/**
 * A host's calendar settings: time zone, lengths, notice, weekly hours and
 * time off. Everything that changes them goes through here.
 */
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import type { HostCalendar } from "@/db/schema";
import { BREAK_CHOICES_MINUTES, HORIZON_CHOICES_WEEKS, LENGTH_CHOICES_MINUTES, NOTICE_CHOICES_HOURS } from "./rules";
import { isCalendarZone } from "./slots";

/** A problem the host can fix. Its message is safe to show them. */
export class CalendarError extends Error {}

const includes = (choices: readonly number[], value: number) => choices.includes(value);

/** The host's calendar, created on first use in their own time zone. */
export async function calendarOf(userId: string, fallbackZone: string | null): Promise<HostCalendar> {
  await db
    .insert(schema.hostCalendars)
    .values({ userId, timeZone: fallbackZone && isCalendarZone(fallbackZone) ? fallbackZone : "America/New_York" })
    .onConflictDoNothing();
  const [calendar] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, userId));
  return calendar;
}

export async function saveCalendarChoices(
  userId: string,
  input: { timeZone: string; lengths: number[]; noticeHours: number; horizonWeeks: number; breakMinutes: number },
): Promise<void> {
  const lengths = [...new Set(input.lengths)].filter((n) => includes(LENGTH_CHOICES_MINUTES, n)).sort((a, b) => a - b);
  if (!isCalendarZone(input.timeZone)) throw new CalendarError("Choose your calendar's time zone from the list.");
  if (lengths.length === 0) throw new CalendarError("Offer at least one call length.");
  if (!includes(NOTICE_CHOICES_HOURS, input.noticeHours)) throw new CalendarError("Choose one of the listed notice periods.");
  if (!includes(HORIZON_CHOICES_WEEKS, input.horizonWeeks)) throw new CalendarError("Choose how far ahead you can be booked from the list.");
  if (!includes(BREAK_CHOICES_MINUTES, input.breakMinutes)) throw new CalendarError("Choose one of the listed breaks.");
  await db
    .update(schema.hostCalendars)
    .set({ timeZone: input.timeZone, lengths: lengths.join(","), noticeHours: input.noticeHours, horizonWeeks: input.horizonWeeks, breakMinutes: input.breakMinutes, updatedAt: new Date() })
    .where(eq(schema.hostCalendars.userId, userId));
}

/** "18:30" as minutes from midnight, or null. */
function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) <= 23 && Number(match[2]) <= 59 ? minutes : null;
}

/** Adds a stretch of weekly hours. "To" of 00:00 means midnight at the end of the day. */
export async function addWeeklyHours(userId: string, input: { weekday: number; from: string; to: string }): Promise<void> {
  const start = minutesOf(input.from);
  const typedEnd = minutesOf(input.to);
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) throw new CalendarError("Choose a day of the week.");
  if (start === null || typedEnd === null) throw new CalendarError("Enter both times, for example 18:00 and 21:00.");
  const end = typedEnd === 0 ? 1440 : typedEnd;
  if (end <= start) throw new CalendarError("The end must be later than the start. To go past midnight, add the rest on the next day.");
  const sameDay = await db.select().from(schema.weeklyHours).where(and(eq(schema.weeklyHours.hostId, userId), eq(schema.weeklyHours.weekday, input.weekday)));
  if (sameDay.some((h) => start < h.endMinute && end > h.startMinute)) throw new CalendarError("Those hours overlap hours you already have on that day.");
  if (sameDay.length >= 6) throw new CalendarError("That is a lot of separate hours for one day. Remove some first.");
  await db.insert(schema.weeklyHours).values({ hostId: userId, weekday: input.weekday, startMinute: start, endMinute: end });
}

export async function removeWeeklyHours(userId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.delete(schema.weeklyHours).where(and(eq(schema.weeklyHours.id, id), eq(schema.weeklyHours.hostId, userId)));
}

/** A date-and-time typed by the host ("2026-12-24T09:00"), read in their calendar's time zone. */
function momentIn(timeZone: string, typed: string): Date | null {
  try {
    return new Date(Temporal.PlainDateTime.from(typed).toZonedDateTime(timeZone, { disambiguation: "compatible" }).epochMilliseconds);
  } catch {
    return null;
  }
}

export async function addTimeOff(userId: string, timeZone: string, input: { from: string; to: string }, now: Date): Promise<void> {
  const startsAt = momentIn(timeZone, input.from);
  const endsAt = momentIn(timeZone, input.to);
  if (!startsAt || !endsAt) throw new CalendarError("Enter when your time off starts and ends.");
  if (endsAt <= startsAt) throw new CalendarError("The end must be later than the start.");
  if (endsAt <= now) throw new CalendarError("That time off is already over.");
  if (endsAt.getTime() - startsAt.getTime() > 366 * 24 * 3_600_000) throw new CalendarError("Time off can be at most a year long.");
  const existing = await db.select({ id: schema.timeOff.id }).from(schema.timeOff).where(and(eq(schema.timeOff.hostId, userId), gt(schema.timeOff.endsAt, now)));
  if (existing.length >= 50) throw new CalendarError("You have a lot of time off saved. Remove some first.");
  await db.insert(schema.timeOff).values({ hostId: userId, startsAt, endsAt });
}

export async function removeTimeOff(userId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.delete(schema.timeOff).where(and(eq(schema.timeOff.id, id), eq(schema.timeOff.hostId, userId)));
}

export async function hoursAndTimeOff(userId: string, now: Date) {
  const [hours, off] = await Promise.all([
    db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, userId)).orderBy(asc(schema.weeklyHours.weekday), asc(schema.weeklyHours.startMinute)),
    db.select().from(schema.timeOff).where(and(eq(schema.timeOff.hostId, userId), gt(schema.timeOff.endsAt, now))).orderBy(asc(schema.timeOff.startsAt)),
  ]);
  return { hours, off };
}

/** 1110 → "18:30"; 1440 → "24:00". */
export function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A moment written out in a given time zone, for the host's own lists. */
export function inZone(timeZone: string, moment: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(moment);
}
