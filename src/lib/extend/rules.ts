/**
 * The rules for adding time during a call, as plain logic: when the customer
 * may ask, until when the host may accept, how many minutes fit, and what they
 * cost. No database, no Stripe, so they can be tested directly.
 */
import { bookedTotalCents } from "@/lib/payments/pricing";

/** The customer can ask from this long before the end. */
export const ASK_OPENS_SECONDS = 90;
/** Asking stops this long before the end: the bank needs a moment to hold the money. */
export const ASK_CLOSES_SECONDS = 15;
/** The host can accept until this long before the end. */
export const ACCEPT_CLOSES_SECONDS = 5;
/** Both people see the big countdown for this long before the end. */
export const COUNTDOWN_SECONDS = 60;
/** While this close to the end, the call screen asks the server for news every couple of seconds. */
export const WATCH_SECONDS = 120;

/** The quick choices, in minutes. */
export const EXTENSION_CHOICES_MINUTES = [5, 10, 15] as const;
export const MIN_EXTENSION_MINUTES = 5;
/** The most that can be asked for in one request. A call can be extended again later. */
export const MAX_EXTENSION_MINUTES = 60;
/** The most requests one call can have, answered or not, so a card is never tried again and again. */
export const MAX_REQUESTS_PER_CALL = 5;

export type ExtensionStatus = "open" | "accepted" | "declined" | "ran_out" | "failed";

const MINUTE = 60_000;

export type AskWindow = "too_early" | "open" | "too_late";

/** Whether the customer can ask for more time at this moment. */
export function askWindow(input: { now: Date; endsAt: Date }): AskWindow {
  const left = input.endsAt.getTime() - input.now.getTime();
  if (left > ASK_OPENS_SECONDS * 1000) return "too_early";
  if (left <= ASK_CLOSES_SECONDS * 1000) return "too_late";
  return "open";
}

/** Whether the host can still accept at this moment. */
export function canStillAccept(input: { now: Date; endsAt: Date }): boolean {
  return input.endsAt.getTime() - input.now.getTime() > ACCEPT_CLOSES_SECONDS * 1000;
}

/**
 * The most whole minutes that can be added to a call that ends at `endsAt`.
 * The host needs their break after the new end before their next thing starts;
 * the customer only needs the new end to come before their next thing.
 * Null means "nothing coming up". Never more than the most one request may ask for.
 */
export function minutesThatFit(input: { endsAt: Date; breakMinutes: number; hostNextAt: Date | null; customerNextAt: Date | null }): number {
  const end = input.endsAt.getTime();
  const forHost = input.hostNextAt ? Math.floor((input.hostNextAt.getTime() - end) / MINUTE) - input.breakMinutes : MAX_EXTENSION_MINUTES;
  const forCustomer = input.customerNextAt ? Math.floor((input.customerNextAt.getTime() - end) / MINUTE) : MAX_EXTENSION_MINUTES;
  return Math.max(0, Math.min(MAX_EXTENSION_MINUTES, forHost, forCustomer));
}

/** The quick choices that fit. */
export function choicesThatFit(fits: number): number[] {
  return EXTENSION_CHOICES_MINUTES.filter((minutes) => minutes <= fits);
}

/** What is wrong with a number of minutes the customer asked for, in words they can read. Null when it is fine. */
export function minutesProblem(minutes: number, fits: number): string | null {
  if (!Number.isInteger(minutes)) return "Enter a whole number of minutes.";
  if (fits < MIN_EXTENSION_MINUTES) return "There is no room to add time to this call.";
  if (minutes < MIN_EXTENSION_MINUTES) return `The least you can add is ${MIN_EXTENSION_MINUTES} minutes.`;
  if (minutes > fits) return `You can add up to ${fits} more minutes.`;
  return null;
}

/** The price of the extra minutes, at the call's own price per 15 minutes. Zero for a free call. */
export function extensionPriceCents(pricePer15Cents: number, minutes: number): number {
  return bookedTotalCents(pricePer15Cents, minutes * 60);
}
