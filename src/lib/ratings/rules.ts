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
  /** An average is shown once this many different people's ratings count (plans/52, decision 1): fewer are too few to say anything. */
  minPeople: 5,
  /** After those first people, ratings count in whole groups of this many, each from a different person, so an average never changes because of one person alone. */
  groupSize: 3,
  /**
   * An average is worked out from the most recent people only, at most this many (plans/52, decision 2a): it says how
   * someone is now. People, not days: a window in days would take the average away from anyone who takes few calls.
   */
  lastPeople: 50,
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
  /** Where the call came from: "customer" (a request), "now" (a call now), "admin" (a call made by a check script), or null for a call with no booking. */
  source: string | null;
  cancelled: boolean;
  /**
   * Ended with the earlier button, "End call and report": never rated. A call ended with "End call now" is rated like
   * any other (plans/51, decision 27): otherwise pressing the button in the last seconds would be a way to never be rated.
   */
  oldStop: boolean;
  /** The room is confirmed closed. */
  roomClosed: boolean;
  /** The call's attendance record, as the charge sees it. */
  record: "complete" | "in_progress" | "needs_review";
  /** Time both people were in the call together; null when the record has no totals. */
  togetherSeconds: number | null;
  endsAt: Date;
  now: Date;
}): RateState {
  if (input.source !== "customer" && input.source !== "now" && input.source !== "member") return "never";
  if (input.cancelled || input.oldStop) return "never";
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
 * often cannot be picked out. Those are taken in whole groups: the first 5
 * people, then the next 3, the next 3, ..., so nothing is shown from fewer
 * than 5 people and what is shown never moves because of one person. A group
 * is fixed once it is formed: if an account in it is closed, that whole group
 * is left out while it is closed, and is never refilled with a later rating
 * (which would give that later rating away).
 *
 * Of those groups only the most recent count, as many whole groups as hold at
 * most 50 people: an older group leaves as a whole when a newer one no longer
 * fits beside it. If fewer than 5 people's ratings are left, nothing is shown.
 */
export function shownAverage(ratings: CountedRating[]): ShownAverage | null {
  const seen = new Set<string>();
  const once = ratings.filter((rating) => {
    if (seen.has(rating.raterId)) return false;
    seen.add(rating.raterId);
    return true;
  });
  const groups: CountedRating[][] = [];
  let size: number = RATING.minPeople;
  for (let start = 0; start + size <= once.length; start += size, size = RATING.groupSize) {
    const group = once.slice(start, start + size);
    if (!group.some((rating) => rating.raterClosed)) groups.push(group);
  }
  let sum = 0;
  let count = 0;
  for (let i = groups.length - 1; i >= 0 && count + groups[i].length <= RATING.lastPeople; i--) {
    sum += groups[i].reduce((total, rating) => total + rating.stars, 0);
    count += groups[i].length;
  }
  if (count < RATING.minPeople) return null;
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
