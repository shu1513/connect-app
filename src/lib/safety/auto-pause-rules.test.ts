import { describe, expect, it } from "vitest";
import { AUTO_PAUSE, AUTO_PAUSE_WORDS, ratingsPause, ratingsWarn, reportsPause, warnedLongEnough } from "./auto-pause-rules";

describe("when reports pause an account by themselves", () => {
  it("not under 5 different people, whatever share of the customers they are", () => {
    expect(reportsPause({ reporters: 4, people: 4 })).toBe(false);
    expect(reportsPause({ reporters: 0, people: 0 })).toBe(false);
  });
  it("5 different people, when they are at least 1 in 10 of the people the account had paid calls with", () => {
    expect(reportsPause({ reporters: 5, people: 5 })).toBe(true);
    expect(reportsPause({ reporters: 5, people: 12 })).toBe(true);
    expect(reportsPause({ reporters: 5, people: 50 })).toBe(true);
  });
  it("not when they are a smaller share: a busy account is judged against its many customers", () => {
    expect(reportsPause({ reporters: 5, people: 51 })).toBe(false);
    expect(reportsPause({ reporters: 5, people: 600 })).toBe(false);
    expect(reportsPause({ reporters: 59, people: 600 })).toBe(false);
    expect(reportsPause({ reporters: 60, people: 600 })).toBe(true);
  });
});

describe("when ratings pause an account by themselves, and when they only warn", () => {
  it("nothing without an average", () => {
    expect(ratingsPause(null)).toBe(false);
    expect(ratingsWarn(null)).toBe(false);
  });
  it("at the line for a pause at 2.0 or lower from 10 or more people", () => {
    // The counts an average can have: 5, 8, 11, ... people, or 3 fewer of a kind when a group is left out (6, 9, 12, ...).
    expect(ratingsPause({ average: 2.0, count: 11 })).toBe(true);
    expect(ratingsPause({ average: 1.0, count: 12 })).toBe(true);
    expect(ratingsPause({ average: 1.0, count: 9 })).toBe(false);
    expect(ratingsPause({ average: 1.0, count: 8 })).toBe(false);
    expect(ratingsPause({ average: 2.1, count: 50 })).toBe(false);
  });
  it("warned at 2.5 or lower, as long as it is not at the line for a pause", () => {
    expect(ratingsWarn({ average: 2.5, count: 5 })).toBe(true);
    expect(ratingsWarn({ average: 1.0, count: 9 })).toBe(true);
    expect(ratingsWarn({ average: 2.6, count: 5 })).toBe(false);
    expect(ratingsWarn({ average: 2.0, count: 11 })).toBe(false);
  });
  it("a pause for ratings comes no sooner than 14 days after the warning, and never without one", () => {
    const now = new Date("2026-12-20T12:00:00Z");
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3_600_000);
    expect(warnedLongEnough(null, now)).toBe(false);
    expect(warnedLongEnough(daysAgo(13.9), now)).toBe(false);
    expect(warnedLongEnough(daysAgo(AUTO_PAUSE.warnDays), now)).toBe(true);
    expect(warnedLongEnough(daysAgo(40), now)).toBe(true);
  });
});

describe("what a person paused by the app is told", () => {
  it("the rule and that the app did it by itself: never who, never how many, never a number of their own", () => {
    for (const text of [AUTO_PAUSE_WORDS.reports.reason, AUTO_PAUSE_WORDS.reports.because]) {
      expect(text).toContain("several different people");
      expect(text).not.toMatch(/\d/);
    }
    expect(AUTO_PAUSE_WORDS.reports.because).toContain("Nobody at Connect has judged those reports");
    expect(AUTO_PAUSE_WORDS.ratings.reason("host")).toBe("Paused automatically: an average rating as a host of 2.0 or lower from 10 or more people, counting paid calls only.");
    expect(AUTO_PAUSE_WORDS.ratings.because("customer")).toContain("as a customer, counting paid calls only, is 2.0 or lower from 10 or more people");
  });
  it("the warning names the two lines and the days, and neither their average nor any rating", () => {
    const text = AUTO_PAUSE_WORDS.ratings.warnText("Hana", "host", "help@example.com");
    expect(text).toContain("Your average rating as a host on Connect, counting paid calls only, is 2.5 or lower.");
    expect(text).toContain("2.0 or lower from 10 or more people is paused automatically, no sooner than 14 days from now");
    expect(text).toContain("help@example.com");
  });
  it("the founder is given the numbers, and told that the calls are being ended, not that they are", () => {
    const text = AUTO_PAUSE_WORDS.reports.founderText({ name: "Hana", email: "hana@example.com" }, { reporters: 5, people: 12 }, "https://x/admin/reports");
    expect(text).toContain("5 different people who had paid calls with them reported them in the last 90 days, out of 12 people");
    expect(text).toContain("are being ended");
    expect(AUTO_PAUSE_WORDS.ratings.founderText({ name: "Hana", email: "hana@example.com" }, "host", { average: 1.3, count: 11 }, "https://x")).toContain("is 1.3 from 11 people. They were warned by email at least 14 days ago.");
  });
});
