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
  // 3: no ceiling on the points from people; a host seen twice without being opened rests (plans/41, 19 November 2026).
  ruleVersion: 3,
  /** How many hosts are suggested at most in a day. */
  places: 6,
  /** How many of them the row shows at first; the others are behind "Show more". */
  shown: 3,
  /** The places kept for the hosts whose suggestion was seen by the fewest different people. */
  keptPlaces: [3, 6] as readonly number[],
  /** Nothing counts from people until this many different ones point at the same host. */
  minPeople: 3,
  /** Points from people at the bar (three people), and what each doubling of the number adds. There is no ceiling: more people is always more points, by a little less each time. */
  pointsAtBar: 9,
  pointsPerDoubling: 6,
  /**
   * A host whose card the person saw on this many different days without opening it rests: they are
   * not suggested to that person again while those sightings are younger than `restDays`. Opening
   * the host's page from the row starts the count afresh, every time.
   */
  restAfterSeenDays: 2,
  restDays: 14,
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

/**
 * Points from people: nothing below the bar; 9 at the bar of three; and 6 more each time the number
 * doubles (6 people: 15, 12: 21, 24: 27). More people always gives more points, so ten come before
 * seven, but each further person adds a little less, so one very popular host cannot bury everyone
 * else. Not rounded: every further person adds something, however many there already are.
 */
export function peoplePoints(people: number): number {
  if (people < SUGGEST.minPeople) return 0;
  return SUGGEST.pointsAtBar + SUGGEST.pointsPerDoubling * Math.log2(people / SUGGEST.minPeople);
}

/**
 * What a person did with one host's card of one day (their own lines of `suggestion_shows`): the
 * day the card was for, whether it came into view, and the day they opened the host's page from
 * it, if they did. That is usually the same day; a card left open in a tab can be pressed later.
 */
export type Sighting = { day: string; seen: boolean; openedOn: string | null };

/**
 * Whether a host rests for this person today (plans/41): they saw the host's card on two different
 * days without opening the host's page, and those days are no more than fourteen days back.
 *
 * Only sightings after the day they last opened the host's page from the row count, whichever
 * card they pressed, so interest makes a host free to be suggested again every time. A day on
 * which they opened the page is interest, not a sighting. `today` is the day the suggestions are
 * made for; it is not counted itself.
 */
export function rests(sightings: Sighting[], today: string): boolean {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - SUGGEST.restDays * DAY).toISOString().slice(0, 10);
  const lastOpened = sightings.reduce((latest, s) => (s.openedOn && s.openedOn > latest ? s.openedOn : latest), "");
  const unanswered = new Set(sightings.filter((s) => s.seen && s.day > lastOpened && s.day >= from && s.day < today).map((s) => s.day));
  return unanswered.size >= SUGGEST.restAfterSeenDays;
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
/** These hosts with the most points first, equal points in the day's own order. For filling a thin row with resting hosts: no place is kept there. */
export function mostPointsFirst<T extends Ranked>(hosts: T[], viewerId: string, day: string): T[] {
  return [...hosts].sort(byPoints(viewerId, day));
}

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

/** "Why these hosts?", the same for everyone: what the row says about itself, on the website and in the phone app. Never why one host is there. */
export const SUGGEST_WHY =
  "These are hosts you do not follow and have not called, who have open times. Being free sooner adds points. Hosts followed by people who follow the same hosts as you get points too, more for more people. Good ratings count a little. Two places are kept for hosts who have been shown less often. You get new suggestions each day. A host you have seen on two days without opening their page rests for about two weeks; one whose page you opened can be suggested again. The X hides a host for good.";
