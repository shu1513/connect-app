/**
 * Cancelling a call, and what that does to its payment.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { releaseBookingOfCall } from "@/lib/booking/release";
import { settleCancelledMemberCall, settleCancelledMemberIn } from "@/lib/membership/calls";
import { lockMonthsOfCall } from "@/lib/membership/locks";
import { afterTheWait } from "@/lib/membership/rules";
import { closeRoom } from "@/lib/video/livekit";
import { capturePayment, releasePayment } from "./actions";
import { syncHold } from "./hold";
import { CALL_WORDS } from "@/lib/call-page/words";
import { MoneyError } from "./operations";
import { cancellationOutcome } from "./rules";

/**
 * Cancels a call on behalf of its host or its customer, or for the founder when an account is closed.
 * Free before the host's cut-off; after it, the customer is charged the booked price.
 */
/** Cancelling would cost more than the person was shown: nothing was cancelled, and the page shows what it means now. */
export class CancelChangedError extends MoneyError {}

export async function cancelCall(input: {
  call: Call;
  /** The call's own payment (null for a free call). */
  payment: Payment | null;
  by: "host" | "customer" | "admin";
  now: Date;
  /** Why, when it is not simply one of the two people cancelling. Shown to nobody; decides which email goes out. */
  reason?: string;
  /**
   * What the person was shown that cancelling would mean, when a person cancels from a page or a screen. If
   * they were shown "free" and it would now cost the late charge (the free period ended between the page being
   * shown and the button being pressed), nothing is cancelled: they are told, and shown what it means now.
   * Left out by everything that cancels by itself (the helper, closing an account, a block).
   */
  shown?: "free" | "late_charge";
}): Promise<"free" | "late_charge"> {
  const { call, by, now } = input;
  let { payment } = input;
  if (call.cancelledAt) throw new MoneyError("This call was already cancelled.");

  // Work from the payment as it is right now, not as it was when the page was loaded.
  if (payment) [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));

  // The customer may have paid a moment ago without our record knowing yet.
  // Ask Stripe first, so a late cancellation cannot slip through as a free one.
  // (Only a customer's cancellation can be late; for a host or for Connect the outcome is free whatever Stripe says.)
  if (by === "customer" && payment?.status === "awaiting_payment" && payment.stripePaymentIntentId) {
    payment = await syncHold(payment.id, now);
  }

  // A paid call whose money was never held: nobody could enter the room, so it can be
  // cancelled by Connect even after its start time (an instant call's payment deadline
  // is a minute after its start). Always free. This only ever works for the call's own payment:
  // the unpaid payment of a request for more time must never cancel a call that is under way.
  const neverPaid = by === "admin" && input.reason === "unpaid" && payment?.status === "awaiting_payment" && payment.extensionId === null;
  const outcome = neverPaid
    ? "free"
    : cancellationOutcome({
        by,
        now,
        startsAt: call.startsAt,
        freeCancelMinutes: call.freeCancelMinutes,
        held: payment?.status === "held",
      });
  if (outcome === "not_allowed") throw new MoneyError("This call has started, so it can no longer be cancelled.");
  if (input.shown === "free" && outcome === "late_charge") throw new CancelChangedError(CALL_WORDS.cancelChanged);

  // Mark the call cancelled first, so nobody can join it. Only the first cancel wins.
  // In the same step the booking it came from ends and both people's time is free again.
  // For a call booked from a membership the money moves in this same step (it is set aside in the month,
  // so there is nothing to ask Stripe), and the email says where it went.
  const fromMembership = payment?.kind === "member_call";
  await db.transaction(async (tx) => {
    // A month comes before a call in the order of locks.
    if (fromMembership) await lockMonthsOfCall(tx, call.id);
    // The month's locks can make this step wait. Whether the call has started is judged by the clock now, so a call
    // that started while it waited is left alone (a call under way is never cancelled).
    const at = fromMembership ? afterTheWait(now) : now;
    const marked = await tx
      .update(schema.calls)
      .set({ cancelledAt: now, cancelledBy: by, cancelledLate: outcome === "late_charge" })
      // Not a call that was ended with "End call and report" (possible from 5 minutes before the start): it is over,
      // and its money waits for the founder's review. A cancellation must never decide it instead.
      .where(and(eq(schema.calls.id, call.id), isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt), neverPaid ? isNull(schema.calls.closedAt) : gt(schema.calls.startsAt, at)))
      .returning();
    if (marked.length === 0) throw new MoneyError("This call can no longer be cancelled.");
    const memberMoney = fromMembership ? await settleCancelledMemberIn(tx, marked[0], now) : null;
    await releaseBookingOfCall(tx, call.id, by, input.reason, memberMoney);
  });

  // People may already be in the room (it opens 5 minutes early). Put them out now
  // and cancel their entry passes. The always-on helper repeats this until it is confirmed.
  await closeRoom(call.roomName, [call.hostId, call.customerId]).catch((error) => {
    console.error(`[calls] could not close the room of cancelled call ${call.id} yet; the helper will retry`, error);
  });

  if (payment && !fromMembership) {
    try {
      await settleCancelledCall({ ...call, cancelledAt: now, cancelledLate: outcome === "late_charge" }, payment);
    } catch (error) {
      // The call is cancelled either way. The always-on helper finishes the money side.
      console.error(`[payments] could not settle cancelled call ${call.id} yet; the helper will retry`, error);
    }
  }
  return outcome;
}

/**
 * The money side of a cancelled call: charge the booked price after a late
 * cancellation, otherwise let the hold go. Safe to run again.
 *
 * The late-cancellation charge is for the call's own payment only. The payment
 * of a request for more time (which a cancelled call should never have) is only ever let go.
 */
export async function settleCancelledCall(call: Call, payment: Payment): Promise<void> {
  if (payment.status !== "awaiting_payment" && payment.status !== "held") return;
  if (payment.kind === "member_call") return settleCancelledMemberCall(call.id, new Date());
  if (call.cancelledLate && payment.status === "held" && payment.extensionId === null) {
    await capturePayment({
      paymentId: payment.id,
      amountCents: payment.bookedCents,
      reason: "late_cancel",
      frozen: null,
      callEndsAt: call.endsAt,
    });
  } else {
    await releasePayment({ paymentId: payment.id, note: "The call was cancelled." });
  }
}
