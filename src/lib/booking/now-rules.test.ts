import { describe, expect, it } from "vitest";
import { fittingLengths, instantAnswerBy, instantPayBy, instantStart, isAvailableNow, latestInstantStart, NOW } from "./now-rules";

const MINUTE = 60_000;
const now = new Date("2026-11-06T20:00:00Z");
const at = (minutes: number) => new Date(now.getTime() + minutes * MINUTE);

describe("isAvailableNow", () => {
  it("needs both a time that has not run out and a recent sign of life", () => {
    expect(isAvailableNow({ availableUntil: at(30), availableSeenAt: now }, now)).toBe(true);
    expect(isAvailableNow({ availableUntil: at(30), availableSeenAt: new Date(now.getTime() - (NOW.presenceSeconds + 1) * 1000) }, now)).toBe(false);
    expect(isAvailableNow({ availableUntil: now, availableSeenAt: now }, now)).toBe(false);
    expect(isAvailableNow({ availableUntil: at(30), availableSeenAt: null }, now)).toBe(false);
    expect(isAvailableNow({ availableUntil: null, availableSeenAt: now }, now)).toBe(false);
  });
});

describe("fittingLengths", () => {
  const lengths = [15, 30, 60];
  it("offers every length when nothing is coming up", () => {
    expect(fittingLengths({ lengths, breakMinutes: 5, busy: [], now, availableUntil: at(60) })).toEqual([15, 30, 60]);
  });
  it("drops lengths that would run into something the host is taken for, counting the break and the latest start", () => {
    // Latest start is now + 4 minutes. A 30-minute call plus a 5-minute break ends at now + 39.
    const busy = [{ start: at(38), end: at(68) }];
    expect(fittingLengths({ lengths, breakMinutes: 5, busy, now, availableUntil: at(60) })).toEqual([15]);
    expect(fittingLengths({ lengths, breakMinutes: 5, busy: [{ start: at(40), end: at(68) }], now, availableUntil: at(60) })).toEqual([15, 30]);
  });
  it("offers nothing while the host is in something right now", () => {
    expect(fittingLengths({ lengths, breakMinutes: 5, busy: [{ start: at(-10), end: at(2) }], now, availableUntil: at(60) })).toEqual([]);
  });
  it("offers nothing once the call could not start before the availability ends", () => {
    expect(fittingLengths({ lengths, breakMinutes: 5, busy: [], now, availableUntil: at(3) })).toEqual([]);
    expect(fittingLengths({ lengths, breakMinutes: 5, busy: [], now, availableUntil: at(5) })).toEqual([15, 30, 60]);
  });
});

describe("instant deadlines", () => {
  it("are fixed offsets", () => {
    expect(latestInstantStart(now).getTime()).toBe(at(4).getTime());
    expect(instantAnswerBy(now).getTime()).toBe(at(3).getTime());
    expect(instantStart(now).getTime()).toBe(now.getTime() + 60_000);
    expect(instantPayBy(now).getTime()).toBe(at(2).getTime());
  });
});
