/**
 * The booking rules that are plain logic: the choices a host has, the limits,
 * the deadlines, and which stage may follow which. No database, no Stripe.
 *
 * In the formulas below: S is the call's start, F the host's free-cancelling
 * period, N the host's shortest notice, r the moment the request was sent.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** The longest call a host can offer, and the step between two lengths (which is also the shortest call), in minutes. */
export const MAX_LENGTH_MINUTES = 360;
export const LENGTH_STEP_MINUTES = 5;
/**
 * Every call length a host can offer: each step of 5 minutes from 5 minutes to 6 hours. A host sets
 * their shortest and their longest call, and the list stored for them holds every step between the
 * two. A customer picks one of those.
 */
export const LENGTH_CHOICES_MINUTES: readonly number[] = Array.from({ length: MAX_LENGTH_MINUTES / LENGTH_STEP_MINUTES }, (_, i) => (i + 1) * LENGTH_STEP_MINUTES);
export const NOTICE_CHOICES_HOURS = [24, 48, 72] as const;
export const HORIZON_CHOICES_WEEKS = [2, 4, 8] as const;
/**
 * After every call, for everyone, this long is kept free (the founder's rule, plans/42). A call
 * taken as a customer takes that person's time until this long after its end, and the shortest
 * break a host can choose is the same. It is the least that always holds, not advice on how long
 * a break should be.
 */
export const AFTER_CALL_MINUTES = 2;
/** Until when a person is taken for a call they are in as the customer: its end and the time kept free after it. */
export function takenUntil(callEndsAt: Date): Date {
  return new Date(callEndsAt.getTime() + AFTER_CALL_MINUTES * MINUTE);
}
export const BREAK_CHOICES_MINUTES = [AFTER_CALL_MINUTES, 5, 10, 15, 30] as const;

/**
 * Why a waiting request ended as "passed over": the host took another request for that time, or
 * a call the host booked for herself (as a customer) took it. The customer is told the first as
 * it is, and of the second only that the host is no longer free.
 */
export const PASSED_OVER = {
  anotherRequest: "the host accepted another request",
  ownCall: "the host is no longer free at that time",
} as const;

export const LIMITS = {
  /** Requests a customer may have waiting with one host, and in total. */
  waitingPerHost: 3,
  waitingTotal: 5,
  /** Free calls a customer may have coming up. */
  upcomingFree: 3,
  /** Waiting requests for one start time of a host, and for a host in total. */
  perStart: 20,
  perHost: 100,
  /** Requests a customer may send in 24 hours (including ones taken back): to one host, and in total. */
  sentPerHostPerDay: 3,
  sentPerDay: 10,
  /** After a host declines a person outright, that person cannot ask that host again for this long. */
  declineCooldownDays: 7,
  noteMax: 300,
  /** How long a customer has to enter their card before an unfinished request is dropped. */
  cardStepMinutes: 30,
  /**
   * Paid requests a customer may have standing at the card step at one time, and may start in 24 hours
   * (sent or not). A request at the card step takes nobody's time and is not counted by the limits above,
   * and each one makes a saved-card step at Stripe: without these, they could be made without end.
   */
  cardStepsOpen: 5,
  cardStepsPerDay: 20,
} as const;

/**
 * The wording version a customer agrees to when saving a card. Change it when the wording changes.
 * The wording itself is the tick box where a paid request is made: `cardTermsWords` in
 * book-words.ts (the website's booking page and the phone app's) and the page
 * src/app/h/[handle]/now/page.tsx; the version is recorded
 * with the request when that box is sent. Other pages must not restate it in a way that only
 * holds for one version.
 */
export const CARD_CONSENT_VERSION = "2026-11-d";
/**
 * The wording versions that say the card is kept until the call is over, so it
 * can also pay for more time the customer asks for during the call. A booking
 * made under an earlier wording ("for this booking only", removed as soon as
 * the money is held) is still treated as its customer was told.
 */
export const CARD_KEPT_FOR_THE_CALL: readonly string[] = ["2026-11-b", "2026-11-c", "2026-11-d"];
/**
 * The wording versions that say what "End call now" costs a customer (plans/51-end-call-now.md): "If you end
 * the call yourself with End call now, you pay for your whole booked time." Only a booking made under such a
 * wording is ever charged that way. A booking made under an earlier wording was told that time the host is
 * not in the call is free, and is charged as it was told: by the host's time, whoever ends the call.
 * (A member's booking has no card step of its own; it carries the version of the words its page showed.)
 */
export const WHOLE_BOOKING_SAID: readonly string[] = ["2026-11-d"];
export const wholeBookingSaid = (version: string | null | undefined): boolean => version != null && WHOLE_BOOKING_SAID.includes(version);
/*
 * "2026-11-c" (20 November 2026, the legal agreements, docs/legal/payment-terms.md, section 12) adds one sentence
 * to the tick box and changes nothing about the card: where a 14-day right to cancel applies to the customer (the
 * United Kingdom and Europe), they ask for the call to take place as booked and understand that the right ends
 * once the call has taken place. It is said to everyone, so the app does not have to ask where a person lives.
 */
/*
 * "2026-11-d" (26 November 2026, plans/51-end-call-now.md) adds one point above the tick box, and changes nothing
 * about the card: a customer who ends the call himself with "End call now" pays for his whole booked time.
 */
/** Under those wordings the card is removed this long after the call's end, when nothing more can be asked of it. */
export const CARD_REMOVED_AFTER_END_MS = 2 * 60_000;

/** Whether a paid request made at this moment may still have its card entered, or be sent on: the card step lasts this long and no longer. */
export function cardStepOpen(createdAt: Date, now: Date): boolean {
  return createdAt.getTime() > now.getTime() - LIMITS.cardStepMinutes * 60_000;
}

/**
 * How long a once-only key made for the phone app can still make a request. After that the app must read
 * the summary again, which brings a new key. (A key that was answered "no request was made" is remembered
 * for longer than this, so it can never come back to life: see `spendKey` in bookings.ts.)
 */
export const REQUEST_KEY_LIFE_MS = 12 * 3_600_000;

/**
 * A once-only key for a request from the phone app. It is an id like any other, and it carries the moment
 * it was made (its first twelve digits, the way a "version 7" id does), so the server can tell later how old
 * it is without keeping a list of the keys it handed out.
 */
export function newRequestKey(now: Date): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const ms = now.getTime();
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** When a key of that kind was made; null for anything else (the website's own keys carry no moment). */
export function requestKeyMadeAt(key: string): Date | null {
  if (!isUuid(key) || key[14] !== "7") return null;
  return new Date(parseInt(key.slice(0, 8) + key.slice(9, 13), 16));
}

/** Whether a key made for the phone app can still make a request at this moment: made by now (give or take a few minutes of clocks), and not too long ago. */
export function requestKeyLives(key: string, now: Date): boolean {
  const madeAt = requestKeyMadeAt(key);
  if (!madeAt) return false;
  const age = now.getTime() - madeAt.getTime();
  return age <= REQUEST_KEY_LIFE_MS && age >= -5 * 60_000;
}

/** Whether a text is an id as the database makes them. Anything else names nothing, and is never asked of the database. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

type Terms = { startsAt: Date; paid: boolean; freeCancelMinutes: number };

/**
 * How long before the start the money must be held at the latest: a full day, so a host whose
 * call is cancelled as unpaid still has a day to fill that time. (12 hours until 19 November
 * 2026. A booking keeps the cut-off it was given when it was asked for.)
 */
const PAY_LEAD_MS = 24 * HOUR;

/**
 * The payment cut-off, D = S − max(F, 24 hours). The money must be held before
 * this, so a card that fails can never be used to dodge the host's cancelling rule.
 */
export function payCutoff(startsAt: Date, freeCancelMinutes: number): Date {
  return new Date(startsAt.getTime() - Math.max(freeCancelMinutes * MINUTE, PAY_LEAD_MS));
}

/**
 * A customer whose card did not work is told at once, and reminded once: 12 hours before the
 * payment cut-off, but never sooner than 6 hours after the first email, and never once the
 * cut-off has passed. (A card that fails less than 6 hours before the cut-off gets no reminder.)
 */
export const CARD_REMINDER = { beforeCutoffMs: 12 * HOUR, afterFirstEmailMs: 6 * HOUR } as const;

export function cardReminderDue(input: { now: Date; payBy: Date; holdFailedAt: Date }): boolean {
  const now = input.now.getTime();
  return now < input.payBy.getTime() && now >= input.payBy.getTime() - CARD_REMINDER.beforeCutoffMs && now >= input.holdFailedAt.getTime() + CARD_REMINDER.afterFirstEmailMs;
}

/**
 * The last moment a time can still be asked for: R = S − N, and for a paid
 * call also no later than 8 hours before the payment cut-off (time for the
 * host to answer and for a card to be fixed).
 */
export function latestRequestAt(input: Terms & { noticeHours: number }): Date {
  const byNotice = input.startsAt.getTime() - input.noticeHours * HOUR;
  if (!input.paid) return new Date(byNotice);
  return new Date(Math.min(byNotice, payCutoff(input.startsAt, input.freeCancelMinutes).getTime() - 8 * HOUR));
}

/** The earliest start that can be asked for right now. The same rule as latestRequestAt, turned around. */
export function earliestStartFor(input: { now: Date; paid: boolean; freeCancelMinutes: number; noticeHours: number }): Date {
  const notice = input.noticeHours * HOUR;
  const paidLead = Math.max(input.freeCancelMinutes * MINUTE, PAY_LEAD_MS) + 8 * HOUR;
  return new Date(input.now.getTime() + (input.paid ? Math.max(notice, paidLead) : notice));
}

/**
 * When the host must have answered: 24 hours after the request, but for a paid
 * call at least 6 hours before the payment cut-off, and for a free call at
 * least 2 hours before the start. It never moves once set.
 */
export function answerDeadline(input: Terms & { requestedAt: Date }): Date {
  const usual = input.requestedAt.getTime() + 24 * HOUR;
  const latest = input.paid
    ? payCutoff(input.startsAt, input.freeCancelMinutes).getTime() - 6 * HOUR
    : input.startsAt.getTime() - 2 * HOUR;
  return new Date(Math.min(usual, latest));
}

export type Stage = "card" | "paying" | "waiting" | "accepted" | "declined" | "passed_over" | "ran_out" | "taken_back" | "cancelled";

const NEXT: Record<Stage, Stage[]> = {
  card: ["waiting", "ran_out"],
  // A member's first booking of a month, while the month's money is being taken: it becomes a call, or ends.
  paying: ["accepted", "ran_out"],
  waiting: ["accepted", "declined", "passed_over", "ran_out", "taken_back"],
  accepted: ["cancelled"],
  declined: [],
  passed_over: [],
  ran_out: [],
  taken_back: [],
  cancelled: [],
};

export function canMoveBooking(from: Stage, to: Stage): boolean {
  return NEXT[from].includes(to);
}

/** Reads the "15,30" list stored for a host. Unknown values are dropped. */
export function readLengths(stored: string): number[] {
  return [...new Set(stored.split(",").map(Number))].filter((n) => LENGTH_CHOICES_MINUTES.includes(n)).sort((a, b) => a - b);
}

/**
 * Every length from a host's shortest call to their longest, or null when the two are not a range a
 * host can offer (not one of the choices, or the shortest longer than the longest).
 */
export function lengthRange(shortest: number, longest: number): number[] | null {
  if (!LENGTH_CHOICES_MINUTES.includes(shortest) || !LENGTH_CHOICES_MINUTES.includes(longest) || shortest > longest) return null;
  return LENGTH_CHOICES_MINUTES.filter((n) => n >= shortest && n <= longest);
}

/** The lengths a new calendar starts with: 30 minutes to 2 hours. */
export const DEFAULT_LENGTHS: readonly number[] = lengthRange(30, 120)!;

/** The length shown first: the offered one closest to 30 minutes, the shorter one when two are equally close. */
export function firstLength(lengths: readonly number[]): number | null {
  let best: number | null = null;
  for (const n of [...lengths].sort((a, b) => a - b)) {
    if (best === null || Math.abs(n - 30) < Math.abs(best - 30)) best = n;
  }
  return best;
}

/** A length in words: "45 minutes", "1 hour", "1 hour 30 minutes", "2 hours". */
export function lengthWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 0 ? "" : hours === 1 ? "1 hour" : `${hours} hours`;
  const m = rest === 0 ? "" : rest === 1 ? "1 minute" : `${rest} minutes`;
  return [h, m].filter(Boolean).join(" ") || "0 minutes";
}

/**
 * What ending a call himself costs a customer, said where he books and where he pays (plans/51-end-call-now.md).
 * Part of the wording CARD_CONSENT_VERSION names: only a booking made under it is charged this way.
 */
export const END_NOW_RULE = 'If you end the call yourself with "End call now", you pay for your whole booked time: the time the host was in the call, and the rest of your booking.';
export const MEMBER_END_NOW_RULE = 'If you end the call yourself with "End call now", all the time you booked is used: the time the host was in the call, and the rest of your booking.';
