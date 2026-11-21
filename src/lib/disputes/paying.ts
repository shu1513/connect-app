/**
 * A customer with a chargeback cannot make a new agreement to pay (plans/47-bank-disputes.md,
 * decision 9).
 *
 * While a chargeback of theirs is open, and after one the bank decided for them although the app
 * had sent its proof (until the founder allows paying again), a customer cannot start anything NEW
 * that costs money: a request for a paid call, added time paid by card, a tip, a contribution, a
 * membership (joining, resuming, taking a host's new offer, switching renewals back on).
 *
 * Everything that acts on something already agreed runs on, and never asks here: paying for and
 * holding a call that is booked, a card step that was begun, booking from a membership they have,
 * renewals with another host, the helper's own tries with a saved card. A bank's question stops
 * nothing. Nothing is stored on the person: it is read from their disputes each time. A payment
 * started in the same instant a dispute arrives may slip through; that is accepted.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { stopsPaying } from "./rules";

type Reader = Pick<typeof db, "select">;

export const STOPPED_WHILE_OPEN =
  "Your bank has an open dispute about a payment on Connect. Until it has ended, you cannot start anything new that costs money here. Your messages say more.";
export const STOPPED_AFTER_LOSS = `Starting new bookings and payments is switched off for your account, after a bank dispute over a payment that Connect's record shows was right. If you think that is wrong, write to ${SUPPORT_EMAIL}.`;

/** Why this person cannot make a new agreement to pay right now, in words for them, or null if they can. */
export async function whyNoNewPayment(reader: Reader, userId: string): Promise<string | null> {
  const rows = await reader
    .select({ stage: schema.disputes.stage, outcome: schema.disputes.outcome, answer: schema.disputes.answer, payingAllowedAt: schema.disputes.payingAllowedAt })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.customerId, userId), eq(schema.disputes.stage, "chargeback"), or(isNull(schema.disputes.outcome), and(eq(schema.disputes.outcome, "lost"), eq(schema.disputes.answer, "proof"), isNull(schema.disputes.payingAllowedAt)))));
  const reasons = rows.map(stopsPaying);
  // An open one first: it is the one the person can do something about (their bank can withdraw it).
  return reasons.includes("open") ? STOPPED_WHILE_OPEN : reasons.includes("lost") ? STOPPED_AFTER_LOSS : null;
}

/**
 * The founder allows the customer of a lost dispute to pay again. Does nothing for a dispute that stops nobody.
 * The change and its line in the record of admin actions are one step: never one without the other.
 */
export async function allowPayingAgain(input: { disputeId: string; adminId: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(schema.disputes)
      .set({ payingAllowedAt: now, payingAllowedBy: input.adminId })
      .where(and(eq(schema.disputes.id, input.disputeId), eq(schema.disputes.outcome, "lost"), eq(schema.disputes.answer, "proof"), isNull(schema.disputes.payingAllowedAt)))
      .returning({ id: schema.disputes.id });
    if (changed.length === 0) return false;
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: "paying allowed again after a lost dispute", targetId: input.disputeId });
    return true;
  });
}
