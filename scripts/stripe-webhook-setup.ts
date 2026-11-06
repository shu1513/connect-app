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
  "charge.dispute.created",
  "charge.dispute.closed",
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
