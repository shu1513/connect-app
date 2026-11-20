/**
 * The rules of the calendar on the home page that are plain logic
 * (plans/43-calendar-on-the-home-page.md): which days are in view, where a call sits in a day,
 * which calls stand side by side, and which hours are drawn. No database, and nothing that only a
 * browser or only a server has: the time zone and the first day of the week are handed in.
 */
import { dayOf } from "./rules";

export const CALENDAR = {
  /** The server sends every call that touches this many days before and after the day asked for (see `viewRange`). */
  daysEitherSide: 9,
  /** The hours always drawn, on the clock: 9 in the morning to 6 in the evening. More when a call in view is earlier or later. */
  firstHour: 9,
  lastHour: 18,
  /** A call is never drawn shorter than this many minutes, so the shortest call still has room for a line of words. */
  leastMinutes: 15,
  /** How tall an hour is drawn, in pixels: the shortest drawing (a quarter of it) still holds one line of small words. */
  hourPixels: 60,
  /** The most calls sent for the days around a day. Beyond it the page says that some are missing. */
  most: 500,
} as const;

/** A day as the address carries it, "2026-11-23", or null when it is not a real day. */
export function parseDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, date] = value.split("-").map(Number);
  if (year < 2000 || year > 2200) return null;
  const read = new Date(Date.UTC(year, month - 1, date));
  // "2026-02-31" is read by the calendar as a day in March: not a day anyone asked for.
  return read.toISOString().slice(0, 10) === value ? value : null;
}

/** The calendar day so many days after a day (before it, for a negative number). */
export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

/** The day of the week of a calendar day: 0 is Sunday, 6 is Saturday. */
export function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/**
 * The days in view. Seven: the week that holds the day, from the week's first day (0 Sunday,
 * 1 Monday, …). Three: the day and the two after it.
 */
export function daysInView(day: string, columns: 3 | 7, weekStartsOn: number): string[] {
  const first = columns === 7 ? addDays(day, -((weekdayOf(day) - weekStartsOn + 7) % 7)) : day;
  return Array.from({ length: columns }, (_, index) => addDays(first, index));
}

/** The day the arrows lead to: a week on, or three days on; back, for -1. */
export function dayToMoveTo(day: string, columns: 3 | 7, direction: 1 | -1): string {
  return addDays(day, direction * columns);
}

/**
 * The first day of the week where this language is spoken: 0 for Sunday, 1 for Monday, and so on.
 * `firstDay` is what the browser says about the language (1 Monday … 7 Sunday), when it can say;
 * otherwise the week starts on Sunday.
 */
export function weekStartFrom(firstDay: unknown): number {
  return typeof firstDay === "number" && Number.isInteger(firstDay) && firstDay >= 1 && firstDay <= 7 ? firstDay % 7 : 0;
}

/**
 * The stretch of time the server loads calls for, around the day asked for (noon of it, on the
 * world's clock; "now" when no day was asked for). The server cannot know the viewer's time zone,
 * the first day of their week, or whether they see three days or seven. Whatever those are, the
 * days in view lie within a week of the day asked for, and a time zone moves a day by less than
 * one more: nine days either side hold them all.
 */
export function viewRange(day: string | null, now: Date): { from: Date; to: Date } {
  const middle = day ? new Date(`${day}T12:00:00Z`).getTime() : now.getTime();
  const reach = CALENDAR.daysEitherSide * 24 * 60 * 60_000;
  return { from: new Date(middle - reach), to: new Date(middle + reach) };
}

const clocks = new Map<string, Intl.DateTimeFormat>();

/** How many minutes into its day a moment is, on the clock of a time zone. */
export function minuteOfDay(moment: Date, timeZone: string): number {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clocks.set(timeZone, clock);
  }
  const parts = clock.formatToParts(moment);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

export type Segment<T> = { call: T; day: string; /** Minutes into the day, on the clock. */ from: number; to: number };

/**
 * Where each call sits in the days in view. A call that runs past midnight has a part in both
 * days. Times are the clock's: on the day the clocks change, a call sits where its clock shows.
 */
export function segmentsOf<T extends { startsAt: Date; endsAt: Date }>(calls: T[], days: string[], timeZone: string): Segment<T>[] {
  const segments: Segment<T>[] = [];
  for (const call of calls) {
    const startDay = dayOf(call.startsAt, timeZone);
    const endDay = dayOf(call.endsAt, timeZone);
    const startMinute = minuteOfDay(call.startsAt, timeZone);
    const endMinute = minuteOfDay(call.endsAt, timeZone);
    const lasts = Math.max(1, Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / 60_000));
    for (const day of days) {
      if (day < startDay || day > endDay) continue;
      const from = day === startDay ? startMinute : 0;
      let to = day === endDay ? endMinute : 1440;
      // A call that ends at midnight exactly has no part in the day that begins there.
      if (day === endDay && day !== startDay && endMinute === 0) continue;
      // The hour that comes twice when the clocks go back: the end can read earlier than the start. Its real length is kept.
      if (to <= from) to = Math.min(1440, from + lasts);
      segments.push({ call, day, from, to });
    }
  }
  return segments;
}

/** The hours drawn: the usual ones, and earlier or later when a call in view needs it. */
export function hoursToDraw(segments: Array<{ from: number; to: number }>): { from: number; to: number } {
  let from: number = CALENDAR.firstHour;
  let to: number = CALENDAR.lastHour;
  for (const segment of segments) {
    from = Math.min(from, Math.floor(segment.from / 60));
    to = Math.max(to, Math.ceil(Math.max(segment.to, segment.from + CALENDAR.leastMinutes) / 60));
  }
  return { from: Math.max(0, from), to: Math.min(24, to) };
}

/**
 * The calls of one day, each with its place across the day's width. Every call is drawn at least
 * `least` minutes tall; two that would then cover each other stand side by side, each in a lane
 * of its own, and share the width (`lanes` is how many share it).
 */
export function inLanes<S extends { from: number; to: number }>(segments: S[], least: number = CALENDAR.leastMinutes): Array<S & { lane: number; lanes: number }> {
  const sorted = [...segments].sort((a, b) => a.from - b.from || a.to - b.to);
  const placed: Array<S & { lane: number; lanes: number }> = [];
  let group: Array<S & { lane: number; lanes: number }> = [];
  let ends: number[] = [];
  const close = () => {
    for (const one of group) one.lanes = ends.length;
    group = [];
    ends = [];
  };
  for (const segment of sorted) {
    const drawnTo = Math.max(segment.to, segment.from + least);
    // Nothing drawn before reaches this far: those calls are done with, and their widths are settled.
    if (ends.length > 0 && ends.every((end) => end <= segment.from)) close();
    let lane = ends.findIndex((end) => end <= segment.from);
    if (lane < 0) lane = ends.length;
    ends[lane] = drawnTo;
    const one = { ...segment, lane, lanes: 1 };
    group.push(one);
    placed.push(one);
  }
  close();
  return placed;
}
