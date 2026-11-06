/**
 * The counting rule: turns the attendance log into three totals for a call.
 *
 * This file knows nothing about the video service or the database. It takes
 * plain data in and gives plain data out, so it can be tested exhaustively.
 *
 * All times are whole seconds since 1970 (UTC). Periods are "half-open":
 * a person connected from 10:00:00 until 10:00:10 counts as 10 seconds.
 */

export const JOINED = "participant_joined";
export const LEFT = "participant_left";

export type AttendanceInput = {
  /** The video service's unique ID for the message. Repeats are ignored. */
  id: string;
  type: string;
  /** Who the message is about (the account ID we put in the entry pass). */
  identity: string | null;
  /** One connection of one person. A rejoin gets a new one. */
  sessionId: string | null;
  /** The video service's own time on the message, in seconds. */
  time: number;
};

export type CallWindow = {
  hostId: string;
  customerId: string;
  /** Start of the booked window, in seconds. */
  start: number;
  /** End of the booked window, in seconds. */
  end: number;
};

export type Interval = { start: number; end: number };

export type AttendanceResult = {
  /**
   * complete     – the call is over and the record is consistent.
   * in_progress  – the call is not final yet.
   * needs_review – the record is incomplete or contradicts itself; no totals.
   */
  status: "complete" | "in_progress" | "needs_review";
  /** Plain-language reasons, only when status is needs_review. */
  reasons: string[];
  /** True while a connection has started and not ended yet (only on a call that is not final). */
  stillConnected: boolean;
  /** Finished connected periods inside the booked window, merged per person. */
  hostIntervals: Interval[];
  customerIntervals: Interval[];
  togetherIntervals: Interval[];
  /**
   * Null when the record needs review, or while someone is still connected.
   * Unknown is never shown as zero, and an unfinished connection is never guessed.
   */
  totals: { hostSeconds: number; customerSeconds: number; togetherSeconds: number } | null;
};

export type CalcOptions = {
  /**
   * True once the call is over and late messages have had time to arrive.
   * A connection that is still open on a final call is treated as missing data.
   */
  final: boolean;
};

export function calculateAttendance(
  window: CallWindow,
  events: AttendanceInput[],
  options: CalcOptions,
): AttendanceResult {
  const reasons = new Set<string>();

  // 1. Ignore repeats, and anything that is not a connect or disconnect.
  const seen = new Set<string>();
  const relevant: AttendanceInput[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    // Any message about a person who is not on this call is a red flag,
    // including a connection attempt that failed.
    if (
      e.type.startsWith("participant_") &&
      e.identity &&
      e.identity !== window.hostId &&
      e.identity !== window.customerId
    ) {
      reasons.add("Someone who is not on this call was reported in the room.");
      continue;
    }
    if (e.type === JOINED || e.type === LEFT) relevant.push(e);
  }

  // 2. Group by connection. Arrival order does not matter.
  type Session = { identity: string; joins: number[]; lefts: number[] };
  const sessions = new Map<string, Session>();
  for (const e of relevant) {
    if (!e.sessionId || !e.identity) {
      reasons.add("A message did not say which person or connection it was about.");
      continue;
    }
    const s = sessions.get(e.sessionId) ?? { identity: e.identity, joins: [], lefts: [] };
    if (s.identity !== e.identity) {
      reasons.add("One connection was reported for two different people.");
      continue;
    }
    (e.type === JOINED ? s.joins : s.lefts).push(e.time);
    sessions.set(e.sessionId, s);
  }

  // 3. Turn each connection into one period.
  const hostRaw: Interval[] = [];
  const customerRaw: Interval[] = [];
  let anyOpen = false;

  for (const s of sessions.values()) {
    // Step 1 already removed anyone who is not the host or the customer.
    const who = s.identity === window.hostId ? "host" : "customer";
    const label = who === "host" ? "The host" : "The customer";

    if (new Set(s.joins).size > 1 || new Set(s.lefts).size > 1) {
      reasons.add(`${label} has contradicting messages for the same connection.`);
      continue;
    }
    if (s.joins.length === 0) {
      reasons.add(`${label} has a "disconnected" message with no matching "connected".`);
      continue;
    }
    const start = s.joins[0];
    if (s.lefts.length === 0) {
      // No end yet. On a finished call that is missing data. On a running call
      // the person is (as far as we know) still connected: we wait, and never
      // guess where the period ends.
      if (options.final) reasons.add(`${label} has a "connected" message with no matching "disconnected".`);
      else anyOpen = true;
      continue;
    }
    const end = s.lefts[0];
    if (end < start) {
      reasons.add(`${label} has a "disconnected" time earlier than the "connected" time.`);
      continue;
    }
    (who === "host" ? hostRaw : customerRaw).push({ start, end });
  }

  // 4. Keep only the part inside the booked window, then merge overlaps.
  const hostIntervals = merge(clip(hostRaw, window.start, window.end));
  const customerIntervals = merge(clip(customerRaw, window.start, window.end));
  const togetherIntervals = intersect(hostIntervals, customerIntervals);

  const needsReview = reasons.size > 0;
  const status = needsReview ? "needs_review" : options.final ? "complete" : "in_progress";

  return {
    status,
    reasons: [...reasons],
    stillConnected: anyOpen,
    hostIntervals,
    customerIntervals,
    togetherIntervals,
    totals:
      needsReview || anyOpen
        ? null
        : {
          hostSeconds: total(hostIntervals),
          customerSeconds: total(customerIntervals),
          togetherSeconds: total(togetherIntervals),
        },
  };
}

/** Cut every period down to the part inside [start, end). Empty ones are dropped. */
export function clip(intervals: Interval[], start: number, end: number): Interval[] {
  const out: Interval[] = [];
  for (const i of intervals) {
    const s = Math.max(i.start, start);
    const e = Math.min(i.end, end);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

/** Merge overlapping or touching periods so no second is counted twice. */
export function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** The periods where both lists overlap. Both inputs must already be merged. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i].start, b[j].start);
    const e = Math.min(a[i].end, b[j].end);
    if (e > s) out.push({ start: s, end: e });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

export function total(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}
