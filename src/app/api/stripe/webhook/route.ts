import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { syncHold } from "@/lib/payments/hold";
import { stripe } from "@/lib/payments/stripe";

/**
 * The inbox for Stripe's messages. Same pattern as the attendance log: check
 * the message is genuine, save it, and only then reply "ok".
 *
 * Messages only ever speed things up or flag a dispute. Nothing here moves
 * money, and every message is acted on by asking Stripe for the current state,
 * so a repeated, late or out-of-order message can do no harm.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Stripe messages are not set up." }, { status: 503 });

  const rawBody = await request.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(rawBody, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return Response.json({ error: "Signature check failed." }, { status: 400 });
  }

  // A repeated message has the same ID and is skipped.
  const inserted = await db
    .insert(schema.stripeEvents)
    .values({ id: event.id, type: event.type, payload: rawBody })
    .onConflictDoNothing()
    .returning({ id: schema.stripeEvents.id });
  if (inserted.length === 0) {
    const [existing] = await db.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.id, event.id));
    if (existing?.processedAt) return Response.json({ ok: true, repeated: true });
  }

  try {
    await handle(event);
    await db.update(schema.stripeEvents).set({ processedAt: new Date() }).where(eq(schema.stripeEvents.id, event.id));
  } catch (error) {
    // Saved but not handled: answering with an error makes Stripe send it again later.
    console.error(`[payments] could not handle Stripe message ${event.id}`, error);
    return Response.json({ error: "Saved, but not handled yet." }, { status: 500 });
  }
  return Response.json({ ok: true });
}

type StripeEvent = Awaited<ReturnType<ReturnType<typeof stripe>["webhooks"]["constructEventAsync"]>>;

async function handle(event: StripeEvent): Promise<void> {
  switch (event.type) {
    // The hold was placed, or ended. Ask Stripe for the real state and record it.
    case "payment_intent.amount_capturable_updated":
    case "payment_intent.canceled":
    case "payment_intent.payment_failed": {
      const paymentId = event.data.object.metadata?.paymentId;
      if (paymentId) await syncHold(paymentId, new Date());
      return;
    }
    // The customer's bank opened or closed a dispute. While it is open, refunds and the host's payout wait.
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      const dispute = event.data.object;
      const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
      if (!intentId) return;
      await db
        .update(schema.payments)
        .set({ disputeOpen: event.type === "charge.dispute.created", updatedAt: new Date() })
        .where(eq(schema.payments.stripePaymentIntentId, intentId));
      return;
    }
    default:
      return; // Saved for the record; nothing to do.
  }
}
