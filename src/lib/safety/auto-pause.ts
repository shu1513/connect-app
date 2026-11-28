/**
 * The round that pauses an account by itself (plans/52-automatic-pause.md): who has reached a
 * line is read here from reports, calls, payments and ratings; the lines themselves are in
 * auto-pause-rules.ts, and the pause is the founder's own (pauseByItself in reports.ts).
 *
 * It only reads, and then pauses: it writes nothing of its own. A round that stops in the middle
 * is simply run again; an account that is paused is not looked at again until a person lifts the
 * pause, and from then on only what came after that moment counts (`user.auto_pause_from`).
 */
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { countedUpTo, type CountedRating, RATING, shownAverage, type ShownAverage } from "@/lib/ratings/rules";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { AUTO_PAUSE, AUTO_PAUSE_WORDS, ratingsPause, ratingsWarn, reportsPause } from "./auto-pause-rules";
import { pauseByItself, pausedListUrl } from "./reports";

const DAY_MS = 24 * 3_600_000;

/** A call between the two that was really paid for: money was taken for it and kept (a member's call by the part of the month it used). */
const paidCallOf = (call: string) => sql.raw(`exists (select 1 from "payments" p where p.call_id = ${call}.id and p.status = 'charged' and coalesce(p.charged_cents, 0) - coalesce(p.refunded_cents, 0) > 0)`);

/**
 * The different people whose reports about an account count right now (decision 4), for every
 * account that has at least one. A report counts when its reporter had a really paid call with
 * the account, the reporter's account is not closed, the account has not reported that reporter,
 * nobody on the team has closed the report, and it was made in the last 90 days and after the
 * last lifted pause. Accounts that are paused, closed or an admin's are left out.
 */
export async function countedReporters(now: Date, only?: string): Promise<Map<string, Set<string>>> {
  const since = new Date(now.getTime() - AUTO_PAUSE.withinDays * DAY_MS).toISOString();
  const rows = await db.execute<{ reported_id: string; reporter_id: string }>(sql`
    select r.reported_id, r.reporter_id
    from "reports" r
    join "user" reported on reported.id = r.reported_id
    join "user" reporter on reporter.id = r.reporter_id
    where r.status = 'open'
      and r.created_at > ${since}::timestamptz
      and r.created_at <= ${now.toISOString()}::timestamptz
      and r.reporter_id <> r.reported_id
      and reported.paused_at is null
      and reported.closed_at is null
      and reporter.closed_at is null
      and (reported.auto_pause_from is null or r.created_at > reported.auto_pause_from)
      and not exists (select 1 from "admins" a where a.user_id = r.reported_id)
      and not exists (select 1 from "reports" back where back.reporter_id = r.reported_id and back.reported_id = r.reporter_id)
      and exists (
        select 1 from "calls" c
        where c.cancelled_at is null
          and ((c.host_id = r.reported_id and c.customer_id = r.reporter_id) or (c.host_id = r.reporter_id and c.customer_id = r.reported_id))
          and ${paidCallOf("c")}
      )
      ${only ? sql`and r.reported_id = ${only}` : sql``}
    group by r.reported_id, r.reporter_id
  `);
  const found = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = found.get(row.reported_id);
    if (set) set.add(row.reporter_id);
    else found.set(row.reported_id, new Set([row.reporter_id]));
  }
  return found;
}

/** The different people an account had a really paid call with, as a host or as a customer, in the last 90 days. */
export async function peopleWithPaidCalls(userId: string, now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - AUTO_PAUSE.withinDays * DAY_MS).toISOString();
  const rows = await db.execute<{ other: string }>(sql`
    select distinct case when c.host_id = ${userId} then c.customer_id else c.host_id end as other
    from "calls" c
    where (c.host_id = ${userId} or c.customer_id = ${userId})
      and c.cancelled_at is null
      and c.starts_at > ${since}::timestamptz
      and ${paidCallOf("c")}
  `);
  return new Set(rows.map((row) => row.other));
}

/**
 * A person's average in one role, counted exactly as the shown one (ratings.ts), but only from
 * ratings of calls that ended after `from` (the last lifted pause), when there is one.
 */
export async function averageSince(userId: string, as: "host" | "customer", from: Date | null, now: Date): Promise<ShownAverage | null> {
  const rows: CountedRating[] = await db
    .select({ raterId: schema.ratings.raterId, stars: schema.ratings.stars, raterClosed: sql<boolean>`${schema.user.closedAt} is not null` })
    .from(schema.ratings)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.ratings.callId))
    .innerJoin(schema.user, eq(schema.user.id, schema.ratings.raterId))
    .where(and(eq(schema.ratings.ratedId, userId), eq(schema.ratings.ratedAs, as), lte(schema.calls.endsAt, countedUpTo(now)), from ? gt(schema.calls.endsAt, from) : undefined))
    .orderBy(asc(schema.calls.endsAt), asc(schema.ratings.id));
  return shownAverage(rows);
}

/**
 * Accounts whose ratings could be low enough for the warning or the pause, in either role: not
 * paused, not closed, not an admin's, rated by at least 5 different people, at least two of the
 * ratings 2 stars or lower (an average of 2.5 or lower from 5 or more people is not possible
 * with fewer). Only a first cut: the average itself is counted for each one.
 */
async function lowRatedCandidates(only?: string): Promise<Array<{ id: string; name: string; email: string; as: "host" | "customer"; from: Date | null }>> {
  const rows = await db.execute<{ id: string; name: string; email: string; rated_as: string; auto_pause_from: Date | string | null }>(sql`
    select u.id, u.name, u.email, g.rated_as, u.auto_pause_from
    from "ratings" g
    join "user" u on u.id = g.rated_id
    where u.paused_at is null
      and u.closed_at is null
      and not exists (select 1 from "admins" a where a.user_id = u.id)
      ${only ? sql`and u.id = ${only}` : sql``}
    group by u.id, u.name, u.email, g.rated_as, u.auto_pause_from
    having count(distinct g.rater_id) >= ${RATING.minPeople} and count(*) filter (where g.stars <= 2) >= 2
  `);
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, as: row.rated_as === "host" ? "host" : "customer", from: row.auto_pause_from ? new Date(row.auto_pause_from) : null }));
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
      // Every counted reporter is one of "the people they had paid calls with", also when that call was longer ago.
      const people = new Set([...(await peopleWithPaidCalls(userId, now)), ...reporters]);
      const facts = { reporters: reporters.size, people: people.size };
      if (!reportsPause(facts)) continue;
      const [person] = await db.select({ name: schema.user.name, email: schema.user.email, from: schema.user.autoPauseFrom }).from(schema.user).where(eq(schema.user.id, userId));
      if (!person) continue;
      const done = await pauseByItself({
        userId,
        reason: AUTO_PAUSE_WORDS.reports.reason,
        because: AUTO_PAUSE_WORDS.reports.because,
        founder: { subject: AUTO_PAUSE_WORDS.reports.founderSubject, text: AUTO_PAUSE_WORDS.reports.founderText(person, facts, list), alreadyText: AUTO_PAUSE_WORDS.reports.founderAlready(person, list) },
        key: `paused:${userId}:by-itself:reports:${person.from?.getTime() ?? 0}`,
      });
      if (done === "paused") paused.push(userId);
    } catch (error) {
      console.error(`[auto-pause] looking at the reports about ${userId} failed; will retry`, error);
    }
  }

  // Ratings: the pause, or else the one warning.
  for (const one of await lowRatedCandidates(only)) {
    try {
      if (paused.includes(one.id)) continue;
      const shown = await averageSince(one.id, one.as, one.from, now);
      const fresh = one.from?.getTime() ?? 0;
      if (ratingsPause(shown)) {
        const done = await pauseByItself({
          userId: one.id,
          reason: AUTO_PAUSE_WORDS.ratings.reason(one.as, shown!),
          because: AUTO_PAUSE_WORDS.ratings.because(one.as, shown!),
          founder: { subject: AUTO_PAUSE_WORDS.ratings.founderSubject, text: AUTO_PAUSE_WORDS.ratings.founderText(one, one.as, shown!, list), alreadyText: AUTO_PAUSE_WORDS.ratings.founderAlready(one, list) },
          key: `paused:${one.id}:by-itself:ratings:${one.as}:${fresh}`,
        });
        if (done === "paused") paused.push(one.id);
      } else if (ratingsWarn(shown)) {
        // Once per role and fresh start: the key keeps a second one from being written.
        const sent = await queueEmail(db, { to: one.email, subject: AUTO_PAUSE_WORDS.ratings.warnSubject, text: AUTO_PAUSE_WORDS.ratings.warnText(one.name, one.as, shown!, SUPPORT_EMAIL), key: `rating-warning:${one.id}:${one.as}:${fresh}` });
        if (sent) warned.push(one.id);
      }
    } catch (error) {
      console.error(`[auto-pause] looking at the ratings of ${one.id} failed; will retry`, error);
    }
  }
  return { paused, warned };
}
