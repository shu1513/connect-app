/**
 * The hold: the customer confirms a paid call by having the full booked price
 * held on their card. Nothing is charged at this point.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { applyCaptured, applyReleased, type CaptureParams } from "./actions";
import type Stripe from "stripe";
import { lockPayment, MoneyError, runMoneyOperation, type Tx } from "./operations";
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

export async function stripeCustomerFor(user: { id: string; name: string; email: string }): Promise<string> {
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

type Payer = { id: string; name: string; email: string };

/** For a call that came from a customer's booking: the moment the money must be held by. */
async function payCutoffOf(reader: Pick<typeof db, "select">, callId: string): Promise<Date | null> {
  const [booking] = await reader
    .select({ payBy: schema.bookings.payBy })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.callId, callId), inArray(schema.bookings.source, ["customer", "now"])));
  return booking?.payBy ?? null;
}

/**
 * The one hold a payment has at Stripe: finds it, or creates it. Both the
 * customer's browser and the automatic try with a saved card come through
 * here, with exactly the same request and the same label, so Stripe gives both
 * the same hold and there can never be two.
 *
 * Nothing is held by this step: the hold only takes effect when a card is
 * confirmed on it.
 */
async function holdIntentFor(input: {
  payment: Payment;
  call: Call;
  customer: Payer;
  now: Date;
}): Promise<{ held: true } | { held: false; intentId: string; clientSecret: string }> {
  const { payment, call, customer, now } = input;
  if (customer.id !== call.customerId) throw new MoneyError("Only the customer can pay for this call.");
  if (call.cancelledAt) throw new MoneyError("This call was cancelled.");
  if (payment.status === "held") return { held: true };
  if (payment.status !== "awaiting_payment") throw new MoneyError("This call can no longer be paid for.");
  if (call.safetyEndedAt) throw new MoneyError("This call was ended, so it can no longer be paid for.");
  const [people] = await db
    .select({ paused: sql<number>`count(*) filter (where ${schema.user.pausedAt} is not null)::int` })
    .from(schema.user)
    .where(inArray(schema.user.id, [call.hostId, call.customerId]));
  if (people.paused > 0 || (await isBlockedEitherWay(call.hostId, call.customerId))) throw new MoneyError("This call can no longer be paid for.");
  const cutoff = await payCutoffOf(db, call.id);
  if (cutoff && now >= cutoff) throw new MoneyError("The time to pay for this call has passed.");
  const window = payWindow({ now, startsAt: call.startsAt, endsAt: call.endsAt });
  if (window === "too_early") throw new MoneyError("This call can be paid for from 2 days before it starts.");
  if (window === "call_over") throw new MoneyError("This call is over.");

  let previousIntentId: string | null = null;
  if (payment.stripePaymentIntentId) {
    const intent = await stripe().paymentIntents.retrieve(payment.stripePaymentIntentId);
    if (intent.status === "requires_capture") {
      await syncHold(payment.id, now);
      return { held: true };
    }
    if (intent.status !== "canceled" && intent.client_secret) return { held: false, intentId: intent.id, clientSecret: intent.client_secret };
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
  // Save it under the payment's lock. If the call was cancelled or closed while Stripe was
  // answering, cancel what we just made, so no hold is ever left behind unnoticed.
  const saved = await db.transaction(async (tx) => {
    const locked = await lockPayment(tx, payment.id);
    const [current] = await tx.select({ cancelledAt: schema.calls.cancelledAt }).from(schema.calls).where(eq(schema.calls.id, call.id));
    const open = locked.status === "awaiting_payment" && !current?.cancelledAt;
    if (locked.stripePaymentIntentId === intent.id) {
      // A second request for the same hold (a double click, two tabs, the automatic try) got here
      // first and Stripe gave both the same one. It belongs to this payment: never cancel it from here.
      if (locked.status === "held") return "held" as const;
      return open ? ("saved" as const) : ("closed" as const);
    }
    // Only replace what this request saw. Anything else means another request has moved on.
    // And never while a money action (such as closing the payment) is under way.
    const [inFlight] = await tx
      .select({ id: schema.moneyOperations.id })
      .from(schema.moneyOperations)
      .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started")))
      .limit(1);
    if (!open || inFlight || locked.stripePaymentIntentId !== payment.stripePaymentIntentId) return "unwanted" as const;
    await tx.update(schema.payments).set({ stripePaymentIntentId: intent.id, updatedAt: new Date() }).where(eq(schema.payments.id, payment.id));
    return "saved" as const;
  });
  if (saved === "held") return { held: true };
  if (saved === "unwanted") await stripe().paymentIntents.cancel(intent.id).catch(() => undefined);
  if (saved !== "saved") throw new MoneyError("This call can no longer be paid for.");
  if (!intent.client_secret) throw new MoneyError("Stripe did not return a way to pay. Please try again.");
  return { held: false, intentId: intent.id, clientSecret: intent.client_secret };
}

/**
 * Starts (or resumes) the hold for a paid call. Returns the secret the
 * browser needs to show Stripe's card form. The hold itself is placed when
 * the customer confirms in that form.
 */
export async function startHold(input: {
  payment: Payment;
  call: Call;
  customer: Payer;
  now: Date;
}): Promise<{ clientSecret: string } | { alreadyHeld: true }> {
  const found = await holdIntentFor(input);
  return found.held ? { alreadyHeld: true } : { clientSecret: found.clientSecret };
}

type HoldDetails = { intentId: string; captureBefore: number | null; cardCountry: string | null; chargeId: string | null; authorisedAt: number | null };

function holdDetails(intent: Stripe.PaymentIntent): HoldDetails {
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const card = charge?.payment_method_details?.card;
  return {
    intentId: intent.id,
    captureBefore: card?.capture_before ?? null,
    cardCountry: card?.country ?? null,
    chargeId: charge?.id ?? null,
    authorisedAt: charge?.created ?? null,
  };
}

/** Records that the money is now held. Does nothing unless the payment was still waiting for exactly this hold. */
async function applyHeld(tx: Tx, payment: Payment, details: HoldDetails, now: Date): Promise<void> {
  if (payment.status !== "awaiting_payment" || payment.stripePaymentIntentId !== details.intentId) return;
  // A card authorised after the booking's cut-off (through a form left open, say) does not count:
  // the payment stays unpaid, and the helper cancels the booking and lets that hold go.
  const cutoff = await payCutoffOf(tx, payment.callId);
  const authorisedAt = details.authorisedAt ? new Date(details.authorisedAt * 1000) : now;
  if (cutoff && authorisedAt >= cutoff) return;
  const captureBefore = details.captureBefore ? new Date(details.captureBefore * 1000) : null;
  await tx
    .update(schema.payments)
    .set({
      status: "held",
      heldAt: now,
      // Counted from when the card was authorised, not from when we happened to hear about it.
      holdExpiresAt: holdExpiry({ heldAt: details.authorisedAt ? new Date(details.authorisedAt * 1000) : now, captureBefore }),
      cardCountry: details.cardCountry,
      stripeChargeId: details.chargeId,
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, payment.id));
}

/**
 * Tries, once, to place the hold on a card the customer saved when they asked
 * for the call. The customer is not there, so if the bank says no or wants
 * them to approve it, nothing is held and they fix it later on the call page,
 * on this same hold.
 *
 * Returns "held", or "not_held" after a clear no. Throws OutcomeUnknownError
 * when Stripe's answer is not known yet; the helper then finds out.
 */
export async function placeHoldWithSavedCard(input: {
  payment: Payment;
  call: Call;
  customer: Payer;
  paymentMethodId: string;
  now: Date;
}): Promise<"held" | "not_held"> {
  const found = await holdIntentFor(input);
  if (found.held) return "held";
  try {
    await runMoneyOperation<{ intentId: string; paymentMethodId: string }, HoldDetails | null>({
      paymentId: input.payment.id,
      kind: "hold",
      labelBase: `holdcard:${input.payment.id}`,
      prepare: async (payment, tx) => {
        if (payment.status !== "awaiting_payment") throw new MoneyError("This payment is not waiting for a hold.");
        if (payment.stripePaymentIntentId !== found.intentId) throw new MoneyError("The hold changed. Nothing was tried.");
        const [tried] = await tx
          .select({ id: schema.moneyOperations.id })
          .from(schema.moneyOperations)
          .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.kind, "hold")))
          .limit(1);
        if (tried) throw new MoneyError("The saved card was already tried once.");
        return { intentId: found.intentId, paymentMethodId: input.paymentMethodId };
      },
      execute: async (params, label) => {
        const intent = await confirmWithSavedCard(params, label);
        return { stripeId: intent.id, result: intent.status === "requires_capture" ? holdDetails(intent) : null };
      },
      apply: async (payment, _params, outcome, tx) => {
        if (outcome.result) await applyHeld(tx, payment, outcome.result, input.now);
      },
    });
  } catch (error) {
    if (error instanceof MoneyError) return (await paymentStatus(input.payment.id)) === "held" ? "held" : "not_held";
    throw error;
  }
  return (await paymentStatus(input.payment.id)) === "held" ? "held" : "not_held";
}

/**
 * The one request that tries a saved card. Sent again under the same label
 * (by the helper, when the first answer never arrived) Stripe returns the
 * original result, or does it now if it never arrived. Never twice.
 */
export function confirmWithSavedCard(params: { intentId: string; paymentMethodId: string }, label: string): Promise<Stripe.PaymentIntent> {
  return stripe().paymentIntents.confirm(
    params.intentId,
    { payment_method: params.paymentMethodId, off_session: true, expand: ["latest_charge"] },
    { idempotencyKey: label },
  );
}

async function paymentStatus(paymentId: string): Promise<string | undefined> {
  const [payment] = await db.select({ status: schema.payments.status }).from(schema.payments).where(eq(schema.payments.id, paymentId));
  return payment?.status;
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
      await applyHeld(tx, payment, holdDetails(intent), now);
    } else if (intent.status === "canceled" && payment.status === "held") {
      // The hold ran out or was cancelled at Stripe. Nothing can be charged any more.
      await applyReleased(payment, "The hold ended at Stripe before a charge was made.", tx);
    } else if (intent.status === "succeeded" && payment.status === "held") {
      await recordLateCharge(tx, payment, intent.amount_received, charge?.id ?? null);
    }
    // A cancelled hold on an unpaid call is left recorded: startHold() sees it and makes a fresh one.
  });

  const [after] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  return after;
}

/**
 * Stripe has charged this hold, but our record still says "held": an earlier
 * attempt was written off as refused and then went through after all. Record
 * the charge, so the customer's money is never left unaccounted for.
 */
async function recordLateCharge(tx: Tx, payment: Payment, amountReceived: number, chargeId: string | null): Promise<void> {
  const attempts = await tx
    .select()
    .from(schema.moneyOperations)
    .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.kind, "capture")))
    .orderBy(desc(schema.moneyOperations.createdAt));
  // An attempt whose outcome is still unknown is finished by the helper's own check.
  if (attempts.some((attempt) => attempt.status === "started")) return;

  // Use the details of the attempt that asked for exactly this amount.
  let params: CaptureParams | null = null;
  for (const attempt of attempts) {
    const tried = JSON.parse(attempt.params) as Partial<CaptureParams>;
    if (tried.amountCents === amountReceived && tried.reason && tried.callEndsAt) {
      params = tried as CaptureParams;
      break;
    }
  }
  const explained = params !== null;
  if (!params) {
    const [call] = await tx.select({ endsAt: schema.calls.endsAt }).from(schema.calls).where(eq(schema.calls.id, payment.callId));
    params = { amountCents: amountReceived, reason: "attendance", frozen: null, callEndsAt: call.endsAt.toISOString(), pricedThroughEventId: null };
  }
  await applyCaptured(payment, params, amountReceived, chargeId, tx);
  if (!explained) {
    // We cannot tell which request made this charge. Record it, and ask the founder to look.
    await tx
      .update(schema.payments)
      .set({ flaggedAfterCharge: true, reviewReason: "Stripe charged this call, but our record cannot explain the amount. Please check it." })
      .where(eq(schema.payments.id, payment.id));
  }
}
