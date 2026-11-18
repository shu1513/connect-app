/**
 * What we do with a message from Stripe.
 *
 * A message never moves money and is never trusted for its content. It is a
 * nudge: we ask Stripe for the current state and record that. So a repeated,
 * late or out-of-order message can do no harm.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { syncMonth } from "@/lib/membership/charge";
import { refreshMonthDispute } from "@/lib/membership/ending";
import { BLOCKING_DISPUTE } from "./disputes";
import { syncHold } from "./hold";
import { stripe } from "./stripe";

type StripeMessage = { type: string; data: { object: Record<string, unknown> } };

export async function handleStripeEvent(event: StripeMessage): Promise<void> {
  const object = event.data.object;

  if (event.type.startsWith("payment_intent.")) {
    // The hold was placed, or ended. Ask Stripe for the real state and record it.
    // A membership month's payment: the same nudge, to the month's own code.
    const monthId = (object.metadata as Record<string, string> | undefined)?.monthId;
    if (monthId && /^[0-9a-f-]{36}$/i.test(monthId)) {
      const [month] = await db.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(eq(schema.membershipMonths.id, monthId));
      if (month) await syncMonth(monthId, new Date());
      return;
    }
    const paymentId = (object.metadata as Record<string, string> | undefined)?.paymentId;
    // Not one of ours (for example made by another copy of the app in the same Stripe test area): nothing to do.
    if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) return;
    const [known] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (known) await syncHold(paymentId, new Date());
    return;
  }

  if (event.type.startsWith("charge.dispute.")) {
    // Messages can arrive out of order, and two can be handled at the same moment. So Stripe is asked
    // where the dispute stands now, that is recorded, and Stripe is asked once more: only when it still
    // says the same is the work done. An answer that went stale while we waited is never the last word.
    let recorded: string | null = null;
    for (let round = 0; round < 4; round++) {
      const dispute = await stripe()
        .disputes.retrieve(String(object.id))
        .catch((error: { code?: string }) => {
          if (error?.code === "resource_missing") return null; // Stripe does not know it: not ours
          throw error;
        });
      if (!dispute || dispute.status === recorded) return;
      const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
      if (!intentId) return;
      await db
        .update(schema.payments)
        .set({ disputeOpen: BLOCKING_DISPUTE.has(dispute.status), updatedAt: new Date() })
        .where(eq(schema.payments.stripePaymentIntentId, intentId));
      // A dispute over a membership month's charge: recorded on the month, where booking, paying back and collecting look.
      const [month] = await db.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(eq(schema.membershipMonths.stripePaymentIntentId, intentId));
      if (month) await refreshMonthDispute(month.id, new Date());
      recorded = dispute.status;
    }
  }
}
