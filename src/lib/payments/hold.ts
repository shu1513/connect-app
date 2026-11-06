/**
 * The hold: the customer confirms a paid call by having the full booked price
 * held on their card. Nothing is charged at this point.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { applyReleased } from "./actions";
import { lockPayment, MoneyError, type Tx } from "./operations";
import { bookedTotalCents, DEFAULT_FEE_TERMS, MIN_PRICE_PER_15_CENTS } from "./pricing";
import { holdExpiry, payWindow } from "./rules";
import { stripe } from "./stripe";

/** Checks a price for a new call. Zero is a free call; anything else must meet the minimum. */
export function priceProblem(pricePer15Cents: number): string | null {
  if (!Number.isInteger(pricePer15Cents) || pricePer15Cents < 0) return "The price must be a whole number of cents.";
  if (pricePer15Cents > 0 && pricePer15Cents < MIN_PRICE_PER_15_CENTS) {
    return `A paid call must cost at least $${(MIN_PRICE_PER_15_CENTS / 100).toFixed(2)} per 15 minutes.`;
  }
  return null;
}

/** Creates the payment record for a paid call, fixing its terms at this moment. */
export async function createPaymentForCall(tx: Tx, call: Pick<Call, "id" | "startsAt" | "endsAt" | "pricePer15Cents">): Promise<void> {
  const bookedSeconds = Math.floor((call.endsAt.getTime() - call.startsAt.getTime()) / 1000);
  await tx.insert(schema.payments).values({
    callId: call.id,
    pricePer15Cents: call.pricePer15Cents,
    bookedCents: bookedTotalCents(call.pricePer15Cents, bookedSeconds),
    feePercentBps: DEFAULT_FEE_TERMS.percentBps,
    feeFixedCents: DEFAULT_FEE_TERMS.fixedCents,
    feeForeignCardBps: DEFAULT_FEE_TERMS.foreignCardBps,
  });
}

async function stripeCustomerFor(user: { id: string; name: string; email: string }): Promise<string> {
  const [existing] = await db.select().from(schema.stripeCustomers).where(eq(schema.stripeCustomers.userId, user.id));
  if (existing) return existing.stripeCustomerId;
  const customer = await stripe().customers.create(
    { name: user.name, email: user.email, metadata: { userId: user.id } },
    { idempotencyKey: `customer:${user.id}` },
  );
  await db.insert(schema.stripeCustomers).values({ userId: user.id, stripeCustomerId: customer.id }).onConflictDoNothing();
  const [saved] = await db.select().from(schema.stripeCustomers).where(eq(schema.stripeCustomers.userId, user.id));
  return saved.stripeCustomerId;
}

/**
 * Starts (or resumes) the hold for a paid call. Returns the secret the
 * browser needs to show Stripe's card form. The hold itself is placed when
 * the customer confirms in that form.
 */
export async function startHold(input: {
  payment: Payment;
  call: Call;
  customer: { id: string; name: string; email: string };
  now: Date;
}): Promise<{ clientSecret: string } | { alreadyHeld: true }> {
  const { payment, call, customer, now } = input;
  if (customer.id !== call.customerId) throw new MoneyError("Only the customer can pay for this call.");
  if (call.cancelledAt) throw new MoneyError("This call was cancelled.");
  if (payment.status === "held") return { alreadyHeld: true };
  if (payment.status !== "awaiting_payment") throw new MoneyError("This call can no longer be paid for.");
  const window = payWindow({ now, startsAt: call.startsAt, endsAt: call.endsAt });
  if (window === "too_early") throw new MoneyError("This call can be paid for from 2 days before it starts.");
  if (window === "call_over") throw new MoneyError("This call is over.");

  let previousIntentId: string | null = null;
  if (payment.stripePaymentIntentId) {
    const intent = await stripe().paymentIntents.retrieve(payment.stripePaymentIntentId);
    if (intent.status === "requires_capture") {
      await syncHold(payment.id, now);
      return { alreadyHeld: true };
    }
    if (intent.status !== "canceled" && intent.client_secret) return { clientSecret: intent.client_secret };
    previousIntentId = intent.id; // cancelled at Stripe: start a fresh one
  }

  const stripeCustomerId = await stripeCustomerFor(customer);
  const intent = await stripe().paymentIntents.create(
    {
      amount: payment.bookedCents,
      currency: payment.currency,
      customer: stripeCustomerId,
      capture_method: "manual",
      allowed_payment_method_types: ["card"],
      transfer_group: call.id,
      description: `Call ${call.id}`,
      metadata: { paymentId: payment.id, callId: call.id },
    },
    // One hold per payment. A new one is only made after the previous one was cancelled.
    { idempotencyKey: `hold:${payment.id}:${previousIntentId ?? "first"}` },
  );
  await db
    .update(schema.payments)
    .set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
    .where(eq(schema.payments.id, payment.id));
  if (!intent.client_secret) throw new MoneyError("Stripe did not return a way to pay. Please try again.");
  return { clientSecret: intent.client_secret };
}

/**
 * Asks Stripe for the real state of a payment's hold and records it.
 * This, not anything the browser says, is what marks a payment as held.
 */
export async function syncHold(paymentId: string, now: Date): Promise<Payment> {
  const [before] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!before) throw new MoneyError("Payment not found.");
  if (!before.stripePaymentIntentId || (before.status !== "awaiting_payment" && before.status !== "held")) return before;

  const intent = await stripe().paymentIntents.retrieve(before.stripePaymentIntentId, { expand: ["latest_charge"] });
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;

  await db.transaction(async (tx) => {
    const payment = await lockPayment(tx, paymentId);
    if (payment.stripePaymentIntentId !== intent.id) return;

    if (intent.status === "requires_capture" && payment.status === "awaiting_payment") {
      const card = charge?.payment_method_details?.card;
      const captureBefore = card?.capture_before ? new Date(card.capture_before * 1000) : null;
      await tx
        .update(schema.payments)
        .set({
          status: "held",
          heldAt: now,
          holdExpiresAt: holdExpiry({ heldAt: now, captureBefore }),
          cardCountry: card?.country ?? null,
          stripeChargeId: charge?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.payments.id, paymentId));
    } else if (intent.status === "canceled" && payment.status === "held") {
      // The hold ran out or was cancelled at Stripe. Nothing can be charged any more.
      await applyReleased(payment, "The hold ended at Stripe before a charge was made.", tx);
    } else if (intent.status === "canceled" && payment.status === "awaiting_payment") {
      // Let the customer start again with a fresh hold.
      await tx.update(schema.payments).set({ stripePaymentIntentId: null, updatedAt: new Date() }).where(eq(schema.payments.id, paymentId));
    }
  });

  const [after] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  return after;
}
