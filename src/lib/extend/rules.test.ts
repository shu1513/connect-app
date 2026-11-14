import { describe, expect, it } from "vitest";
import { askWindow, canStillAccept, choicesThatFit, extensionPriceCents, minutesProblem, minutesThatFit } from "./rules";

const endsAt = new Date("2026-01-01T10:00:00Z");
const before = (seconds: number) => new Date(endsAt.getTime() - seconds * 1000);
const after = (minutes: number) => new Date(endsAt.getTime() + minutes * 60_000);

describe("when the customer can ask for more time", () => {
  it("is too early with more than 1 minute 30 left", () => {
    expect(askWindow({ now: before(91), endsAt })).toBe("too_early");
  });
  it("opens with exactly 1 minute 30 left", () => {
    expect(askWindow({ now: before(90), endsAt })).toBe("open");
  });
  it("is still open with 16 seconds left", () => {
    expect(askWindow({ now: before(16), endsAt })).toBe("open");
  });
  it("closes with 15 seconds left", () => {
    expect(askWindow({ now: before(15), endsAt })).toBe("too_late");
  });
  it("is closed after the end", () => {
    expect(askWindow({ now: after(1), endsAt })).toBe("too_late");
  });
});

describe("until when the host can accept", () => {
  it("can accept with 6 seconds left", () => {
    expect(canStillAccept({ now: before(6), endsAt })).toBe(true);
  });
  it("cannot accept with 5 seconds left", () => {
    expect(canStillAccept({ now: before(5), endsAt })).toBe(false);
  });
  it("cannot accept after the end", () => {
    expect(canStillAccept({ now: after(1), endsAt })).toBe(false);
  });
});

describe("how many minutes fit", () => {
  it("is the most one request may ask for when nothing is coming up", () => {
    expect(minutesThatFit({ endsAt, breakMinutes: 5, hostNextAt: null, customerNextAt: null })).toBe(60);
  });
  it("leaves the host their break before their next call", () => {
    expect(minutesThatFit({ endsAt, breakMinutes: 5, hostNextAt: after(30), customerNextAt: null })).toBe(25);
  });
  it("lets the customer go right up to their next call", () => {
    expect(minutesThatFit({ endsAt, breakMinutes: 5, hostNextAt: null, customerNextAt: after(12) })).toBe(12);
  });
  it("takes whichever of the two is tighter", () => {
    expect(minutesThatFit({ endsAt, breakMinutes: 10, hostNextAt: after(30), customerNextAt: after(25) })).toBe(20);
  });
  it("rounds down to whole minutes", () => {
    expect(minutesThatFit({ endsAt, breakMinutes: 0, hostNextAt: new Date(endsAt.getTime() + 7 * 60_000 + 59_000), customerNextAt: null })).toBe(7);
  });
  it("is zero when the next call starts right after the break", () => {
    expect(minutesThatFit({ endsAt, breakMinutes: 5, hostNextAt: after(5), customerNextAt: null })).toBe(0);
  });
  it("is never below zero", () => {
    expect(minutesThatFit({ endsAt, breakMinutes: 15, hostNextAt: after(5), customerNextAt: null })).toBe(0);
  });
});

describe("the choices offered", () => {
  it("offers 5, 10 and 15 when all fit", () => {
    expect(choicesThatFit(60)).toEqual([5, 10, 15]);
  });
  it("leaves out the ones that do not fit", () => {
    expect(choicesThatFit(12)).toEqual([5, 10]);
  });
  it("offers nothing when fewer than 5 minutes fit", () => {
    expect(choicesThatFit(4)).toEqual([]);
  });
});

describe("a number of minutes the customer asks for", () => {
  it("accepts 5 minutes", () => {
    expect(minutesProblem(5, 60)).toBeNull();
  });
  it("accepts exactly what fits", () => {
    expect(minutesProblem(23, 23)).toBeNull();
  });
  it("refuses fewer than 5", () => {
    expect(minutesProblem(4, 60)).toMatch(/least/);
  });
  it("refuses more than fits", () => {
    expect(minutesProblem(24, 23)).toMatch(/up to 23/);
  });
  it("refuses a part of a minute", () => {
    expect(minutesProblem(7.5, 60)).toMatch(/whole number/);
  });
  it("refuses anything when fewer than 5 minutes fit", () => {
    expect(minutesProblem(5, 4)).toMatch(/no room/);
  });
  it("never allows more than 60, because no more than 60 ever fit", () => {
    expect(minutesProblem(61, minutesThatFit({ endsAt, breakMinutes: 0, hostNextAt: null, customerNextAt: null }))).toMatch(/up to 60/);
  });
});

describe("the price of more time", () => {
  it("is the call's price for the extra minutes", () => {
    expect(extensionPriceCents(2000, 10)).toBe(1333);
    expect(extensionPriceCents(2000, 5)).toBe(667);
    expect(extensionPriceCents(2000, 15)).toBe(2000);
  });
  it("is at least Stripe's minimum for the smallest extension at the lowest price", () => {
    expect(extensionPriceCents(500, 5)).toBe(167);
  });
  it("is zero for a free call", () => {
    expect(extensionPriceCents(0, 10)).toBe(0);
  });
});
