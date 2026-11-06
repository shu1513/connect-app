/**
 * The rules for "available now" and instant calls that are plain logic: how
 * long availability lasts, what counts as the host being there, which call
 * lengths fit, and the instant deadlines. No database, no Stripe.
 */
import type { Interval } from "./slots";

const MINUTE = 60_000;

export const NOW = {
  /** How long a host can say they are available for, in minutes. */
  durations: [30, 60, 120] as const,
  /** The host's page says "still here" this often; after `presenceSeconds` without it, the host is not available. */
  heartbeatSeconds: 15,
  presenceSeconds: 45,
  /** The host has this long to answer an instant request. */
  answerMinutes: 3,
  /** After accepting: the call starts this many seconds later, and the money must be held within `payMinutes`. */
  startAfterSeconds: 60,
  payMinutes: 2,
  /** After a host declines an instant request, that customer cannot ask them for an instant call for this long. */
  cooldownHours: 24,
  /** Instant requests one host can have waiting at a time, and a customer may have outstanding (card step or waiting). */
  waitingPerHost: 5,
  outstandingPerCustomer: 1,
  /** After this many refused cards in a row within the hour, no instant requests for an hour. */
  cardFailuresBeforePause: 3,
  cardFailurePauseMinutes: 60,
} as const;

export type Availability = { availableUntil: Date | null; availableSeenAt: Date | null };

/** True while the host said they are available and their page has said "still here" recently. */
export function isAvailableNow(state: Availability, now: Date): boolean {
  if (!state.availableUntil || state.availableUntil <= now) return false;
  if (!state.availableSeenAt || now.getTime() - state.availableSeenAt.getTime() > NOW.presenceSeconds * 1000) return false;
  return true;
}

/** The latest moment an instant call asked for now could start: after the host's full time to answer, plus the start delay. */
export function latestInstantStart(now: Date): Date {
  return new Date(now.getTime() + NOW.answerMinutes * MINUTE + NOW.startAfterSeconds * 1000);
}

/**
 * The call lengths that fit right now: the whole call plus the host's break,
 * starting as late as it might, runs into nothing the host is taken for (as
 * host or as customer), and the call itself is over before the host's
 * availability ends (they said how long they have).
 */
export function fittingLengths(input: { lengths: number[]; breakMinutes: number; busy: Interval[]; now: Date; availableUntil: Date }): number[] {
  const start = latestInstantStart(input.now);
  // Anything the host is taken for from this moment on blocks a call that would overlap it.
  const from = input.now;
  return input.lengths.filter((length) => {
    const callEnd = new Date(start.getTime() + length * MINUTE);
    if (callEnd > input.availableUntil) return false;
    const end = new Date(callEnd.getTime() + input.breakMinutes * MINUTE);
    return !input.busy.some((b) => b.start < end && b.end > from);
  });
}

/** The instant deadlines, from the moment the request was sent, and from the moment it was accepted. */
export function instantAnswerBy(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + NOW.answerMinutes * MINUTE);
}
export function instantStart(acceptedAt: Date): Date {
  return new Date(acceptedAt.getTime() + NOW.startAfterSeconds * 1000);
}
export function instantPayBy(acceptedAt: Date): Date {
  return new Date(acceptedAt.getTime() + NOW.payMinutes * MINUTE);
}
