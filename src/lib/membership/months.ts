/**
 * The only code that changes a month's numbers.
 *
 * A month's money is always in exactly one of six places: free, set aside,
 * used, expired, to be paid back, paid back (the rulebook's "Where a month's
 * money can be"). Each function here is one movement between two of them. It
 * runs inside the caller's database step, with the month already locked
 * (locks.ts), changes both places in ONE statement (the database checks after
 * every statement that the six add up), and is safe to run twice.
 *
 * None of them asks Stripe anything.
 *
 * Part two adds the three movements of a call here: set aside, used, come back.
 */
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { MembershipMonth, MembershipRefund } from "@/db/schema";
import { addLedgerEntry, MoneyError, type Tx } from "@/lib/payments/operations";
import { splitCharge } from "@/lib/payments/pricing";
import { COLLECT_EXPIRED_AFTER_MS, feeTermsFor, isFrozen, splitAtEnd } from "./rules";

const months = schema.membershipMonths;

// The month's lock (the rulebook's "How the parts connect" hands it over from this file).
export { lockForMonth, lockMonth, type LockedMonth } from "./locks";

async function reread(tx: Tx, monthId: string): Promise<MembershipMonth> {
  const [month] = await tx.select().from(months).where(eq(months.id, monthId));
  return month;
}

/**
 * The whole monthly amount is confirmed taken: the month runs, and all of it is free. Writes the
 * month's one "charged to the customer" line. Does nothing unless the month is still only held.
 */
export async function openMonth(tx: Tx, month: MembershipMonth, taken: { chargeId: string | null; at: Date }): Promise<MembershipMonth> {
  const opened = await tx
    .update(months)
    .set({ status: "running", freeCents: month.totalCents, takenAt: taken.at, takenCents: month.totalCents, stripeChargeId: taken.chargeId ?? month.stripeChargeId, updatedAt: taken.at })
    .where(and(eq(months.id, month.id), eq(months.status, "held")))
    .returning();
  if (opened.length === 0) return reread(tx, month.id);
  await addLedgerEntry(tx, { monthId: month.id, kind: "customer_charge", amountCents: month.totalCents, stripeRef: opened[0].stripeChargeId, note: "membership month" });
  return opened[0];
}

/**
 * Owes money back to the member's card, once: `sourceKey` names the one event that owes it, and a
 * second call with the same key changes nothing. The money leaves "free" (its host-caused part
 * first, since that part is the one that is paid back anyway). Refused for a frozen month.
 * Returns the line, and whether this call is the one that made it.
 */
export async function owePayBack(
  tx: Tx,
  month: MembershipMonth,
  input: { amountCents: number; sourceKey: string; reason: string; paymentId?: string | null },
): Promise<{ refund: MembershipRefund; created: boolean }> {
  const [existing] = await tx.select().from(schema.membershipRefunds).where(eq(schema.membershipRefunds.sourceKey, input.sourceKey));
  if (existing) return { refund: existing, created: false };
  if (isFrozen(month)) throw new MoneyError("This month's charge is disputed at the member's bank, so nothing is paid back from it now.");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > month.freeCents) throw new MoneyError("That is more than this month has free.");
  const [refund] = await tx
    .insert(schema.membershipRefunds)
    .values({ monthId: month.id, sourceKey: input.sourceKey, amountCents: input.amountCents, reason: input.reason, paymentId: input.paymentId ?? null })
    .returning();
  await tx
    .update(months)
    .set({
      freeCents: sql`${months.freeCents} - ${input.amountCents}`,
      hostCausedCents: sql`greatest(${months.hostCausedCents} - ${input.amountCents}, 0)`,
      toPayBackCents: sql`${months.toPayBackCents} + ${input.amountCents}`,
      updatedAt: new Date(),
    })
    .where(eq(months.id, month.id));
  return { refund, created: true };
}

/** Stripe confirmed a pay-back: the money moves from "to be paid back" to "paid back", once. */
export async function payBackDone(tx: Tx, refund: MembershipRefund, stripeRefundId: string, now: Date): Promise<boolean> {
  const marked = await tx
    .update(schema.membershipRefunds)
    .set({ status: "done", stripeRefundId, finishedAt: now })
    .where(and(eq(schema.membershipRefunds.id, refund.id), sql`${schema.membershipRefunds.status} <> 'done'`))
    .returning({ id: schema.membershipRefunds.id });
  if (marked.length === 0) return false;
  await tx
    .update(months)
    .set({ toPayBackCents: sql`${months.toPayBackCents} - ${refund.amountCents}`, paidBackCents: sql`${months.paidBackCents} + ${refund.amountCents}`, updatedAt: now })
    .where(eq(months.id, refund.monthId));
  await addLedgerEntry(tx, { monthId: refund.monthId, kind: "customer_refund", amountCents: -refund.amountCents, stripeRef: stripeRefundId, note: refund.reason });
  return true;
}

/**
 * The end of a month (the rulebook's step 5): it is closed for bookings, and its free money is
 * split. The host-caused part is owed back to the card; the rest has expired, and becomes the
 * month's one "expired time" payment, which the host collects like any other share.
 * Does nothing unless the month is running. A frozen month is closed but its money is not moved.
 */
export async function closeAtEnd(tx: Tx, month: MembershipMonth, now: Date): Promise<MembershipMonth> {
  if (month.status !== "running") return month;
  if (isFrozen(month)) {
    const [closed] = await tx.update(months).set({ status: "closed", updatedAt: now }).where(and(eq(months.id, month.id), eq(months.status, "running"))).returning();
    return closed ?? reread(tx, month.id);
  }
  const { expiredCents, payBackCents } = splitAtEnd(month);
  if (payBackCents > 0) await owePayBack(tx, month, { amountCents: payBackCents, sourceKey: `monthend:${month.id}`, reason: "Time the host cancelled or was not there for, and that was not used again by the end of the month." });

  // What reaches the host of the expired money, by the rulebook's "The fee": the percentages, and the
  // month's fixed part if no amount of this month has carried it yet.
  const terms = feeTermsFor(month);
  const split = splitCharge(expiredCents, terms, month.cardCountry !== null && month.cardCountry !== "US");
  const [closed] = await tx
    .update(months)
    .set({
      status: "closed",
      freeCents: sql`${months.freeCents} - ${expiredCents}`,
      expiredCents: sql`${months.expiredCents} + ${expiredCents}`,
      fixedFeePlaced: month.fixedFeePlaced || expiredCents > 0,
      updatedAt: now,
    })
    .where(and(eq(months.id, month.id), eq(months.status, "running")))
    .returning();
  if (!closed) return reread(tx, month.id);
  if (expiredCents > 0) {
    const [payment] = await tx
      .insert(schema.payments)
      .values({
        kind: "member_expired",
        monthId: month.id,
        // No call. The stretch it stands for is the month itself.
        coversFrom: month.startsAt ?? now,
        coversUntil: month.endsAt ?? now,
        pricePer15Cents: month.pricePer15Cents,
        bookedCents: expiredCents,
        feePercentBps: terms.percentBps,
        feeFixedCents: terms.fixedCents,
        feeForeignCardBps: terms.foreignCardBps,
        status: "charged",
        chargedCents: expiredCents,
        chargeReason: "expired",
        chargedAt: now,
        // The month's charge is the charge the host's transfer names. The month keeps its PaymentIntent to itself.
        stripeChargeId: month.stripeChargeId,
        cardCountry: month.cardCountry,
        originalFeeCents: split.feeCents,
        originalHostShareCents: split.hostShareCents,
        transferStatus: split.hostShareCents > 0 ? "not_due" : "not_owed",
        transferDueAt: split.hostShareCents > 0 ? new Date((month.endsAt ?? now).getTime() + COLLECT_EXPIRED_AFTER_MS) : null,
      })
      .returning({ id: schema.payments.id });
    // No "charged to the customer" line here: the month has the only one.
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: split.feeCents, stripeRef: month.stripeChargeId, note: "expired member time" });
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: split.hostShareCents, stripeRef: month.stripeChargeId, note: "expired member time" });
  }
  return closed;
}

/** A closed month with nothing set aside and nothing owed back, and no dispute holding it, is finished. */
export async function finishIfSettled(tx: Tx, month: MembershipMonth, now: Date): Promise<MembershipMonth> {
  if (month.status !== "closed" || isFrozen(month) || month.setAsideCents !== 0 || month.toPayBackCents !== 0 || month.freeCents !== 0) return month;
  const [finished] = await tx.update(months).set({ status: "finished", updatedAt: now }).where(and(eq(months.id, month.id), eq(months.status, "closed"))).returning();
  return finished ?? reread(tx, month.id);
}

/**
 * A charge first found after the fact (plans/20, syncMonth): Stripe took a month's whole amount
 * although we had not opened it. It is recorded once, and all of it is owed back. The month
 * becomes "closed", so the six places hold. Gives no time.
 */
export async function recordChargeOwedBack(tx: Tx, month: MembershipMonth, taken: { chargeId: string | null; at: Date }): Promise<MembershipMonth> {
  if (month.status !== "to_pay" && month.status !== "held" && month.status !== "given_up") return month;
  const [recorded] = await tx
    .update(months)
    .set({ status: "closed", toPayBackCents: month.totalCents, takenAt: taken.at, takenCents: month.totalCents, stripeChargeId: taken.chargeId ?? month.stripeChargeId, updatedAt: taken.at })
    .where(and(eq(months.id, month.id), eq(months.status, month.status)))
    .returning();
  if (!recorded) return reread(tx, month.id);
  await addLedgerEntry(tx, { monthId: month.id, kind: "customer_charge", amountCents: month.totalCents, stripeRef: recorded.stripeChargeId, note: "membership month, taken after it was given up" });
  await tx
    .insert(schema.membershipRefunds)
    .values({ monthId: month.id, sourceKey: `late:${month.id}`, amountCents: month.totalCents, reason: "This payment went through after the month had been given up, so all of it is paid back." })
    .onConflictDoNothing();
  return recorded;
}

/**
 * Stripe took a different amount than the month's whole amount. The month stays out of the six
 * places (they are all zero), remembers what Stripe really took, and waits for the founder.
 */
export async function recordOddCharge(tx: Tx, month: MembershipMonth, taken: { cents: number; chargeId: string | null; at: Date }): Promise<MembershipMonth> {
  if (month.takenAt) return month;
  const [marked] = await tx
    .update(months)
    .set({
      problem: `Stripe took $${(taken.cents / 100).toFixed(2)} for this month, not the whole $${(month.totalCents / 100).toFixed(2)}. Nothing was given for it. Please settle it by hand.`,
      takenCents: taken.cents,
      takenAt: taken.at,
      stripeChargeId: taken.chargeId ?? month.stripeChargeId,
      updatedAt: taken.at,
    })
    .where(eq(months.id, month.id))
    .returning();
  await addLedgerEntry(tx, { monthId: month.id, kind: "customer_charge", amountCents: taken.cents, stripeRef: marked.stripeChargeId, note: "membership month, an amount that does not match" });
  return marked;
}

/** Records where a month's bank dispute stands. Returns the month, and whether this is the first we record of a dispute on it. */
export async function setDispute(tx: Tx, month: MembershipMonth, state: "open" | "won" | "lost", now: Date): Promise<{ month: MembershipMonth; first: boolean }> {
  if (month.dispute === state) return { month, first: false };
  const [updated] = await tx.update(months).set({ dispute: state, updatedAt: now }).where(eq(months.id, month.id)).returning();
  return { month: updated, first: month.dispute === "none" };
}
