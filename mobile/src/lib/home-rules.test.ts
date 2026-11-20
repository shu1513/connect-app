import type { AppAsk, AppCall, AppHome } from "../../../src/lib/app-door/types";
import { calendarView, clockWords, isHome, placeOf, ratingWords } from "./home-rules";

const call = (id: string, startsAt: string, minutes: number, more: Partial<AppCall> = {}): AppCall => ({
  id,
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
  minutes,
  name: "Ada Lovelace",
  photoId: null,
  hosting: false,
  open: false,
  finished: false,
  payment: "$40.00, charged after the call",
  ...more,
});

const home: AppHome = {
  serverNow: "2026-11-20T18:00:00.000Z",
  firstName: "Ada",
  hosting: null,
  calls: [],
  next: null,
  noCall: "You have no call coming up. Find a host to ask for one.",
  calendar: { shown: false, day: null, asks: [], cut: false, most: 500 },
  toAnswer: { count: 0, times: 0, shown: [] },
  toRate: [],
  requests: [],
  followed: { total: 0, hosts: [] },
  suggested: null,
  takeCalls: true,
  refreshSeconds: 60,
};

describe("the server's answer for the home page", () => {
  it("is taken when it has what the screen reads", () => {
    expect(isHome(home)).toBe(true);
    expect(isHome({ ...home, calls: [call("c1", "2026-11-20T20:00:00.000Z", 30)], next: { id: "c1", opensAt: "2026-11-20T19:50:00.000Z", notPaid: false }, noCall: null })).toBe(true);
    expect(
      isHome({
        ...home,
        hosting: { page: "ada" },
        calls: [call("c1", "2026-11-20T20:00:00.000Z", 30, { hosting: true, about: { words: "", idConfirmed: true, member: false, callsBefore: 2, lastCallAt: "2026-11-01T20:00:00.000Z", note: null } })],
        calendar: { shown: true, day: "2026-11-20", asks: [{ startsAt: "2026-11-21T20:00:00.000Z", endsAt: "2026-11-21T20:30:00.000Z", count: 2 }], cut: false, most: 500 },
        toAnswer: { count: 1, times: 1, shown: [{ id: "b1", startsAt: "2026-11-21T20:00:00.000Z", endsAt: "2026-11-21T20:30:00.000Z", minutes: 30, price: "free", name: "Ben", respondBy: null }] },
        followed: { total: 1, hosts: [{ name: "Maya", handle: null, available: false, photoId: null }] },
        suggested: { day: "2026-11-20", made: true, shownFirst: 3, why: "…", hosts: [{ place: 1, handle: "maya", name: "Maya", price: "Free calls", languages: ["English"], seen: false, rating: { average: 4.8, count: 21 }, photoId: null, availableNow: false, nextOpen: null }] },
      }),
    ).toBe(true);
  });

  it("is not taken when a part is missing or is not what it should be", () => {
    for (const bad of [
      {},
      null,
      [],
      { ...home, serverNow: "soon" },
      { ...home, calls: [{ id: "c1" }] },
      { ...home, calls: undefined },
      { ...home, next: { id: "c1" } },
      { ...home, calendar: undefined },
      { ...home, toAnswer: { count: "2", shown: [] } },
      { ...home, followed: { total: 1 } },
      { ...home, suggested: { day: "2026-11-20" } },
      { ...home, takeCalls: "yes" },
      // Inside the lists too: a part the screen reads that is not there would break the screen, not show an error.
      { ...home, calendar: { ...home.calendar, day: 5 } },
      { ...home, calendar: { ...home.calendar, asks: [{ startsAt: "2026-11-20T20:00:00.000Z" }] } },
      { ...home, calls: [{ ...call("c1", "2026-11-20T20:00:00.000Z", 30), about: { words: "hello" } }] },
      { ...home, toAnswer: { count: 1, times: 1, shown: [{ id: "b1" }] } },
      { ...home, followed: { total: 1, hosts: [{ name: "Maya" }] } },
      { ...home, suggested: { day: "2026-11-20", made: true, shownFirst: 3, why: "…", hosts: [{ place: 1, handle: "maya", name: "Maya", price: "Free calls", seen: false, rating: null, photoId: null, availableNow: false, nextOpen: null }] } },
      { ...home, hosting: { page: 7 } },
    ]) {
      expect(isHome(bad)).toBe(false);
    }
  });
});

describe("the calendar, laid out in the phone's own time zone", () => {
  const serverNow = "2026-11-20T18:00:00.000Z";

  it("shows three days from today, by the phone's clock, whatever the server's is", () => {
    // 18:00 on the world's clock is still the 20th in Los Angeles, and already the 21st in Tokyo.
    expect(calendarView({ calls: [], asks: [], day: null, serverNow, zone: "America/Los_Angeles" }).days).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(calendarView({ calls: [], asks: [], day: null, serverNow, zone: "Asia/Tokyo" }).days).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(calendarView({ calls: [], asks: [], day: "2026-12-01", serverNow, zone: "Asia/Tokyo" }).days).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
  });

  it("puts one call under different days for two phones in different zones", () => {
    // 03:00 on the world's clock on the 21st: the evening of the 20th in Los Angeles, noon of the 21st in Tokyo.
    const one = call("c1", "2026-11-21T03:00:00.000Z", 30);
    const la = calendarView({ calls: [one], asks: [], day: null, serverNow, zone: "America/Los_Angeles" });
    const tokyo = calendarView({ calls: [one], asks: [], day: null, serverNow, zone: "Asia/Tokyo" });
    expect(la.pieces.map((p) => [p.day, p.from, p.to])).toEqual([["2026-11-20", 19 * 60, 19 * 60 + 30]]);
    expect(tokyo.pieces.map((p) => [p.day, p.from, p.to])).toEqual([["2026-11-21", 12 * 60, 12 * 60 + 30]]);
  });

  it("draws a call across midnight in both days, and lists it under the first", () => {
    // 23:45 to 00:45 in Los Angeles.
    const late = call("late", "2026-11-21T07:45:00.000Z", 60);
    const view = calendarView({ calls: [late], asks: [], day: null, serverNow, zone: "America/Los_Angeles" });
    expect(view.pieces.map((p) => [p.day, p.from, p.to])).toEqual([
      ["2026-11-20", 23 * 60 + 45, 24 * 60],
      ["2026-11-21", 0, 45],
    ]);
    expect(view.firstDayOf.get("late")).toBe("2026-11-20");
    expect(view.inView.map((c) => c.id)).toEqual(["late"]);
    // The hours drawn stretch to hold it: from midnight to midnight.
    expect(view.hours).toEqual({ from: 0, to: 24 });
  });

  it("stands a call and a time asked for side by side when they would cover each other", () => {
    const one = call("c1", "2026-11-20T21:00:00.000Z", 30, { hosting: true });
    const ask: AppAsk = { startsAt: "2026-11-20T21:00:00.000Z", endsAt: "2026-11-20T21:30:00.000Z", count: 2 };
    const view = calendarView({ calls: [one], asks: [ask], day: null, serverNow, zone: "America/Los_Angeles" });
    expect(view.pieces).toHaveLength(2);
    expect(view.pieces.every((p) => p.lanes === 2)).toBe(true);
    expect(new Set(view.pieces.map((p) => p.lane)).size).toBe(2);
    expect(view.pieces.find((p) => p.ask)?.ask?.count).toBe(2);
  });

  it("leaves out a call that has no part in the days in view", () => {
    const far = call("far", "2026-12-24T20:00:00.000Z", 30);
    const view = calendarView({ calls: [far], asks: [], day: null, serverNow, zone: "America/Los_Angeles" });
    expect(view.pieces).toEqual([]);
    expect(view.inView).toEqual([]);
  });

  it("marks 'now' in today's column only when today and this hour are drawn", () => {
    // 10:00 in Los Angeles: inside the hours always drawn (9 to 18).
    expect(calendarView({ calls: [], asks: [], day: null, serverNow, zone: "America/Los_Angeles" }).nowMinute).toBe(10 * 60);
    // Another day in view: no line.
    expect(calendarView({ calls: [], asks: [], day: "2026-12-01", serverNow, zone: "America/Los_Angeles" }).nowMinute).toBeNull();
    // 03:00 in Tokyo: before the first hour drawn.
    expect(calendarView({ calls: [], asks: [], day: null, serverNow, zone: "Asia/Tokyo" }).nowMinute).toBeNull();
  });

  it("adds up what the calls she hosted in these days earned, and nothing else", () => {
    const earned = call("e1", "2026-11-20T17:00:00.000Z", 30, { hosting: true, finished: true, earned: { text: "$37.74", cents: 3774, soFar: false } });
    const booked = call("b1", "2026-11-20T16:00:00.000Z", 30, { finished: true });
    const view = calendarView({ calls: [earned, booked], asks: [], day: null, serverNow, zone: "America/Los_Angeles" });
    expect(view.total).toEqual({ calls: 1, cents: 3774, soFar: false });
    expect(calendarView({ calls: [booked], asks: [], day: null, serverNow, zone: "America/Los_Angeles" }).total).toBeNull();
  });

  it("places a piece by its minutes, never shorter than the least a call is drawn", () => {
    expect(placeOf({ from: 10 * 60, to: 10 * 60 + 30 }, { from: 9 })).toEqual({ top: 60, height: 29 });
    expect(placeOf({ from: 9 * 60, to: 9 * 60 + 5 }, { from: 9 })).toEqual({ top: 0, height: 14 });
  });
});

describe("small words", () => {
  it("writes a running clock", () => {
    expect(clockWords(272)).toBe("4:32");
    expect(clockWords(3872)).toBe("1:04:32");
    expect(clockWords(-5)).toBe("0:00");
  });

  it("writes an average as the website does", () => {
    expect(ratingWords({ average: 4.8, count: 21 }, "New on Connect")).toBe("★ 4.8 from 21 ratings");
    expect(ratingWords(null, "New on Connect")).toBe("New on Connect");
  });
});
