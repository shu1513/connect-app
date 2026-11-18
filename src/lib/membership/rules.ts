/**
 * The plain rules of memberships: numbers, dates and decisions, with no
 * database and no Stripe in them. The rules themselves are in the rulebook,
 * plans/19-memberships.md; this file is how they are worked out.
 */
import { DEADLINE_CUSHION_MS, TAKE_BEFORE_EXPIRY_MS } from "@/lib/payments/rules";
import type { FeeTerms } from "@/lib/payments/pricing";

/** A problem the person can understand and act on. Its message is safe to show them. */
export class MembershipError extends Error {}

/**
 * The moment something is really decided: the clock read again once the locks are held. A request
 * can arrive just before a deadline and wait for a lock until after it; a deadline is judged by
 * when the step happens, not by when it was asked for. (A later `asOf`, as the check scripts pass, stands.)
 */
export const afterTheWait = (asOf: Date): Date => new Date(Math.max(asOf.getTime(), Date.now()));

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// What a host can offer (the rulebook's "The builder's choices", rows 4 and 5)
// ---------------------------------------------------------------------------

export const MEMBERSHIP = {
  /** The app's lowest price for a paid call, in cents per 15 minutes. */
  minPricePer15Cents: 500,
  minMinutes: 30,
  maxMinutes: 100 * 60,
  stepMinutes: 30,
} as const;

/** What is wrong with a member price and a time included, in words for the host, or null. */
export function offerProblem(input: { pricePer15Cents: number; includedMinutes: number; regularPricePer15Cents: number }): string | null {
  const { pricePer15Cents, includedMinutes, regularPricePer15Cents } = input;
  if (!Number.isInteger(pricePer15Cents) || pricePer15Cents < MEMBERSHIP.minPricePer15Cents) {
    return `The member price must be at least $${(MEMBERSHIP.minPricePer15Cents / 100).toFixed(2)} per 15 minutes.`;
  }
  if (regularPricePer15Cents <= 0) return "A host whose calls are free cannot offer a membership.";
  if (pricePer15Cents > regularPricePer15Cents) return "The member price cannot be more than your regular price.";
  if (!Number.isInteger(includedMinutes) || includedMinutes < MEMBERSHIP.minMinutes || includedMinutes > MEMBERSHIP.maxMinutes || includedMinutes % MEMBERSHIP.stepMinutes !== 0) {
    return "Choose the time included from the list: from 30 minutes to 100 hours, in steps of 30 minutes.";
  }
  return null;
}

/**
 * What a call of this length sets aside from a month: the member price for its length, rounded
 * DOWN to a whole cent, so a member can always book every minute they are shown.
 */
export function memberCallCents(pricePer15Cents: number, minutes: number): number {
  return Math.floor((pricePer15Cents * minutes) / 15);
}

/** What a month costs. Exact: the time is always a whole number of half hours. */
export function monthTotalCents(pricePer15Cents: number, includedMinutes: number): number {
  return (pricePer15Cents * includedMinutes) / 15;
}

// ---------------------------------------------------------------------------
// A month's dates (row 1)
// ---------------------------------------------------------------------------

/**
 * One calendar month after the start, to the same minute; on the last day when the next month is
 * shorter (31 January to 28 February, and from there to 28 March). Worked out in UTC, so it does
 * not depend on anybody's clock change.
 */
export function monthEnd(startsAt: Date): Date {
  const year = startsAt.getUTCFullYear();
  const month = startsAt.getUTCMonth();
  const lastDayOfNext = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const day = Math.min(startsAt.getUTCDate(), lastDayOfNext);
  return new Date(Date.UTC(year, month + 1, day, startsAt.getUTCHours(), startsAt.getUTCMinutes(), startsAt.getUTCSeconds(), startsAt.getUTCMilliseconds()));
}

// ---------------------------------------------------------------------------
// First a hold, then the money (rows 6 and 7)
// ---------------------------------------------------------------------------

/** How long "Cancel now" is offered after the hold. */
export const CANCEL_NOW_MS = 72 * HOUR_MS;

/**
 * The moments around a month's hold, counted from the bank's own time for it.
 * `offeredUntil` is the last moment the page offers "Cancel now"; the money is taken 3 minutes
 * later (the app's cushion for a press in the last second). When the card's hold ends sooner than
 * that needs, the money is taken 12 hours before the hold ends, and that moment is the one shown.
 */
export function holdTiming(input: { authorisedAt: Date; holdExpiresAt: Date }): { offeredUntil: Date; takeAt: Date } {
  const usual = input.authorisedAt.getTime() + CANCEL_NOW_MS + DEADLINE_CUSHION_MS;
  const early = input.holdExpiresAt.getTime() - TAKE_BEFORE_EXPIRY_MS;
  // The rulebook's row 7: with a short hold, the page and the receipt show that earlier moment itself.
  if (early < usual) return { offeredUntil: new Date(early), takeAt: new Date(early) };
  return { offeredUntil: new Date(usual - DEADLINE_CUSHION_MS), takeAt: new Date(usual) };
}

// ---------------------------------------------------------------------------
// A monthly payment that fails (row 2)
// ---------------------------------------------------------------------------

/** Days after the first failure on which the saved card is tried again. */
export const TRY_AGAIN_AFTER_DAYS = [1, 3, 5] as const;
/** After this many days without a hold the payment is given up and the membership paused. */
export const GIVE_UP_AFTER_DAYS = 7;

/** When the payment is given up, counted from the first failure. */
export function giveUpAt(firstFailedAt: Date): Date {
  return new Date(firstFailedAt.getTime() + GIVE_UP_AFTER_DAYS * DAY_MS);
}

/**
 * When the saved card is tried next, after `failures` tries have failed (1 after the first), or
 * null when no automatic try is left and only the member's own "Pay now" or giving up remains.
 */
export function nextTryAt(firstFailedAt: Date, failures: number): Date | null {
  const days = TRY_AGAIN_AFTER_DAYS[failures - 1];
  return days === undefined ? null : new Date(firstFailedAt.getTime() + days * DAY_MS);
}

/** How long a person has at the card form after "Join" or "Resume" (the same as a booking's card step). */
export const CARD_STEP_MS = 30 * MINUTE_MS;

// ---------------------------------------------------------------------------
// The six places, and the end of a month
// ---------------------------------------------------------------------------

export type Places = { freeCents: number; setAsideCents: number; usedCents: number; expiredCents: number; toPayBackCents: number; paidBackCents: number };

export const sumOfPlaces = (p: Places): number => p.freeCents + p.setAsideCents + p.usedCents + p.expiredCents + p.toPayBackCents + p.paidBackCents;

/**
 * A month's free money at its end (the rulebook's step 5): the part that came back because of the
 * host is paid back to the member's card, and the rest has expired.
 */
export function splitAtEnd(month: { freeCents: number; hostCausedCents: number }): { expiredCents: number; payBackCents: number } {
  const payBackCents = Math.min(month.hostCausedCents, month.freeCents);
  return { expiredCents: month.freeCents - payBackCents, payBackCents };
}

/** A month whose bank dispute is open or lost is frozen: nothing of it is booked, used, given back, paid back or collected. A dispute that was won does not freeze. */
export const isFrozen = (month: { dispute: string }): boolean => month.dispute === "open" || month.dispute === "lost";

/**
 * The fee terms of an amount of a month that is used or expires (the rulebook's "The fee"): the
 * percentages on each amount, and the fixed part once a month, on the first such amount.
 */
export function feeTermsFor(month: { feePercentBps: number; feeFixedCents: number; feeForeignCardBps: number; fixedFeePlaced: boolean }): FeeTerms {
  return { percentBps: month.feePercentBps, fixedCents: month.fixedFeePlaced ? 0 : month.feeFixedCents, foreignCardBps: month.feeForeignCardBps };
}

/** Expired money can be collected by the host this long after the month's end. */
export const COLLECT_EXPIRED_AFTER_MS = DAY_MS;

// ---------------------------------------------------------------------------
// Room (rows 9 to 12)
// ---------------------------------------------------------------------------

export type WeeklyStretch = { weekday: number; startMinute: number; endMinute: number };

/**
 * What a host's weekly hours offer in four weeks, in minutes: for each weekday the stretches are
 * joined, so two that overlap are not counted twice; measured by the clock; times four.
 */
export function hostMinutesInFourWeeks(weekly: WeeklyStretch[]): number {
  let week = 0;
  for (let weekday = 1; weekday <= 7; weekday++) {
    const day = weekly.filter((w) => w.weekday === weekday && w.endMinute > w.startMinute).sort((a, b) => a.startMinute - b.startMinute);
    let coveredUntil = -1;
    for (const stretch of day) {
      const from = Math.max(stretch.startMinute, coveredUntil);
      if (stretch.endMinute > from) week += stretch.endMinute - from;
      coveredUntil = Math.max(coveredUntil, stretch.endMinute);
    }
  }
  return week * 4;
}

/**
 * Who keeps their place at a renewal, in one calculation that gives the same answer whoever's
 * renewal comes first. `members` are those who want a next month; each is given a place if their
 * own time still fits in what is left, going from the longest-standing to the newest. One whose
 * time does not fit uses no room, so a newer member with less time can still fit.
 */
export function placesKept(input: { hostMinutes: number; members: Array<{ id: string; since: Date; minutes: number }> }): Set<string> {
  const kept = new Set<string>();
  let left = input.hostMinutes;
  const inOrder = [...input.members].sort((a, b) => a.since.getTime() - b.since.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const member of inOrder) {
    if (member.minutes <= left) {
      kept.add(member.id);
      left -= member.minutes;
    }
  }
  return kept;
}

/** "2 hours", "1 hour 30 minutes", "30 minutes". */
export function timeWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 0 ? "" : `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const m = rest === 0 ? "" : `${rest} minutes`;
  return [h, m].filter(Boolean).join(" ") || "0 minutes";
}

// ---------------------------------------------------------------------------
// Invitations (rows 14 and 15)
// ---------------------------------------------------------------------------

/** An invitation lasts this long. */
export const INVITATION_MS = DAY_MS;
/** At most this many invitations to the same person in this many days. */
export const INVITATIONS_PER_PERSON = 3;
export const INVITATIONS_WINDOW_MS = 30 * DAY_MS;

// ---------------------------------------------------------------------------
// An offer of less time (row 16)
// ---------------------------------------------------------------------------

/** What is wrong with a smaller time offered to a member, or null: at least 30 minutes, in half hours, and less than their time now. */
export function lessTimeProblem(input: { offeredMinutes: number; minutesNow: number }): string | null {
  const { offeredMinutes, minutesNow } = input;
  if (!Number.isInteger(offeredMinutes) || offeredMinutes < MEMBERSHIP.minMinutes || offeredMinutes % MEMBERSHIP.stepMinutes !== 0) return "Offer at least 30 minutes, in steps of 30 minutes.";
  if (offeredMinutes >= minutesNow) return "The time you offer must be less than the member has now.";
  return null;
}
