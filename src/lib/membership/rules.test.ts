import { describe, expect, it } from "vitest";
import { DEADLINE_CUSHION_MS, TAKE_BEFORE_EXPIRY_MS } from "@/lib/payments/rules";
import { feeTermsFor, giveUpAt, holdTiming, isFrozen, monthEnd, monthTotalCents, nextTryAt, offerProblem, splitAtEnd, sumOfPlaces, timeWords } from "./rules";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);

describe("what a host can offer", () => {
  const ok = { pricePer15Cents: 750, includedMinutes: 120, regularPricePer15Cents: 1000 };
  it("accepts a member price up to the regular price, and time in half hours", () => {
    expect(offerProblem(ok)).toBeNull();
    expect(offerProblem({ ...ok, pricePer15Cents: 1000 })).toBeNull();
    expect(offerProblem({ ...ok, includedMinutes: 30 })).toBeNull();
    expect(offerProblem({ ...ok, includedMinutes: 100 * 60 })).toBeNull();
  });
  it("refuses a member price above the regular price, or under the app's minimum", () => {
    expect(offerProblem({ ...ok, pricePer15Cents: 1001 })).toMatch(/more than your regular price/);
    expect(offerProblem({ ...ok, pricePer15Cents: 499 })).toMatch(/at least \$5\.00/);
  });
  it("refuses a host whose calls are free", () => {
    expect(offerProblem({ ...ok, regularPricePer15Cents: 0 })).toMatch(/free/);
  });
  it("refuses time outside 30 minutes to 100 hours, or not in half hours", () => {
    for (const includedMinutes of [0, 15, 45, 100 * 60 + 30]) expect(offerProblem({ ...ok, includedMinutes })).toMatch(/from the list/);
  });
  it("works out the monthly amount exactly", () => {
    expect(monthTotalCents(750, 120)).toBe(6000);
    expect(monthTotalCents(599, 30)).toBe(1198);
  });
});

describe("a month's end", () => {
  it("is the same day and minute one calendar month later, in UTC", () => {
    expect(monthEnd(at("2026-11-14T09:30:15.250Z")).toISOString()).toBe("2026-12-14T09:30:15.250Z");
    expect(monthEnd(at("2026-12-15T23:59:00Z")).toISOString()).toBe("2027-01-15T23:59:00.000Z");
  });
  it("falls on the last day when the next month is shorter", () => {
    expect(monthEnd(at("2027-01-31T10:00:00Z")).toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(monthEnd(at("2028-01-31T10:00:00Z")).toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(monthEnd(at("2027-02-28T10:00:00Z")).toISOString()).toBe("2027-03-28T10:00:00.000Z");
    expect(monthEnd(at("2027-03-31T10:00:00Z")).toISOString()).toBe("2027-04-30T10:00:00.000Z");
  });
});

describe("first a hold, then the money", () => {
  const authorisedAt = at("2026-11-18T12:00:00Z");
  it("takes the money 72 hours and 3 minutes after the bank's time, and offers Cancel now for 72 hours", () => {
    const timing = holdTiming({ authorisedAt, holdExpiresAt: new Date(authorisedAt.getTime() + 7 * DAY) });
    expect(DEADLINE_CUSHION_MS).toBe(3 * 60_000);
    expect(timing.offeredUntil.getTime() - authorisedAt.getTime()).toBe(72 * HOUR);
    expect(timing.takeAt.getTime() - authorisedAt.getTime()).toBe(72 * HOUR + 3 * 60_000);
  });
  it("moves both earlier when the card's hold ends sooner: the money is taken 12 hours before the hold ends", () => {
    const holdExpiresAt = new Date(authorisedAt.getTime() + 2 * DAY);
    const timing = holdTiming({ authorisedAt, holdExpiresAt });
    expect(timing.takeAt.getTime()).toBe(holdExpiresAt.getTime() - TAKE_BEFORE_EXPIRY_MS);
    expect(timing.takeAt.getTime() - timing.offeredUntil.getTime()).toBe(DEADLINE_CUSHION_MS);
  });
});

describe("a monthly payment that fails", () => {
  const first = at("2026-11-18T12:00:00Z");
  it("is tried again 1, 3 and 5 days after the first failure, and then no more", () => {
    expect(nextTryAt(first, 1)!.getTime() - first.getTime()).toBe(1 * DAY);
    expect(nextTryAt(first, 2)!.getTime() - first.getTime()).toBe(3 * DAY);
    expect(nextTryAt(first, 3)!.getTime() - first.getTime()).toBe(5 * DAY);
    expect(nextTryAt(first, 4)).toBeNull();
  });
  it("is given up 7 days after the first failure", () => {
    expect(giveUpAt(first).getTime() - first.getTime()).toBe(7 * DAY);
  });
});

describe("the six places and the end of a month", () => {
  it("adds the six places up", () => {
    expect(sumOfPlaces({ freeCents: 1, setAsideCents: 2, usedCents: 3, expiredCents: 4, toPayBackCents: 5, paidBackCents: 6 })).toBe(21);
  });
  it("pays the host-caused part of free money back and lets the rest expire", () => {
    expect(splitAtEnd({ freeCents: 4500, hostCausedCents: 1500 })).toEqual({ expiredCents: 3000, payBackCents: 1500 });
    expect(splitAtEnd({ freeCents: 4500, hostCausedCents: 0 })).toEqual({ expiredCents: 4500, payBackCents: 0 });
    expect(splitAtEnd({ freeCents: 1000, hostCausedCents: 1000 })).toEqual({ expiredCents: 0, payBackCents: 1000 });
  });
  it("freezes a month whose dispute is open or lost, and not one that was won", () => {
    expect(isFrozen({ dispute: "open" })).toBe(true);
    expect(isFrozen({ dispute: "lost" })).toBe(true);
    expect(isFrozen({ dispute: "won" })).toBe(false);
    expect(isFrozen({ dispute: "none" })).toBe(false);
  });
  it("puts the month's fixed 30 cents on the first amount only", () => {
    const month = { feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150, fixedFeePlaced: false };
    expect(feeTermsFor(month).fixedCents).toBe(30);
    expect(feeTermsFor({ ...month, fixedFeePlaced: true })).toEqual({ percentBps: 490, fixedCents: 0, foreignCardBps: 150 });
  });
});

describe("time in words", () => {
  it("writes hours and minutes out", () => {
    expect(timeWords(120)).toBe("2 hours");
    expect(timeWords(60)).toBe("1 hour");
    expect(timeWords(90)).toBe("1 hour 30 minutes");
    expect(timeWords(30)).toBe("30 minutes");
    expect(timeWords(0)).toBe("0 minutes");
  });
});
