/**
 * The rules for calls that start now ("available now") and for more time
 * agreed during a call (a "part 2"). Plain logic, no database, tested on its own.
 */
import { roomOpensAt } from "@/lib/calls";

const SECOND = 1000;
const MINUTE = 60_000;

/** An instant call starts this long after the button: time to enter a card, and for the host to notice. */
export const INSTANT_LEAD_MS = 5 * MINUTE;
/** How long a host can say "I am available now" for, in minutes. It switches itself off afterwards. */
export const AVAILABLE_CHOICES_MINUTES = [30, 60, 120] as const;
/** More time may be offered only while at least this much of the call remains: time to pay before the part 2 starts. */
export const OFFER_WHILE_LEFT_MS = 5 * MINUTE;

export type Interval = { start: Date; end: Date };

/**
 * When an instant call started now begins: on a whole second (the video service
 * counts in whole seconds), rounded down so the room, which opens 5 minutes
 * before the start, is open the moment the button is pressed.
 */
export function instantStartAt(now: Date): Date {
  return new Date(Math.floor((now.getTime() + INSTANT_LEAD_MS) / SECOND) * SECOND);
}

/** Whether a call starting at `startsAt` falls inside the host's "available now" window. */
export function startsWhileAvailable(startsAt: Date, availableUntil: Date | null): boolean {
  return availableUntil !== null && startsAt <= availableUntil;
}

/**
 * The stretch of time each person is taken for by a call of this length. The
 * host's reservation runs on through the break after the call. For a part 2,
 * `hostFrom` is where part 1's reservation (break included) ends: the two
 * reservations touch, so nothing has to be shortened or put back.
 */
export function reservationFor(input: { startsAt: Date; lengthMinutes: number; breakMinutes: number; hostFrom?: Date }): { host: Interval; customer: Interval } {
  const endsAt = new Date(input.startsAt.getTime() + input.lengthMinutes * MINUTE);
  const hostFrom = input.hostFrom && input.hostFrom > input.startsAt ? input.hostFrom : input.startsAt;
  return {
    host: { start: hostFrom, end: new Date(endsAt.getTime() + input.breakMinutes * MINUTE) },
    customer: { start: input.startsAt, end: endsAt },
  };
}

/** Whether a stretch of time overlaps anything in `busy`. Stretches include their start and not their end. */
export function clashes(wanted: Interval, busy: Interval[]): boolean {
  return busy.some((b) => wanted.start < b.end && wanted.end > b.start);
}

/** The call lengths that fit around what both people are already taken for. */
export function lengthsThatFit(input: {
  lengths: number[];
  startsAt: Date;
  breakMinutes: number;
  hostFrom?: Date;
  hostBusy: Interval[];
  customerBusy: Interval[];
}): number[] {
  return input.lengths.filter((lengthMinutes) => {
    const wanted = reservationFor({ startsAt: input.startsAt, lengthMinutes, breakMinutes: input.breakMinutes, hostFrom: input.hostFrom });
    return !clashes(wanted.host, input.hostBusy) && !clashes(wanted.customer, input.customerBusy);
  });
}

/** Whether more time may be offered on this call right now: its room is open, it has not been stopped, and at least 5 minutes remain. */
export function mayOfferMoreTime(call: { startsAt: Date; endsAt: Date; cancelledAt: Date | null; safetyEndedAt: Date | null; continuesCallId?: string | null }, now: Date): boolean {
  if (call.cancelledAt || call.safetyEndedAt) return false;
  if (now < roomOpensAt(call)) return false;
  return call.endsAt.getTime() - now.getTime() >= OFFER_WHILE_LEFT_MS;
}
