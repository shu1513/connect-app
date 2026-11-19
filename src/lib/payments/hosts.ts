/**
 * A host's payout account at Stripe. Stripe collects and checks the host's
 * identity and bank details on its own pages. We keep only the account's ID
 * and whether Stripe says it can receive money.
 *
 * One rule always holds (plans/27-hosts-abroad.md): the country on a host's profile and the
 * country of their Stripe account are the same. Stripe fixes an account's country when it is
 * opened, and an account in the wrong country cannot be paid.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { payoutAccountRequest } from "./host-account";
import { stripe } from "./stripe";

import type { HostUser } from "./host-account";

type AccountView = {
  id: string;
  identity?: { country?: string | null } | null;
  configuration?: {
    recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string }; payouts?: { status?: string } } } } | null;
  } | null;
};

/** Payout setup cannot go on, for a reason the host can read. No account was linked to them, and none that was is changed. */
export class PayoutSetupError extends Error {}

const NO_PROFILE = "Send your host profile first. Your payout account is opened for the country you say you are based in.";
/** Said both when Stripe names another country and when it names none: either way the account cannot be used. */
const WRONG_COUNTRY = "We could not confirm that your payout account at Stripe is in the country on your host profile, so payout setup cannot go on. Please write to support.";

async function settingsFor(userId: string) {
  await db.insert(schema.hostSettings).values({ userId }).onConflictDoNothing();
  const [settings] = await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, userId));
  return settings;
}

/** The host's settings, created on first use. */
export const getHostSettings = settingsFor;

/** The country on this person's host profile, or null when they have not applied to host. */
async function profileCountry(userId: string): Promise<string | null> {
  const [profile] = await db.select({ country: schema.hostProfiles.country }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId));
  return profile?.country ?? null;
}

/** The country Stripe has an account in, as two capital letters. Always asked of Stripe, never remembered. */
async function accountCountry(accountId: string): Promise<string | null> {
  const account = (await stripe().v2.core.accounts.retrieve(accountId, { include: ["identity"] } as never)) as unknown as AccountView;
  return account.identity?.country?.toUpperCase() ?? null;
}

/**
 * Connect's own public address, for Stripe's records of a host abroad. A host's own page is not
 * public until it is approved, and payout setup comes before that, so it is the front page. Null
 * on a developer's computer: Stripe then asks the host.
 */
function publicSiteAddress(): string | null {
  try {
    const url = new URL(publicAppUrl());
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Creates the host's payout account at Stripe if they do not have one yet. Returns its ID.
 *
 * Only for someone with a host profile: the account is opened for the profile's country. Before
 * an account is used or kept, Stripe is asked which country it is in; one in another country
 * than the profile's is never returned, linked or saved.
 */
export async function ensurePayoutAccount(user: HostUser): Promise<string> {
  const country = await profileCountry(user.id);
  if (!country) throw new PayoutSetupError(NO_PROFILE);
  const settings = await settingsFor(user.id);
  if (settings.stripeAccountId) {
    if ((await accountCountry(settings.stripeAccountId)) !== country) throw new PayoutSetupError(WRONG_COUNTRY);
    return settings.stripeAccountId;
  }

  const request = payoutAccountRequest(user, country, publicSiteAddress());
  const account = (await stripe().v2.core.accounts.create(request.params as never, { idempotencyKey: request.idempotencyKey })) as unknown as AccountView;
  // (Asked again, not read from the answer above: the request for a US host is kept exactly as it always was,
  // and that request does not ask for the country to be sent back.)
  if ((await accountCountry(account.id)) !== country) {
    console.error(`[payments] Stripe account ${account.id} of ${user.id} is not in ${country}; it was not linked.`);
    throw new PayoutSetupError(WRONG_COUNTRY);
  }

  // Kept only if no account was linked meanwhile (a second press at the same moment). Then that one is used.
  const kept = await db
    .update(schema.hostSettings)
    .set({ stripeAccountId: account.id, updatedAt: new Date() })
    .where(and(eq(schema.hostSettings.userId, user.id), isNull(schema.hostSettings.stripeAccountId)))
    .returning({ id: schema.hostSettings.stripeAccountId });
  if (kept.length > 0) return account.id;
  const now = await settingsFor(user.id);
  if (!now.stripeAccountId) throw new Error(`The payout account of ${user.id} could not be saved.`);
  if (now.stripeAccountId !== account.id && (await accountCountry(now.stripeAccountId)) !== country) throw new PayoutSetupError(WRONG_COUNTRY);
  return now.stripeAccountId;
}

/** A one-time link to Stripe's own form where the host enters their details. */
export async function payoutSetupLink(accountId: string, urls: { returnUrl: string; refreshUrl: string }): Promise<string> {
  const link = (await stripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { return_url: urls.returnUrl, refresh_url: urls.refreshUrl },
    },
  })) as unknown as { url: string };
  return link.url;
}

/**
 * Asks Stripe whether the host's account can receive money, and records the
 * answer. Coming back from Stripe's form proves nothing; this does.
 *
 * Stripe must say two things: that the account can receive our transfers, and that it can pay its
 * balance out to the host's bank. The first alone is not enough: in Stripe's test mode an account
 * with a checked person and no bank account had the first and not the second, and money sent to
 * it would have stayed at Stripe.
 *
 * An account in another country than the host's profile is never ready, whatever Stripe says
 * about it: money sent there would go to the wrong place or be refused. (A payout account with
 * no host profile beside it has no country to compare with, and is judged by Stripe's answer.)
 */
export async function refreshPayoutsReady(userId: string): Promise<boolean> {
  const settings = await settingsFor(userId);
  if (!settings.stripeAccountId) return false;
  const account = (await stripe().v2.core.accounts.retrieve(settings.stripeAccountId, {
    include: ["configuration.recipient", "identity"],
  } as never)) as unknown as AccountView;
  const country = await profileCountry(userId);
  const rightCountry = country === null || account.identity?.country?.toUpperCase() === country;
  if (!rightCountry) console.error(`[payments] the payout account of ${userId} is not in ${country}, the country of their host profile. They are not ready to be paid.`);
  const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
  const ready = rightCountry && balance?.stripe_transfers?.status === "active" && balance?.payouts?.status === "active";
  await db
    .update(schema.hostSettings)
    .set({ payoutsReady: ready, payoutsCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.hostSettings.userId, userId));
  return ready;
}

/** The public https address of the app. Stripe only accepts https addresses to send people back to. */
export function publicAppUrl(): string {
  const url = process.env.PUBLIC_APP_URL || process.env.BETTER_AUTH_URL;
  if (!url) throw new Error("PUBLIC_APP_URL is not set. Check .env.local.");
  return url.replace(/\/$/, "");
}
