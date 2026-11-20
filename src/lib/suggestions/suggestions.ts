/**
 * "Suggested hosts" on the home page (plans/37-suggested-hosts.md): who can be suggested to a
 * person, the points, the day's six, and what is written down about them.
 *
 * Only the person themselves ever reads their own suggestions. Nothing here tells a host who was
 * shown their card, who hid it, or who follows whom; and no page says why a host is suggested.
 *
 * Drawing a page only reads (`todaysSuggestions`). A day's suggestions are made by
 * `makeSuggestions`, which the browser asks for through an action once the page is there: this
 * version of the framework may draw a page ahead of time, so a page that wrote while it was drawn
 * would write for looks that never happened.
 */
import { and, eq, gt, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { instantOffer, offerOf, openTimes } from "@/lib/booking/bookings";
import { isAvailableNow } from "@/lib/booking/now-rules";
import { photosOf } from "@/lib/profiles/photo";
import { averagesFor } from "@/lib/ratings/ratings";
import type { ShownAverage } from "@/lib/ratings/rules";
import { hasOpenTime, inPlaces, mostPointsFirst, type OpenTime, openPoints, peoplePoints, ratingPoints, rests, shortlist, type Sighting, SUGGEST, suggestionDay } from "./rules";

const DAY = 24 * 3_600_000;
const hostId = schema.hostProfiles.userId;

type Candidate = { hostId: string; handle: string; displayName: string; pricePer15Cents: number; languages: string[] };

/**
 * The hosts who can be suggested to this person, before their open time is looked at (decisions 1
 * and 2): a page that is open to everyone, no block either way (the same test as search), and
 * nobody the person already knows or has said no to. With `only`, the same question about just
 * those hosts.
 */
async function candidates(viewerId: string, only?: string[]): Promise<Candidate[]> {
  if (only && only.length === 0) return [];
  const none = (found: SQL) => sql`not exists (${found})`;
  return db
    .select({ hostId, handle: schema.hostProfiles.handle, displayName: schema.hostProfiles.displayName, pricePer15Cents: schema.hostProfiles.pricePer15Cents, languages: schema.hostProfiles.languages })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, hostId))
    .where(
      and(
        only ? inArray(hostId, only) : undefined,
        eq(schema.hostProfiles.status, "approved"),
        eq(schema.hostProfiles.hidden, false),
        isNull(schema.user.closedAt),
        isNull(schema.user.pausedAt),
        sql`${hostId} <> ${viewerId}`,
        none(sql`select 1 from ${schema.blocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${hostId}) or (b.blocker_id = ${hostId} and b.blocked_id = ${viewerId})`),
        // Someone they follow, or have unfollowed or said "Don't follow" to: any line at all.
        none(sql`select 1 from ${schema.follows} f where f.follower_id = ${viewerId} and f.host_id = ${hostId}`),
        // Someone they have had or have a call or a request with, whoever hosted.
        none(sql`select 1 from ${schema.calls} c where (c.customer_id = ${viewerId} and c.host_id = ${hostId}) or (c.host_id = ${viewerId} and c.customer_id = ${hostId})`),
        none(sql`select 1 from ${schema.bookings} k where (k.customer_id = ${viewerId} and k.host_id = ${hostId}) or (k.host_id = ${viewerId} and k.customer_id = ${hostId})`),
        // Someone they are or were a member of, or were invited by.
        none(sql`select 1 from ${schema.memberships} m where m.customer_id = ${viewerId} and m.host_id = ${hostId}`),
        none(sql`select 1 from ${schema.reports} r where r.reporter_id = ${viewerId} and r.reported_id = ${hostId}`),
        none(sql`select 1 from ${schema.suggestionHides} h where h.viewer_id = ${viewerId} and h.host_id = ${hostId}`),
      ),
    );
}

/**
 * For each of these hosts: how many different people follow them AND follow one of the hosts the
 * viewer follows (decision 3). A person counts only while their account is open, not paused, and
 * at least `SUGGEST.minAccountDays` old (so accounts made for the purpose do not count at once);
 * the viewer's host only while its page is open; and a follow, the viewer's own among them, only
 * while there is no block between that person and that host (a host who blocks a follower leaves
 * the follow standing, so it has to be left out here). The bar of three is applied to this number by `peoplePoints`.
 * The number is used for the order only: it is never shown to anyone. (Exported for the check script.)
 */
export async function peopleBehind(viewerId: string, hostIds: string[], now: Date): Promise<Map<string, number>> {
  if (hostIds.length === 0) return new Map();
  const noBlock = (person: SQL, host: SQL) => sql`not exists (select 1 from ${schema.blocks} b where (b.blocker_id = ${person} and b.blocked_id = ${host}) or (b.blocker_id = ${host} and b.blocked_id = ${person}))`;
  const rows = await db.execute<{ host_id: string; people: number }>(sql`
    select theirs.host_id, count(distinct theirs.follower_id)::int as people
    from ${schema.follows} mine
    join ${schema.hostProfiles} my_host on my_host.user_id = mine.host_id and my_host.status = 'approved' and my_host.hidden = false
    join ${schema.user} my_host_account on my_host_account.id = mine.host_id and my_host_account.closed_at is null and my_host_account.paused_at is null
    join ${schema.follows} shared on shared.host_id = mine.host_id and shared.unfollowed_at is null and shared.follower_id <> ${viewerId}
    join ${schema.user} person on person.id = shared.follower_id and person.closed_at is null and person.paused_at is null and person.created_at <= ${new Date(now.getTime() - SUGGEST.minAccountDays * DAY).toISOString()}::timestamptz
    join ${schema.follows} theirs on theirs.follower_id = shared.follower_id and theirs.unfollowed_at is null
    where mine.follower_id = ${viewerId}
      and mine.unfollowed_at is null
      and theirs.host_id in ${hostIds}
      and ${noBlock(sql`mine.follower_id`, sql`mine.host_id`)}
      and ${noBlock(sql`shared.follower_id`, sql`shared.host_id`)}
      and ${noBlock(sql`theirs.follower_id`, sql`theirs.host_id`)}
    group by theirs.host_id
  `);
  return new Map(rows.map((row) => [row.host_id, row.people]));
}

/** For each of these hosts: how many different people really saw their suggestion in the last seven days. Never shown to anyone. (Exported for the check script.) */
export async function seenBy(hostIds: string[], now: Date): Promise<Map<string, number>> {
  if (hostIds.length === 0) return new Map();
  const rows = await db
    .select({ hostId: schema.suggestionShows.hostId, people: sql<number>`count(distinct ${schema.suggestionShows.viewerId})::int` })
    .from(schema.suggestionShows)
    .where(and(inArray(schema.suggestionShows.hostId, hostIds), gt(schema.suggestionShows.seenAt, new Date(now.getTime() - SUGGEST.seenDays * DAY))))
    .groupBy(schema.suggestionShows.hostId);
  return new Map(rows.map((row) => [row.hostId, row.people]));
}

/**
 * A host's open time, as their own page would show it: whether they are available now, and their
 * next open time for their shortest call. It looks at the host only; what stands in the way for
 * one customer is decided when they ask (`checkMayAsk`).
 */
async function openTimeOf(host: string, now: Date): Promise<OpenTime> {
  const offer = await offerOf(host);
  if (!offer || !offer.canTakePaid) return { availableNow: false, nextOpen: null };
  // The full question about "available now" costs several more reads: it is asked only of a host who says they are.
  const [instant, times] = await Promise.all([isAvailableNow(offer, now) ? instantOffer(host, now) : null, openTimes(offer, Math.min(...offer.lengths), now)]);
  return { availableNow: instant !== null, nextOpen: times[0] ?? null };
}

/** The open times of these hosts, asked five at a time: each answer takes several questions to the database. */
async function openTimesOf(hostIds: string[], now: Date): Promise<Map<string, OpenTime>> {
  const found = new Map<string, OpenTime>();
  for (let i = 0; i < hostIds.length; i += 5) {
    const some = hostIds.slice(i, i + 5);
    const opens = await Promise.all(some.map((host) => openTimeOf(host, now)));
    some.forEach((host, at) => found.set(host, opens[at]));
  }
  return found;
}

/** Works a person's suggestions for the day out. Only reads. */
async function workOut(viewerId: string, day: string, now: Date, among?: string[]): Promise<Array<{ hostId: string; place: number; kept: boolean }>> {
  const [viewer] = await db.select({ closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt }).from(schema.user).where(eq(schema.user.id, viewerId));
  if (!viewer || viewer.closedAt || viewer.pausedAt) return [];
  const pool = await candidates(viewerId, among);
  if (pool.length === 0) return [];
  const ids = pool.map((host) => host.hostId);
  const [people, ratings, seen] = await Promise.all([peopleBehind(viewerId, ids, now), averagesFor(ids, "host", now), seenBy(ids, now)]);
  const ranked = pool.map((host) => ({
    hostId: host.hostId,
    points: peoplePoints(people.get(host.hostId) ?? 0) + ratingPoints(ratings.get(host.hostId) ?? null),
    seenBy: seen.get(host.hostId) ?? 0,
  }));
  // Hosts the person has seen twice lately without opening them rest (plans/41). They come back only to fill the row.
  const resting = await restingFor(viewerId, day);
  const fresh = ranked.filter((host) => !resting.has(host.hostId));
  // The open time is looked up for a short list only (an approximation once there are many hosts).
  const withOpenTimes = async (hosts: typeof ranked) => {
    const opens = await openTimesOf(hosts.map((host) => host.hostId), now);
    return hosts.filter((host) => hasOpenTime(opens.get(host.hostId)!)).map((host) => ({ ...host, points: host.points + openPoints(opens.get(host.hostId)!, now) }));
  };
  const placed = inPlaces(await withOpenTimes(shortlist(fresh, viewerId, day)), viewerId, day).map((one) => ({ hostId: one.host.hostId, place: one.place, kept: one.kept }));
  if (placed.length >= SUGGEST.shown || resting.size === 0) return placed;
  // Too few fresh hosts to fill what the row shows at first: the best of the resting ones fill the gap, so the row is not left thin.
  // Their open time is looked up for the ten with the most points so far; then simply the most points first. No place is kept among fillers.
  const rested = mostPointsFirst(ranked.filter((host) => resting.has(host.hostId)), viewerId, day).slice(0, SUGGEST.lookUpLeastSeen);
  for (const one of mostPointsFirst(await withOpenTimes(rested), viewerId, day)) {
    if (placed.length >= SUGGEST.shown) break;
    placed.push({ hostId: one.hostId, place: placed.length + 1, kept: false });
  }
  return placed;
}

/**
 * The hosts who rest for this person on this day (`rests` in rules.ts), from the person's own
 * lines of the last two weeks: which cards they saw, and which they opened.
 */
async function restingFor(viewerId: string, day: string): Promise<Set<string>> {
  const from = suggestionDay(new Date(Date.parse(`${day}T00:00:00Z`) - SUGGEST.restDays * DAY));
  const lines = await db
    .select({ hostId: schema.suggestionShows.hostId, day: schema.suggestionShows.day, seenAt: schema.suggestionShows.seenAt, openedAt: schema.suggestionShows.openedAt })
    .from(schema.suggestionShows)
    // The cards of the last two weeks, and any older card that was opened in that time (a card left open in a tab can be pressed days later).
    .where(and(eq(schema.suggestionShows.viewerId, viewerId), lt(schema.suggestionShows.day, day), or(gte(schema.suggestionShows.day, from), gte(schema.suggestionShows.openedAt, new Date(`${from}T00:00:00Z`)))));
  const byHost = new Map<string, Sighting[]>();
  for (const line of lines) byHost.set(line.hostId, [...(byHost.get(line.hostId) ?? []), { day: line.day, seen: line.seenAt !== null, openedOn: line.openedAt ? suggestionDay(line.openedAt) : null }]);
  return new Set([...byHost].filter(([, sightings]) => rests(sightings, day)).map(([hostId]) => hostId));
}

const today = (viewerId: string, day: string) => and(eq(schema.suggestionDays.viewerId, viewerId), eq(schema.suggestionDays.day, day));

/**
 * Makes the person's suggestions for today, once. If today's line is there already: nothing.
 *
 * The working out is done first, with ordinary reads and outside any database step. Then one short
 * step, under a lock named after the person, looks again and writes the day's line and all its
 * hosts together: the day is complete or not there, and two looks at the same moment give one
 * result. (The working out asks many questions through helpers that use the shared connections;
 * inside the locked step it could wait for a connection that other locked steps are holding.)
 * A day with no fitting host is written too, so the work is done once a day.
 *
 * `among` limits the hosts that are looked at. Only the check script passes it: the test database
 * is shared with other work, whose hosts would otherwise turn up in its results.
 */
export async function makeSuggestions(viewerId: string, now: Date, among?: string[]): Promise<void> {
  const day = suggestionDay(now);
  const [made] = await db.select({ day: schema.suggestionDays.day }).from(schema.suggestionDays).where(today(viewerId, day));
  if (made) return;
  const picked = await workOut(viewerId, day, now, among);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`suggestions:${viewerId}`}))`);
    const [there] = await tx.select({ day: schema.suggestionDays.day }).from(schema.suggestionDays).where(today(viewerId, day));
    if (there) return;
    await tx.insert(schema.suggestionDays).values({ viewerId, day, ruleVersion: SUGGEST.ruleVersion, madeAt: now });
    if (picked.length > 0) await tx.insert(schema.suggestionShows).values(picked.map((host) => ({ viewerId, day, place: host.place, hostId: host.hostId, kept: host.kept })));
  });
}

export type SuggestedHost = Candidate & {
  place: number;
  /** Whether this card has already been marked as seen today. */
  seen: boolean;
  rating: ShownAverage | null;
  photoId: string | null;
  open: OpenTime;
};

/**
 * What the home page shows: whether today's suggestions have been made, and today's hosts who
 * still fit, in their places, each with a freshly worked out open time. A host who has since been
 * followed or hidden, whose page closed, with whom a block appeared, or who has no open time
 * left, is not in it; an empty place is not filled again that day. Only reads.
 */
export async function todaysSuggestions(viewerId: string, now: Date): Promise<{ day: string; made: boolean; hosts: SuggestedHost[] }> {
  const day = suggestionDay(now);
  const [made] = await db.select({ day: schema.suggestionDays.day }).from(schema.suggestionDays).where(today(viewerId, day));
  if (!made) return { day, made: false, hosts: [] };
  const shows = await db
    .select({ hostId: schema.suggestionShows.hostId, place: schema.suggestionShows.place, seenAt: schema.suggestionShows.seenAt })
    .from(schema.suggestionShows)
    .where(and(eq(schema.suggestionShows.viewerId, viewerId), eq(schema.suggestionShows.day, day)))
    .orderBy(schema.suggestionShows.place);
  const still = await candidates(viewerId, shows.map((show) => show.hostId));
  if (still.length === 0) return { day, made: true, hosts: [] };
  const opens = await openTimesOf(still.map((host) => host.hostId), now);
  const fit = still.filter((host) => hasOpenTime(opens.get(host.hostId)!));
  const ids = fit.map((host) => host.hostId);
  const [ratings, photos] = await Promise.all([averagesFor(ids, "host", now), photosOf(ids)]);
  const byHost = new Map(fit.map((host) => [host.hostId, host]));
  const hosts = shows.flatMap((show) => {
    const host = byHost.get(show.hostId);
    return host ? [{ ...host, place: show.place, seen: show.seenAt !== null, rating: ratings.get(host.hostId) ?? null, photoId: photos.get(host.hostId) ?? null, open: opens.get(host.hostId)! }] : [];
  });
  return { day, made: true, hosts };
}

/**
 * Marks cards as really seen: the person's own lines of the named day, in these places, that are
 * not marked yet. It can touch nothing else, whatever the browser sends.
 */
export async function markSeen(viewerId: string, day: string, places: number[], now: Date): Promise<void> {
  const valid = [...new Set(places)].filter((place) => Number.isInteger(place) && place >= 1 && place <= SUGGEST.places);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || valid.length === 0) return;
  await db
    .update(schema.suggestionShows)
    .set({ seenAt: now })
    .where(and(eq(schema.suggestionShows.viewerId, viewerId), eq(schema.suggestionShows.day, day), inArray(schema.suggestionShows.place, valid), isNull(schema.suggestionShows.seenAt)));
}

/**
 * Marks that the person opened a host's page from the row (plans/41): their own line of the named
 * day, in that place, once. It is what keeps a host they are interested in coming back. Whoever
 * opens a card has seen it, so it is marked as seen too if it was not. It can touch nothing else.
 */
export async function markOpened(viewerId: string, day: string, place: number, now: Date): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(place) || place < 1 || place > SUGGEST.places) return;
  await db
    .update(schema.suggestionShows)
    .set({ openedAt: now, seenAt: sql`coalesce(${schema.suggestionShows.seenAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(schema.suggestionShows.viewerId, viewerId), eq(schema.suggestionShows.day, day), eq(schema.suggestionShows.place, place), isNull(schema.suggestionShows.openedAt)));
}

/**
 * The X: hides the host whose page has this handle from this person's suggestions, for good.
 * Nothing else changes: the host can still be found and followed, and is never told. Only a host
 * who was really suggested to this person can be hidden, so nobody can pile up lines by sending
 * made-up handles. An unknown handle, one's own, or a host who was never suggested to them is
 * quietly nothing.
 */
export async function hideSuggestion(viewerId: string, handle: string, now: Date): Promise<void> {
  if (handle.length === 0 || handle.length > 64) return;
  const [host] = await db.select({ userId: hostId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.handle, handle.toLowerCase()));
  if (!host || host.userId === viewerId) return;
  const [suggested] = await db
    .select({ place: schema.suggestionShows.place })
    .from(schema.suggestionShows)
    .where(and(eq(schema.suggestionShows.viewerId, viewerId), eq(schema.suggestionShows.hostId, host.userId)))
    .limit(1);
  if (!suggested) return;
  await db.insert(schema.suggestionHides).values({ viewerId, hostId: host.userId, createdAt: now }).onConflictDoNothing();
}

/**
 * Deletes what was suggested more than 90 days ago (the days, and with them their hosts). An X is
 * kept. `onlyViewers` limits it to those people; only the check script passes it, so that it
 * never deletes anything of another session on the shared test database.
 */
export async function removeOldSuggestions(now: Date, onlyViewers?: string[]): Promise<number> {
  if (onlyViewers && onlyViewers.length === 0) return 0;
  const gone = await db
    .delete(schema.suggestionDays)
    .where(and(lt(schema.suggestionDays.day, suggestionDay(new Date(now.getTime() - SUGGEST.keepDays * DAY))), onlyViewers ? inArray(schema.suggestionDays.viewerId, onlyViewers) : undefined))
    .returning({ day: schema.suggestionDays.day });
  return gone.length;
}
