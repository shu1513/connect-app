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

export type EmailKind = "confirm" | "reset" | "notice" | "booking";

/**
 * How many emails of each kind one address can be sent, whoever asks. The
 * kinds are counted apart, so someone who keeps triggering one kind for an
 * address (for example by "signing up" with it again and again) cannot use up
 * the owner's allowance for a password-reset or confirmation link.
 */
export const EMAIL_LIMITS: Record<EmailKind, { max: number; hours: number }> = {
  confirm: { max: 5, hours: 1 },
  reset: { max: 5, hours: 1 },
  // "Someone tried to sign up with your address": once a day is enough.
  notice: { max: 1, hours: 24 },
  // Emails about bookings are each written once per event (see queueEmail), so this is only a safety net.
  booking: { max: 60, hours: 1 },
};

type Email = { to: string; kind: EmailKind; subject: string; text: string };

export async function sendEmail(message: Email): Promise<void> {
  const to = message.to.trim().toLowerCase();
  const limit = EMAIL_LIMITS[message.kind];
  const live = process.env.NODE_ENV === "production";
  const saved = await db.transaction(async (tx) => {
    // One address at a time, so many requests at the same moment cannot slip past the limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`email:${to}`}))`);
    const [recent] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.emailOutbox)
      .where(
        and(
          eq(schema.emailOutbox.to, to),
          eq(schema.emailOutbox.kind, message.kind),
          gt(schema.emailOutbox.createdAt, new Date(Date.now() - limit.hours * 3_600_000)),
        ),
      );
    if (recent.count >= limit.max) return false;
    // Emails contain login links. In the live app only the fact that one was sent is kept, not its text.
    await tx.insert(schema.emailOutbox).values({ to, kind: message.kind, subject: message.subject, body: live ? "" : message.text });
    return true;
  });
  if (!saved) {
    console.warn(`[email] not sent: this address has had too many "${message.kind}" emails recently`);
    return;
  }
  if (live) {
    // No sending service has been chosen yet. This must be filled in before real people sign up.
    console.error("[email] no email service is set up, so this message was not delivered");
  }
}

/** For callers that must not wait for the email (so timing gives nothing away) or fail because of it. */
export function sendEmailInBackground(message: Email): void {
  void sendEmail(message).catch((error) => console.error("[email] could not send", error));
}

type Writer = Pick<typeof db, "insert">;

/**
 * Writes an email about an event (a request was accepted, a call was
 * cancelled) as part of the same database step as the event itself, so the
 * email exists exactly when the event happened: never lost, never twice.
 * `key` names the event, for example "accepted:<booking id>:customer".
 */
export async function queueEmail(tx: Writer, message: { to: string; subject: string; text: string; key: string }): Promise<void> {
  // These emails carry deadlines and instructions but no login links, so their text is always kept:
  // it is what the sending service will deliver.
  await tx
    .insert(schema.emailOutbox)
    .values({
      to: message.to.trim().toLowerCase(),
      kind: "booking",
      subject: message.subject,
      body: message.text,
      dedupeKey: message.key,
    })
    .onConflictDoNothing();
}
