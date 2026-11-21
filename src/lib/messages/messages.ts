/**
 * Messages from Connect to a person, kept in the app (plans/47-bank-disputes.md, decision 2).
 *
 * A message is always written together with the email that carries the same words, in one
 * database step and under one key. So what a person reads on their "Messages" page is what
 * was emailed to them, and neither exists twice.
 */
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Message } from "@/db/schema";
import { queueEmail } from "@/lib/email";

type Writer = Pick<typeof db, "insert">;

export function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export type Telling = {
  to: { id: string; email: string };
  /** Names the event and the person, for example "dispute:du_1:chargeback:began:host". */
  key: string;
  subject: string;
  /** The words, without the link: the page shows the link as a button, the email as an address. */
  text: string;
  /** A page inside the app, starting with "/". */
  path?: string | null;
  /** After this the email is not worth sending any more. The message in the app stays. */
  emailExpiresAt?: Date;
};

/**
 * Tells a person something: a message on their Messages page and an email with the same words,
 * written in the caller's database step. Gives back whether it was written now: false when this
 * key was written before, and then nothing at all is written.
 */
export async function tell(tx: Writer, telling: Telling): Promise<boolean> {
  const path = telling.path ?? null;
  if (path !== null && !path.startsWith("/")) throw new Error(`A message's link must be a page of the app, not "${path}".`);
  const written = await tx
    .insert(schema.messages)
    .values({ userId: telling.to.id, subject: telling.subject, body: telling.text, path, key: telling.key })
    .onConflictDoNothing()
    .returning({ id: schema.messages.id });
  const emailed = await queueEmail(tx, {
    to: telling.to.email,
    key: telling.key,
    subject: telling.subject,
    text: `${telling.text}\n${path ? `\nRead it in the app:\n${appUrl()}${path}\n` : ""}\nYou can read every message from Connect under "Messages" in the app:\n${appUrl()}/messages\n`,
    expiresAt: telling.emailExpiresAt,
  });
  // The two are a pair. One without the other means this key was used somewhere else for something else:
  // a fault of ours, and nothing half-told may be saved. Throwing undoes the caller's whole step.
  if ((written.length > 0) !== emailed) throw new Error(`The message and the email under the key "${telling.key}" are not a pair.`);
  return emailed;
}

/** How many messages one page shows. Older ones stay in the database. */
export const MESSAGES_SHOWN = 50;

/** A person's latest messages, newest first. */
export async function messagesOf(userId: string): Promise<Message[]> {
  return db.select().from(schema.messages).where(eq(schema.messages.userId, userId)).orderBy(desc(schema.messages.createdAt), desc(schema.messages.id)).limit(MESSAGES_SHOWN);
}

/** How many messages this person has not been shown yet. */
export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(schema.messages)
    .where(and(eq(schema.messages.userId, userId), isNull(schema.messages.readAt)));
  return row?.unread ?? 0;
}

/**
 * The person's own browser has shown these messages: they count as read from now. Only ever their
 * own, and only ones not read before (the first time stays). Exactly the messages that were on the
 * page: one that was written in the same moment and was not on it stays new for the next visit.
 *
 * `alsoOlderThan` is given when the page was full: the oldest message on it. Every unread message
 * older than that one counts as read too. Nothing on the page could ever show those (they were
 * emailed), and a number in the top bar that no page can clear would only mislead. The moment is
 * compared inside the database, never carried through this code: the database keeps it to the
 * microsecond and a date here only to the millisecond.
 */
export async function markShown(userId: string, shownIds: string[], alsoOlderThan: string | null = null, now: Date = new Date()): Promise<void> {
  const mine = and(eq(schema.messages.userId, userId), isNull(schema.messages.readAt));
  if (shownIds.length > 0) await db.update(schema.messages).set({ readAt: now }).where(and(mine, inArray(schema.messages.id, shownIds)));
  if (alsoOlderThan) {
    // A message that is not this person's gives no moment, and then nothing is marked.
    const before = sql`(select anchor.created_at from messages anchor where anchor.id = ${alsoOlderThan} and anchor.user_id = ${userId})`;
    await db.update(schema.messages).set({ readAt: now }).where(and(mine, sql`${schema.messages.createdAt} < ${before}`));
  }
}
