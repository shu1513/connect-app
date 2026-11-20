/**
 * Cancelling a call, and what that does to its payment.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import type { MemberMoney } from "@/lib/booking/emails";
import { releaseBookingOfCall } from "@/lib/booking/release";
import { settleCancelledMemberCall, settleCancelledMemberIn } from "@/lib/membership/calls";
import { lockMonthsOfCall } from "@/lib/membership/locks";
import { afterTheWait } from "@/lib/membership/rules";
import { closeRoom } from "@/lib/video/livekit";
import { capturePayment, releasePayment } from "./actions";
import { syncHoldLocked } from "./hold";
import { CALL_WORDS } from "@/lib/call-page/words";
import { lockPayment, MoneyError } from "./operations";
import { cancellationOutcome } from "./rules";

/** Cancelling would cost more than the person was shown: nothing was cancelled, and the page shows what it means now. */
export class CancelChangedError extends MoneyError {}

type CancelInput = {
  call: Call;
  /** The call's own payment (null for a free call). */
  payment: Payment | null;
  by: "host" | "customer" | "admin";
  now: Date;
  /** Why, when it is not simply one of the two people cancelling. Shown to nobody; decides which email goes out. */
  reason?: string;
  /**
   * What the person was shown that cancelling would mean, when a person cancels from a page or a screen. If
   * they were shown "free" and it would now cost the late charge (the free period ended, or a hold was placed,
   * between the page being shown and the call being cancelled), nothing is cancelled: they are told, and shown
   * what it means now. Left out by everything that cancels by itself (the helper, closing an account, a block).
   */
  shown?: "free" | "late_charge";
};

/** What a cancellation did. */
export type Cancelled = {
  outcome: "free" | "late_charge";
  /** A member's call: what became of the membership time set aside for it. Null when nothing was settled, and for every other call. */
  memberMoney: MemberMoney | null;
  /** A free cancellation of a call with a card hold placed or begun: that hold is being let go. */
  holdLetGo: boolean;
};

/**
 * Cancels a call on behalf of its host or its customer, or for the founder when an account is closed.
 * Free before the host's cut-off; after it, the customer is charged the booked price.
 */
export async function cancelCall(input: CancelInput): Promise<"free" | "late_charge"> {
  return (await cancelCallWith(input)).outcome;
}

/** The same, answering with everything a page says afterwards. */
export async function cancelCallWith(input: CancelInput): Promise<Cancelled> {
  const { call, by, now } = input;
  let { payment } = input;
  if (call.cancelledAt) throw new MoneyError("This call was already cancelled.");

  // Work from the payment as it is right now, not as it was when the page was loaded.
  if (payment) [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));

  // What cancelling means is decided, compared with what the person was shown, and written down in one step,
  // with the call and its own payment locked and read again: nothing can change between the decision and the
  // cancelling (a hold landing, the free period ending while this step waited for a lock).
  // In the same step the booking it came from ends and both people's time is free again.
  // For a call booked from a membership the money moves in this same step (it is set aside in the month,
  // so there is nothing to ask Stripe), and the email says where it went.
  const fromMembership = payment?.kind === "member_call";
  const paymentId = payment?.id ?? null;
  const done = await db.transaction(async (tx) => {
    // A month comes before a call, and a call before its payment, in the order of locks.
    if (fromMembership) await lockMonthsOfCall(tx, call.id);
    const [fresh] = await tx.select().from(schema.calls).where(eq(schema.calls.id, call.id)).for("update");
    if (!fresh || fresh.cancelledAt) throw new MoneyError("This call can no longer be cancelled.");
    let own = paymentId ? await lockPayment(tx, paymentId) : null;
    // The customer may have paid a moment ago without our record knowing yet (the bank can say yes while this step
    // waits for its locks). Stripe is asked here, with the payment locked, so a late cancellation can never slip
    // through as a free one, and the host never loses a charge that was hers. The same when the helper cancels a
    // call as "unpaid": a hold that is there, or still being confirmed, must not be missed. If Stripe cannot be
    // asked, or its answer is not final yet, this throws and nothing is cancelled. (A host's cancellation, and any
    // other of Connect's, is free whatever Stripe says, and does not ask.)
    if ((by === "customer" || input.reason === "unpaid") && own) own = await syncHoldLocked(tx, own);
    // The locks, and Stripe's answer, can make this step wait. So the clock is read only now, with everything
    // else known: when a person cancels from a page (`shown`), and always for a member's call, a free period that
    // ended, or a call that started, while this step waited counts. (Everything else keeps the moment it was
    // handed: the helper, and the check scripts with their own clocks.)
    const at = input.shown !== undefined || fromMembership ? afterTheWait(now) : now;

    // From here on a "no" is handed back, not thrown: a hold that was just found and written down above must stay
    // written down when nothing is cancelled, and a thrown error would undo it with the rest of this step.

    // A paid call whose money was never held: nobody could enter the room, so it can be
    // cancelled by Connect even after its start time (an instant call's payment deadline
    // is a minute after its start). Always free. This only ever works for the call's own payment:
    // the unpaid payment of a request for more time must never cancel a call that is under way.
    const neverPaid = by === "admin" && input.reason === "unpaid" && own?.status === "awaiting_payment" && own.extensionId === null;
    // "Unpaid" is the helper's reason for cancelling a call whose money was not held in time, and for nothing else:
    // if the money has been held meanwhile, the call stands.
    if (input.reason === "unpaid" && !neverPaid) return { refused: new MoneyError("This call has been paid for meanwhile, so it is not cancelled as unpaid.") };
    const outcome = neverPaid ? "free" : cancellationOutcome({ by, now: at, startsAt: fresh.startsAt, freeCancelMinutes: fresh.freeCancelMinutes, held: own?.status === "held" });
    if (outcome === "not_allowed") return { refused: new MoneyError("This call has started, so it can no longer be cancelled.") };
    if (input.shown === "free" && outcome === "late_charge") return { refused: new CancelChangedError(CALL_WORDS.cancelChanged) };

    // Mark the call cancelled, so nobody can join it. Only the first cancel wins.
    const marked = await tx
      .update(schema.calls)
      // Dated by the same clock the decision was made by, so the record never shows a late charge inside the free period.
      .set({ cancelledAt: at, cancelledBy: by, cancelledLate: outcome === "late_charge" })
      // Not a call that was ended with "End call and report" (possible from 5 minutes before the start): it is over,
      // and its money waits for the founder's review. A cancellation must never decide it instead.
      .where(and(eq(schema.calls.id, call.id), isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt), neverPaid ? isNull(schema.calls.closedAt) : gt(schema.calls.startsAt, at)))
      .returning();
    if (marked.length === 0) return { refused: new MoneyError("This call can no longer be cancelled.") };
    const memberMoney = fromMembership ? await settleCancelledMemberIn(tx, marked[0], at) : null;
    await releaseBookingOfCall(tx, call.id, by, input.reason, memberMoney);
    return { outcome, memberMoney, own, at };
  });
  // Said only now, with the step saved: nothing was cancelled, and whatever was learned about the hold is kept.
  if ("refused" in done) throw done.refused;

  // Two things follow, side by side, and neither waits for the other:
  // people may already be in the room (it opens 5 minutes early), so they are put out and their entry passes
  // cancelled (the always-on helper repeats this until it is confirmed); and the money side is finished, so a hold
  // that is not wanted any more is let go at once (the helper finishes this too, if it does not go through now).
  await Promise.all([
    closeRoom(call.roomName, [call.hostId, call.customerId]).catch((error) => {
      console.error(`[calls] could not close the room of cancelled call ${call.id} yet; the helper will retry`, error);
    }),
    done.own && !fromMembership
      ? settleCancelledCall({ ...call, cancelledAt: done.at, cancelledLate: done.outcome === "late_charge" }, done.own).catch((error) => {
          // The call is cancelled either way.
          console.error(`[payments] could not settle cancelled call ${call.id} yet; the helper will retry`, error);
        })
      : null,
  ]);
  return { outcome: done.outcome, memberMoney: done.memberMoney, holdLetGo: !fromMembership && done.outcome === "free" && Boolean(done.own?.stripePaymentIntentId) };
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
