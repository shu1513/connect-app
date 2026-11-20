/**
 * The rule for "Suggested hosts" that is plain logic (plans/37-suggested-hosts.md): the numbers,
 * the points, the six places, and the order for equal scores. No database.
 *
 * The numbers are starting values. They are not proven; they are here, in one place, to be
 * adjusted once there is something to learn from.
 */
import type { ShownAverage } from "@/lib/ratings/rules";

export const SUGGEST = {
  /** Written with each day's suggestions, so a later look can tell which rule made them. Count it up when the rule changes. */
  // 2: a person counts toward the bar only once their account is `minAccountDays` old (19 November 2026).
  ruleVersion: 2,
  /** How many hosts are suggested at most. */
  places: 6,
  /** The places kept for the hosts whose suggestion was seen by the fewest different people. */
  keptPlaces: [3, 6] as readonly number[],
  /** Points for each person who follows one of the viewer's hosts and follows this host too. */
  perPerson: 3,
  /** Nothing counts from people until this many different ones point at the same host. */
  minPeople: 3,
  /** The most points that can come from people. */
  maxPeoplePoints: 20,
  /**
   * A person counts toward the bar only once their account is at least this many days old. So accounts made today, to
   * supply some of the three people oneself and see what the order gives away, count for nothing for a while.
   */
  minAccountDays: 3,
  /** Points for a host who is available now, and for one whose next open time is within `soonDays`. */
  availableNow: 20,
  openSoon: 10,
  soonDays: 7,
  /** Every host starts as if they had this many ratings of this many stars; real ratings slowly take over. */
  startRatings: 5,
  startStars: 4,
  /** The open time is looked up for this many hosts at most when a day's suggestions are made: the ones with the most points so far, and the ones seen by the fewest people. */
  lookUpTop: 20,
  lookUpLeastSeen: 10,
  /** "Seen by the fewest people" looks back this many days. */
  seenDays: 7,
  /** What was suggested is deleted after this many days. */
  keepDays: 90,
} as const;

const DAY = 24 * 3_600_000;

/** The day a person's suggestions belong to: the calendar day in UTC, as "2026-11-27". */
export function suggestionDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Points from people: nothing below the bar, then so many for each different person, up to the cap. */
export function peoplePoints(people: number): number {
  if (people < SUGGEST.minPeople) return 0;
  return Math.min(SUGGEST.maxPeoplePoints, people * SUGGEST.perPerson);
}

/** Points from ratings, between 1 and 5: the shown average pulled toward the starting value while there are few ratings. No shown rating: the starting value. */
export function ratingPoints(shown: ShownAverage | null): number {
  const n = shown?.count ?? 0;
  const r = shown?.average ?? 0;
  return (n * r + SUGGEST.startRatings * SUGGEST.startStars) / (n + SUGGEST.startRatings);
}

export type OpenTime = { availableNow: boolean; nextOpen: Date | null };

/** Whether the host can be suggested at all: available now, or with an open time. */
export function hasOpenTime(open: OpenTime): boolean {
  return open.availableNow || open.nextOpen !== null;
}

/** Points for being free sooner. */
export function openPoints(open: OpenTime, now: Date): number {
  if (open.availableNow) return SUGGEST.availableNow;
  if (open.nextOpen && open.nextOpen.getTime() - now.getTime() <= SUGGEST.soonDays * DAY) return SUGGEST.openSoon;
  return 0;
}

/**
 * A number between 0 and 1 that is always the same for one person, one host and one day, and looks
 * unrelated for another person, host or day. It puts equal scores in an order that changes from
 * day to day and from person to person, and stays put when the page is looked at again.
 */
export function mix(viewerId: string, hostId: string, day: string): number {
  // FNV-1a, 32 bits: small, steady, and good enough to shuffle a handful of hosts.
  let hash = 0x811c9dc5;
  for (const char of `${day}|${viewerId}|${hostId}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

type Ranked = { hostId: string; points: number; seenBy: number };

/** The most points first; equal points in the day's own order. */
const byPoints = (viewerId: string, day: string) => (a: Ranked, b: Ranked) => b.points - a.points || mix(viewerId, a.hostId, day) - mix(viewerId, b.hostId, day);
/** Seen by the fewest different people first; equal numbers in the day's own order. */
const byLeastSeen = (viewerId: string, day: string) => (a: Ranked, b: Ranked) => a.seenBy - b.seenBy || mix(viewerId, a.hostId, day) - mix(viewerId, b.hostId, day);

/**
 * The hosts whose open time is looked up when a day's suggestions are made (that look costs
 * several questions to the database for each host): the ones with the most points so far, and the
 * ones seen by the fewest people. An approximation once there are more hosts than this.
 */
export function shortlist<T extends Ranked>(hosts: T[], viewerId: string, day: string): T[] {
  const top = [...hosts].sort(byPoints(viewerId, day)).slice(0, SUGGEST.lookUpTop);
  const chosen = new Set(top.map((host) => host.hostId));
  const least = [...hosts].sort(byLeastSeen(viewerId, day)).filter((host) => !chosen.has(host.hostId)).slice(0, SUGGEST.lookUpLeastSeen);
  return [...top, ...least];
}

export type Placed<T> = { host: T; place: number; kept: boolean };

/**
 * The six places. The kept places go to the host seen by the fewest different people who is not
 * placed yet; the others to the host with the most points who is not placed yet. With fewer hosts
 * than places, the places are filled from the first on and the rest stay empty. No host twice.
 */
export function inPlaces<T extends Ranked>(hosts: T[], viewerId: string, day: string): Placed<T>[] {
  const best = [...hosts].sort(byPoints(viewerId, day));
  const least = [...hosts].sort(byLeastSeen(viewerId, day));
  const placed = new Set<string>();
  const out: Placed<T>[] = [];
  for (let place = 1; place <= SUGGEST.places; place++) {
    const kept = SUGGEST.keptPlaces.includes(place);
    const host = (kept ? least : best).find((candidate) => !placed.has(candidate.hostId));
    if (!host) break;
    placed.add(host.hostId);
    out.push({ host, place, kept });
  }
  return out;
}
