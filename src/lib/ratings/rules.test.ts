import { describe, expect, it } from "vitest";
import { averageText, countedUpTo, rateState, ratingDeadline, shownAverage, validStars, type CountedRating } from "./rules";

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
  it("a call's ratings count from the very moment it can no longer be rated", () => {
    const deadline = ratingDeadline(endsAt);
    expect(endsAt <= countedUpTo(deadline)).toBe(true);
    expect(endsAt <= countedUpTo(new Date(deadline.getTime() - 1))).toBe(false);
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

/** Ratings in the order their calls ended: "a5" is 5 stars from person a; a capital letter is a closed account. */
const from = (...list: string[]): CountedRating[] => list.map((r) => ({ raterId: r[0].toLowerCase(), stars: Number(r.slice(1)), raterClosed: r[0] !== r[0].toLowerCase() }));

describe("what an average may show", () => {
  it("nothing until 3 different people's ratings count", () => {
    expect(shownAverage([])).toBeNull();
    expect(shownAverage(from("a5", "b5"))).toBeNull();
    expect(shownAverage(from("a5", "b4", "c3"))).toEqual({ average: 4, count: 3 });
  });
  it("each person counts once, with their first rating", () => {
    expect(shownAverage(from("a5", "a5", "a5", "a5"))).toBeNull();
    // Three from one regular, then two others: never an average made of the regular's ratings alone.
    expect(shownAverage(from("a1", "a5", "a5", "b5", "c5"))).toEqual({ average: 3.7, count: 3 });
    // A second group must be three new people too.
    expect(shownAverage(from("a5", "b5", "c5", "a1", "b1", "c1"))).toEqual({ average: 5, count: 3 });
  });
  it("moves only a whole group of 3 people at a time", () => {
    const three = shownAverage(from("a5", "b5", "c5"));
    expect(shownAverage(from("a5", "b5", "c5", "d1"))).toEqual(three);
    expect(shownAverage(from("a5", "b5", "c5", "d1", "e1"))).toEqual(three);
    expect(shownAverage(from("a5", "b5", "c5", "d1", "e1", "f1"))).toEqual({ average: 3, count: 6 });
  });
  it("a closed account takes its whole group out, and the group is never refilled", () => {
    // Without this, closing a would turn "5.0 from 3" into the average of b, c and d, and give d's rating away.
    expect(shownAverage(from("A5", "b5", "c5", "d1"))).toBeNull();
    expect(shownAverage(from("A5", "b5", "c5", "d1", "e1", "f1"))).toEqual({ average: 1, count: 3 });
    expect(shownAverage(from("a5", "b5", "c5", "D1", "e1", "f1"))).toEqual({ average: 5, count: 3 });
    // A closed account whose rating is not in a whole group yet changes nothing.
    expect(shownAverage(from("a5", "b5", "c5", "D1"))).toEqual({ average: 5, count: 3 });
  });
  it("is rounded to one decimal", () => {
    expect(shownAverage(from("a5", "b5", "c4"))).toEqual({ average: 4.7, count: 3 });
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
