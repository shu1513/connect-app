/**
 * The connection to Stripe. Every Stripe call in the app goes through the
 * client made here.
 */
import Stripe from "stripe";

let client: Stripe | null = null;

/** True when Stripe keys are present. Paid calls are switched off without them. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set. Check .env.local.");
  // A live key moves real money. It is only accepted when explicitly switched on.
  if (!key.startsWith("sk_test_") && process.env.ALLOW_LIVE_STRIPE !== "yes") {
    throw new Error("STRIPE_SECRET_KEY is not a test key. Refusing to start.");
  }
  client = new Stripe(key);
  return client;
}

/** The key the browser uses to show Stripe's card form. Not a secret. */
export function stripePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set. Check .env.local.");
  return key;
}

/**
 * Whether a Stripe error means "definitely did not happen" (a refusal), as
 * opposed to "we do not know" (a timeout or an outage). Only a definite
 * refusal may be recorded as a failure; anything else is checked with Stripe later.
 */
export function isDefiniteRefusal(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeCardError ||
    error instanceof Stripe.errors.StripeInvalidRequestError ||
    error instanceof Stripe.errors.StripeIdempotencyError ||
    error instanceof Stripe.errors.StripePermissionError
  );
}

export function stripeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
