/**
 * The round that pauses an account by itself (plans/52-automatic-pause.md): who has reached a
 * line is read here from reports, calls, payments, bank disputes and ratings; the lines
 * themselves are in auto-pause-rules.ts, and the pause is the founder's own (pauseByItself in
 * reports.ts).
 *
 * A round counts first and acts after. Whatever it acts on is counted a second time inside the
 * step that pauses or warns, with the account's row held, so that a pause a person lifted in
 * between, or a report closed in between, is not acted on from an old count. A round that stops
 * in the middle is simply run again.
 */
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { countedUpTo, type CountedRating, RATING, shownAverage, type ShownAverage } from "@/lib/ratings/rules";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { AUTO_PAUSE, AUTO_PAUSE_WORDS, ratingsPause, ratingsWarn, reportsPause, warnedLongEnough } from "./auto-pause-rules";
import { pauseByItself, pausedListUrl } from "./reports";

const DAY_MS = 24 * 3_600_000;
type Reader = Pick<typeof db, "select" | "execute">;

/**
 * A call that was really paid for (decision 4a): money was taken for it (a member's call by the
 * part of the month it used), and no bank took it back or is about to. Money given back
 * afterwards by the host or by Connect does not undo it: otherwise a host could give their money
 * back to the people who complained and make the complaints disappear.
 *
 * A bank's dispute is read where the money work reads it (collect.ts): the payment's own mark
 * while a dispute is open, the month's mark for a member's call, and the dispute's record once
 * one is lost. The marks are written first when a dispute arrives, so a dispute whose record
 * could not be written yet still takes the call out.
 */
const paidCallOf = (call: string) =>
  sql.raw(`exists (
    select 1 from "payments" p
    where p.call_id = ${call}.id and p.status = 'charged' and coalesce(p.charged_cents, 0) > 0
      and p.dispute_open = false
      and not exists (select 1 from "membership_months" m where m.id = p.month_id and m.dispute in ('open', 'lost'))
      and not exists (select 1 from "disputes" d where d.payment_id = p.id and d.status = 'lost')
  )`);

const since90 = (now: Date) => new Date(now.getTime() - AUTO_PAUSE.withinDays * DAY_MS).toISOString();

/**
 * The reports that count right now (decision 4), one row for each account and reporter. A report
 * counts when it was made in the last 90 days and after the last lifted pause, nobody on the
 * team has closed it, its reporter had a really paid call with the account in those 90 days and
 * has an account that is not closed, and the account has no open report of its own about that
 * reporter from those 90 days. Accounts that are paused, closed or an admin's are left out.
 */
const countedRows = (now: Date, only?: string) => sql`
    select r.reported_id, r.reporter_id, reported.auto_pause_from
    from "reports" r
    join "user" reported on reported.id = r.reported_id
    join "user" reporter on reporter.id = r.reporter_id
    where r.status = 'open'
      and r.created_at > ${since90(now)}::timestamptz
      and r.created_at <= ${now.toISOString()}::timestamptz
      and r.reporter_id <> r.reported_id
      and reported.paused_at is null
      and reported.closed_at is null
      and reporter.closed_at is null
      and (reported.auto_pause_from is null or r.created_at > reported.auto_pause_from)
      and not exists (select 1 from "admins" a where a.user_id = r.reported_id)
      and not exists (
        select 1 from "reports" back
        where back.reporter_id = r.reported_id and back.reported_id = r.reporter_id
          and back.status = 'open' and back.created_at > ${since90(now)}::timestamptz
      )
      and exists (
        select 1 from "calls" c
        where c.cancelled_at is null
          and c.starts_at > ${since90(now)}::timestamptz
          and ((c.host_id = r.reported_id and c.customer_id = r.reporter_id) or (c.host_id = r.reporter_id and c.customer_id = r.reported_id))
          and ${paidCallOf("c")}
      )
      ${only !== undefined ? sql`and r.reported_id = ${only}` : sql``}
    group by r.reported_id, r.reporter_id, reported.auto_pause_from`;

/** The different people whose reports about an account count right now, for every account that has at least one (or for `only`). */
export async function countedReporters(now: Date, only?: string, reader: Reader = db): Promise<Map<string, Set<string>>> {
  const rows = await reader.execute<{ reported_id: string; reporter_id: string }>(countedRows(now, only));
  const found = new Map<string, Set<string>>();
  for (const row of rows) {
    const one = found.get(row.reported_id);
    if (one) one.add(row.reporter_id);
    else found.set(row.reported_id, new Set([row.reporter_id]));
  }
  return found;
}

export type ReportFacts = { reporters: number; people: number; from: Date | null; pauses: boolean };

/**
 * What the reports about one account come to at one moment: how many different people's reports
 * count, how many different people the account had a really paid call with in the same 90 days
 * (as a host or as a customer; every counted reporter is one of them), the fresh start it is on,
 * and whether that pauses it. Read in ONE question to the database, so that the two numbers
 * belong to the same moment.
 */
export async function reportFacts(userId: string, now: Date, reader: Reader = db): Promise<ReportFacts> {
  const rows = await reader.execute<{ reporters: number; people: number; auto_pause_from: Date | string | null }>(sql`
    with counted as (${countedRows(now, userId)})
    select
      (select count(*)::int from counted) as reporters,
      (select count(distinct case when c.host_id = ${userId} then c.customer_id else c.host_id end)::int
         from "calls" c
         where (c.host_id = ${userId} or c.customer_id = ${userId})
           and c.cancelled_at is null
           and c.starts_at > ${since90(now)}::timestamptz
           and ${paidCallOf("c")}) as people,
      (select u.auto_pause_from from "user" u where u.id = ${userId}) as auto_pause_from
  `);
  const row = rows[0];
  const facts = { reporters: Number(row?.reporters ?? 0), people: Number(row?.people ?? 0) };
  return { ...facts, from: row?.auto_pause_from ? new Date(row.auto_pause_from) : null, pauses: reportsPause(facts) };
}

/**
 * A person's average in one role for the pause and its warning: counted as the shown one is
 * (ratings.ts), but only from ratings of calls that were really paid for, and that started after
 * `from` (the last lifted pause) when there is one. A free call costs nothing to make, so its
 * stars count for what is shown and never toward a pause: the same line the reports have.
 */
export async function averageSince(userId: string, as: "host" | "customer", from: Date | null, now: Date, reader: Reader = db): Promise<ShownAverage | null> {
  const rows: CountedRating[] = await reader
    .select({ raterId: schema.ratings.raterId, stars: schema.ratings.stars, raterClosed: sql<boolean>`${schema.user.closedAt} is not null` })
    .from(schema.ratings)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.ratings.callId))
    .innerJoin(schema.user, eq(schema.user.id, schema.ratings.raterId))
    .where(and(eq(schema.ratings.ratedId, userId), eq(schema.ratings.ratedAs, as), lte(schema.calls.endsAt, countedUpTo(now)), from ? gt(schema.calls.startsAt, from) : undefined, paidCallOf('"calls"')))
    .orderBy(asc(schema.calls.endsAt), asc(schema.ratings.id));
  return shownAverage(rows);
}

type Candidate = { id: string; name: string; email: string; as: "host" | "customer"; from: Date | null; warnedAt: Date | null };

/**
 * Accounts whose ratings could be low enough for the warning or the pause, in either role: not
 * paused, not closed, not an admin's, rated by at least 5 different people, at least two of the
 * ratings 2 stars or lower (an average of 2.5 or lower from 5 or more people is not possible
 * with fewer). Only a first cut: the average itself is counted for each one.
 */
async function lowRatedCandidates(only?: string): Promise<Candidate[]> {
  const rows = await db.execute<{ id: string; name: string; email: string; rated_as: string; auto_pause_from: Date | string | null; rating_warned_at: Date | string | null }>(sql`
    select u.id, u.name, u.email, g.rated_as, u.auto_pause_from, u.rating_warned_at
    from "ratings" g
    join "user" u on u.id = g.rated_id
    where u.paused_at is null
      and u.closed_at is null
      and not exists (select 1 from "admins" a where a.user_id = u.id)
      ${only !== undefined ? sql`and u.id = ${only}` : sql``}
    group by u.id, u.name, u.email, g.rated_as, u.auto_pause_from, u.rating_warned_at
    having count(distinct g.rater_id) >= ${RATING.minPeople} and count(*) filter (where g.stars <= 2) >= 2
  `);
  const when = (value: Date | string | null) => (value ? new Date(value) : null);
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, as: row.rated_as === "host" ? "host" : "customer", from: when(row.auto_pause_from), warnedAt: when(row.rating_warned_at) }));
}

const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
/** The moment something is decided inside its own step: never earlier than the round's own clock, and not an old one if the round took long. */
const decisionTime = (now: Date) => new Date(Math.max(now.getTime(), Date.now()));
const warningKey = (userId: string, warnedAt: Date) => `rating-warning:${userId}:${warnedAt.getTime()}`;

/**
 * The one warning about low ratings (decision 6a), written and marked in one step with the
 * account's row held: only an account that is still open, not paused, not an admin's, on the
 * same fresh start and not warned yet, and whose average is still low when counted again there.
 */
async function warnAboutRatings(one: Candidate, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    // (Held the way a pause holds it, which lets a call or a request that names this person be written meanwhile.)
    const [row] = await tx
      .select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt, from: schema.user.autoPauseFrom, warnedAt: schema.user.ratingWarnedAt })
      .from(schema.user)
      .where(eq(schema.user.id, one.id))
      .for("no key update");
    const [admin] = await tx.select({ id: schema.admins.userId }).from(schema.admins).where(eq(schema.admins.userId, one.id));
    if (!row || admin || row.pausedAt || row.closedAt || row.warnedAt || !same(row.from, one.from)) return false;
    const at = decisionTime(now);
    const shown = await averageSince(one.id, one.as, one.from, at, tx);
    if (!ratingsWarn(shown) && !ratingsPause(shown)) return false;
    await tx.update(schema.user).set({ ratingWarnedAt: at }).where(eq(schema.user.id, one.id));
    await queueEmail(tx, { to: one.email, subject: AUTO_PAUSE_WORDS.ratings.warnSubject, text: AUTO_PAUSE_WORDS.ratings.warnText(one.name, one.as, SUPPORT_EMAIL), key: warningKey(one.id, at) });
    return true;
  });
}

/**
 * When the warning this account was marked with really went out: the moment its email was sent,
 * or null while it has not been (still waiting, or it could not be delivered). The 14 days run
 * from here: nobody is paused for ratings on the strength of an email that never left.
 */
async function warningSentAt(one: Candidate): Promise<Date | null> {
  if (!one.warnedAt) return null;
  const [mail] = await db.select({ sentAt: schema.emailOutbox.sentAt }).from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, warningKey(one.id, one.warnedAt)));
  return mail?.sentAt ?? null;
}

/**
 * One round. `only` keeps it to one account (the check script). Each account is looked at by
 * itself: a failure with one never stops the others. Returns who was paused and who was warned.
 */
export async function runAutoPauses(now: Date, only?: string): Promise<{ paused: string[]; warned: string[] }> {
  const paused: string[] = [];
  const warned: string[] = [];
  const list = pausedListUrl();

  // Reports.
  for (const [userId, reporters] of await countedReporters(now, only)) {
    try {
      if (reporters.size < AUTO_PAUSE.reporters) continue;
      const looked = await reportFacts(userId, now);
      if (!looked.pauses) continue;
      const [person] = await db.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, userId));
      if (!person) continue;
      // What the pause is really made on: counted again in the pause's own step, at that moment. A report a
      // person closed in between no longer counts, and the founder is told the numbers of that second count.
      let decided: ReportFacts = looked;
      const done = await pauseByItself({
        userId,
        expectedFrom: looked.from,
        stillTrue: async (tx) => {
          decided = await reportFacts(userId, decisionTime(now), tx);
          return decided.pauses;
        },
        reason: AUTO_PAUSE_WORDS.reports.reason,
        because: AUTO_PAUSE_WORDS.reports.because,
        founder: { subject: AUTO_PAUSE_WORDS.reports.founderSubject, text: () => AUTO_PAUSE_WORDS.reports.founderText(person, decided, list), alreadyText: AUTO_PAUSE_WORDS.reports.founderAlready(person, list) },
        key: `paused:${userId}:by-itself:reports:${looked.from?.getTime() ?? 0}`,
      });
      if (done === "paused") paused.push(userId);
    } catch (error) {
      console.error(`[auto-pause] looking at the reports about ${userId} failed; will retry`, error);
    }
  }

  // Ratings: first the one warning; the pause only some days after that email was sent.
  for (const one of await lowRatedCandidates(only)) {
    try {
      if (paused.includes(one.id) || warned.includes(one.id)) continue;
      const looked = await averageSince(one.id, one.as, one.from, now);
      if (!ratingsWarn(looked) && !ratingsPause(looked)) continue;
      if (one.warnedAt === null) {
        if (await warnAboutRatings(one, now)) warned.push(one.id);
      } else if (ratingsPause(looked) && warnedLongEnough(await warningSentAt(one), now)) {
        let decided: ShownAverage = looked!;
        const done = await pauseByItself({
          userId: one.id,
          expectedFrom: one.from,
          stillTrue: async (tx) => {
            const again = await averageSince(one.id, one.as, one.from, decisionTime(now), tx);
            if (!ratingsPause(again)) return false;
            decided = again!;
            return true;
          },
          reason: AUTO_PAUSE_WORDS.ratings.reason(one.as),
          because: AUTO_PAUSE_WORDS.ratings.because(one.as),
          founder: { subject: AUTO_PAUSE_WORDS.ratings.founderSubject, text: () => AUTO_PAUSE_WORDS.ratings.founderText(one, one.as, decided, list), alreadyText: AUTO_PAUSE_WORDS.ratings.founderAlready(one, list) },
          key: `paused:${one.id}:by-itself:ratings:${one.as}:${one.from?.getTime() ?? 0}`,
        });
        if (done === "paused") paused.push(one.id);
      }
    } catch (error) {
      console.error(`[auto-pause] looking at the ratings of ${one.id} failed; will retry`, error);
    }
  }
  return { paused, warned };
}
