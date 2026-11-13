/**
 * Ratings after a call: giving one, and the averages that are shown. The
 * rules themselves (which calls, when a rating counts, what an average shows)
 * are plain logic in rules.ts; this file reads and writes the database.
 *
 * Nobody is ever shown the rating one particular person gave them, or whether
 * the other person has rated yet.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import { roleOnCall } from "@/lib/calls";
import { RATING, countedUpTo, rateState, shownAverage, validStars, type CountedRating, type RateState, type ShownAverage } from "./rules";

/** A problem the person can understand. Its message is safe to show them. */
export class RatingError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Reader = Pick<typeof db, "select">;

/** Where a call stands for rating right now, worked out from the same record the charge uses. */
export async function ratingStateOf(call: Call, now: Date): Promise<RateState> {
  const [booking] = await db.select({ source: schema.bookings.source }).from(schema.bookings).where(eq(schema.bookings.callId, call.id));
  const attendance = await loadAttendance(call, now);
  return rateState({
    source: booking?.source ?? null,
    cancelled: Boolean(call.cancelledAt),
    safetyEnded: Boolean(call.safetyEndedAt),
    roomClosed: Boolean(call.closedAt),
    record: attendance.result.status,
    togetherSeconds: attendance.result.totals?.togetherSeconds ?? null,
    endsAt: call.endsAt,
    now,
  });
}

/** The stars this person gave for this call, or null. Only ever their own. */
export async function myRating(callId: string, raterId: string): Promise<number | null> {
  const [row] = await db.select({ stars: schema.ratings.stars }).from(schema.ratings).where(and(eq(schema.ratings.callId, callId), eq(schema.ratings.raterId, raterId)));
  return row?.stars ?? null;
}

/**
 * One person rates the other after a call. Who gives it comes from the
 * login; who receives it, and in which role, comes from the call. The browser
 * supplies only the call and the stars. One rating per person per call: the
 * first one stands.
 */
export async function rateCall(input: { callId: string; raterId: string; stars: number; now: Date }): Promise<void> {
  if (!validStars(input.stars)) throw new RatingError("Choose 1 to 5 stars.");
  if (!UUID.test(input.callId)) throw new RatingError("Call not found.");
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, input.callId));
  const role = call ? roleOnCall(call, input.raterId) : null;
  // Someone who was not on the call gets the same answer whether or not it exists.
  if (!call || !role) throw new RatingError("Call not found.");
  const state = await ratingStateOf(call, input.now);
  if (state === "not_yet") throw new RatingError("This call can be rated a few minutes after its booked end, once its record is final.");
  if (state === "too_late") throw new RatingError(`The ${RATING.windowDays} days to rate this call are over.`);
  if (state === "never") throw new RatingError("This call cannot be rated.");
  const saved = await db
    .insert(schema.ratings)
    .values({
      callId: call.id,
      raterId: input.raterId,
      ratedId: role === "host" ? call.customerId : call.hostId,
      ratedAs: role === "host" ? "customer" : "host",
      stars: input.stars,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: schema.ratings.id });
  if (saved.length === 0) throw new RatingError("You have already rated this call. A rating cannot be changed.");
}

/**
 * What may be shown of the ratings several people received in one role, in
 * one query. A rating counts once the time to rate its call is over (7 days
 * after the booked end), never earlier. Ratings are taken in the order their
 * calls ended. So the person being rated cannot choose when a rating starts
 * to count or which ratings it is grouped with, and a rating that starts to
 * count is always added at the end. How they are grouped, and what a closed
 * account does, is in rules.ts. Null means "New".
 */
export async function averagesFor(ids: string[], as: "host" | "customer", now: Date, reader: Reader = db): Promise<Map<string, ShownAverage | null>> {
  const shown = new Map<string, ShownAverage | null>(ids.map((id) => [id, null]));
  if (ids.length === 0) return shown;
  const rows = await reader
    .select({ ratedId: schema.ratings.ratedId, raterId: schema.ratings.raterId, stars: schema.ratings.stars, raterClosed: sql<boolean>`${schema.user.closedAt} is not null` })
    .from(schema.ratings)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.ratings.callId))
    .innerJoin(schema.user, eq(schema.user.id, schema.ratings.raterId))
    // The same 7 days, counted the same way, as the rule that closes a call for rating.
    .where(and(inArray(schema.ratings.ratedId, ids), eq(schema.ratings.ratedAs, as), lte(schema.calls.endsAt, countedUpTo(now))))
    .orderBy(schema.calls.endsAt, schema.ratings.id);
  const perPerson = new Map<string, CountedRating[]>();
  for (const row of rows) {
    const list = perPerson.get(row.ratedId);
    if (list) list.push(row);
    else perPerson.set(row.ratedId, [row]);
  }
  for (const [id, ratings] of perPerson) shown.set(id, shownAverage(ratings));
  return shown;
}

/** The same for one person. */
export async function averageFor(id: string, as: "host" | "customer", now: Date): Promise<ShownAverage | null> {
  return (await averagesFor([id], as, now)).get(id) ?? null;
}

/**
 * This person's calls that are waiting for their rating, newest first, for
 * the home page. Only calls from the last 7 days can qualify, and each one's
 * record is looked at properly, newest first, until enough are found. The
 * number shown is cut after that look, so recent calls that cannot be rated
 * (a no-show, say) never hide an older one that can.
 */
export async function callsToRate(userId: string, now: Date, limit = 5): Promise<Array<{ callId: string; otherName: string; endsAt: Date }>> {
  const mine = alias(schema.ratings, "mine");
  const candidates = await db
    .select({ call: schema.calls })
    .from(schema.calls)
    .innerJoin(schema.bookings, eq(schema.bookings.callId, schema.calls.id))
    .leftJoin(mine, and(eq(mine.callId, schema.calls.id), eq(mine.raterId, userId)))
    .where(
      and(
        or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)),
        inArray(schema.bookings.source, ["customer", "now"]),
        isNull(schema.calls.cancelledAt),
        isNull(schema.calls.safetyEndedAt),
        isNotNull(schema.calls.closedAt),
        lte(schema.calls.endsAt, now),
        // Still inside the time to rate.
        gt(schema.calls.endsAt, countedUpTo(now)),
        isNull(mine.id),
      ),
    )
    .orderBy(desc(schema.calls.endsAt));
  const open: Call[] = [];
  for (const { call } of candidates) {
    if (open.length >= limit) break;
    if ((await ratingStateOf(call, now)) === "open") open.push(call);
  }
  if (open.length === 0) return [];
  const otherIds = [...new Set(open.map((c) => (c.hostId === userId ? c.customerId : c.hostId)))];
  const people = await db
    .select({ id: schema.user.id, name: schema.user.name, displayName: schema.hostProfiles.displayName })
    .from(schema.user)
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
    .where(inArray(schema.user.id, otherIds));
  const byId = new Map(people.map((p) => [p.id, p]));
  return open.map((call) => {
    const iAmHost = call.hostId === userId;
    const other = byId.get(iAmHost ? call.customerId : call.hostId);
    // A host is known by their display name; a customer by their own name.
    return { callId: call.id, otherName: (iAmHost ? other?.name : (other?.displayName ?? other?.name)) ?? "the other person", endsAt: call.endsAt };
  });
}
