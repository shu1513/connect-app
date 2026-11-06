/**
 * A host's payout account at Stripe. Stripe collects and checks the host's
 * identity and bank details on its own pages. We keep only the account's ID
 * and whether Stripe says it can receive money.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { stripe } from "./stripe";

type HostUser = { id: string; name: string; email: string };

type AccountView = {
  id: string;
  configuration?: {
    recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } } } | null;
  } | null;
};

async function settingsFor(userId: string) {
  await db.insert(schema.hostSettings).values({ userId }).onConflictDoNothing();
  const [settings] = await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, userId));
  return settings;
}

/** The host's settings, created on first use. */
export const getHostSettings = settingsFor;

/** Creates the host's payout account at Stripe if they do not have one yet. Returns its ID. */
export async function ensurePayoutAccount(user: HostUser): Promise<string> {
  const settings = await settingsFor(user.id);
  if (settings.stripeAccountId) return settings.stripeAccountId;

  const account = (await stripe().v2.core.accounts.create(
    {
      contact_email: user.email,
      display_name: user.name,
      // We pay Stripe's fees and carry any losses; the host only receives money.
      defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
      dashboard: "express",
      identity: { country: "us" },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    } as never,
    { idempotencyKey: `host-account:${user.id}` },
  )) as unknown as AccountView;

  await db
    .update(schema.hostSettings)
    .set({ stripeAccountId: account.id, updatedAt: new Date() })
    .where(eq(schema.hostSettings.userId, user.id));
  return account.id;
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
 */
export async function refreshPayoutsReady(userId: string): Promise<boolean> {
  const settings = await settingsFor(userId);
  if (!settings.stripeAccountId) return false;
  const account = (await stripe().v2.core.accounts.retrieve(settings.stripeAccountId, {
    include: ["configuration.recipient"],
  } as never)) as unknown as AccountView;
  const ready = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
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
