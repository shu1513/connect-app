import { describe, expect, it } from "vitest";
import { hoursAsStretches, isOpenStart, openStarts, type WeeklyRange } from "./slots";

const NY = "America/New_York";
const at = (iso: string) => new Date(iso);
const times = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 16));

// Monday 2 November 2026, 9:00 in New York (winter time, UTC-5).
const NOW = at("2026-11-02T14:00:00Z");
const base = {
  timeZone: NY,
  timeOff: [],
  busy: [],
  lengthMinutes: 30,
  breakMinutes: 5,
  now: NOW,
  earliestStart: NOW,
  horizonWeeks: 1,
};
// Tuesdays 18:00 to 21:00.
const TUESDAY_EVENING: WeeklyRange[] = [{ weekday: 2, startMinute: 18 * 60, endMinute: 21 * 60 }];

describe("hoursAsStretches", () => {
  it("turns weekly hours into real moments in the host's time zone", () => {
    const stretches = hoursAsStretches({ timeZone: NY, weekly: TUESDAY_EVENING, now: NOW, days: 7 });
    expect(stretches).toEqual([{ start: at("2026-11-03T23:00:00Z"), end: at("2026-11-04T02:00:00Z") }]);
  });

  it("keeps 18:00 at 18:00 for the host across a clock change", () => {
    // Clocks go forward in New York on Sunday 8 March 2026.
    const stretches = hoursAsStretches({ timeZone: NY, weekly: TUESDAY_EVENING, now: at("2026-03-02T14:00:00Z"), days: 14 });
    expect(times(stretches.map((s) => s.start))).toEqual(["2026-03-03T23:00", "2026-03-10T22:00"]);
  });

  it("joins hours that run up to midnight with hours that continue the next morning", () => {
    const weekly: WeeklyRange[] = [
      { weekday: 2, startMinute: 22 * 60, endMinute: 1440 },
      { weekday: 3, startMinute: 0, endMinute: 60 },
    ];
    const stretches = hoursAsStretches({ timeZone: NY, weekly, now: NOW, days: 7 });
    expect(stretches).toEqual([{ start: at("2026-11-04T03:00:00Z"), end: at("2026-11-04T06:00:00Z") }]);
  });

  it("works for zones with half-hour offsets and far from UTC", () => {
    const weekly: WeeklyRange[] = [{ weekday: 2, startMinute: 9 * 60, endMinute: 10 * 60 }];
    expect(hoursAsStretches({ timeZone: "Asia/Kolkata", weekly, now: NOW, days: 7 })[0].start).toEqual(at("2026-11-03T03:30:00Z"));
    expect(hoursAsStretches({ timeZone: "Pacific/Kiritimati", weekly, now: NOW, days: 7 })[0].start).toEqual(at("2026-11-02T19:00:00Z"));
  });

  it("on the day the clocks go forward, an hour that does not exist is simply missing", () => {
    // Sunday 8 March 2026: 2:00 to 3:00 does not exist in New York. Hours 1:00 to 4:00 are two real hours.
    const weekly: WeeklyRange[] = [{ weekday: 7, startMinute: 60, endMinute: 240 }];
    const [stretch] = hoursAsStretches({ timeZone: NY, weekly, now: at("2026-03-07T14:00:00Z"), days: 2 });
    expect(stretch).toEqual({ start: at("2026-03-08T06:00:00Z"), end: at("2026-03-08T08:00:00Z") });
  });

  it("hours that lie inside the missing hour give nothing, instead of sliding an hour later", () => {
    // 2:00 to 2:30 does not exist on 8 March 2026 in New York.
    const inside: WeeklyRange[] = [{ weekday: 7, startMinute: 120, endMinute: 150 }];
    expect(hoursAsStretches({ timeZone: NY, weekly: inside, now: at("2026-03-07T14:00:00Z"), days: 2 })).toEqual([]);
    // 2:30 to 4:00: what is left is 3:00 to 4:00.
    const across: WeeklyRange[] = [{ weekday: 7, startMinute: 150, endMinute: 240 }];
    expect(hoursAsStretches({ timeZone: NY, weekly: across, now: at("2026-03-07T14:00:00Z"), days: 2 })).toEqual([
      { start: at("2026-03-08T07:00:00Z"), end: at("2026-03-08T08:00:00Z") },
    ]);
  });

  it("on the day the clocks go back, the repeated hour makes the stretch an hour longer", () => {
    // Sunday 1 November 2026: 1:00 to 2:00 happens twice in New York. Hours 0:00 to 3:00 are four real hours.
    const weekly: WeeklyRange[] = [{ weekday: 7, startMinute: 0, endMinute: 180 }];
    const [stretch] = hoursAsStretches({ timeZone: NY, weekly, now: at("2026-10-31T14:00:00Z"), days: 2 });
    expect(stretch).toEqual({ start: at("2026-11-01T04:00:00Z"), end: at("2026-11-01T08:00:00Z") });
  });
});

describe("openStarts", () => {
  it("lays times out one after another: call length plus break", () => {
    // 18:00, 18:35, 19:10, 19:45, 20:20 in New York. 20:55 would end after 21:00.
    expect(times(openStarts({ ...base, weekly: TUESDAY_EVENING }))).toEqual([
      "2026-11-03T23:00",
      "2026-11-03T23:35",
      "2026-11-04T00:10",
      "2026-11-04T00:45",
      "2026-11-04T01:20",
    ]);
  });

  it("honours a one-minute break and a thirty-minute break", () => {
    const one = openStarts({ ...base, weekly: TUESDAY_EVENING, breakMinutes: 1 });
    expect(times(one).slice(0, 3)).toEqual(["2026-11-03T23:00", "2026-11-03T23:31", "2026-11-04T00:02"]);
    const thirty = openStarts({ ...base, weekly: TUESDAY_EVENING, breakMinutes: 30 });
    expect(times(thirty)).toEqual(["2026-11-03T23:00", "2026-11-04T00:00", "2026-11-04T01:00"]);
  });

  it("lets the last call end exactly when the hours end; its break may run past them", () => {
    const weekly: WeeklyRange[] = [{ weekday: 2, startMinute: 18 * 60, endMinute: 18 * 60 + 30 }];
    expect(times(openStarts({ ...base, weekly }))).toEqual(["2026-11-03T23:00"]);
    expect(openStarts({ ...base, weekly, lengthMinutes: 45 })).toEqual([]);
  });

  it("closes times that touch an existing call or its break, and offers the time right after it", () => {
    // The host has a 15-minute call at 18:00 with a 5-minute break: busy 18:00 to 18:20.
    const busy = [{ start: at("2026-11-03T23:00:00Z"), end: at("2026-11-03T23:20:00Z") }];
    const open = times(openStarts({ ...base, weekly: TUESDAY_EVENING, busy }));
    expect(open).not.toContain("2026-11-03T23:00");
    expect(open[0]).toBe("2026-11-03T23:20"); // right after, so the 15 minutes until 18:35 are not wasted
    expect(open).toContain("2026-11-04T00:10");
  });

  it("offers the time that ends exactly one break before the next call", () => {
    // Busy from 19:00. A 30-minute call with a 5-minute break can start at 18:25 at the latest.
    const busy = [{ start: at("2026-11-04T00:00:00Z"), end: at("2026-11-04T00:35:00Z") }];
    const open = times(openStarts({ ...base, weekly: TUESDAY_EVENING, busy }));
    expect(open).toContain("2026-11-03T23:25");
    expect(open).toContain("2026-11-03T23:00");
    expect(open).not.toContain("2026-11-03T23:35"); // would run into the 19:00 call
  });

  it("never offers a time whose call or break overlaps something the host is busy with", () => {
    const busy = [
      { start: at("2026-11-03T23:40:00Z"), end: at("2026-11-04T00:15:00Z") },
      { start: at("2026-11-04T01:00:00Z"), end: at("2026-11-04T01:20:00Z") },
    ];
    for (const start of openStarts({ ...base, weekly: TUESDAY_EVENING, busy })) {
      const from = start.getTime();
      const to = from + 35 * 60_000;
      expect(busy.every((b) => to <= b.start.getTime() || from >= b.end.getTime())).toBe(true);
    }
  });

  it("removes time off, and starts again right after it", () => {
    const timeOff = [{ start: at("2026-11-03T23:00:00Z"), end: at("2026-11-04T00:30:00Z") }];
    expect(times(openStarts({ ...base, weekly: TUESDAY_EVENING, timeOff }))).toEqual(["2026-11-04T00:30", "2026-11-04T01:05"]);
  });

  it("offers nothing earlier than the earliest start", () => {
    const open = openStarts({ ...base, weekly: TUESDAY_EVENING, earliestStart: at("2026-11-04T00:00:00Z") });
    expect(times(open)).toEqual(["2026-11-04T00:10", "2026-11-04T00:45", "2026-11-04T01:20"]);
  });

  it("stops at the horizon, counted in the host's calendar days", () => {
    const oneWeek = openStarts({ ...base, weekly: TUESDAY_EVENING, horizonWeeks: 1 });
    const twoWeeks = openStarts({ ...base, weekly: TUESDAY_EVENING, horizonWeeks: 2 });
    expect(new Set(times(oneWeek).map((t) => t.slice(0, 10)))).toEqual(new Set(["2026-11-03", "2026-11-04"]));
    expect(twoWeeks.length).toBe(oneWeek.length * 2);
  });

  it("offers the same times whatever lengths exist: each length gets its own layout", () => {
    const fifteen = times(openStarts({ ...base, weekly: TUESDAY_EVENING, lengthMinutes: 15 }));
    expect(fifteen.slice(0, 3)).toEqual(["2026-11-03T23:00", "2026-11-03T23:20", "2026-11-03T23:40"]);
    const sixty = times(openStarts({ ...base, weekly: TUESDAY_EVENING, lengthMinutes: 60 }));
    expect(sixty).toEqual(["2026-11-03T23:00", "2026-11-04T00:05"]);
  });

  it("offers the hour that happens twice only the first time round", () => {
    // Sunday 1 November 2026 in New York: 1:00 to 2:00 happens twice (05:00Z and 06:00Z).
    const weekly: WeeklyRange[] = [{ weekday: 7, startMinute: 0, endMinute: 180 }];
    const now = at("2026-10-31T14:00:00Z");
    const open = times(openStarts({ ...base, weekly, now, earliestStart: now, breakMinutes: 30, lengthMinutes: 30 }));
    // Laid out an hour apart from midnight: 0:00, 1:00 (first time), then 1:00 again (skipped), then 2:00.
    expect(open).toEqual(["2026-11-01T04:00", "2026-11-01T05:00", "2026-11-01T07:00"]);
  });

  it("gives nothing for a host with no hours", () => {
    expect(openStarts({ ...base, weekly: [] })).toEqual([]);
  });
});

describe("isOpenStart", () => {
  it("accepts only a time the rule itself would offer", () => {
    const input = { ...base, weekly: TUESDAY_EVENING };
    expect(isOpenStart(at("2026-11-03T23:35:00Z"), input)).toBe(true);
    expect(isOpenStart(at("2026-11-03T23:36:00Z"), input)).toBe(false);
    expect(isOpenStart(at("2026-11-03T22:00:00Z"), input)).toBe(false);
  });
});
