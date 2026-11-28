import { describe, expect, it } from "vitest";
import { averageText, countedUpTo, rateState, ratingDeadline, shownAverage, validStars, type CountedRating } from "./rules";

const endsAt = new Date("2026-11-10T20:00:00Z");
const after = (minutes: number) => new Date(endsAt.getTime() + minutes * 60_000);
const good = { source: "customer", cancelled: false, oldStop: false, roomClosed: true, record: "complete" as const, togetherSeconds: 600, endsAt, now: after(5) };

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
    expect(rateState({ ...good, oldStop: true })).toBe("never");
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
  it("nothing until 5 different people's ratings count", () => {
    expect(shownAverage([])).toBeNull();
    expect(shownAverage(from("a5", "b5"))).toBeNull();
    expect(shownAverage(from("a1", "b1", "c1", "d1"))).toBeNull();
    expect(shownAverage(from("a5", "b4", "c3", "d4", "e4"))).toEqual({ average: 4, count: 5 });
  });
  it("each person counts once, with their first rating", () => {
    expect(shownAverage(from("a5", "a5", "a5", "a5", "a5", "a5"))).toBeNull();
    // a's first rating (1 star) is the one that counts.
    expect(shownAverage(from("a1", "a5", "a5", "b5", "c5", "d5", "e5"))).toEqual({ average: 4.2, count: 5 });
    // A second rating from each of the first five is no new group.
    expect(shownAverage(from("a5", "b5", "c5", "d5", "e5", "a1", "b1", "c1", "d1", "e1"))).toEqual({ average: 5, count: 5 });
  });
  it("after the first 5 it moves only a whole group of 3 people at a time", () => {
    const five = shownAverage(from("a5", "b5", "c5", "d5", "e5"));
    expect(shownAverage(from("a5", "b5", "c5", "d5", "e5", "f1"))).toEqual(five);
    expect(shownAverage(from("a5", "b5", "c5", "d5", "e5", "f1", "g1"))).toEqual(five);
    expect(shownAverage(from("a5", "b5", "c5", "d5", "e5", "f1", "g1", "h1"))).toEqual({ average: 3.5, count: 8 });
  });
  it("a closed account takes its whole group out, and the group is never refilled", () => {
    // Without this, closing a would turn "5.0 from 5" into an average with f in it, and give f's rating away.
    expect(shownAverage(from("A5", "b5", "c5", "d5", "e5", "f1"))).toBeNull();
    // The first five are out; the three that are left are fewer than 5, so nothing is shown.
    expect(shownAverage(from("A5", "b5", "c5", "d5", "e5", "f1", "g1", "h1"))).toBeNull();
    // With two later groups there are 6 people again.
    expect(shownAverage(from("A5", "b5", "c5", "d5", "e5", "f1", "g1", "h1", "i2", "j2", "k2"))).toEqual({ average: 1.5, count: 6 });
    expect(shownAverage(from("a5", "b5", "c5", "d5", "e5", "F1", "g1", "h1"))).toEqual({ average: 5, count: 5 });
    // A closed account whose rating is not in a whole group yet changes nothing.
    expect(shownAverage(from("a5", "b5", "c5", "d5", "e5", "F1"))).toEqual({ average: 5, count: 5 });
  });
  it("is a rolling average: only the most recent people count, 50 at most, and an old group leaves as a whole", () => {
    const people = (n: number, stars: number, start = 0): string[] => Array.from({ length: n }, (_, i) => `${String.fromCharCode(0x4e00 + start + i)}${stars}`);
    // 5 + 15 groups of 3 = 50 people: all of them count.
    expect(shownAverage(from(...people(5, 1), ...people(45, 5, 5)))).toEqual({ average: 4.6, count: 50 });
    // Three more people: the newest 16 groups of 3 are 48 people, and the first five (1 star each) no longer fit.
    expect(shownAverage(from(...people(5, 1), ...people(48, 5, 5)))).toEqual({ average: 5, count: 48 });
    // A bad start is repaired, and a good past does not hide a bad present.
    expect(shownAverage(from(...people(50, 5), ...people(48, 1, 50)))).toEqual({ average: 1, count: 48 });
    // Two more people are not a whole group yet: nothing moves.
    expect(shownAverage(from(...people(5, 1), ...people(47, 5, 5)))).toEqual({ average: 4.6, count: 50 });
  });
  it("is rounded to one decimal", () => {
    expect(shownAverage(from("a5", "b5", "c4", "d5", "e4"))).toEqual({ average: 4.6, count: 5 });
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
