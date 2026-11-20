import { describe, expect, it } from "vitest";
import { afterEach, beforeEach } from "vitest";
import { FOLLOW, followEmailsAddress, followEmailsOn, followsAfterCall, inListOrder, insideHours, minuteOfDay, readHours, type AfterCallFacts } from "./rules";

const good: AfterCallFacts = {
  source: "customer",
  cancelled: false,
  safetyEnded: false,
  recordComplete: true,
  togetherSeconds: 600,
  customerReported: false,
  customerBlocked: false,
  refundAsked: false,
  hostPageOpen: true,
  eitherClosedOrPaused: false,
  hasLine: false,
  following: 0,
};

describe("followsAfterCall", () => {
  it("follows after a call that took place and went well", () => {
    expect(followsAfterCall(good)).toBe(true);
    expect(followsAfterCall({ ...good, source: "now" })).toBe(true);
    expect(followsAfterCall({ ...good, source: "member" })).toBe(true);
  });

  it("never after a call made by a check script, or one with no booking", () => {
    expect(followsAfterCall({ ...good, source: "admin" })).toBe(false);
    expect(followsAfterCall({ ...good, source: null })).toBe(false);
  });

  it("needs the two together for at least two minutes, by a complete record", () => {
    expect(followsAfterCall({ ...good, togetherSeconds: FOLLOW.minTogetherSeconds })).toBe(true);
    expect(followsAfterCall({ ...good, togetherSeconds: FOLLOW.minTogetherSeconds - 1 })).toBe(false);
    expect(followsAfterCall({ ...good, togetherSeconds: null })).toBe(false);
    expect(followsAfterCall({ ...good, recordComplete: false })).toBe(false);
    expect(followsAfterCall({ ...good, cancelled: true })).toBe(false);
  });

  it.each(["safetyEnded", "customerReported", "customerBlocked", "refundAsked", "eitherClosedOrPaused", "hasLine"] as const)("never when %s", (fact) => {
    expect(followsAfterCall({ ...good, [fact]: true })).toBe(false);
  });

  it("never for a host whose page is not open to everyone", () => {
    expect(followsAfterCall({ ...good, hostPageOpen: false })).toBe(false);
  });

  it("never pushes anyone over the limit", () => {
    expect(followsAfterCall({ ...good, following: FOLLOW.limit - 1 })).toBe(true);
    expect(followsAfterCall({ ...good, following: FOLLOW.limit })).toBe(false);
  });
});

describe("inListOrder", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 19, 12, minutes));
  const host = (name: string, available = false, nextCallAt: Date | null = null) => ({ name, available, nextCallAt });

  it("puts the available first, then those with a call coming up, then the rest", () => {
    const sorted = inListOrder([host("Zed"), host("Cara", false, at(30)), host("Bea", true), host("Abe")]);
    expect(sorted.map((h) => h.name)).toEqual(["Bea", "Cara", "Abe", "Zed"]);
  });

  it("orders calls coming up by the soonest, and everything else by name", () => {
    const sorted = inListOrder([host("Ann", false, at(50)), host("bob", false, at(10)), host("Dee", true, at(5)), host("cy", true)]);
    expect(sorted.map((h) => h.name)).toEqual(["cy", "Dee", "bob", "Ann"]);
    expect(inListOrder([host("b"), host("A"), host("c")]).map((h) => h.name)).toEqual(["A", "b", "c"]);
  });

  it("does not change the list it was given", () => {
    const given = [host("b"), host("a")];
    inListOrder(given);
    expect(given.map((h) => h.name)).toEqual(["b", "a"]);
  });
});

describe("insideHours", () => {
  const utc = (hour: number, minute = 0, day = 19, month = 10) => new Date(Date.UTC(2026, month, day, hour, minute));

  it("is always true without hours", () => {
    expect(insideHours(utc(3), "America/New_York", null, null)).toBe(true);
  });

  it("reads the moment in the follower's own time zone", () => {
    // 23:30 UTC on 19 November is 18:30 in New York and 00:30 the next day in Berlin.
    expect(minuteOfDay(utc(23, 30), "America/New_York")).toBe(18 * 60 + 30);
    expect(minuteOfDay(utc(23, 30), "Europe/Berlin")).toBe(30);
    expect(insideHours(utc(23, 30), "America/New_York", 18 * 60, 22 * 60)).toBe(true);
    expect(insideHours(utc(23, 30), "Europe/Berlin", 18 * 60, 22 * 60)).toBe(false);
  });

  it("includes the first minute and leaves out the last", () => {
    expect(insideHours(utc(23, 0), "America/New_York", 18 * 60, 22 * 60)).toBe(true); // 18:00
    expect(insideHours(utc(22, 59), "America/New_York", 18 * 60, 22 * 60)).toBe(false); // 17:59
    expect(insideHours(utc(2, 59, 20), "America/New_York", 18 * 60, 22 * 60)).toBe(true); // 21:59
    expect(insideHours(utc(3, 0, 20), "America/New_York", 18 * 60, 22 * 60)).toBe(false); // 22:00
  });

  it("runs past midnight", () => {
    const [from, to] = [22 * 60, 2 * 60];
    expect(insideHours(utc(4, 0, 20), "America/New_York", from, to)).toBe(true); // 23:00
    expect(insideHours(utc(6, 30, 20), "America/New_York", from, to)).toBe(true); // 01:30
    expect(insideHours(utc(7, 0, 20), "America/New_York", from, to)).toBe(false); // 02:00
    expect(insideHours(utc(20, 0), "America/New_York", from, to)).toBe(false); // 15:00
  });

  it("follows the clocks when they change", () => {
    // New York leaves summer time on 1 November 2026: 05:30 UTC is 01:30, and 06:30 UTC is 01:30 again.
    expect(minuteOfDay(new Date(Date.UTC(2026, 10, 1, 5, 30)), "America/New_York")).toBe(90);
    expect(minuteOfDay(new Date(Date.UTC(2026, 10, 1, 6, 30)), "America/New_York")).toBe(90);
    // And enters it on 8 March 2026: 06:30 UTC is 01:30, 07:30 UTC is 03:30.
    expect(minuteOfDay(new Date(Date.UTC(2026, 2, 8, 7, 30)), "America/New_York")).toBe(3 * 60 + 30);
  });

  it("treats someone without a time zone as New York", () => {
    expect(minuteOfDay(utc(23, 30), null)).toBe(18 * 60 + 30);
  });
});

describe("readHours", () => {
  it("reads whole hours, and nothing for any time", () => {
    expect(readHours("", "")).toBeNull();
    expect(readHours("18", "22")).toEqual({ from: 1080, to: 1320 });
    expect(readHours("22", "2")).toEqual({ from: 1320, to: 120 });
    expect(readHours("0", "23")).toEqual({ from: 0, to: 1380 });
  });

  it("refuses half a choice, the same hour twice, and anything that is not an hour", () => {
    for (const [from, to] of [["18", ""], ["", "22"], ["18", "18"], ["24", "2"], ["-1", "2"], ["1.5", "2"], ["x", "2"]]) expect(readHours(from, to)).toBe(false);
  });
});

describe("the switch for emails to followers", () => {
  const before = process.env.FOLLOW_EMAILS_ADDRESS;
  beforeEach(() => delete process.env.FOLLOW_EMAILS_ADDRESS);
  afterEach(() => {
    if (before === undefined) delete process.env.FOLLOW_EMAILS_ADDRESS;
    else process.env.FOLLOW_EMAILS_ADDRESS = before;
  });

  it("is off without a postal address, and for one that is only spaces", () => {
    expect(followEmailsOn()).toBe(false);
    process.env.FOLLOW_EMAILS_ADDRESS = "   ";
    expect(followEmailsOn()).toBe(false);
  });

  it("is on with one, which is tidied to a single line", () => {
    process.env.FOLLOW_EMAILS_ADDRESS = " Connect Inc.\n1 Main Street,  Springfield ";
    expect(followEmailsOn()).toBe(true);
    expect(followEmailsAddress()).toBe("Connect Inc. 1 Main Street, Springfield");
  });
});
