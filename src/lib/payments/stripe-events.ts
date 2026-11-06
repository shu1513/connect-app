/**
 * What we do with a message from Stripe.
 *
 * A message never moves money and is never trusted for its content. It is a
 * nudge: we ask Stripe for the current state and record that. So a repeated,
 * late or out-of-order message can do no harm.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { syncHold } from "./hold";
import { stripe } from "./stripe";

/**
 * Dispute states that block paying the host and refunding: the customer's bank
 * still has the charge under dispute, or we lost and the money has gone back to
 * the customer. A lost dispute stays blocked; the founder settles it by hand.
 */
const BLOCKING_DISPUTE = new Set([
  "lost",
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
  "appeal_needs_response",
  "appeal_under_review",
]);

type StripeMessage = { type: string; data: { object: Record<string, unknown> } };

export async function handleStripeEvent(event: StripeMessage): Promise<void> {
  const object = event.data.object;

  if (event.type.startsWith("payment_intent.")) {
    // The hold was placed, or ended. Ask Stripe for the real state and record it.
    const paymentId = (object.metadata as Record<string, string> | undefined)?.paymentId;
    // Not one of ours (for example made by another copy of the app in the same Stripe test area): nothing to do.
    if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) return;
    const [known] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (known) await syncHold(paymentId, new Date());
    return;
  }

  if (event.type.startsWith("charge.dispute.")) {
    // Messages can arrive out of order, so ask Stripe where the dispute stands now.
    const dispute = await stripe()
      .disputes.retrieve(String(object.id))
      .catch((error: { code?: string }) => {
        if (error?.code === "resource_missing") return null; // Stripe does not know it: not ours
        throw error;
      });
    if (!dispute) return;
    const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!intentId) return;
    await db
      .update(schema.payments)
      .set({ disputeOpen: BLOCKING_DISPUTE.has(dispute.status), updatedAt: new Date() })
      .where(eq(schema.payments.stripePaymentIntentId, intentId));
  }
}
