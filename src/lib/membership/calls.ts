/**
 * The money of a call that was booked from a membership, after the booking: used, or come back.
 *
 * Such a call's payment (`member_call`) has no hold and no charge of its own at Stripe: its money
 * is set aside in the month. So nothing here asks Stripe anything. Each step is one database
 * step, with the locks in the one order (the membership, the month, the call, its payments), and
 * closes the payment together with the month's numbers, so neither can change without the other.
 *
 * A month that is frozen (its dispute open or lost) is passed over by every step: its money stays
 * set aside until the dispute is won.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import type { MemberMoney } from "@/lib/booking/emails";
import type { ChargeReason, FrozenTotals, Lowered } from "@/lib/payments/actions";
import { addLedgerEntry, lockPayment, MoneyError, type Tx } from "@/lib/payments/operations";
import { ownPaymentOf } from "@/lib/payments/own";
import { attendanceChargeCents, countedSeconds, splitCharge } from "@/lib/payments/pricing";
import { readyToCollectAt, REVIEW_WINDOW_MS } from "@/lib/payments/rules";
import { lockMonthsOfCall, type LockedMonth } from "./locks";
import { comeBack, finishIfSettled, spendSetAside } from "./months";
import { feeTermsFor, isFrozen } from "./rules";

const months = schema.membershipMonths;

/** What became of a member payment: how much was used, how much came back and where to. Or why nothing moved. */
export type Closed = { usedCents: number; backCents: number; backTo: "free" | "card" | null } | "frozen" | "not_held";

type Close = {
  /** How much of what was set aside the call takes. Never more than was set aside; 0 for nothing. */
  usedCents: number;
  reason?: ChargeReason;
  frozen?: FrozenTotals | null;
  pricedThroughEventId?: number | null;
  lowered?: Lowered;
  /** Shown on the founder's pages when nothing was used. */
  note?: string;
  /** Names the event in the pay-back's source key, so each return is owed once. */
  what: string;
  /**
   * How much of what comes back counts as "because of the host" (the rulebook's list). "all": the
   * host cancelled or was not there, an answer or a review lowered it, or Connect cancelled.
   * "as_booked": the member cancelled in time, so each part goes back where it came from.
   */
  hostCaused: "all" | "as_booked";
};

/** The reason on a pay-back to the card, shown to the member. */
const BACK_REASON = "Membership time that was set aside for a call and not used for it.";

/** The month of a payment with its membership, as they stand now. The caller holds their locks. */
async function monthOf(tx: Tx, monthId: string): Promise<LockedMonth> {
  const [row] = await tx
    .select({ membership: schema.memberships, month: months })
    .from(months)
    .innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId))
    .where(eq(months.id, monthId));
  if (!row) throw new MoneyError("Month not found.");
  return row;
}

/**
 * Closes a member payment that is still set aside: what the call takes becomes used (and the
 * host's share of it can be collected like any other), and the rest comes back, to the month's
 * free money or to the member's card. One step; the caller holds the locks of the month, the call
 * and this payment.
 */
export async function closeMemberPayment(tx: Tx, call: Pick<Call, "id" | "endsAt">, payment: Payment, how: Close, now: Date): Promise<Closed> {
  if (payment.kind !== "member_call" || !payment.monthId) throw new MoneyError("This payment is not part of a membership.");
  if (payment.status !== "held") return "not_held";
  const locked = await monthOf(tx, payment.monthId);
  const { month } = locked;
  if (isFrozen(month)) return "frozen";

  const usedCents = Math.max(0, Math.min(how.usedCents, payment.bookedCents));
  const backCents = payment.bookedCents - usedCents;
  if (usedCents > 0) {
    // The fee by the rulebook's "The fee": the month's percentages, and its fixed part on the first amount of the month that is used or expires.
    const terms = feeTermsFor(month);
    const split = splitCharge(usedCents, terms, payment.cardCountry !== null && payment.cardCountry !== "US");
    const [asked] = split.hostShareCents > 0 ? await tx.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id)).limit(1) : [];
    await tx
      .update(schema.payments)
      .set({
        status: "charged",
        needsReview: false,
        chargedCents: usedCents,
        chargeReason: how.reason ?? "attendance",
        chargedAt: now,
        // The month's charge is the charge the host's transfer names.
        stripeChargeId: month.stripeChargeId,
        feeFixedCents: terms.fixedCents,
        originalFeeCents: split.feeCents,
        originalHostShareCents: split.hostShareCents,
        frozenHostSeconds: how.frozen?.hostSeconds ?? null,
        frozenCustomerSeconds: how.frozen?.customerSeconds ?? null,
        frozenTogetherSeconds: how.frozen?.togetherSeconds ?? null,
        pricedThroughEventId: how.pricedThroughEventId ?? null,
        recordCents: how.lowered?.recordCents ?? null,
        loweredBy: how.lowered?.by ?? null,
        transferStatus: split.hostShareCents > 0 ? "not_due" : "not_owed",
        transferDueAt: split.hostShareCents > 0 ? readyToCollectAt({ callEndsAt: call.endsAt, chargedAt: now, refundAsked: Boolean(asked) }) : null,
        updatedAt: now,
      })
      .where(eq(schema.payments.id, payment.id));
    // No "charged to the customer" line: the month has the only one.
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: split.feeCents, stripeRef: month.stripeChargeId, note: how.reason ?? "attendance" });
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: split.hostShareCents, stripeRef: month.stripeChargeId, note: how.reason ?? "attendance" });
    await spendSetAside(tx, month.id, usedCents, !month.fixedFeePlaced);
  } else {
    await tx
      .update(schema.payments)
      .set({ status: "closed_uncharged", needsReview: false, transferStatus: "not_owed", reviewReason: how.note ?? null, recordCents: how.lowered?.recordCents ?? null, loweredBy: how.lowered?.by ?? null, updatedAt: now })
      .where(eq(schema.payments.id, payment.id));
  }

  let backTo: "free" | "card" | null = null;
  if (backCents > 0) {
    backTo = await comeBack(tx, locked, {
      cents: backCents,
      hostCausedCents: how.hostCaused === "all" ? backCents : Math.min(payment.hostCausedCents, backCents),
      sourceKey: `callreturn:${payment.id}:${how.what}`,
      reason: BACK_REASON,
      paymentId: payment.id,
      now,
    });
  }
  // A month that had ended and was only waiting for this call may be finished now.
  await finishIfSettled(tx, (await monthOf(tx, month.id)).month, now);
  return { usedCents, backCents, backTo };
}

/** One step for one call, with the locks in order: its months, the call, then whatever `work` locks of its payments. */
async function inCallStep<T>(callId: string, work: (tx: Tx, call: Call) => Promise<T>): Promise<T | null> {
  return db.transaction(async (tx) => {
    await lockMonthsOfCall(tx, callId);
    const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, callId)).for("update");
    return call ? work(tx, call) : null;
  });
}

/** Whether the month of this payment is frozen, read without a lock: a first look, so the settle jobs pass over it cheaply. */
async function monthIsFrozen(monthId: string): Promise<boolean> {
  const [month] = await db.select({ dispute: months.dispute }).from(months).where(eq(months.id, monthId));
  return !month || isFrozen(month);
}

/** The last moment a member's call can wait for the founder's decision or for its record: 3 days after the call. There is no hold that could end sooner. */
export const memberDecisionDeadline = (call: Pick<Call, "endsAt">): Date => new Date(call.endsAt.getTime() + REVIEW_WINDOW_MS);

/**
 * What the helper does with a member payment of a call that has ended (the counterpart of
 * `settleOne` in payments/jobs.ts). Gives back "ordinary" when the record is final and gives an
 * amount: that money is then used at the call's moment, with the call's other charges (take.ts).
 */
export async function settleMemberOne(found: Payment, call: Call, now: Date): Promise<"ordinary" | void> {
  if (found.kind !== "member_call" || found.status !== "held" || !found.monthId) return;
  if (await monthIsFrozen(found.monthId)) return;

  /** Everything set aside comes back, if the payment still stands as it was seen. */
  const allBack = (what: string, note: string, underReview: boolean) =>
    inCallStep(call.id, async (tx, locked) => {
      const payment = await lockPayment(tx, found.id);
      if (payment.status !== "held" || payment.needsReview !== underReview) return;
      await closeMemberPayment(tx, locked, payment, { usedCents: 0, note, what, hostCaused: "all" }, now);
    });

  const deadline = memberDecisionDeadline(call);
  if (found.needsReview) {
    if (now >= deadline) await allBack("undecided", "No decision was made in time, so the time set aside came back.", true);
    return;
  }

  const attendance = await loadAttendance(call, now, { from: found.coversFrom, until: found.coversUntil });
  if (!attendance.final || !call.closedAt) {
    if (now >= deadline) await allBack("not_final", "The call's record was not final in time, so the time set aside came back.", false);
    return;
  }

  if (attendance.result.status === "complete" && attendance.result.totals) {
    const amountCents = attendanceChargeCents({ pricePer15Cents: found.pricePer15Cents, bookedSeconds: attendance.bookedSeconds, countedSeconds: countedSeconds(call, attendance.result.totals) });
    if (amountCents === 0) {
      await allBack("nothing_owed", "Nothing was owed for this call.", false);
      return;
    }
    return "ordinary";
  }

  // The record is incomplete or contradicts itself: the founder reviews it, as for a card payment.
  await db.transaction(async (tx) => {
    const payment = await lockPayment(tx, found.id);
    if (payment.status !== "held" || payment.needsReview) return;
    await tx
      .update(schema.payments)
      .set({ needsReview: true, reviewReason: attendance.result.reasons.join(" ") || "The call's record is incomplete.", updatedAt: new Date() })
      .where(eq(schema.payments.id, payment.id));
  });
}

/**
 * The money of a cancelled member call, inside a step that already holds the locks of its months
 * and of the call. A late cancellation by the member uses everything that was set aside; any other
 * cancellation gives it back. Returns where the money went, for the email, or null when there was
 * nothing to settle.
 */
export async function settleCancelledMemberIn(tx: Tx, call: Pick<Call, "id" | "endsAt" | "cancelledBy" | "cancelledLate">, now: Date): Promise<MemberMoney | null> {
  const own = await ownPaymentOf(call.id, tx);
  if (!own || own.kind !== "member_call") return null;
  const payment = await lockPayment(tx, own.id);
  // Money that waits for the founder's review is only ever decided by the founder (or by the review's time limit).
  if (payment.needsReview) return null;
  const closed = call.cancelledLate
    ? await closeMemberPayment(tx, call, payment, { usedCents: payment.bookedCents, reason: "late_cancel", frozen: null, what: "late_cancel", hostCaused: "all" }, now)
    : await closeMemberPayment(tx, call, payment, { usedCents: 0, note: "The call was cancelled.", what: "cancelled", hostCaused: call.cancelledBy === "customer" ? "as_booked" : "all" }, now);
  if (closed === "frozen") return "kept";
  if (closed === "not_held") return null;
  return closed.usedCents > 0 ? "used" : closed.backTo;
}

/** For the helper: the money of a cancelled member call that could not be settled when it was cancelled (its month was frozen then). Safe to run again. */
export async function settleCancelledMemberCall(callId: string, now: Date): Promise<void> {
  await inCallStep(callId, async (tx, call) => {
    if (call.cancelledAt) await settleCancelledMemberIn(tx, call, now);
  });
}

/**
 * The founder's decision on a member payment under review: use an amount, or let everything come
 * back. The same ceilings a card payment has: what was set aside, the time before the call was
 * stopped (`maxCents`), and an answer to a refund request that was accepted before the review.
 */
export async function decideMemberReview(input: { paymentId: string; amountCents: number | null; maxCents?: number; frozen: FrozenTotals | null; now: Date }): Promise<void> {
  const [seen] = await db.select({ callId: schema.payments.callId }).from(schema.payments).where(eq(schema.payments.id, input.paymentId));
  if (!seen?.callId) throw new MoneyError("Payment not found.");
  const done = await inCallStep(seen.callId, async (tx, call) => {
    const payment = await lockPayment(tx, input.paymentId);
    if (payment.kind !== "member_call") throw new MoneyError("This payment is not part of a membership.");
    if (payment.status !== "held") throw new MoneyError("This payment is not waiting any more.");
    if (!payment.needsReview) throw new MoneyError("This payment is not waiting for review.");
    if (input.now >= memberDecisionDeadline(call)) throw new MoneyError("The deadline for deciding this call has passed.");
    if (input.amountCents === null) {
      return closeMemberPayment(tx, call, payment, { usedCents: 0, note: "Released by Connect after review.", what: "review", hostCaused: "all" }, input.now);
    }
    const amountCents = input.amountCents;
    // Time added to a call counts only if the host accepted that request.
    if (payment.extensionId) {
      const [extension] = await tx.select({ status: schema.callExtensions.status }).from(schema.callExtensions).where(eq(schema.callExtensions.id, payment.extensionId));
      if (extension?.status !== "accepted") throw new MoneyError("This request for more time was not accepted, so nothing can be used for it.");
    }
    // An answer to a refund request that was accepted for this charge before the review stays the most the member pays.
    const [answer] = await tx
      .select({ choice: schema.refundRequestAnswers.choice, maxCents: schema.refundRequestAnswers.maxCents })
      .from(schema.refundRequestAnswers)
      .innerJoin(schema.refundRequests, eq(schema.refundRequests.id, schema.refundRequestAnswers.requestId))
      .where(and(eq(schema.refundRequestAnswers.paymentId, payment.id), eq(schema.refundRequests.status, "answered")));
    if (answer?.choice === "nothing") throw new MoneyError("The answer to this call's refund request was \"charge nothing\" for this charge. Release it instead.");
    if (answer?.choice === "less" && amountCents > (answer.maxCents ?? 0)) throw new MoneyError(`The answer to this call's refund request was "at most $${((answer.maxCents ?? 0) / 100).toFixed(2)}" for this charge. Use that or less.`);
    if (!Number.isInteger(amountCents) || amountCents < 50) throw new MoneyError("The amount is below the minimum that can be used.");
    if (amountCents > payment.bookedCents) throw new MoneyError("The amount is more than was set aside for this call.");
    if (input.maxCents !== undefined && amountCents > input.maxCents) throw new MoneyError("The amount is more than the time before the call was stopped allows.");
    return closeMemberPayment(tx, call, payment, { usedCents: amountCents, reason: "admin", frozen: input.frozen, what: "review", hostCaused: "all" }, input.now);
  });
  if (done === "frozen") throw new MoneyError("This month's charge is disputed at the member's bank, so nothing of it moves until that is decided.");
  if (done === null) throw new MoneyError("Call not found.");
}
