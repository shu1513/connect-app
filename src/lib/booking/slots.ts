/**
 * The rule for open times: from a host's weekly hours, time off and existing
 * calls, work out the start times a customer can ask for.
 *
 * Plain logic only. Weekly hours are wall-clock times in the host's calendar
 * time zone; everything that comes out is an exact moment in world time.
 * Lengths, breaks, notice and deadlines are real elapsed time, so the day the
 * clocks change is handled by the time-zone library, not by arithmetic here.
 */
import { Temporal } from "@js-temporal/polyfill";

const MINUTE = 60_000;

export type WeeklyRange = { weekday: number; startMinute: number; endMinute: number };
export type Interval = { start: Date; end: Date };

/** The exact moment of a wall-clock time on a date in a time zone. */
function momentOf(date: Temporal.PlainDate, minuteOfDay: number, timeZone: string): number {
  const day = minuteOfDay >= 1440 ? date.add({ days: 1 }) : date;
  const minute = minuteOfDay >= 1440 ? 0 : minuteOfDay;
  const local = day.toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 });
  const earlier = local.toZonedDateTime(timeZone, { disambiguation: "earlier" });
  const later = local.toZonedDateTime(timeZone, { disambiguation: "later" });
  if (earlier.epochMilliseconds === later.epochMilliseconds) return earlier.epochMilliseconds; // an ordinary time
  // A time that happens twice (clocks go back) means the first one.
  if (earlier.toPlainDateTime().equals(local)) return earlier.epochMilliseconds;
  // A time that does not exist (clocks go forward) means the moment the clocks jump. So hours
  // that lie wholly inside the missing hour come out empty, instead of sliding to an hour later.
  return earlier.getTimeZoneTransition("next")!.epochMilliseconds;
}

/** True for a moment inside the second run of an hour that happens twice (the day the clocks go back). */
function isRepeatOfAnHour(moment: number, timeZone: string): boolean {
  const local = Temporal.Instant.fromEpochMilliseconds(moment).toZonedDateTimeISO(timeZone).toPlainDateTime();
  return local.toZonedDateTime(timeZone, { disambiguation: "earlier" }).epochMilliseconds !== moment;
}

function merged(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Removes the `holes` from the `pieces`. */
function without(pieces: Array<[number, number]>, holes: Array<[number, number]>): Array<[number, number]> {
  let left = pieces;
  for (const [h0, h1] of holes) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of left) {
      if (h1 <= a || h0 >= b) next.push([a, b]);
      else {
        if (h0 > a) next.push([a, h0]);
        if (h1 < b) next.push([h1, b]);
      }
    }
    left = next;
  }
  return left;
}

/**
 * The stretches of real time a host's weekly hours cover, for `days` calendar
 * days starting with the host's "today". Hours that run up to midnight and
 * continue the next morning come out as one stretch.
 */
export function hoursAsStretches(input: { timeZone: string; weekly: WeeklyRange[]; now: Date; days: number }): Interval[] {
  const today = Temporal.Instant.fromEpochMilliseconds(input.now.getTime()).toZonedDateTimeISO(input.timeZone).toPlainDate();
  const raw: Array<[number, number]> = [];
  for (let d = 0; d < input.days; d++) {
    const date = today.add({ days: d });
    for (const range of input.weekly) {
      if (range.weekday !== date.dayOfWeek) continue;
      raw.push([momentOf(date, range.startMinute, input.timeZone), momentOf(date, range.endMinute, input.timeZone)]);
    }
  }
  return merged(raw).map(([a, b]) => ({ start: new Date(a), end: new Date(b) }));
}

/**
 * The start times that can be asked for.
 *
 * Within each free stretch the times are laid out one after another from its
 * start: one call length plus the break apart. The moment right after an
 * existing call (and its break), and the moment that ends exactly one break
 * before the next one, are offered too, so no time is wasted around calls of
 * other lengths.
 *
 * A time is open only if the whole call fits in the stretch and the call plus
 * its break touches nothing the host is busy with. `busy` entries already
 * include the break after each of the host's calls.
 */
export function openStarts(input: {
  timeZone: string;
  weekly: WeeklyRange[];
  timeOff: Interval[];
  busy: Interval[];
  lengthMinutes: number;
  breakMinutes: number;
  now: Date;
  /** Nothing before this can be asked for (notice, and time to answer and to pay). */
  earliestStart: Date;
  horizonWeeks: number;
}): Date[] {
  const length = input.lengthMinutes * MINUTE;
  const padded = length + input.breakMinutes * MINUTE;
  const stretches = hoursAsStretches({ timeZone: input.timeZone, weekly: input.weekly, now: input.now, days: input.horizonWeeks * 7 });
  const off = input.timeOff.map((t): [number, number] => [t.start.getTime(), t.end.getTime()]);
  const pieces = without(
    stretches.map((s): [number, number] => [s.start.getTime(), s.end.getTime()]),
    off,
  );
  const busy = merged(input.busy.map((b): [number, number] => [b.start.getTime(), b.end.getTime()]));
  const earliest = input.earliestStart.getTime();

  const found = new Set<number>();
  for (const [from, to] of pieces) {
    const candidates: number[] = [];
    for (let start = from; start + length <= to; start += padded) candidates.push(start);
    for (const [b0, b1] of busy) {
      if (b1 >= from && b1 < to) candidates.push(b1); // right after a call and its break
      if (b0 > from && b0 <= to + padded) candidates.push(b0 - padded); // ending one break before the next call
    }
    for (const start of candidates) {
      if (start < from || start + length > to || start < earliest) continue;
      if (start % MINUTE !== 0) continue;
      const clash = busy.some(([b0, b1]) => start < b1 && start + padded > b0);
      if (clash || found.has(start)) continue;
      // The hour that happens twice is offered once: the first time round.
      if (isRepeatOfAnHour(start, input.timeZone)) continue;
      found.add(start);
    }
  }
  return [...found].sort((a, b) => a - b).map((ms) => new Date(ms));
}

/** Whether a start time asked for by a browser really is one of the open times. Never trust the browser. */
export function isOpenStart(start: Date, input: Parameters<typeof openStarts>[0]): boolean {
  const wanted = start.getTime();
  return openStarts(input).some((open) => open.getTime() === wanted);
}

/** True for a name like "America/New_York" that the time-zone library knows. */
export function isCalendarZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return timeZone.includes("/") || timeZone === "UTC";
  } catch {
    return false;
  }
}
