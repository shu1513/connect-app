/**
 * The home page's plain logic in the app (plans/45-phone-apps/04-the-home-page.md): checking the
 * server's answer, laying the calendar out, and the words for times. The laying out itself is the
 * website's own (src/lib/home/calendar.ts and rules.ts, read as they are); this only puts its
 * pieces together the way the website's calendar does, for three days on a phone.
 *
 * The server does not know the phone's time zone. It sends moments on the world's clock, and
 * everything here turns them into days and hours in the phone's own zone.
 */
import type { AppAsk, AppCall, AppHome } from "../../../src/lib/app-door/types";
import { CALENDAR, daysInView, hostedTotal, hoursToDraw, inLanes, minuteOfDay, parseDay, segmentsOf } from "../../../src/lib/home/calendar";
import { dayOf } from "../../../src/lib/home/rules";

const isThing = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isMoment = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isListOf = (value: unknown, each: (item: Record<string, unknown>) => boolean): boolean => Array.isArray(value) && value.every((item) => isThing(item) && each(item));

function isCall(value: unknown): value is AppCall {
  if (!isThing(value) || !isText(value.id) || !isMoment(value.startsAt) || !isMoment(value.endsAt) || typeof value.minutes !== "number" || !isText(value.name)) return false;
  if (!isTextOrNull(value.photoId) || typeof value.hosting !== "boolean" || typeof value.open !== "boolean" || typeof value.finished !== "boolean" || !isText(value.payment)) return false;
  const earned = value.earned;
  if (earned !== undefined && !(isThing(earned) && isText(earned.text) && typeof earned.cents === "number" && typeof earned.soFar === "boolean")) return false;
  const about = value.about;
  return about === undefined || (isThing(about) && isText(about.words) && typeof about.idConfirmed === "boolean" && typeof about.member === "boolean" && typeof about.callsBefore === "number" && isTextOrNull(about.lastCallAt) && isTextOrNull(about.note));
}

/**
 * Whether an answer really is the home page, with the parts the screen reads. Half an answer, or
 * another site's page, is treated as not reaching Connect.
 */
export function isHome(data: unknown): data is AppHome {
  if (!isThing(data) || !isMoment(data.serverNow) || !isText(data.firstName) || typeof data.takeCalls !== "boolean" || typeof data.refreshSeconds !== "number") return false;
  if (!Array.isArray(data.calls) || !data.calls.every(isCall)) return false;
  if (data.next !== null && !(isThing(data.next) && isText(data.next.id) && isMoment(data.next.opensAt) && typeof data.next.notPaid === "boolean")) return false;
  if (data.noCall !== null && !isText(data.noCall)) return false;
  const calendar = data.calendar;
  if (!isThing(calendar) || typeof calendar.shown !== "boolean" || typeof calendar.cut !== "boolean" || typeof calendar.most !== "number") return false;
  // The day in view is a real calendar day, or none (today): anything else would break the laying out.
  if (calendar.day !== null && (!isText(calendar.day) || parseDay(calendar.day) !== calendar.day)) return false;
  if (!isListOf(calendar.asks, (ask) => isMoment(ask.startsAt) && isMoment(ask.endsAt) && typeof ask.count === "number")) return false;
  const toAnswer = data.toAnswer;
  if (!isThing(toAnswer) || typeof toAnswer.count !== "number" || typeof toAnswer.times !== "number") return false;
  if (!isListOf(toAnswer.shown, (r) => isText(r.id) && isMoment(r.startsAt) && typeof r.minutes === "number" && isText(r.price) && isText(r.name) && (r.respondBy === null || isMoment(r.respondBy)))) return false;
  if (!isListOf(data.toRate, (c) => isText(c.callId) && isText(c.otherName) && isMoment(c.endsAt))) return false;
  if (!isListOf(data.requests, (r) => isText(r.id) && isText(r.hostName) && isMoment(r.startsAt) && isText(r.words))) return false;
  const followed = data.followed;
  if (!isThing(followed) || typeof followed.total !== "number") return false;
  if (!isListOf(followed.hosts, (h) => isText(h.name) && isTextOrNull(h.handle) && typeof h.available === "boolean" && isTextOrNull(h.photoId))) return false;
  const suggested = data.suggested;
  if (suggested !== null) {
    if (!isThing(suggested) || !isText(suggested.day) || typeof suggested.made !== "boolean" || typeof suggested.shownFirst !== "number" || !isText(suggested.why)) return false;
    const isHost = (h: Record<string, unknown>) =>
      typeof h.place === "number" && isText(h.handle) && isText(h.name) && isText(h.price) && Array.isArray(h.languages) && h.languages.every(isText) && typeof h.seen === "boolean" && isTextOrNull(h.photoId) && typeof h.availableNow === "boolean" && (h.nextOpen === null || isMoment(h.nextOpen)) && (h.rating === null || (isThing(h.rating) && typeof h.rating.average === "number" && typeof h.rating.count === "number"));
    if (!isListOf(suggested.hosts, isHost)) return false;
  }
  return data.hosting === null || (isThing(data.hosting) && isTextOrNull(data.hosting.page));
}

export type Piece = { key: string; day: string; from: number; to: number; lane: number; lanes: number; call: AppCall | null; ask: AppAsk | null };

export type CalendarView = {
  /** The three days in view, as "2026-11-20". */
  days: string[];
  today: string;
  /** The hours drawn, on the clock. */
  hours: { from: number; to: number };
  /** Calls and asked-for times, each with its place in its day; two that would cover each other stand side by side. */
  pieces: Piece[];
  /** The calls with a part in these days, and the first of the days each has a part in (where the list puts it). */
  inView: AppCall[];
  firstDayOf: Map<string, string>;
  /** Minutes into today at which "now" is, when today and this hour are in view; else null. */
  nowMinute: number | null;
  /** What the calls she hosted in these days earned together; null when she hosted none that is over. */
  total: { calls: number; cents: number; soFar: boolean } | null;
};

/** The calendar of three days from `day` (today when null), in the phone's time zone. */
export function calendarView(input: { calls: AppCall[]; asks: AppAsk[]; day: string | null; serverNow: string; zone: string }): CalendarView {
  const now = new Date(input.serverNow);
  const today = dayOf(now, input.zone);
  const days = daysInView(input.day ?? today, 3, 0);
  const callSegments = segmentsOf(
    input.calls.map((call) => ({ call, startsAt: new Date(call.startsAt), endsAt: new Date(call.endsAt) })),
    days,
    input.zone,
  );
  const askSegments = segmentsOf(
    input.asks.map((ask) => ({ ask, startsAt: new Date(ask.startsAt), endsAt: new Date(ask.endsAt) })),
    days,
    input.zone,
  );
  const loose = [
    ...callSegments.map((segment) => ({ day: segment.day, from: segment.from, to: segment.to, call: segment.call.call as AppCall | null, ask: null as AppAsk | null })),
    ...askSegments.map((segment) => ({ day: segment.day, from: segment.from, to: segment.to, call: null as AppCall | null, ask: segment.call.ask as AppAsk | null })),
  ];
  const hours = hoursToDraw(loose);
  const pieces: Piece[] = days.flatMap((day) =>
    inLanes(loose.filter((piece) => piece.day === day)).map((piece) => ({ ...piece, key: `${piece.call ? piece.call.id : `ask-${piece.ask!.startsAt}`}-${day}` })),
  );
  const firstDayOf = new Map<string, string>();
  for (const segment of [...callSegments].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) if (!firstDayOf.has(segment.call.call.id)) firstDayOf.set(segment.call.call.id, segment.day);
  const inView = input.calls.filter((call) => firstDayOf.has(call.id));
  const minute = minuteOfDay(now, input.zone);
  const nowMinute = days.includes(today) && minute >= hours.from * 60 && minute < hours.to * 60 ? minute : null;
  return { days, today, hours, pieces, inView, firstDayOf, nowMinute, total: hostedTotal(inView) };
}

/** Where a piece sits in its day's column, in points from the top, and how tall it is drawn. */
export function placeOf(piece: { from: number; to: number }, hours: { from: number }): { top: number; height: number } {
  return {
    top: ((piece.from - hours.from * 60) / 60) * CALENDAR.hourPixels,
    height: (Math.max(piece.to - piece.from, CALENDAR.leastMinutes) / 60) * CALENDAR.hourPixels - 1,
  };
}

/** The phone's own time zone; the world's clock if the phone will not say. */
export function phoneZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A moment as the website writes one: "Nov 20, 5:00 PM PST", in the phone's own zone and language. */
export function localTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
/** Only the time of day: "5:00 PM PST". */
export function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
/** Only the day, with its year: "Nov 12, 2026". */
export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
/** Noon of a calendar day, read as a plain date: its name never slips to a neighbour. */
const plainDay = (day: string) => new Date(`${day}T12:00:00Z`);
/** A day's name: "Fri 20", or "Friday, November 20" when long. */
export function dayName(day: string, long = false): string {
  return plainDay(day).toLocaleDateString(undefined, { weekday: long ? "long" : "short", day: "numeric", ...(long ? { month: "long" } : {}), timeZone: "UTC" });
}
/** The month, or the two months, the days in view lie in: "November 2026". */
export function monthsOf(days: string[]): string {
  return [...new Set([days[0], days[days.length - 1]].map((one) => plainDay(one).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })))].join(" – ");
}
export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;
/** A person's average, written out as the website writes it: "★ 4.8 from 21 ratings". */
export function ratingWords(rating: { average: number; count: number } | null, newText: string): string {
  return rating ? `★ ${rating.average.toFixed(1)} from ${rating.count} ratings` : newText;
}
/** How long, as a running clock: "4:32", or "1:04:32". */
export function clockWords(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// The website's own words for a countdown, for "how long ago", and for the calls before: read as they are.
export { agoWords, callsBeforeWords, countdownWords } from "../../../src/lib/home/rules";
export { dollars } from "../../../src/lib/home/calendar";
