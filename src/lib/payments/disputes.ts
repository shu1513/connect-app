/**
 * Dispute states that block paying the host and refunding: the customer's bank
 * still has the charge under dispute, or we lost and the money has gone back to
 * the customer. A lost dispute stays blocked; the founder settles it by hand.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { anyBlocksMoney } from "@/lib/disputes/status";
import { stripe } from "./stripe";

export const BLOCKING_DISPUTE = new Set([
  "lost",
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
  "appeal_needs_response",
  "appeal_under_review",
]);

/**
 * Asks Stripe where the disputes over a call's card payment stand, ALL of them together, and
 * records whether any of them still blocks the money. A bank can dispute one charge more than
 * once: a win on one must never unfreeze money that another still holds (plans/47, decision 1).
 *
 * Messages can arrive out of order, and two can be handled at the same moment. So Stripe is asked,
 * that is recorded, and Stripe is asked once more: only when it still says the same is the work
 * done. An answer that went stale while we waited is never the last word.
 */
export async function refreshPaymentDispute(paymentId: string, now: Date = new Date()): Promise<void> {
  const [payment] = await db.select({ intentId: schema.payments.stripePaymentIntentId }).from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment?.intentId) return;
  let recorded: boolean | null = null;
  for (let round = 0; round < 4; round++) {
    const disputes = await stripe().disputes.list({ payment_intent: payment.intentId, limit: 100 }).autoPagingToArray({ limit: 300 });
    // Stripe shows none: there is nothing to record, and nothing that was recorded is taken back on that word alone.
    if (disputes.length === 0) return;
    const blocked = anyBlocksMoney(disputes.map((dispute) => dispute.status));
    if (blocked === recorded) return;
    await db.update(schema.payments).set({ disputeOpen: blocked, updatedAt: now }).where(eq(schema.payments.id, paymentId));
    recorded = blocked;
  }
}
