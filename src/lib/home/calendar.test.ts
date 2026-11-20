import { describe, expect, it } from "vitest";
import { addDays, daysInView, dayToMoveTo, hoursToDraw, inLanes, minuteOfDay, parseDay, segmentsOf, viewRange, weekdayOf, weekStartFrom } from "./calendar";
import { dayOf } from "./rules";

const at = (iso: string) => new Date(iso);
const call = (startsAt: string, endsAt: string) => ({ startsAt: at(startsAt), endsAt: at(endsAt) });
const LA = "America/Los_Angeles";

describe("the day in the address", () => {
  it("is read when it is a real day", () => {
    expect(parseDay("2026-11-23")).toBe("2026-11-23");
    expect(parseDay("2028-02-29")).toBe("2028-02-29");
  });
  it("is nothing for anything else", () => {
    for (const bad of ["", "today", "2026-2-3", "2026-02-31", "2026-13-01", "1999-01-01", "2026-11-23T00:00", " 2026-11-23", null, undefined, 20261123, ["2026-11-23"]]) expect(parseDay(bad)).toBeNull();
  });
});

describe("days", () => {
  it("are counted on the calendar, over the end of a month and a year", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-11-19", 7)).toBe("2026-11-26");
  });
  it("know their day of the week", () => {
    expect(weekdayOf("2026-11-19")).toBe(4); // a Thursday
    expect(weekdayOf("2026-11-15")).toBe(0);
  });
});

describe("the days in view", () => {
  it("are the week that holds the day, from Sunday or from Monday", () => {
    expect(daysInView("2026-11-19", 7, 0)).toEqual(["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
    expect(daysInView("2026-11-19", 7, 1)[0]).toBe("2026-11-16");
    expect(daysInView("2026-11-15", 7, 1)[0]).toBe("2026-11-09"); // a Sunday ends a week that starts on Monday
    expect(daysInView("2026-11-15", 7, 0)[0]).toBe("2026-11-15");
    expect(daysInView("2026-11-14", 7, 6)[0]).toBe("2026-11-14"); // a week that starts on Saturday
  });
  it("are the day and the two after it on a narrow screen", () => {
    expect(daysInView("2026-11-30", 3, 0)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
  });
  it("move by as many days as are shown", () => {
    expect(dayToMoveTo("2026-11-19", 7, 1)).toBe("2026-11-26");
    expect(dayToMoveTo("2026-11-19", 7, -1)).toBe("2026-11-12");
    expect(dayToMoveTo("2026-11-19", 3, 1)).toBe("2026-11-22");
    expect(dayToMoveTo("2026-11-19", 3, -1)).toBe("2026-11-16");
  });
  it("start on the day the browser names, or on Sunday", () => {
    expect(weekStartFrom(1)).toBe(1);
    expect(weekStartFrom(7)).toBe(0);
    expect(weekStartFrom(6)).toBe(6);
    for (const unknown of [undefined, null, 0, 8, 1.5, "1"]) expect(weekStartFrom(unknown)).toBe(0);
  });
});

describe("what the server loads", () => {
  it("holds every day that can be in view, in every time zone, for a day asked for", () => {
    const { from, to } = viewRange("2026-11-19", at("2026-01-01T00:00:00Z"));
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC", LA]) {
      for (const start of [0, 1, 6]) {
        const days = daysInView("2026-11-19", 7, start);
        // The first moment of the first day and the last of the last, in that zone, lie inside.
        expect(dayOf(from, zone) < days[0]).toBe(true);
        expect(dayOf(to, zone) > days[6]).toBe(true);
      }
    }
  });
  it("is around now when no day is asked for, wherever the viewer's today is", () => {
    const now = at("2026-11-19T23:30:00Z");
    const { from, to } = viewRange(null, now);
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const days = daysInView(dayOf(now, zone), 7, 1);
      expect(dayOf(from, zone) < days[0]).toBe(true);
      expect(dayOf(to, zone) > days[6]).toBe(true);
    }
  });
});

describe("where a call sits", () => {
  it("is at its own time in the viewer's time zone", () => {
    expect(minuteOfDay(at("2026-11-19T20:00:00Z"), LA)).toBe(12 * 60);
    expect(minuteOfDay(at("2026-11-19T08:00:00Z"), LA)).toBe(0);
    const [one] = segmentsOf([call("2026-11-19T20:00:00Z", "2026-11-19T20:30:00Z")], ["2026-11-19"], LA);
    expect(one).toMatchObject({ day: "2026-11-19", from: 720, to: 750 });
  });
  it("is on the day it starts on there, not on the world's clock", () => {
    // 11 PM on the 18th in Los Angeles is the 19th on the world's clock.
    const late = call("2026-11-19T07:00:00Z", "2026-11-19T07:30:00Z");
    expect(segmentsOf([late], ["2026-11-19"], LA)).toEqual([]);
    expect(segmentsOf([late], ["2026-11-18"], LA)[0]).toMatchObject({ from: 23 * 60, to: 23 * 60 + 30 });
  });
  it("has a part in both days when it runs past midnight", () => {
    const over = call("2026-11-19T07:45:00Z", "2026-11-19T08:15:00Z"); // 11:45 PM to 12:15 AM
    const parts = segmentsOf([over], ["2026-11-18", "2026-11-19", "2026-11-20"], LA);
    expect(parts.map((p) => [p.day, p.from, p.to])).toEqual([
      ["2026-11-18", 1425, 1440],
      ["2026-11-19", 0, 15],
    ]);
  });
  it("has no part in the day that begins when it ends", () => {
    const untilMidnight = call("2026-11-19T07:30:00Z", "2026-11-19T08:00:00Z");
    expect(segmentsOf([untilMidnight], ["2026-11-18", "2026-11-19"], LA).map((p) => [p.day, p.from, p.to])).toEqual([["2026-11-18", 1410, 1440]]);
  });
  it("keeps its length in the hour that comes twice when the clocks go back", () => {
    // 1 November 2026, Los Angeles: 1:50 AM (summer time) to 1:10 AM (winter time), 20 minutes.
    const [one] = segmentsOf([call("2026-11-01T08:50:00Z", "2026-11-01T09:10:00Z")], ["2026-11-01"], LA);
    expect(one).toMatchObject({ from: 110, to: 130 });
  });
  it("is left out of days that are not in view", () => {
    expect(segmentsOf([call("2026-11-25T20:00:00Z", "2026-11-25T20:30:00Z")], ["2026-11-19", "2026-11-20"], LA)).toEqual([]);
  });
});

describe("the hours drawn", () => {
  it("are 9 to 6 with nothing earlier or later", () => {
    expect(hoursToDraw([])).toEqual({ from: 9, to: 18 });
    expect(hoursToDraw([{ from: 600, to: 630 }])).toEqual({ from: 9, to: 18 });
  });
  it("stretch for an early or a late call, with room for the shortest drawing", () => {
    expect(hoursToDraw([{ from: 390, to: 420 }])).toEqual({ from: 6, to: 18 });
    expect(hoursToDraw([{ from: 1290, to: 1320 }])).toEqual({ from: 9, to: 22 });
    expect(hoursToDraw([{ from: 1075, to: 1080 }])).toEqual({ from: 9, to: 19 });
    expect(hoursToDraw([{ from: 0, to: 1440 }])).toEqual({ from: 0, to: 24 });
  });
});

describe("calls side by side", () => {
  it("keep the whole width when they do not touch", () => {
    const placed = inLanes([
      { from: 600, to: 630 },
      { from: 630, to: 660 },
    ]);
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
  it("share the width when the shortest drawing of one would cover the next", () => {
    // Two calls of five minutes, five minutes apart: each is drawn fifteen minutes tall.
    const placed = inLanes([
      { from: 600, to: 605 },
      { from: 610, to: 615 },
      { from: 620, to: 625 },
    ]);
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ]);
  });
  it("settle each group on its own", () => {
    const placed = inLanes([
      { from: 600, to: 605 },
      { from: 605, to: 610 },
      { from: 606, to: 611 },
      { from: 900, to: 930 },
    ]);
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [0, 1],
    ]);
  });
});
