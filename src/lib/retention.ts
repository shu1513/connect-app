/**
 * End dates for two kinds of record (plans/46-agreements-live.md, decision 15, part 4). The helper
 * runs both about once an hour.
 *
 *   - An email, two years after it was sent: only the fact that it was sent is kept. Its text, its
 *     subject and the address it went to are removed, and with them the extra headers (they can hold
 *     a link that still works), the note of an error and the sending service's own number. Its kind,
 *     its key, its times and whether it was sent or failed stay. An email that was never sent is
 *     treated the same two years after it was written. One that is still waiting to be sent, or
 *     being sent, is never touched.
 *   - A login record, twelve months after it ran out: deleted. (Most are gone much sooner: the
 *     login library removes them on logging out.) The login library's one-time codes and links
 *     (confirming an address, a new password) go the same way twelve months after they ran out.
 *
 * These are the two periods of the draft Privacy Policy (section 7) that do not depend on an
 * account being closed. What happens on closing is plans/45, parts 19 to 19c.
 */
import { and, inArray, isNotNull, like, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export const EMAIL_KEPT_YEARS = 2;
export const LOGIN_KEPT_MONTHS = 12;

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
export type OnlyThese = { emailKeyLike: string; userIds: string[]; codeLike: string };

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
        or(ne(mail.to, ""), ne(mail.subject, ""), ne(mail.body, ""), isNotNull(mail.headers), isNotNull(mail.lastError), isNotNull(mail.providerId)),
        only ? like(mail.dedupeKey, only.emailKeyLike) : undefined,
      ),
    )
    .limit(PER_ROUND);
  const emptied = await db
    .update(mail)
    .set({ to: "", subject: "", body: "", headers: null, lastError: null, providerId: null })
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

/** Both, for the helper. One failing does not stop the other. */
export async function runRetention(now: Date): Promise<void> {
  await emptyOldEmails(now).catch((error) => console.error("[retention] emptying old emails failed; will retry", error));
  await deleteOldLogins(now).catch((error) => console.error("[retention] deleting old login records failed; will retry", error));
}
