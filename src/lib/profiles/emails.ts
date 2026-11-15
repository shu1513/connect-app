/**
 * The email a host gets when the founder decides about their profile. Written in the same
 * database step as the decision (see queueEmail), so a host is told exactly when it happens.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { profileDecisionEmail } from "./decision-email";

type Writer = Pick<typeof db, "insert" | "select">;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Queues the email for one decision. `decidedAt` is part of its name, so a later decision about the same profile gets its own email. */
export async function queueProfileDecisionEmail(tx: Writer, input: { userId: string; decision: "approved" | "declined" | "suspended"; decidedAt: Date }): Promise<void> {
  const [host] = await tx
    .select({ name: schema.user.name, email: schema.user.email, closedAt: schema.user.closedAt, handle: schema.hostProfiles.handle })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .where(eq(schema.hostProfiles.userId, input.userId));
  // A closed account is not written to.
  if (!host || host.closedAt) return;
  const { subject, text } = profileDecisionEmail(input.decision, host, appUrl());
  await queueEmail(tx, { to: host.email, subject, text, key: `profile_${input.decision}:${input.userId}:${input.decidedAt.toISOString()}` });
}
