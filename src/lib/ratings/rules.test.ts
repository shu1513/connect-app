import { describe, expect, it } from "vitest";
import { averageText, rateState, ratingDeadline, shownAverage, validStars } from "./rules";

const endsAt = new Date("2026-11-10T20:00:00Z");
const after = (minutes: number) => new Date(endsAt.getTime() + minutes * 60_000);
const good = { source: "customer", cancelled: false, safetyEnded: false, roomClosed: true, record: "complete" as const, togetherSeconds: 600, endsAt, now: after(5) };

describe("which calls can be rated, and when", () => {
  it("a call that really happened can be rated once its record is final", () => {
    expect(rateState(good)).toBe("open");
    expect(rateState({ ...good, source: "now" })).toBe("open");
  });
  it("not before the room is confirmed closed and the record is final", () => {
    expect(rateState({ ...good, roomClosed: false })).toBe("not_yet");
    expect(rateState({ ...good, record: "in_progress", togetherSeconds: null })).toBe("not_yet");
  });
  it("for 7 days after the booked end, and not a moment longer", () => {
    expect(rateState({ ...good, now: new Date(ratingDeadline(endsAt).getTime() - 1) })).toBe("open");
    expect(rateState({ ...good, now: ratingDeadline(endsAt) })).toBe("too_late");
  });
  it("never a cancelled call, one ended with End call and report, or a test call", () => {
    expect(rateState({ ...good, cancelled: true })).toBe("never");
    expect(rateState({ ...good, safetyEnded: true })).toBe("never");
    expect(rateState({ ...good, source: "admin" })).toBe("never");
    expect(rateState({ ...good, source: null })).toBe("never");
  });
  it("never a call whose record needs review, or where the two were together under 2 minutes", () => {
    expect(rateState({ ...good, record: "needs_review", togetherSeconds: null })).toBe("never");
    expect(rateState({ ...good, togetherSeconds: 119 })).toBe("never");
    expect(rateState({ ...good, togetherSeconds: 0 })).toBe("never");
    expect(rateState({ ...good, togetherSeconds: 120 })).toBe("open");
  });
});

describe("what an average may show", () => {
  it("nothing until ratings from 3 different people count", () => {
    expect(shownAverage([], 0)).toBeNull();
    expect(shownAverage([5, 5], 2)).toBeNull();
    expect(shownAverage([5, 5, 5, 5], 2)).toBeNull(); // four ratings, but from two people
    expect(shownAverage([5, 4, 3], 3)).toEqual({ average: 4, count: 3 });
  });
  it("moves only in steps of 3, so one new rating never changes what is shown", () => {
    const three = shownAverage([5, 5, 5], 3);
    expect(shownAverage([5, 5, 5, 1], 4)).toEqual(three);
    expect(shownAverage([5, 5, 5, 1, 1], 5)).toEqual(three);
    expect(shownAverage([5, 5, 5, 1, 1, 1], 6)).toEqual({ average: 3, count: 6 });
  });
  it("is rounded to one decimal", () => {
    expect(shownAverage([5, 5, 4], 3)).toEqual({ average: 4.7, count: 3 });
  });
  it("is written out plainly", () => {
    expect(averageText(null)).toBe("New");
    expect(averageText({ average: 5, count: 3 })).toBe("5.0 from 3 ratings");
    expect(averageText({ average: 4.7, count: 21 })).toBe("4.7 from 21 ratings");
  });
});

describe("stars", () => {
  it("are whole numbers from 1 to 5", () => {
    expect([1, 3, 5].every(validStars)).toBe(true);
    expect([0, 6, 2.5, NaN, "5", null, undefined].some(validStars)).toBe(false);
  });
});
