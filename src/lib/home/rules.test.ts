import { describe, expect, it } from "vitest";
import { agoWords, callsBeforeWords, countdownWords, dayAfter, dayOf, nextCall, notOver } from "./rules";

const at = (iso: string) => new Date(iso);
const call = (startsAt: string, endsAt: string, more: { cancelledAt?: Date; safetyEndedAt?: Date } = {}) => ({
  startsAt: at(startsAt),
  endsAt: at(endsAt),
  cancelledAt: more.cancelledAt ?? null,
  safetyEndedAt: more.safetyEndedAt ?? null,
});

describe("a call that is not over", () => {
  const one = call("2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z");
  it("is not over long before it, during it, and in its last second", () => {
    expect(notOver(one, at("2025-12-01T00:00:00Z"))).toBe(true);
    expect(notOver(one, at("2026-01-01T09:30:00Z"))).toBe(true);
    expect(notOver(one, at("2026-01-01T09:59:59Z"))).toBe(true);
  });
  it("is over exactly at its booked end", () => {
    expect(notOver(one, at("2026-01-01T10:00:00Z"))).toBe(false);
  });
  it("is over when it was cancelled or ended with a report, whatever the time", () => {
    expect(notOver({ ...one, cancelledAt: at("2025-12-31T00:00:00Z") }, at("2025-12-31T12:00:00Z"))).toBe(false);
    expect(notOver({ ...one, safetyEndedAt: at("2026-01-01T09:10:00Z") }, at("2026-01-01T09:20:00Z"))).toBe(false);
  });
});

describe("the next call", () => {
  const now = at("2026-01-01T08:00:00Z");
  const soon = call("2026-01-01T09:00:00Z", "2026-01-01T09:30:00Z");
  const later = call("2026-01-02T09:00:00Z", "2026-01-02T09:30:00Z");
  it("is the soonest, in whatever order they come", () => {
    expect(nextCall([later, soon], now)).toBe(soon);
    expect(nextCall([soon, later], now)).toBe(soon);
  });
  it("is never a cancelled call, one ended with a report, or one that is over", () => {
    const cancelled = call("2026-01-01T08:30:00Z", "2026-01-01T08:45:00Z", { cancelledAt: now });
    const reported = call("2026-01-01T07:50:00Z", "2026-01-01T08:50:00Z", { safetyEndedAt: now });
    const over = call("2026-01-01T07:00:00Z", "2026-01-01T07:30:00Z");
    expect(nextCall([cancelled, reported, over, later], now)).toBe(later);
  });
  it("is a call that is running now, before one that starts later", () => {
    const running = call("2026-01-01T07:50:00Z", "2026-01-01T08:20:00Z");
    expect(nextCall([soon, running], now)).toBe(running);
  });
  it("is the one that ends first when two start together", () => {
    const short = call("2026-01-01T09:00:00Z", "2026-01-01T09:15:00Z");
    expect(nextCall([soon, short], now)).toBe(short);
  });
  it("is nothing when no call is left", () => {
    expect(nextCall([], now)).toBeNull();
    expect(nextCall([call("2025-01-01T09:00:00Z", "2025-01-01T09:30:00Z")], now)).toBeNull();
  });
});

describe("what the countdown says", () => {
  it("counts whole days from two days on", () => {
    expect(countdownWords(3 * 86_400 + 5 * 3600)).toEqual({ text: "in 3 days", everySecond: false });
    expect(countdownWords(2 * 86_400)).toEqual({ text: "in 2 days", everySecond: false });
  });
  it("adds the hours to one day", () => {
    expect(countdownWords(2 * 86_400 - 1)).toEqual({ text: "in 1 day 23 hours", everySecond: false });
    expect(countdownWords(86_400 + 3600)).toEqual({ text: "in 1 day 1 hour", everySecond: false });
    expect(countdownWords(86_400)).toEqual({ text: "in 1 day", everySecond: false });
  });
  it("says hours and minutes under a day", () => {
    expect(countdownWords(86_400 - 1)).toEqual({ text: "in 23 hours 59 minutes", everySecond: false });
    expect(countdownWords(5 * 3600 + 12 * 60 + 40)).toEqual({ text: "in 5 hours 12 minutes", everySecond: false });
    expect(countdownWords(3600 + 60)).toEqual({ text: "in 1 hour 1 minute", everySecond: false });
    expect(countdownWords(3600)).toEqual({ text: "in 1 hour", everySecond: false });
  });
  it("shows minutes and seconds in the last hour, and moves every second", () => {
    expect(countdownWords(3599)).toEqual({ text: "59:59", everySecond: true });
    expect(countdownWords(754)).toEqual({ text: "12:34", everySecond: true });
    expect(countdownWords(60)).toEqual({ text: "1:00", everySecond: true });
    expect(countdownWords(9.9)).toEqual({ text: "0:09", everySecond: true });
    expect(countdownWords(1)).toEqual({ text: "0:01", everySecond: true });
  });
  it("says nothing at zero and after: the server has the word then", () => {
    expect(countdownWords(0.9)).toBeNull();
    expect(countdownWords(0)).toBeNull();
    expect(countdownWords(-30)).toBeNull();
  });
});

describe("how long ago the booked start was", () => {
  it("is 'just now' in the first minute", () => {
    expect(agoWords(0)).toBe("just now");
    expect(agoWords(59)).toBe("just now");
  });
  it("counts minutes, then hours and minutes", () => {
    expect(agoWords(60)).toBe("1 minute ago");
    expect(agoWords(59 * 60 + 59)).toBe("59 minutes ago");
    expect(agoWords(3600)).toBe("1 hour ago");
    expect(agoWords(359 * 60)).toBe("5 hours 59 minutes ago");
  });
});

describe("days", () => {
  it("are the person's own calendar days", () => {
    // 03:30 UTC on the 2nd is still the evening of the 1st in New York, and already noon in Tokyo.
    expect(dayOf(at("2026-01-02T03:30:00Z"), "America/New_York")).toBe("2026-01-01");
    expect(dayOf(at("2026-01-02T03:30:00Z"), "Asia/Tokyo")).toBe("2026-01-02");
    expect(dayOf(at("2026-01-02T03:30:00Z"), "UTC")).toBe("2026-01-02");
  });
  it("follow each other on the calendar, over a month's and a year's end", () => {
    expect(dayAfter("2026-01-31")).toBe("2026-02-01");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
  });
});

describe("the words for the calls a host has had with a customer before", () => {
  it("says it is the first call when there was none", () => {
    expect(callsBeforeWords(0)).toBe("First call with you");
  });
  it("leads up to one date for one call, and to the last date for several", () => {
    expect(callsBeforeWords(1)).toBe("1 call before, on");
    expect(callsBeforeWords(2)).toBe("2 calls before, the last on");
    expect(callsBeforeWords(14)).toBe("14 calls before, the last on");
  });
});
