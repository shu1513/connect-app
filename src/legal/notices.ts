/**
 * Telling people about a coming version of a legal document (plans/46-agreements-live.md,
 * decision 12, part 2).
 *
 * A version whose day has not come is "coming". Everyone it concerns is written one email about
 * it: by the helper, about once a minute, for the people who are there; and in the same database
 * step for someone who finishes signing up, or applies to host, while it is coming. The email's
 * key holds the document, the version, the day and the person, so nobody is told twice, and a day
 * that is moved is announced again by itself.
 *
 * The Terms (23.2) and the Host Agreement (19.2) promise 30 days. Whether they were kept is said
 * to the founder by email and on the founder's Emails page (`noticeProblems`, `noticeReport`): an
 * email that went out with fewer than 30 days left, one still not out with fewer than 30 days
 * left, one that failed for a reason of our own. The founder then moves the day, or has a refused
 * email sent again. It is deliberately not part of the health address: that one watches money.
 *
 * The rules are in the first half of this file, without the database, so that they can be tested
 * on their own.
 */
import { and, eq, isNotNull, isNull, like, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { currentVersion, dayOf, DOCUMENT_NAMES, DOCUMENTS, GENERAL_DOCUMENTS, NOTICE_DAYS, versionHref, versionsOf, type DocumentName, type DocumentVersion } from "./versions";

const DAY_MS = 24 * 3_600_000;

/**
 * Who a coming version of each document concerns. The Privacy Policy is told, not accepted. The
 * Copyright Policy is part of the Terms, so it is told like the Terms. The Identity Check Notice is
 * shown in full, in the version in effect, each time a check is started: nobody holds an old one.
 */
export const AUDIENCE: Record<DocumentName, "everyone" | "hosts" | null> = {
  "terms-of-service": "everyone",
  "payment-terms": "everyone",
  "community-rules": "everyone",
  "privacy-policy": "everyone",
  "copyright-policy": "everyone",
  "host-agreement": "hosts",
  "identity-check-notice": null,
};

export type Audience = "everyone" | "hosts";

export type Coming = {
  name: DocumentName;
  version: DocumentVersion;
  audience: Audience;
  /**
   * Whether 30 days' notice is owed for it. Not after a draft (a draft was never in force, so nobody holds terms
   * that are being changed), and not for a version that says why it is urgent.
   */
  owed: boolean;
};

/**
 * Every version whose day has not come and that somebody has to be told about, at this moment. All of them, not
 * only the next one of each document: a second change planned behind the first is owed its own 30 days.
 */
export function comingVersions(now: Date): Coming[] {
  return DOCUMENT_NAMES.flatMap((name) => {
    const audience = AUDIENCE[name];
    if (!audience) return [];
    const all = versionsOf(name);
    return all.flatMap((version, index) => {
      if (dayOf(version.effectiveFrom).getTime() <= now.getTime()) return [];
      const before = all[index - 1];
      return [{ name, version, audience, owed: Boolean(before && !before.draft && !version.urgent?.trim()) }];
    });
  });
}

/** The last moment at which an email still gives the full 30 days. */
export function noticeDeadline(version: DocumentVersion): Date {
  return new Date(dayOf(version.effectiveFrom).getTime() - NOTICE_DAYS * DAY_MS);
}

/** The start of every key of one coming version: document, version and day. The person's own name for us follows. */
export function noticeKeyStart(name: DocumentName, version: Pick<DocumentVersion, "version" | "effectiveFrom">): string {
  return `agreement-notice:${name}:${version.version}:${version.effectiveFrom}:`;
}

/** Reads a key back. Null for a key that is not a notice's. */
export function readNoticeKey(key: string): { name: string; version: string; effectiveFrom: string; userId: string } | null {
  const found = key.match(/^agreement-notice:([^:]+):([^:]+):([^:]+):(.+)$/);
  return found ? { name: found[1], version: found[2], effectiveFrom: found[3], userId: found[4] } : null;
}

/** "21 December 2026", for a day written "2026-12-21". */
export function dayInWords(day: string): string {
  return dayOf(day).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Why an email is given up when its version is no longer coming on its day. Read back by the helper, which takes such an email up again if the day returns. */
export const NOT_COMING = "that version is not coming on that day any more";

/**
 * The words of the email. `site` is the site's own address, without a slash at its end; `inEffect` is the
 * version the person holds today, so that its link still shows that text after the change.
 */
export function noticeEmail(coming: Pick<Coming, "name" | "version">, person: { name: string }, site: string, inEffect: Pick<DocumentVersion, "version">): { subject: string; text: string } {
  const { name, version } = coming;
  const title = DOCUMENTS[name].title;
  const day = dayInWords(version.effectiveFrom);
  const accepted = (GENERAL_DOCUMENTS as readonly DocumentName[]).includes(name);
  const whatToDo =
    name === "host-agreement"
      ? [
          `You do not need to do anything now. From ${day} your Hosting page asks you to accept the new version.`,
          "",
          `If you do not agree with the change, you can end the Host Agreement by closing your host page before ${day}: write to ${SUPPORT_EMAIL}. The change does not apply to calls already booked or to membership months already begun.`,
        ]
      : accepted
        ? [
            `You do not need to do anything now. From ${day} we ask you to accept the new version the next time you use Connect.`,
            "",
            `If you do not agree with the change, stop using Connect and ask us to close your account before ${day}: write to ${SUPPORT_EMAIL}. Calls, memberships and payments agreed before the change stay under the version that applied when they were agreed.`,
            ...(name === "terms-of-service" ? ["", "If the change is to section 20 of the Terms (how disputes are settled), section 20.10 says how you can reject that change and keep the version you accepted."] : []),
          ]
        : [`You do not need to do anything. If you have a question about the change, write to ${SUPPORT_EMAIL}.`];
  const lines = [
    `Hi ${person.name},`,
    "",
    `Our ${title} will change. The new version takes effect on ${day}, at 00:00 UTC.`,
    "",
    "What changes:",
    version.summary.trim() || "See the new version itself.",
    "",
    "The new version, in full:",
    `${site}${versionHref(name, version.version)}`,
    "",
    "The version in effect today:",
    `${site}${versionHref(name, inEffect.version)}`,
    "",
    ...whatToDo,
    "",
    `—\nConnect · questions: ${SUPPORT_EMAIL}`,
  ];
  return { subject: `Our ${title} will change on ${day}`, text: lines.join("\n") };
}

/** A failed notice that is not ours to mend: the address bounces or complained, or the email was no longer true. */
export function failureIsOurs(lastError: string | null): boolean {
  return !/^(address not written to:|no longer wanted:)/.test(lastError ?? "");
}

/**
 * A failed notice that certainly did not go out, so that sending it again cannot send it twice: the sending service
 * was asked exactly once and refused outright (a 4xx answer). Not after several tries (an earlier one may have been
 * accepted with its answer lost), and not a 409, which says an earlier request is still under way.
 */
export function wasRefused(lastError: string | null, attempts: number): boolean {
  return attempts === 1 && /^4\d\d\b/.test(lastError ?? "") && !/^409\b/.test(lastError ?? "");
}

// ---------------------------------------------------------------------------------------------
// With the database.
// ---------------------------------------------------------------------------------------------

type Writer = Pick<typeof db, "insert" | "select">;
const mail = schema.emailOutbox;

function siteAddress(): string {
  return (process.env.PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * The people a coming version concerns, as a condition on the people's table, and since when each has been
 * concerned. "Everyone" is everyone with an open account who has finished signing up at least once: a person
 * who has not is shown the coming change on that last step, and is written to in the step that finishes it.
 * A paused account is still an account: its owner is told.
 */
function concerned(audience: Audience): { who: SQL; since: SQL } {
  const open = and(isNull(schema.user.closedAt), eq(schema.user.emailVerified, true), isNotNull(schema.user.adultConfirmedAt))!;
  if (audience === "everyone") return { who: open, since: sql`${schema.user.adultConfirmedAt}` };
  const hostSince = sql`(select ${schema.hostProfiles.createdAt} from ${schema.hostProfiles} where ${schema.hostProfiles.userId} = ${schema.user.id})`;
  return { who: and(open, sql`${hostSince} is not null`)!, since: hostSince };
}

/** For check scripts only: touch nobody but people whose address matches. */
export type OnlyPeople = { emailLike: string };
const onlyPeople = (people?: OnlyPeople) => (people ? like(schema.user.email, people.emailLike) : undefined);
const onlyMail = (people?: OnlyPeople) => (people ? like(mail.to, people.emailLike) : undefined);

/** Writes one person's email about one coming version, unless it is there. True when it was written now. */
async function writeNotice(tx: Writer, coming: Coming, person: { id: string; name: string; email: string }, now: Date): Promise<boolean> {
  const { subject, text } = noticeEmail(coming, person, siteAddress(), currentVersion(coming.name, now));
  // Not worth sending once its day has come: from then on the site itself asks.
  return queueEmail(tx, { to: person.email, subject, text, key: `${noticeKeyStart(coming.name, coming.version)}${person.id}`, expiresAt: dayOf(coming.version.effectiveFrom) });
}

/**
 * For the step that finishes signing up ("everyone") and the one that makes a host profile ("hosts"): the person is
 * written to about every version coming for that audience, in the same database step. So someone who joins in the
 * last minute before a version's day is told like everyone else, whatever the helper is doing.
 */
export async function queueNoticesFor(tx: Writer, userId: string, audience: Audience, now: Date): Promise<number> {
  const due = comingVersions(now).filter((coming) => coming.audience === audience);
  if (due.length === 0) return 0;
  const [person] = await tx.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
  if (!person) return 0;
  let written = 0;
  for (const coming of due) if (await writeNotice(tx, coming, person, now)) written++;
  return written;
}

/**
 * The helper's round: writes the email about every coming version to everyone it concerns who has none yet. A few
 * hundred people a round; the helper comes back about once a minute until nobody is left. Returns how many emails
 * were written or taken up again.
 */
export async function announceComingVersions(now: Date, people?: OnlyPeople, perRound = 300): Promise<number> {
  let written = 0;
  for (const coming of comingVersions(now)) {
    const start = noticeKeyStart(coming.name, coming.version);
    // An email given up as "not coming on that day any more" while the version IS coming on that day: a helper still
    // running older code gave it up during a release, or the day was moved away and back. It is wanted again. Its
    // tries and the moment of its first try stay as they are: if the sending service was asked before and the answer
    // was lost, the sending's own rules decide (a try older than a day is never repeated blindly), not this.
    const again = await db
      .update(mail)
      .set({ status: "queued", lastError: null, nextAttemptAt: now, leaseUntil: null })
      .where(and(like(mail.dedupeKey, `${start}%`), eq(mail.status, "failed"), eq(mail.lastError, `no longer wanted: ${NOT_COMING}`), onlyMail(people)))
      .returning({ id: mail.id });
    written += again.length;
    const { who } = concerned(coming.audience);
    const untold = await db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(and(who, onlyPeople(people), sql`not exists (select 1 from ${mail} where ${mail.dedupeKey} = ${start} || ${schema.user.id})`))
      .limit(perRound);
    for (const person of untold) if (await writeNotice(db, coming, person, now)) written++;
  }
  return written;
}

/**
 * Asked right before a notice is sent (notifications/delivery.ts): is it still true? Not when the account was
 * closed since, and not when the version is no longer coming on that day (the day was moved: the email with the
 * new day is another one). `undefined` for a key that is not a notice's.
 */
export async function noticeEmailProblem(key: string, now: Date): Promise<string | null | undefined> {
  const read = readNoticeKey(key);
  if (!read) return undefined;
  const still = comingVersions(now).some((c) => c.name === read.name && c.version.version === read.version && c.version.effectiveFrom === read.effectiveFrom);
  if (!still) return NOT_COMING;
  const [person] = await db.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, read.userId));
  if (!person || person.closedAt) return "the account is closed";
  return null;
}

export type NoticeProblem = { kind: "late" | "failed" | "not_out" | "other_day"; coming: Coming; line: string };

/**
 * Was everyone told in time? One line for each coming version for which the 30 days are owed and were not kept
 * for somebody who was concerned before the last day for it. A person who signed up, or became a host, later
 * than that gets a shorter time by the nature of it, and is not counted.
 */
export async function noticeProblems(now: Date, people?: OnlyPeople): Promise<NoticeProblem[]> {
  const problems: NoticeProblem[] = [];
  for (const coming of comingVersions(now)) {
    const deadline = noticeDeadline(coming.version);
    const start = noticeKeyStart(coming.name, coming.version);
    const { who, since } = concerned(coming.audience);
    const what = `${DOCUMENTS[coming.name].title}, version ${coming.version.version}, in effect from ${coming.version.effectiveFrom}`;
    const add = (kind: NoticeProblem["kind"], line: string) => problems.push({ kind, coming, line });
    const anyOf = async (...conditions: SQL[]) => (await db.select({ id: schema.user.id }).from(schema.user).where(and(who, onlyPeople(people), ...conditions)).limit(1)).length > 0;

    // The day was moved away and back again: the email for this day went out, and after it one that names another
    // day. So the last thing the person was told is wrong. Asked for every coming version and everyone concerned,
    // whether or not 30 days are owed: it is about what people were told, not about how early.
    const lastToldAnotherDay = sql`exists (
      select 1 from ${mail} as cur, ${mail} as other
      where cur.dedupe_key = ${start} || ${schema.user.id} and cur.status = 'sent'
        and other.dedupe_key like ${`agreement-notice:${coming.name}:${coming.version.version}:%`}
        and right(other.dedupe_key, length(${schema.user.id}) + 1) = ':' || ${schema.user.id}
        and other.dedupe_key <> cur.dedupe_key and other.status = 'sent' and other.sent_at > cur.sent_at)`;
    if (await anyOf(lastToldAnotherDay)) {
      add("other_day", `Somebody was last told another day for a new version than the one it now has (${what}). Choose a day that was not announced before.`);
    }

    if (!coming.owed) continue;
    const inTime = sql`${since} <= ${deadline.toISOString()}::timestamptz`;
    const theirs = sql`${mail.dedupeKey} = ${start} || ${schema.user.id}`;
    const notOurs = sql`(coalesce(${mail.lastError}, '') like 'address not written to:%' or coalesce(${mail.lastError}, '') like 'no longer wanted:%')`;
    if (await anyOf(inTime, sql`exists (select 1 from ${mail} where ${theirs} and ${mail.status} = 'sent' and ${mail.sentAt} > ${deadline.toISOString()}::timestamptz)`)) {
      add("late", `The notice of a new version went out to somebody with fewer than ${NOTICE_DAYS} days left (${what}). Move its day.`);
    }
    if (await anyOf(inTime, sql`exists (select 1 from ${mail} where ${theirs} and ${mail.status} = 'failed' and not ${notOurs})`)) {
      add("failed", `The notice of a new version could not be sent to somebody (${what}). See the Emails page: an email the sending service refused outright can be sent again there.`);
    }
    if (now.getTime() > deadline.getTime() && (await anyOf(inTime, sql`not exists (select 1 from ${mail} where ${theirs} and ${mail.status} in ('sent', 'failed'))`))) {
      add("not_out", `The notice of a new version is still not out to somebody, with fewer than ${NOTICE_DAYS} days left (${what}). Move its day.`);
    }
  }
  return problems;
}

/**
 * Tells the founder, by email, about each problem once: one email for each admin, version, day and kind of
 * problem. Run by the helper after its round. Returns how many emails were written.
 */
export async function tellFounderAboutNotices(now: Date, people?: OnlyPeople, /** For check scripts only: who is written to instead of the admins. */ instead?: { id: string; email: string }[]): Promise<number> {
  const problems = await noticeProblems(now, people);
  if (problems.length === 0) return 0;
  const admins = instead ?? (await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId)));
  let written = 0;
  for (const problem of problems) {
    for (const admin of admins) {
      const text = [problem.line, "", "Where the day is set: src/legal/versions.ts. Where the emails are listed, with how many went out in time:", `${siteAddress()}/admin/outbox`, "", "This email is sent once for each problem of each version."].join("\n");
      const key = `agreement-notice-problem:${problem.kind}:${noticeKeyStart(problem.coming.name, problem.coming.version)}${admin.id}`;
      if (await queueEmail(db, { to: admin.email, subject: "Connect: the notice of new terms needs you", text, key })) written++;
    }
  }
  return written;
}

/** The helper's whole round. */
export async function runNoticeRound(now: Date): Promise<void> {
  if (comingVersions(now).length === 0) return; // nothing coming: the database is not asked
  await announceComingVersions(now);
  await tellFounderAboutNotices(now);
}

export type NoticeCount = {
  name: DocumentName;
  title: string;
  version: string;
  effectiveFrom: string;
  /** Coming on this day; in effect since this day; or a day that was announced and then given up (the version moved to another day). */
  state: "coming" | "in_effect" | "day_given_up";
  owed: boolean;
  /** Emails written, and of those: sent with 30 days or more to go, sent later, waiting, refused or failed on our side, not sent for a reason that is not ours. */
  written: number;
  sentInTime: number;
  sentLate: number;
  waiting: number;
  failedOurs: number;
  notOurs: number;
};

/**
 * For the founder's Emails page: every announcement of the last year or so, with what became of its emails. Counted
 * from the emails themselves, by the document, version and day their own keys name. So it stands after the day, and
 * a day that was announced and then moved keeps its own line.
 */
export async function noticeReport(now: Date, people?: OnlyPeople): Promise<NoticeCount[]> {
  const coming = comingVersions(now);
  const name = sql<string>`split_part(${mail.dedupeKey}, ':', 2)`;
  const version = sql<string>`split_part(${mail.dedupeKey}, ':', 3)`;
  const day = sql<string>`split_part(${mail.dedupeKey}, ':', 4)`;
  const deadline = sql`((split_part(${mail.dedupeKey}, ':', 4))::timestamp at time zone 'UTC') - interval '30 days'`;
  const rows = await db
    .select({
      name,
      version,
      day,
      written: sql<number>`count(*)::int`,
      sentInTime: sql<number>`count(*) filter (where ${mail.status} = 'sent' and ${mail.sentAt} <= ${deadline})::int`,
      sentLate: sql<number>`count(*) filter (where ${mail.status} = 'sent' and ${mail.sentAt} > ${deadline})::int`,
      waiting: sql<number>`count(*) filter (where ${mail.status} in ('queued', 'sending'))::int`,
      notOurs: sql<number>`count(*) filter (where ${mail.status} = 'failed' and (coalesce(${mail.lastError}, '') like 'address not written to:%' or coalesce(${mail.lastError}, '') like 'no longer wanted:%'))::int`,
      failed: sql<number>`count(*) filter (where ${mail.status} = 'failed')::int`,
    })
    .from(mail)
    .where(and(like(mail.dedupeKey, "agreement-notice:%"), sql`${mail.createdAt} > ${new Date(now.getTime() - 400 * DAY_MS).toISOString()}::timestamptz`, onlyMail(people)))
    .groupBy(name, version, day);
  const report: NoticeCount[] = [];
  for (const row of rows) {
    if (!(DOCUMENT_NAMES as readonly string[]).includes(row.name)) continue;
    const document = row.name as DocumentName;
    const found = coming.find((c) => c.name === document && c.version.version === row.version && c.version.effectiveFrom === row.day);
    const listed = versionsOf(document).some((v) => v.version === row.version && v.effectiveFrom === row.day);
    report.push({ name: document, title: DOCUMENTS[document].title, version: row.version, effectiveFrom: row.day, state: found ? "coming" : listed ? "in_effect" : "day_given_up", owed: found?.owed ?? false, written: row.written, sentInTime: row.sentInTime, sentLate: row.sentLate, waiting: row.waiting, failedOurs: row.failed - row.notOurs, notOurs: row.notOurs });
  }
  // A coming version nobody has been written to about yet still has its line.
  for (const c of coming) {
    if (report.some((one) => one.name === c.name && one.version === c.version.version && one.effectiveFrom === c.version.effectiveFrom)) continue;
    report.push({ name: c.name, title: DOCUMENTS[c.name].title, version: c.version.version, effectiveFrom: c.version.effectiveFrom, state: "coming", owed: c.owed, written: 0, sentInTime: 0, sentLate: 0, waiting: 0, failedOurs: 0, notOurs: 0 });
  }
  return report.sort((x, y) => `${x.effectiveFrom} ${x.name} ${x.version}`.localeCompare(`${y.effectiveFrom} ${y.name} ${y.version}`));
}

/**
 * Puts the notices the sending service refused outright back in the queue, for versions that are still coming.
 * Only those that certainly did not go out (`wasRefused`: asked once, a 4xx answer, not a 409), so a second try
 * cannot send twice; an email whose outcome is not known is left for a person to look at. One statement, with that
 * proof in its own condition, so that nothing can change between looking and writing. Returns how many were put back.
 */
export async function sendRefusedNoticesAgain(now: Date, people?: OnlyPeople): Promise<number> {
  const starts = comingVersions(now).map((coming) => noticeKeyStart(coming.name, coming.version));
  if (starts.length === 0) return 0;
  const back = await db
    .update(mail)
    .set({ status: "queued", lastError: null, attempts: 0, firstTriedAt: null, nextAttemptAt: now, leaseUntil: null })
    .where(
      and(
        eq(mail.status, "failed"),
        eq(mail.attempts, 1),
        sql`${mail.lastError} ~ '^4[0-9][0-9]([^0-9]|$)' and ${mail.lastError} !~ '^409([^0-9]|$)'`,
        sql`(${sql.join(starts.map((start) => sql`${mail.dedupeKey} like ${`${start}%`}`), sql` or `)})`,
        onlyMail(people),
      ),
    )
    .returning({ id: mail.id });
  return back.length;
}
