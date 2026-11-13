/**
 * The rating rules that are plain logic: which calls can be rated and when,
 * and what an average may show. No database.
 */

const DAY = 24 * 3_600_000;

export const RATING = {
  /** A call can be rated for this long after its booked end. Its ratings start to count when that time is over, never earlier. */
  windowDays: 7,
  /** Both people must have been in the call together at least this long. */
  minTogetherSeconds: 120,
  /** Ratings count toward an average in whole groups of this many, each from a different person, so it never changes because of one person alone. */
  groupSize: 3,
} as const;

/** The last moment a call can be rated, and the moment its ratings start to count toward the averages. */
export function ratingDeadline(endsAt: Date): Date {
  return new Date(endsAt.getTime() + RATING.windowDays * DAY);
}

/**
 * open      it can be rated now
 * not_yet   it is not over, or its record is not final yet
 * too_late  the time to rate it has passed
 * never     this call cannot be rated at all
 */
export type RateState = "open" | "not_yet" | "too_late" | "never";

export function rateState(input: {
  /** Where the call came from: "customer" (a request), "now" (a call now), "admin" (the test page), or null for a call with no booking. */
  source: string | null;
  cancelled: boolean;
  /** Ended with "End call and report": that goes to the founder as a report, not into stars. */
  safetyEnded: boolean;
  /** The room is confirmed closed. */
  roomClosed: boolean;
  /** The call's attendance record, as the charge sees it. */
  record: "complete" | "in_progress" | "needs_review";
  /** Time both people were in the call together; null when the record has no totals. */
  togetherSeconds: number | null;
  endsAt: Date;
  now: Date;
}): RateState {
  if (input.source !== "customer" && input.source !== "now") return "never";
  if (input.cancelled || input.safetyEnded) return "never";
  if (input.now >= ratingDeadline(input.endsAt)) return "too_late";
  // A record that contradicts itself is never guessed at.
  if (input.record === "needs_review") return "never";
  if (!input.roomClosed || input.record !== "complete") return "not_yet";
  if ((input.togetherSeconds ?? 0) < RATING.minTogetherSeconds) return "never";
  return "open";
}

/** A call that ended at or before this moment has had its time to rate, so its ratings count. Later ones can still be rated. */
export function countedUpTo(now: Date): Date {
  return new Date(now.getTime() - RATING.windowDays * DAY);
}

export type ShownAverage = { average: number; count: number };
export type CountedRating = { raterId: string; stars: number; raterClosed: boolean };

/**
 * What may be shown of a person's ratings, or null ("New"). `ratings` are the
 * ones whose time to rate is over, in the order their calls ended.
 *
 * Each person counts once: their first rating stands, so someone who calls
 * often cannot be picked out. Those are taken in whole groups of 3 (the first
 * 3 people, the next 3, ...), so what is shown never moves because of one
 * person. A group is fixed once it is formed: if an account in it is closed,
 * that whole group is left out while it is closed, and is never refilled with
 * a later rating (which would give that later rating away).
 */
export function shownAverage(ratings: CountedRating[]): ShownAverage | null {
  const seen = new Set<string>();
  const once = ratings.filter((rating) => {
    if (seen.has(rating.raterId)) return false;
    seen.add(rating.raterId);
    return true;
  });
  let sum = 0;
  let count = 0;
  for (let start = 0; start + RATING.groupSize <= once.length; start += RATING.groupSize) {
    const group = once.slice(start, start + RATING.groupSize);
    if (group.some((rating) => rating.raterClosed)) continue;
    sum += group.reduce((total, rating) => total + rating.stars, 0);
    count += group.length;
  }
  if (count === 0) return null;
  return { average: Math.round((sum / count) * 10) / 10, count };
}

/** "4.8 from 21 ratings", or "New". */
export function averageText(shown: ShownAverage | null): string {
  return shown ? `${shown.average.toFixed(1)} from ${shown.count} ratings` : "New";
}

/** True for a whole number of stars from 1 to 5. */
export function validStars(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}
