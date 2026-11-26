/**
 * End dates for three kinds of record (plans/46-agreements-live.md, decision 15, part 4). The
 * helper runs them about once an hour.
 *
 *   - An email, two years after it was sent: only the fact that an email of that kind was sent, and
 *     when, is kept. Its text, its subject and the address it went to are removed, and with them
 *     the extra headers (they can hold a link that still works), the note of an error and the
 *     sending service's own number. Its key is replaced by one that names nobody: a key can hold
 *     the numbers of the people an email was about ("follow-post:<host>:<follower>:<post>"), and
 *     the draft Privacy Policy (section 7) promises that what is kept no longer says who it is
 *     about. Its kind, its times and whether it was sent or failed stay. An email that was never
 *     sent is treated the same two years after it was written. One that is still waiting to be
 *     sent, or being sent, is never touched.
 *   - A login record, twelve months after it ran out: deleted. (Most are gone much sooner: the
 *     login library removes them on logging out. A login that is still being used keeps moving
 *     its end forward, so the twelve months count from the last time it could be used.) The login
 *     library's one-time codes and links (confirming an address, a new password) go the same way
 *     twelve months after they ran out.
 *   - The login library's counters of repeated attempts, which are kept by network address: seven
 *     days after the last attempt they counted. They are only read inside windows of an hour.
 *
 * Nothing reads an email by its key that late: the clean-up of refund texts finds its emails after
 * one year, and the notices of new terms are counted for about a year.
 *
 * These are the periods of the draft Privacy Policy (section 7) that do not depend on an account
 * being closed. What happens on closing is plans/45, parts 19 to 19c.
 */
import { and, inArray, isNotNull, like, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export const EMAIL_KEPT_YEARS = 2;
/** A message between a host and a customer is deleted this long after it was sent (plans/49-messaging.md, decision 26). */
export const MESSAGES_KEPT_MONTHS = 12;
export const LOGIN_KEPT_MONTHS = 12;
export const ATTEMPT_COUNTERS_KEPT_DAYS = 7;
/** The start of the key an emptied email gets in place of its own: its own number follows, which names no person. */
export const EMPTIED_KEY = "emptied:";

/** The same day and time, this many months earlier. A day the earlier month does not have (31 March less one month) becomes its last day. */
export function monthsBefore(now: Date, months: number): Date {
  const then = new Date(now.getTime());
  const day = then.getUTCDate();
  then.setUTCDate(1);
  then.setUTCMonth(then.getUTCMonth() - months);
  const last = new Date(Date.UTC(then.getUTCFullYear(), then.getUTCMonth() + 1, 0)).getUTCDate();
  then.setUTCDate(Math.min(day, last));
  return then;
}

/** Emails sent (or, if never sent, written) before this moment are emptied. */
export const emailCutoff = (now: Date): Date => monthsBefore(now, EMAIL_KEPT_YEARS * 12);
/** Login records that ran out before this moment are deleted. */
export const loginCutoff = (now: Date): Date => monthsBefore(now, LOGIN_KEPT_MONTHS);

/** For check scripts only: touch nothing but rows of matching people, so a check never changes other rows. */
export type OnlyThese = { emailKeyLike: string; userIds: string[]; codeLike: string; counterKeyLike: string; conversationIds?: string[] };

const mail = schema.emailOutbox;
/** How many rows one round changes at most; the helper comes back within the hour. */
const PER_ROUND = 2000;

/**
 * Empties the emails whose two years are over. Returns how many were emptied in this round.
 * An emptied email is not found again: the condition asks for something still to remove.
 */
export async function emptyOldEmails(now: Date, only?: OnlyThese): Promise<number> {
  const cutoff = emailCutoff(now).toISOString();
  const due = db
    .select({ id: mail.id })
    .from(mail)
    .where(
      and(
        // Never one that is waiting to be sent or being sent.
        inArray(mail.status, ["sent", "failed"]),
        sql`coalesce(${mail.sentAt}, ${mail.createdAt}) < ${cutoff}::timestamptz`,
        // Something is still to remove. An email with no key of its own (a login link) has none to replace.
        or(ne(mail.to, ""), ne(mail.subject, ""), ne(mail.body, ""), isNotNull(mail.headers), isNotNull(mail.lastError), isNotNull(mail.providerId), sql`${mail.dedupeKey} not like ${`${EMPTIED_KEY}%`}`),
        only ? like(mail.dedupeKey, only.emailKeyLike) : undefined,
      ),
    )
    .limit(PER_ROUND);
  const emptied = await db
    .update(mail)
    .set({ to: "", subject: "", body: "", headers: null, lastError: null, providerId: null, dedupeKey: sql`case when ${mail.dedupeKey} is null then null else ${EMPTIED_KEY} || ${mail.id}::text end` })
    // Asked again in the writing itself: an email that went back to waiting in between is left alone.
    .where(and(inArray(mail.id, due), inArray(mail.status, ["sent", "failed"])))
    .returning({ id: mail.id });
  return emptied.length;
}

/** Deletes the login records, and the login library's one-time codes, that ran out more than twelve months ago. Returns how many. */
export async function deleteOldLogins(now: Date, only?: OnlyThese): Promise<number> {
  const cutoff = loginCutoff(now);
  const sessions = await db
    .delete(schema.session)
    .where(and(lt(schema.session.expiresAt, cutoff), only ? inArray(schema.session.userId, only.userIds) : undefined))
    .returning({ id: schema.session.id });
  const codes = await db
    .delete(schema.verification)
    .where(and(lt(schema.verification.expiresAt, cutoff), only ? like(schema.verification.identifier, only.codeLike) : undefined))
    .returning({ id: schema.verification.id });
  return sessions.length + codes.length;
}

/** Deletes the login library's counters of repeated attempts that have counted nothing for seven days. Returns how many. */
export async function deleteOldAttemptCounters(now: Date, only?: OnlyThese): Promise<number> {
  const cutoff = now.getTime() - ATTEMPT_COUNTERS_KEPT_DAYS * 24 * 3_600_000;
  const gone = await db
    .delete(schema.rateLimit)
    .where(and(lt(schema.rateLimit.lastRequest, cutoff), only ? like(schema.rateLimit.key, only.counterKeyLike) : undefined))
    .returning({ id: schema.rateLimit.id });
  return gone.length;
}

/**
 * Deletes the messages between hosts and customers that were sent more than twelve months ago
 * (plans/49-messaging.md, decision 26). Returns how many in this round. The conversation's own
 * row stays: it holds the customer's switch and the number of the last message, so a number is
 * never used twice. What is kept with a report (`report_conversations`) is a copy of its own and
 * is not touched.
 */
export async function deleteOldConversationMessages(now: Date, only?: Pick<OnlyThese, "conversationIds">): Promise<number> {
  const cutoff = monthsBefore(now, MESSAGES_KEPT_MONTHS);
  const old = schema.conversationMessages;
  const due = db
    .select({ id: old.id })
    .from(old)
    .where(and(lt(old.createdAt, cutoff), only?.conversationIds ? inArray(old.conversationId, only.conversationIds.length ? only.conversationIds : ["00000000-0000-0000-0000-000000000000"]) : undefined))
    .limit(PER_ROUND);
  const gone = await db.delete(old).where(inArray(old.id, due)).returning({ id: old.id });
  return gone.length;
}

/** All four, for the helper. One failing does not stop the others. */
export async function runRetention(now: Date): Promise<void> {
  await emptyOldEmails(now).catch((error) => console.error("[retention] emptying old emails failed; will retry", error));
  await deleteOldLogins(now).catch((error) => console.error("[retention] deleting old login records failed; will retry", error));
  await deleteOldAttemptCounters(now).catch((error) => console.error("[retention] deleting old attempt counters failed; will retry", error));
  // Never the error itself here: a database error can carry the statement's values.
  await deleteOldConversationMessages(now).catch((error) => console.error(`[retention] deleting old messages between hosts and customers failed; will retry (${error instanceof Error ? error.name : "unknown error"})`));
}
