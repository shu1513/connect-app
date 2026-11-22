/**
 * Setup tool: tells Stripe (test mode only) where to send its messages, and
 * saves the signing secret into .env.local without printing it.
 *
 * Run it again whenever the app's public address changes, for example after
 * the development tunnel restarts.
 *
 * Usage: npx tsx scripts/stripe-webhook-setup.ts https://your-public-address
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { readFileSync, writeFileSync } from "node:fs";

const EVENTS = [
  "payment_intent.amount_capturable_updated",
  "payment_intent.canceled",
  "payment_intent.payment_failed",
  // For membership months: the taking of a held month, and a bank that wants the member's own approval.
  "payment_intent.succeeded",
  "payment_intent.requires_action",
  "charge.dispute.created",
  // A bank's question that becomes a chargeback, and any other change while a dispute is open (plans/47).
  "charge.dispute.updated",
  "charge.dispute.closed",
  // A dispute that was lost and is later decided the other way.
  "charge.dispute.funds_reinstated",
  // A refund that Stripe first confirmed and that then failed after all: the app undoes its record, and a host who
  // was to pay for it owes nothing (plans/46-part-3-money-owed.md).
  "refund.failed",
  "refund.updated",
  // A host's transfer was reversed: one made by hand at Stripe may have paid a take-back, or paid one twice.
  "transfer.reversed",
] as const;
const MARK = "connect-app-dev";

function setEnv(name: string, value: string) {
  const path = ".env.local";
  let text = readFileSync(path, "utf8");
  const line = `${name}=${value}`;
  text = new RegExp(`^${name}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${name}=.*$`, "m"), () => line)
    : `${text.replace(/\n*$/, "\n")}\n${line}\n`;
  writeFileSync(path, text);
}

async function main() {
  const base = process.argv[2]?.replace(/\/$/, "");
  if (!base?.startsWith("https://")) throw new Error("Give the app's public https address.");
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");

  const { stripe } = await import("../src/lib/payments/stripe");
  const url = `${base}/api/stripe/webhook`;

  // Remove the endpoints this script made earlier; the address has changed.
  const existing = await stripe().webhookEndpoints.list({ limit: 100 });
  for (const endpoint of existing.data) {
    if (endpoint.metadata?.createdBy === MARK) await stripe().webhookEndpoints.del(endpoint.id);
  }

  const endpoint = await stripe().webhookEndpoints.create({
    url,
    enabled_events: [...EVENTS],
    metadata: { createdBy: MARK },
  });
  if (!endpoint.secret) throw new Error("Stripe did not return a signing secret.");

  setEnv("STRIPE_WEBHOOK_SECRET", endpoint.secret);
  setEnv("PUBLIC_APP_URL", base);
  console.log(`Stripe will send its messages to ${url}`);
  console.log("The signing secret and the public address were saved to .env.local.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
