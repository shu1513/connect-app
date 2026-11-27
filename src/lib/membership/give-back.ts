/**
 * Giving time back after a member call's money was used: where the host's refund form and the
 * founder's go for a `member_call` payment (a card payment goes to `refundPayment`).
 *
 * Nothing is refunded at Stripe by this step. In one database step, with the month locked: used
 * becomes free again, or, when the member can no longer book from that month, owed back to their
 * card (which `payback.ts` then sends); the payment's refunded amount grows and its fee and
 * host's share shrink in proportion; and a line is added to `refunds` that is done at once, so an
 * open refund request counts as answered.
 *
 * The form's own id is the id of that line and part of the pay-back's key, so the same press
 * twice gives back once, and two different amounts are two.
 *
 * After the host has collected her share of the call (plans/50-part-2-member-time-owed-back.md):
 * only the founder, from the founder's refund page (`afterCollection`), with a reason. The money
 * then always goes back to the member's card, never into the membership again: time that was
 * free again could be booked a second time, and the month's one charge cannot carry the host's
 * share of it twice. The line carries what her share was before and after, and the helper
 * writes her take-back from it, as for a call paid by card (disputes/takeback.ts).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentSplit } from "@/lib/payments/actions";
import { addLedgerEntry, lockPayment, MoneyError } from "@/lib/payments/operations";
import { splitAfterRefunds } from "@/lib/payments/pricing";
import { queueTimeBackEmail } from "@/lib/refunds/emails";
import { lockMonthsOfCall } from "./locks";
import { finishIfSettled, giveUsedBack } from "./months";
import { afterTheWait, isFrozen } from "./rules";

const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns where the time went: back into the membership ("free"), or to the member's card ("card"). */
export async function giveTimeBack(input: {
  paymentId: string;
  amountCents: number;
  decidedBy: string;
  decidedAs: "host" | "admin";
  reason: string | null;
  requestId: string;
  /** The founder's refund page, and nothing else: time may be given back although the host has collected. */
  afterCollection?: boolean;
  /** What that page said when its form was drawn: whether the host had collected. If that has changed, nothing is given back. */
  shownCollected?: boolean;
  now?: Date;
}): Promise<"free" | "card"> {
  if (!IS_ID.test(input.requestId)) throw new MoneyError("This refund request is not valid. Reload the page and try again.");
  const asked = input.now ?? new Date();
  const [seen] = await db.select({ callId: schema.payments.callId }).from(schema.payments).where(eq(schema.payments.id, input.paymentId));
  if (!seen?.callId) throw new MoneyError("Payment not found.");
  const callId = seen.callId;

  return db.transaction(async (tx) => {
    // The one order of locks: the membership and the month, the call, the payment, then refund records.
    await lockMonthsOfCall(tx, callId);
    await tx.select({ id: schema.calls.id }).from(schema.calls).where(eq(schema.calls.id, callId)).for("update");
    const payment = await lockPayment(tx, input.paymentId);
    // The moment of the step, read once the locks are held: a refund request that was asked while this waited counts as answered by it.
    const now = afterTheWait(asked);
    if (payment.kind !== "member_call" || !payment.monthId) throw new MoneyError("This payment is not part of a membership.");

    // The same press again: it was given back once, and that stands.
    const [again] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, input.requestId));
    if (again) {
      if (again.paymentId !== payment.id) throw new MoneyError("This refund request did not go through. Reload the page to try again.");
      const [owed] = await tx.select({ id: schema.membershipRefunds.id }).from(schema.membershipRefunds).where(eq(schema.membershipRefunds.sourceKey, `giveback:${again.id}`));
      return owed ? "card" : "free";
    }

    // The same limits a card refund has, in the same order.
    if (payment.status !== "charged" || payment.chargedCents === null || payment.originalHostShareCents === null) throw new MoneyError("Nothing was used for this call.");
    const collected = payment.transferStatus === "sent";
    // A form that explained another outcome than this press would have gives nothing back.
    if (input.shownCollected !== undefined && input.shownCollected !== collected) throw new MoneyError(collected ? "The host has collected her share of this call since this page was drawn. Nothing was given back. Look at the form again: giving time back now makes her owe her share of it back." : "This page is out of date. Nothing was given back. Look at the form again.");
    if (collected) {
      if (!(input.afterCollection && input.decidedAs === "admin")) throw new MoneyError("The host has already been paid for this call. Giving time back now has to go through support.");
      if (!input.reason?.trim()) throw new MoneyError("Say why Connect gives this time back in the host's place: the host is told the reason.");
    }
    const [row] = await tx
      .select({ membership: schema.memberships, month: schema.membershipMonths })
      .from(schema.membershipMonths)
      .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
      .where(eq(schema.membershipMonths.id, payment.monthId));
    if (!row) throw new MoneyError("Month not found.");
    if (isFrozen(row.month)) throw new MoneyError("The member's bank has disputed this month's charge, so nothing of it can be given back now.");
    // A share that was written down for collecting can no longer come back, also while Stripe's answer is awaited.
    const [unfinished] = await tx.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started"))).limit(1);
    if (unfinished) throw new MoneyError("The host's share of this call is being sent right now, so nothing can be given back at the moment.");
    if (!Number.isInteger(input.amountCents) || input.amountCents < 1) throw new MoneyError("Enter an amount to give back.");
    if (input.amountCents > payment.chargedCents - payment.refundedCents) throw new MoneyError("That is more than what is left to give back.");

    // The fee and the host's share shrink in the same proportion, as for a card refund.
    const before = currentSplit(payment);
    const refundedCents = payment.refundedCents + input.amountCents;
    const after = splitAfterRefunds({ chargeCents: payment.chargedCents, refundedCents, originalHostShareCents: payment.originalHostShareCents });
    // After collection the line says what her share lost, and its place among this payment's refunds after the
    // sending: her take-back is worked out from these numbers (as applyRefundDone writes them for a card refund).
    const [last] = collected ? await tx.select({ no: sql<number>`coalesce(max(${schema.refunds.afterCollectionNo}), 0)::int` }).from(schema.refunds).where(eq(schema.refunds.paymentId, payment.id)) : [{ no: 0 }];
    const [refund] = await tx
      .insert(schema.refunds)
      .values({
        id: input.requestId,
        paymentId: payment.id,
        amountCents: input.amountCents,
        decidedBy: input.decidedBy,
        decidedAs: input.decidedAs,
        reason: input.reason,
        status: "done",
        createdAt: now,
        finishedAt: now,
        ...(collected
          ? { afterCollection: true, shareBeforeCents: before.hostShareCents, shareAfterCents: after.hostShareCents, feeBeforeCents: before.feeCents, feeAfterCents: after.feeCents, hostOwesCents: Math.max(0, before.hostShareCents - after.hostShareCents), afterCollectionNo: last.no + 1 }
          : {}),
      })
      .returning();

    // Used becomes free again or owed to the card. Given back by the host or by Connect: it counts as "because of the host".
    const to = await giveUsedBack(tx, row, {
      cents: input.amountCents,
      hostCausedCents: input.amountCents,
      sourceKey: `giveback:${refund.id}`,
      reason: "Membership time a call had used, given back afterwards.",
      paymentId: payment.id,
      now,
      // After collection: to the card, whatever the month still allows.
      toCard: collected,
    });
    if (!to) throw new MoneyError("This refund request did not go through. Reload the page to try again.");

    // (A share that was sent stays "sent", also when nothing is left of it: what was sent is what her take-back is about.)
    await tx
      .update(schema.payments)
      .set({ refundedCents, transferStatus: after.hostShareCents === 0 && !collected ? "not_owed" : payment.transferStatus, updatedAt: now })
      .where(eq(schema.payments.id, payment.id));
    // No "refunded to the customer" line here: nothing left Connect in this step. A pay-back to the card writes its own when Stripe confirms it.
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: after.feeCents - before.feeCents, stripeRef: null, note: "time given back" });
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: after.hostShareCents - before.hostShareCents, stripeRef: null, note: "time given back" });

    const [month] = await tx.select().from(schema.membershipMonths).where(eq(schema.membershipMonths.id, payment.monthId));
    await finishIfSettled(tx, month, now);
    await queueTimeBackEmail(tx, refund, to);
    return to;
  });
}
