/**
 * Telling people about a coming version of a legal document (plans/46-agreements-live.md,
 * decision 12, part 2).
 *
 * A version whose day has not come is "coming". The helper emails every person it concerns, once,
 * as soon as it sees one. The email's key holds the document, the version, the day and the person,
 * so nobody is told twice, and a day that is moved is announced again by itself.
 *
 * The Terms (23.2) and the Host Agreement (19.2) promise 30 days. Whether they were kept is said
 * in the health report (`noticeHealthProblems`): an email that went out with fewer than 30 days
 * left, or that is still not out with fewer than 30 days left, or that failed for a reason of our
 * own. The founder then moves the day.
 *
 * The rules are in the first half of this file, without the database, so that they can be tested
 * on their own.
 */
import { and, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { comingVersion, dayOf, DOCUMENT_NAMES, DOCUMENTS, GENERAL_DOCUMENTS, NOTICE_DAYS, versionHref, versionsOf, type DocumentName, type DocumentVersion } from "./versions";

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

export type Coming = {
  name: DocumentName;
  version: DocumentVersion;
  audience: "everyone" | "hosts";
  /**
   * Whether 30 days' notice is owed for it. Not after a draft (a draft was never in force, so nobody holds terms
   * that are being changed), and not for a version that says why it is urgent.
   */
  owed: boolean;
};

/** Every coming version that somebody has to be told about, at this moment. */
export function comingVersions(now: Date): Coming[] {
  return DOCUMENT_NAMES.flatMap((name) => {
    const audience = AUDIENCE[name];
    const version = comingVersion(name, now);
    if (!audience || !version) return [];
    const all = versionsOf(name);
    const before = all[all.indexOf(version) - 1];
    return [{ name, version, audience, owed: Boolean(before && !before.draft && !version.urgent) }];
  });
}

/** The last moment at which an email still gives the full 30 days. */
export function noticeDeadline(version: DocumentVersion): Date {
  return new Date(dayOf(version.effectiveFrom).getTime() - NOTICE_DAYS * DAY_MS);
}

const KEY = "agreement-notice";

/** The start of every key of one coming version: document, version and day. The person's own name for us follows. */
export function noticeKeyStart(name: DocumentName, version: DocumentVersion): string {
  return `${KEY}:${name}:${version.version}:${version.effectiveFrom}:`;
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

/** The words of the email. `site` is the site's own address, without a slash at its end. */
export function noticeEmail(coming: Pick<Coming, "name" | "version">, person: { name: string }, site: string): { subject: string; text: string } {
  const { name, version } = coming;
  const title = DOCUMENTS[name].title;
  const day = dayInWords(version.effectiveFrom);
  const accepted = (GENERAL_DOCUMENTS as readonly DocumentName[]).includes(name);
  const whatToDo =
    name === "host-agreement"
      ? `You do not need to do anything now. From ${day} your Hosting page asks you to accept the new version.`
      : accepted
        ? `You do not need to do anything now. From ${day} we ask you to accept the new version the next time you use Connect.`
        : "You do not need to do anything.";
  const lines = [
    `Hi ${person.name},`,
    "",
    `Our ${title} will change. The new version takes effect on ${day}.`,
    "",
    "What changes:",
    version.summary.trim() || "See the new version itself.",
    "",
    "The new version, in full:",
    `${site}${versionHref(name, version.version)}`,
    "",
    "The version in effect until then:",
    `${site}${DOCUMENTS[name].path}`,
    "",
    whatToDo,
    "",
    `If you do not agree with the change, you can stop using Connect and ask us to close your account before ${day}: write to ${SUPPORT_EMAIL}.`,
    "",
    `—\nConnect · questions: ${SUPPORT_EMAIL}`,
  ];
  return { subject: `Our ${title} will change on ${day}`, text: lines.join("\n") };
}

/** Why a failed notice is not ours to mend: the address bounces or complained, or the email was no longer true. */
export function failureIsOurs(lastError: string | null): boolean {
  return !/^(address not written to:|no longer wanted:)/.test(lastError ?? "");
}

// ---------------------------------------------------------------------------------------------
// With the database.
// ---------------------------------------------------------------------------------------------

function siteAddress(): string {
  return (process.env.PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * The people a coming version concerns, as a condition on the people's table, and since when each has been
 * concerned. "Everyone" is everyone with an open account who has finished signing up at least once: a person
 * who has not is shown the coming change on that last step, and is found here a moment after finishing it.
 * A paused account is still an account: its owner is told.
 */
function concerned(audience: "everyone" | "hosts"): { who: SQL; since: SQL } {
  const open = and(isNull(schema.user.closedAt), eq(schema.user.emailVerified, true), isNotNull(schema.user.adultConfirmedAt))!;
  if (audience === "everyone") return { who: open, since: sql`${schema.user.adultConfirmedAt}` };
  const hostSince = sql`(select ${schema.hostProfiles.createdAt} from ${schema.hostProfiles} where ${schema.hostProfiles.userId} = ${schema.user.id})`;
  return { who: and(open, sql`${hostSince} is not null`)!, since: hostSince };
}

/** For check scripts only: touch nobody but people whose address matches. */
export type OnlyPeople = { emailLike: string };
const only = (people?: OnlyPeople) => (people ? sql`${schema.user.email} like ${people.emailLike}` : undefined);

/**
 * Writes the email about every coming version to everyone it concerns who has none yet. A few hundred people a
 * round; the helper comes back about once a minute until nobody is left. Returns how many emails were written.
 */
export async function announceComingVersions(now: Date, people?: OnlyPeople, perRound = 300): Promise<number> {
  let written = 0;
  for (const coming of comingVersions(now)) {
    const start = noticeKeyStart(coming.name, coming.version);
    const { who } = concerned(coming.audience);
    const untold = await db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(and(who, only(people), sql`not exists (select 1 from ${schema.emailOutbox} where ${schema.emailOutbox.dedupeKey} = ${start} || ${schema.user.id})`))
      .limit(perRound);
    for (const person of untold) {
      const { subject, text } = noticeEmail(coming, person, siteAddress());
      // Not worth sending once its day has come: from then on the site itself asks.
      if (await queueEmail(db, { to: person.email, subject, text, key: `${start}${person.id}`, expiresAt: dayOf(coming.version.effectiveFrom) })) written++;
    }
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
  if (!still) return "that version is not coming on that day any more";
  const [person] = await db.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, read.userId));
  if (!person || person.closedAt) return "the account is closed";
  return null;
}

/**
 * Was everyone told in time? One line for each coming version for which the 30 days are owed and were not kept
 * for somebody who was concerned before the last day for it. A person who signed up, or became a host, later
 * than that gets a shorter time by the nature of it, and is not counted.
 */
export async function noticeHealthProblems(now: Date, people?: OnlyPeople): Promise<string[]> {
  const problems: string[] = [];
  for (const coming of comingVersions(now)) {
    if (!coming.owed) continue;
    const deadline = noticeDeadline(coming.version);
    const start = noticeKeyStart(coming.name, coming.version);
    const { who, since } = concerned(coming.audience);
    const inTime = sql`${since} <= ${deadline.toISOString()}::timestamptz`;
    const mail = schema.emailOutbox;
    const theirs = sql`${mail.dedupeKey} = ${start} || ${schema.user.id}`;
    const any = async (condition: SQL) => (await db.select({ id: schema.user.id }).from(schema.user).where(and(who, only(people), inTime, condition)).limit(1)).length > 0;
    const what = `${DOCUMENTS[coming.name].title}, version ${coming.version.version}, in effect from ${coming.version.effectiveFrom}`;
    const notOurs = sql`(coalesce(${mail.lastError}, '') like 'address not written to:%' or coalesce(${mail.lastError}, '') like 'no longer wanted:%')`;

    if (await any(sql`exists (select 1 from ${mail} where ${theirs} and ${mail.status} = 'sent' and ${mail.sentAt} > ${deadline.toISOString()}::timestamptz)`)) {
      problems.push(`the notice of a new version went out to somebody with fewer than ${NOTICE_DAYS} days left (${what}): move its day`);
    }
    if (await any(sql`exists (select 1 from ${mail} where ${theirs} and ${mail.status} = 'failed' and not ${notOurs})`)) {
      problems.push(`the notice of a new version could not be sent to somebody (${what}): see the Emails page`);
    }
    if (now.getTime() > deadline.getTime() && (await any(sql`not exists (select 1 from ${mail} where ${theirs} and ${mail.status} in ('sent', 'failed'))`))) {
      problems.push(`the notice of a new version is still not out to somebody, with fewer than ${NOTICE_DAYS} days left (${what}): move its day`);
    }
  }
  return problems;
}
