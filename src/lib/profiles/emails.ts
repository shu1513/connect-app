/**
 * The email a host gets when the founder decides about their profile. Written in the same
 * database step as the decision (see queueEmail), so a host is told exactly when it happens.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { profileDecisionEmail } from "./decision-email";
import { topPriceEmail } from "./top-price-email";

type Writer = Pick<typeof db, "insert" | "select">;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Queues the email for one decision. The caller only calls this when the answer really changed
 * (under a lock), so each call is one event and gets a name of its own.
 */
export async function queueProfileDecisionEmail(tx: Writer, input: { userId: string; decision: "approved" | "declined" | "suspended"; /** For "declined" and "suspended": why, as saved with the decision. */ reason?: string | null }): Promise<void> {
  const [host] = await tx
    .select({ name: schema.user.name, email: schema.user.email, closedAt: schema.user.closedAt, handle: schema.hostProfiles.handle, hidden: schema.hostProfiles.hidden })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .where(eq(schema.hostProfiles.userId, input.userId));
  // A closed account is not written to.
  if (!host || host.closedAt) return;
  const { subject, text } = profileDecisionEmail(input.decision, host, appUrl(), input.reason ?? null);
  await queueEmail(tx, { to: host.email, subject, text, key: `profile_${input.decision}:${input.userId}:${randomUUID()}` });
}

/**
 * Queues the email to a host whose price came down because the founder lowered her top price
 * (plans/48). Written in the same database step as the change, and each change is one event.
 */
export async function queueTopPriceEmail(tx: Writer, input: { userId: string; topPricePer15Cents: number; priceWas: number }): Promise<boolean> {
  const [host] = await tx.select({ name: schema.user.name, email: schema.user.email, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, input.userId));
  // A closed account is not written to. The answer says whether an email was written, so the founder is not told one went out when none did.
  if (!host || host.closedAt) return false;
  const { subject, text } = topPriceEmail(host, { topPricePer15Cents: input.topPricePer15Cents, priceWas: input.priceWas }, appUrl());
  return queueEmail(tx, { to: host.email, subject, text, key: `top_price:${input.userId}:${randomUUID()}` });
}
