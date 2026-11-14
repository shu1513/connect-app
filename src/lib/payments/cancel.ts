/**
 * Cancelling a call, and what that does to its payment.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { releaseBookingOfCall } from "@/lib/booking/release";
import { closeRoom } from "@/lib/video/livekit";
import { capturePayment, releasePayment } from "./actions";
import { syncHold } from "./hold";
import { MoneyError } from "./operations";
import { cancellationOutcome } from "./rules";

/**
 * Cancels a call on behalf of its host or its customer, or for the founder when an account is closed.
 * Free before the host's cut-off; after it, the customer is charged the booked price.
 */
export async function cancelCall(input: {
  call: Call;
  /** The call's own payment (null for a free call). */
  payment: Payment | null;
  by: "host" | "customer" | "admin";
  now: Date;
  /** Why, when it is not simply one of the two people cancelling. Shown to nobody; decides which email goes out. */
  reason?: string;
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

  // Mark the call cancelled first, so nobody can join it. Only the first cancel wins.
  // In the same step the booking it came from ends and both people's time is free again.
  await db.transaction(async (tx) => {
    const marked = await tx
      .update(schema.calls)
      .set({ cancelledAt: now, cancelledBy: by, cancelledLate: outcome === "late_charge" })
      .where(and(eq(schema.calls.id, call.id), isNull(schema.calls.cancelledAt), neverPaid ? isNull(schema.calls.closedAt) : gt(schema.calls.startsAt, now)))
      .returning({ id: schema.calls.id });
    if (marked.length === 0) throw new MoneyError("This call can no longer be cancelled.");
    await releaseBookingOfCall(tx, call.id, by, input.reason);
  });

  // People may already be in the room (it opens 5 minutes early). Put them out now
  // and cancel their entry passes. The always-on helper repeats this until it is confirmed.
  await closeRoom(call.roomName, [call.hostId, call.customerId]).catch((error) => {
    console.error(`[calls] could not close the room of cancelled call ${call.id} yet; the helper will retry`, error);
  });

  if (payment) {
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
