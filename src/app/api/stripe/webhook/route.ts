import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { stripe } from "@/lib/payments/stripe";
import { handleStripeEvent } from "@/lib/payments/stripe-events";

/**
 * The inbox for Stripe's messages. Same pattern as the attendance log: check
 * the message is genuine, save it, and only then reply "ok".
 *
 * If handling a saved message fails, the always-on helper tries it again.
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
    await handleStripeEvent(event as never);
    await db.update(schema.stripeEvents).set({ processedAt: new Date() }).where(eq(schema.stripeEvents.id, event.id));
  } catch (error) {
    // It is saved. The always-on helper will handle it; Stripe does not need to send it again.
    console.error(`[payments] could not handle Stripe message ${event.id} yet`, error);
  }
  return Response.json({ ok: true });
}
