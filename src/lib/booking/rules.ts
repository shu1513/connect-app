/**
 * The booking rules that are plain logic: the choices a host has, the limits,
 * the deadlines, and which stage may follow which. No database, no Stripe.
 *
 * In the formulas below: S is the call's start, F the host's free-cancelling
 * period, N the host's shortest notice, r the moment the request was sent.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const LENGTH_CHOICES_MINUTES = [15, 30, 45, 60] as const;
export const NOTICE_CHOICES_HOURS = [24, 48, 72] as const;
export const HORIZON_CHOICES_WEEKS = [2, 4, 8] as const;
export const BREAK_CHOICES_MINUTES = [1, 5, 10, 15, 30] as const;

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
} as const;

/** The wording version a customer agrees to when saving a card. Change it when the wording changes. */
export const CARD_CONSENT_VERSION = "2026-11-b";
/**
 * The wording versions that say the card is kept until the call is over, so it
 * can also pay for more time the customer asks for during the call. A booking
 * made under an earlier wording ("for this booking only", removed as soon as
 * the money is held) is still treated as its customer was told.
 */
export const CARD_KEPT_FOR_THE_CALL: readonly string[] = ["2026-11-b"];
/** Under those wordings the card is removed this long after the call's end, when nothing more can be asked of it. */
export const CARD_REMOVED_AFTER_END_MS = 2 * 60_000;

type Terms = { startsAt: Date; paid: boolean; freeCancelMinutes: number };

/**
 * The payment cut-off, D = S − max(F, 12 hours). The money must be held before
 * this, so a card that fails can never be used to dodge the host's cancelling rule.
 */
export function payCutoff(startsAt: Date, freeCancelMinutes: number): Date {
  return new Date(startsAt.getTime() - Math.max(freeCancelMinutes * MINUTE, 12 * HOUR));
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
  const paidLead = Math.max(input.freeCancelMinutes * MINUTE, 12 * HOUR) + 8 * HOUR;
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

export type Stage = "card" | "waiting" | "accepted" | "declined" | "passed_over" | "ran_out" | "taken_back" | "cancelled";

const NEXT: Record<Stage, Stage[]> = {
  card: ["waiting", "ran_out"],
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
  const allowed: readonly number[] = LENGTH_CHOICES_MINUTES;
  return [...new Set(stored.split(",").map(Number))].filter((n) => allowed.includes(n)).sort((a, b) => a - b);
}
