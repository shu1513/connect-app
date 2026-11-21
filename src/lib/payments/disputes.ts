/**
 * A bank dispute over a call's card payment: what keeps its money where it is.
 *
 * While the customer's bank has the charge under dispute, and after a dispute is lost (the money
 * has gone back to the customer), the host cannot collect that money and it cannot be refunded on
 * top. `payments.disputeOpen` says so. A lost dispute stays blocked; the founder settles it by hand.
 * Which of Stripe's statuses block is one rule for every kind of money: `blocksMoney` in
 * src/lib/disputes/status.ts.
 */
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import { anyBlocksMoney } from "@/lib/disputes/status";
import { stripe } from "./stripe";

/** Every dispute Stripe has on one charge, however many pages that is. */
export async function allDisputesOf(intentId: string): Promise<Stripe.Dispute[]> {
  const found: Stripe.Dispute[] = [];
  for await (const dispute of stripe().disputes.list({ payment_intent: intentId, limit: 100 })) found.push(dispute);
  return found;
}

/**
 * Asks Stripe where the disputes over a call's card payment stand, ALL of them together, and
 * records whether any of them still blocks the money. A bank can dispute one charge more than
 * once: a win on one must never unfreeze money that another still holds (plans/47, decision 1).
 *
 * Messages can arrive out of order, and two can be handled at the same moment. So Stripe is asked,
 * that is recorded, and Stripe is asked once more: only when it still says the same is the work
 * done. An answer that went stale while we waited is never the last word.
 *
 * `known` is a dispute the caller has just read from Stripe by its id (the one a message was
 * about). If Stripe's list does not show it yet, it is counted all the same. So is every dispute
 * on this payment that the app has on record as holding the money (plans/47) and that the list
 * leaves out: money is never released on a list that omits a dispute we know of.
 */
export async function refreshPaymentDispute(paymentId: string, now: Date = new Date(), known?: { id: string; status: string }): Promise<void> {
  const [payment] = await db.select({ intentId: schema.payments.stripePaymentIntentId }).from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment?.intentId) return;
  let recorded: boolean | null = null;
  for (let round = 0; round < 4; round++) {
    const disputes = await allDisputesOf(payment.intentId);
    const statuses = disputes.map((dispute) => dispute.status);
    const listed = new Set(disputes.map((dispute) => dispute.id));
    if (known && !listed.has(known.id)) statuses.push(known.status);
    const onRecord = await db.select({ id: schema.disputes.id, status: schema.disputes.status }).from(schema.disputes).where(eq(schema.disputes.paymentId, paymentId));
    for (const row of onRecord) if (!listed.has(row.id) && row.id !== known?.id) statuses.push(row.status);
    // Stripe shows none: there is nothing to record, and nothing that was recorded is taken back on that word alone.
    if (statuses.length === 0) return;
    const blocked = anyBlocksMoney(statuses);
    if (blocked === recorded) return;
    await db.update(schema.payments).set({ disputeOpen: blocked, updatedAt: now }).where(eq(schema.payments.id, paymentId));
    recorded = blocked;
  }
}
