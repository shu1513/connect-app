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
  /** An average is shown only once ratings from this many different people count. */
  minPeople: 3,
  /** The shown average moves only in steps of this many ratings, so it never changes because of one rating alone. */
  step: 3,
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

export type ShownAverage = { average: number; count: number };

/**
 * What may be shown of a person's ratings, or null ("New").
 * `stars` are the ratings that count, in the order their calls ended;
 * `people` is how many different people gave them. The average is taken over
 * whole steps only (the first 3, the first 6, ...), and the count shown is that
 * same number, so one new rating never moves what is shown.
 */
export function shownAverage(stars: number[], people: number): ShownAverage | null {
  if (people < RATING.minPeople) return null;
  const count = Math.floor(stars.length / RATING.step) * RATING.step;
  if (count === 0) return null;
  const sum = stars.slice(0, count).reduce((total, s) => total + s, 0);
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
