/**
 * Messages from Connect to a person, kept in the app (plans/47-bank-disputes.md, decision 2).
 *
 * A message is always written together with the email that carries the same words, in one
 * database step and under one key. So what a person reads on their "Messages" page is what
 * was emailed to them, and neither exists twice.
 */
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
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
 * The person's browser has shown their Messages page down from this message, its newest: that
 * message and every older one of theirs count as read from now. Only ever their own, and only ones
 * not read before (the first time stays). Older than the page shows are read too: they were emailed,
 * and a number in the top bar that nothing on the page can clear would only mislead.
 */
export async function markReadUpTo(userId: string, newestId: string, now: Date = new Date()): Promise<void> {
  // The moment of the newest message is compared inside the database, never carried through this code: the database
  // keeps it to the microsecond and a date here only to the millisecond, which would leave out the very message shown.
  // A message that is not this person's gives no moment, and then nothing is marked.
  const upTo = sql`(select anchor.created_at from messages anchor where anchor.id = ${newestId} and anchor.user_id = ${userId})`;
  await db
    .update(schema.messages)
    .set({ readAt: now })
    .where(and(eq(schema.messages.userId, userId), isNull(schema.messages.readAt), sql`${schema.messages.createdAt} <= ${upTo}`));
}
