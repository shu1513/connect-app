/**
 * The rules of the home page that are plain logic (plans/36-customer-home-page.md): which calls
 * are "not over", which one is "the next call", what the countdown says, and which day a moment
 * falls on. (How calls are laid out in days is in calendar.ts, plans/43.) No database, and
 * nothing that only a browser or only a server has.
 */

export const HOME = {
  /** How many of the hosts a person follows are shown on the home page; the rest are behind "See all". */
  hostsShown: 8,
  /** "Past calls" shows this many to a page. */
  pastPerPage: 50,
  /** A diary post's first lines in the news, in characters. */
  newsLetters: 280,
  /** How many of the times people asked a host for are shown on the home page; the rest are on the requests page. */
  requestTimesShown: 5,
} as const;

export type CallMoments = { startsAt: Date; endsAt: Date; cancelledAt: Date | null; safetyEndedAt: Date | null };

/**
 * A call is "not over" while it is not cancelled, was not ended with a report, and its booked end
 * has not passed. Whose call it is, is the query's business. Everything else is a past call.
 */
export function notOver(call: CallMoments, now: Date): boolean {
  return !call.cancelledAt && !call.safetyEndedAt && call.endsAt.getTime() > now.getTime();
}

/** The call the countdown is about: the soonest that is not over. With the same start, the one that ends first. */
export function nextCall<T extends CallMoments>(calls: T[], now: Date): T | null {
  const open = calls.filter((call) => notOver(call, now));
  if (open.length === 0) return null;
  return open.reduce((first, call) =>
    call.startsAt.getTime() < first.startsAt.getTime() || (call.startsAt.getTime() === first.startsAt.getTime() && call.endsAt.getTime() < first.endsAt.getTime()) ? call : first,
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What the countdown says for the seconds that are left until the room opens.
 *
 * - a day or more: "in 3 days", and for the one day before that "in 1 day 4 hours";
 * - an hour or more: "in 5 hours 12 minutes";
 * - under an hour: minutes and seconds, "12:34", which the browser moves every second;
 * - nothing left: null. The page then asks the server; it never decides by itself that a room is open.
 */
export function countdownWords(secondsLeft: number): { text: string; everySecond: boolean } | null {
  const s = Math.floor(secondsLeft);
  if (s <= 0) return null;
  if (s < 3600) return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, everySecond: true };
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days >= 2) return { text: `in ${plural(days, "day")}`, everySecond: false };
  if (days === 1) return { text: hours > 0 ? `in 1 day ${plural(hours, "hour")}` : "in 1 day", everySecond: false };
  return { text: minutes > 0 ? `in ${plural(hours, "hour")} ${plural(minutes, "minute")}` : `in ${plural(hours, "hour")}`, everySecond: false };
}

/** How long ago the booked start of a running call was: "just now", "12 minutes ago", "5 hours 59 minutes ago". */
export function agoWords(secondsAgo: number): string {
  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 > 0 ? `${plural(hours, "hour")} ${plural(minutes % 60, "minute")} ago` : `${plural(hours, "hour")} ago`;
}

/** The calendar day of a moment in a time zone, as "2026-11-27". */
export function dayOf(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(moment);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The calendar day after a day. Days are counted on the calendar, so the day the clocks change is a day like any other. */
export function dayAfter(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/**
 * What a host is shown about the customer of a call she hosts (plans/38-host-home-page.md). Made
 * on the server for the host of that call only, and attached to that call before anything is sent
 * to the browser: a call the person is the customer of never has one.
 */
export type CustomerDetails = {
  /** What the customer wrote when asking for the call; empty when they wrote nothing. */
  words: string;
  /** Only a yes or no: never the ID or the name on it. */
  idConfirmed: boolean;
  /** The customer has an active membership with this host: a month is held or running. */
  member: boolean;
  /** How often the two have talked before, by the rule of "People you have talked to". */
  callsBefore: number;
  /** When the last of those calls started; null when there was none. */
  lastCallAt: string | null;
  /** The host's own private note about this customer, or null. */
  note: string | null;
};

/** The words for the calls before. With one or more, a date follows: "1 call before, on …", "3 calls before, the last on …". */
export function callsBeforeWords(calls: number): string {
  if (calls <= 0) return "First call with you";
  return calls === 1 ? "1 call before, on" : `${calls} calls before, the last on`;
}
