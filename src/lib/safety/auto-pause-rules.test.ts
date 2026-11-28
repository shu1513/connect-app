import { describe, expect, it } from "vitest";
import { AUTO_PAUSE, AUTO_PAUSE_WORDS, ratingsPause, ratingsWarn, reportsPause } from "./auto-pause-rules";

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
  it("paused at 2.0 or lower from 10 or more people", () => {
    expect(ratingsPause({ average: 2.0, count: 11 })).toBe(true);
    expect(ratingsPause({ average: 1.0, count: 10 })).toBe(true);
    expect(ratingsPause({ average: 2.1, count: 50 })).toBe(false);
    expect(ratingsPause({ average: 1.0, count: 8 })).toBe(false);
  });
  it("warned at 2.5 or lower, as long as it is not a pause", () => {
    expect(ratingsWarn({ average: 2.5, count: 5 })).toBe(true);
    expect(ratingsWarn({ average: 1.0, count: 8 })).toBe(true);
    expect(ratingsWarn({ average: 2.6, count: 5 })).toBe(false);
    expect(ratingsWarn({ average: 2.0, count: 11 })).toBe(false);
  });
});

describe("what a person paused by the app is told", () => {
  it("the rule and that the app did it by itself, never who or how many reported", () => {
    expect(AUTO_PAUSE_WORDS.reports.reason).toBe(`Paused automatically: ${AUTO_PAUSE.reporters} or more different people who had paid calls with this account reported it within ${AUTO_PAUSE.withinDays} days.`);
    expect(AUTO_PAUSE_WORDS.reports.because).toContain("Nobody at Connect has judged those reports");
    expect(AUTO_PAUSE_WORDS.ratings.reason("host", { average: 1.8, count: 11 })).toBe("Paused automatically: an average rating as a host of 1.8 from 11 people. The line is 2.0 or lower from 10 or more people.");
    expect(AUTO_PAUSE_WORDS.ratings.because("customer", { average: 2, count: 14 })).toContain("as a customer is 2.0 from 14 people");
  });
  it("the warning names the average and the line, and no particular rating", () => {
    const text = AUTO_PAUSE_WORDS.ratings.warnText("Hana", "host", { average: 2.4, count: 5 }, "help@example.com");
    expect(text).toContain("Your average rating as a host on Connect is 2.4 from 5 people.");
    expect(text).toContain("2.0 or lower from 10 or more people is paused automatically");
    expect(text).toContain("help@example.com");
  });
});
