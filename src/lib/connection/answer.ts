/**
 * The connection check: turning what the browser measured into one plain answer.
 *
 * This file has no browser or server code in it, so the rule can be read and tested on its own.
 * The test itself (src/lib/connection/run-test.ts) sends a made-up picture to a private test room
 * for a few seconds and takes a reading every second. Here those readings become figures, and the
 * figures an answer.
 *
 * What is judged: the delay (how long a round trip to the video service takes) and the loss (how
 * much of what was sent did not arrive). Both come from the reports the video service sends back
 * about the picture it received. How much picture a connection can carry is not judged: a few
 * seconds are not enough to measure that dependably.
 */

/** Good: nothing wrong found. Weak: it connects, but the call may break up. */
export type Answer = "good" | "weak" | "no_connection" | "not_measured";

/** One reading, taken about once a second while the test picture is being sent. */
export type Reading = {
  /**
   * The newest report the video service has sent back about the picture, or null when there is
   * none yet (or this browser does not pass such reports on).
   */
  report: {
    /** When that report arrived, on the browser's own clock. This is what tells one report from the next: the same one can be read more than once. */
    madeAt: number;
    /** The share lost since the report before it, from 0 to 1. Null when the browser does not say. */
    lossShare: number | null;
    /** The round trip, in seconds. Null when the browser does not say. */
    roundTripSeconds: number | null;
  } | null;
};

export type Figures = {
  /** Whether the device got through to the video service at all. */
  connected: boolean;
  /** Whether the connection was lost, or had to be made again, while the test was running. */
  interrupted: boolean;
  /** How many separate reports came back that carried both figures, each a sensible number. */
  reports: number;
  /** The average round trip over every report that gave one, in seconds, or null when none did. */
  roundTripSeconds: number | null;
  /** The average share lost over every report that gave one, from 0 to 1, or null when none did. */
  lossShare: number | null;
};

/** The limits. Starting values, to be adjusted after real calls on real bad connections. */
export const LIMITS = {
  /** A round trip longer than this makes a conversation awkward: people talk over each other. */
  roundTripSeconds: 0.4,
  /** More than this lost and the picture and sound break up. */
  lossShare: 0.03,
  /** Fewer reports than this, each with both figures, is too little to call a connection good. */
  reportsForGood: 2,
} as const;

/** A real, sensible number, or null. Anything odd from a browser counts as "did not say". */
function sensible(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

// A round trip of more than 10 seconds, or a share outside 0 to 1, is a broken figure, not a slow line.
const MAX_TRIP = 10;
const MAX_SHARE = 1;

/** Boils the readings down. Each report counts once, however many times it was read. */
export function figuresFrom(connected: boolean, readings: Reading[], interrupted = false): Figures {
  const seen = new Set<number>();
  const trips: number[] = [];
  const losses: number[] = [];
  let complete = 0;
  for (const { report } of readings) {
    if (!report || !Number.isFinite(report.madeAt) || seen.has(report.madeAt)) continue;
    seen.add(report.madeAt);
    const trip = sensible(report.roundTripSeconds, MAX_TRIP);
    const loss = sensible(report.lossShare, MAX_SHARE);
    if (trip !== null) trips.push(trip);
    if (loss !== null) losses.push(loss);
    if (trip !== null && loss !== null) complete++;
  }
  return { connected, interrupted, reports: complete, roundTripSeconds: average(trips), lossShare: average(losses) };
}

/**
 * The answer. "Weak" when either average is over its limit (one of the two is enough), or when the
 * connection was lost or had to be made again during the test. "Good"
 * needs both averages fine and at least two reports that each carried both figures: something
 * that was not measured is never taken to be good. Figures are checked again here, so a broken
 * number can never pass as a good one whoever calls this.
 */
export function answerFor(figures: Figures): Answer {
  if (!figures.connected) return "no_connection";
  const trip = sensible(figures.roundTripSeconds, MAX_TRIP);
  const loss = sensible(figures.lossShare, MAX_SHARE);
  if ((trip !== null && trip > LIMITS.roundTripSeconds) || (loss !== null && loss > LIMITS.lossShare)) return "weak";
  // A connection that dropped, or had to be made again, within a few seconds will break up a call, however
  // good the reports were that came back before it did. Good reports from before the drop never make it "good".
  if (figures.interrupted) return "weak";
  if (trip === null || loss === null || !(figures.reports >= LIMITS.reportsForGood)) return "not_measured";
  return "good";
}

/** What the person is told. One place, so the call page and the test's own page say the same. */
export const WORDS: Record<Answer, { title: string; tip: string }> = {
  good: { title: "No connection problems found.", tip: "This was a short check from this device, on the network you are on now." },
  weak: {
    title: "Your connection is weak.",
    tip: "The picture or sound may break up. Try moving closer to your Wi-Fi, closing other video or downloads, or using another network.",
  },
  no_connection: {
    title: "This device could not reach the video service.",
    tip: "Check that you are online. An office, school or hotel network may be blocking video calls: try another network or mobile data.",
  },
  not_measured: { title: "We could not measure your connection on this device.", tip: "That is not a sign of a problem. You can still join." },
};
