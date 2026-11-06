/**
 * The one place the app sends email from.
 *
 * While developing, nothing is really sent: each message is saved to the
 * email_outbox table and can be read on the admin-only "sent emails" page.
 * When a real sending service is chosen, it is called from here and nothing
 * else changes.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/** No address is ever sent more than this many emails in an hour, whoever asks. */
export const MAX_EMAILS_PER_ADDRESS_PER_HOUR = 5;

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<void> {
  const to = message.to.trim().toLowerCase();
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.emailOutbox)
    .where(and(eq(schema.emailOutbox.to, to), gt(schema.emailOutbox.createdAt, new Date(Date.now() - 3_600_000))));
  if (recent.count >= MAX_EMAILS_PER_ADDRESS_PER_HOUR) {
    console.warn("[email] not sent: this address has had too many emails in the last hour");
    return;
  }

  const live = process.env.NODE_ENV === "production";
  // Emails contain login links. In the live app only the fact that one was sent is kept, not its text.
  await db.insert(schema.emailOutbox).values({ to, subject: message.subject, body: live ? "" : message.text });
  if (live) {
    // No sending service has been chosen yet. This must be filled in before real people sign up.
    console.error("[email] no email service is set up, so this message was not delivered");
  }
}

/** For callers that must not wait for the email (so timing gives nothing away) or fail because of it. */
export function sendEmailInBackground(message: { to: string; subject: string; text: string }): void {
  void sendEmail(message).catch((error) => console.error("[email] could not send", error));
}
