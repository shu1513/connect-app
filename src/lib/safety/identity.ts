/**
 * The identity check: a photo of an ID and a matching selfie, on Stripe's own
 * pages (Stripe Identity). We keep the outcome, "18 or older" and the name on
 * the ID; never the date of birth, the ID number or any picture. The result
 * is always read from Stripe, never from the browser.
 */
import { and, desc, eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "@/db";
import { stripe } from "@/lib/payments/stripe";

/**
 * Reading the date of birth from a check needs a separate, restricted Stripe
 * key with the "sensitive verification results" permission. Without it the
 * check still runs, but "18 or older" cannot be read, so nobody passes.
 */
export function identityResultsKeyConfigured(): boolean {
  return Boolean(process.env.STRIPE_IDENTITY_KEY?.startsWith("rk_test_") || (process.env.STRIPE_IDENTITY_KEY?.startsWith("rk_live_") && process.env.ALLOW_LIVE_STRIPE === "yes"));
}
let resultsClient: Stripe | null = null;
function identityResults(): Stripe {
  if (!identityResultsKeyConfigured()) return stripe();
  resultsClient ??= new Stripe(process.env.STRIPE_IDENTITY_KEY!);
  return resultsClient;
}

export class IdentityError extends Error {}

export const IDENTITY_TRIES = 3;

export type IdentityState = { passed: boolean; adult: boolean | null; verifiedName: string | null; triesLeft: number; pending: boolean };

/** Where this person stands. */
export async function identityState(userId: string): Promise<IdentityState> {
  const checks = await db.select().from(schema.identityChecks).where(eq(schema.identityChecks.userId, userId)).orderBy(desc(schema.identityChecks.createdAt));
  const passed = checks.find((c) => c.status === "verified" && c.adult === true);
  const used = checks.filter((c) => c.status !== "canceled").length;
  return {
    passed: Boolean(passed),
    adult: passed?.adult ?? null,
    verifiedName: passed?.verifiedName ?? null,
    triesLeft: Math.max(0, IDENTITY_TRIES - used),
    pending: checks.some((c) => c.status === "started" || c.status === "processing"),
  };
}

/** Starts a check at Stripe and returns the address of Stripe's page. Each person gets a few tries. */
export async function startIdentityCheck(user: { id: string; email: string }, returnUrl: string): Promise<string> {
  const state = await identityState(user.id);
  if (state.passed) throw new IdentityError("You have already passed the identity check.");
  if (state.triesLeft === 0) throw new IdentityError("You have used all your tries. Please write to us.");
  const session = await stripe().identity.verificationSessions.create(
    {
      type: "document",
      options: { document: { require_matching_selfie: true, require_live_capture: true } },
      metadata: { userId: user.id },
      return_url: returnUrl,
    },
    { idempotencyKey: `identity:${user.id}:${IDENTITY_TRIES - state.triesLeft + 1}` },
  );
  await db.insert(schema.identityChecks).values({ userId: user.id, stripeSessionId: session.id, status: session.status === "requires_input" ? "started" : session.status }).onConflictDoNothing();
  if (!session.url) throw new IdentityError("Stripe did not return a page to go to. Please try again.");
  return session.url;
}

/** Asks Stripe how this person's checks stand and records the answer. */
export async function refreshIdentity(userId: string): Promise<IdentityState> {
  const open = await db
    .select()
    .from(schema.identityChecks)
    .where(and(eq(schema.identityChecks.userId, userId)));
  for (const check of open) {
    if (check.status === "verified" || check.status === "canceled") continue;
    const session = await identityResults().identity.verificationSessions.retrieve(check.stripeSessionId, identityResultsKeyConfigured() ? { expand: ["verified_outputs.dob"] } : {});
    if (session.metadata?.userId !== userId) continue; // not this person's: never record it for them
    let status = check.status;
    let adult: boolean | null = null;
    let verifiedName: string | null = null;
    if (session.status === "verified") {
      status = "verified";
      const outputs = session.verified_outputs;
      const dob = outputs?.dob;
      if (dob?.year && dob.month && dob.day) {
        const eighteenth = new Date(Date.UTC(dob.year + 18, dob.month - 1, dob.day));
        adult = eighteenth.getTime() <= Date.now();
      } else if (!identityResultsKeyConfigured()) {
        console.error("[identity] a check passed at Stripe, but STRIPE_IDENTITY_KEY is not set, so the age could not be read. Nobody passes until it is.");
      }
      verifiedName = [outputs?.first_name, outputs?.last_name].filter(Boolean).join(" ") || null;
    } else if (session.status === "canceled") status = "canceled";
    else if (session.status === "processing") status = "processing";
    else if (session.status === "requires_input" && session.last_error) status = "failed";
    else status = check.status === "processing" ? "processing" : "started";
    await db
      .update(schema.identityChecks)
      .set({ status, adult, verifiedName, checkedAt: new Date() })
      .where(eq(schema.identityChecks.id, check.id));
  }
  return identityState(userId);
}

/** For the helper: finish checks that Stripe was still thinking about. */
export async function refreshPendingIdentityChecks(): Promise<void> {
  const pending = await db
    .selectDistinct({ userId: schema.identityChecks.userId })
    .from(schema.identityChecks)
    .where(eq(schema.identityChecks.status, "processing"))
    .limit(20);
  for (const { userId } of pending) await refreshIdentity(userId).catch((error) => console.error(`[identity] could not refresh checks of ${userId}`, error));
}
