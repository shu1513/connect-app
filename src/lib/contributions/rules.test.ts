import { describe, expect, it } from "vitest";
import { collectFrom, CONTRIBUTION, ContributionError, kindsOffered, lastMomentToTake, mayTake, monthlyDue, readAmount, readSuggested, suggestedOf, waitFor, type PairPayment } from "./rules";

const DAY = 24 * 3_600_000;
const at = (iso: string) => new Date(iso);

describe("reading a typed amount", () => {
  it("takes dollars, with or without cents, a dollar sign and commas", () => {
    expect(readAmount("5")).toBe(500);
    expect(readAmount(" 25.5 ")).toBe(2550);
    expect(readAmount("25.50")).toBe(2550);
    expect(readAmount("$1,000.00")).toBe(100_000);
    expect(readAmount("100000")).toBe(10_000_000);
    expect(readAmount("100,000.00")).toBe(10_000_000);
  });
  it("refuses less than $5 and more than $100,000, in words for the person", () => {
    expect(() => readAmount("4.99")).toThrow(/smallest contribution is \$5/);
    expect(() => readAmount("0")).toThrow(ContributionError);
    expect(() => readAmount("100000.01")).toThrow(/largest contribution is \$100,000/);
    expect(() => readAmount("99999999999")).toThrow(/largest/);
  });
  it("refuses what is not an amount", () => {
    for (const typed of ["", "ten", "5.555", "-5", "5,00", "1,00,000", "5 dollars", "1e3", "5.", ".50", "$"]) expect(() => readAmount(typed), typed).toThrow(ContributionError);
  });
});

describe("the day of a monthly payment", () => {
  it("is the same day and minute each month, by the UTC clock", () => {
    const first = at("2026-03-10T14:07:30.000Z");
    expect(monthlyDue(first, 1)).toEqual(first);
    expect(monthlyDue(first, 2)).toEqual(at("2026-04-10T14:07:30.000Z"));
    expect(monthlyDue(first, 11)).toEqual(at("2027-01-10T14:07:30.000Z"));
  });
  it("is counted from the first hold each time, so a short month does not move it for good", () => {
    const first = at("2027-01-31T23:59:00.000Z");
    expect(monthlyDue(first, 2)).toEqual(at("2027-02-28T23:59:00.000Z"));
    expect(monthlyDue(first, 3)).toEqual(at("2027-03-31T23:59:00.000Z"));
    expect(monthlyDue(first, 4)).toEqual(at("2027-04-30T23:59:00.000Z"));
  });
  it("knows a leap year", () => {
    expect(monthlyDue(at("2028-01-30T08:00:00.000Z"), 2)).toEqual(at("2028-02-29T08:00:00.000Z"));
    expect(monthlyDue(at("2027-01-30T08:00:00.000Z"), 2)).toEqual(at("2027-02-28T08:00:00.000Z"));
  });
  it("refuses a number below 1", () => {
    expect(() => monthlyDue(at("2026-03-10T00:00:00Z"), 0)).toThrow();
  });
});

describe("whether held money may be taken", () => {
  const held = { status: "held", endedHow: null, problem: null, takeAt: at("2026-06-04T12:03:00Z"), takeBy: at("2026-06-08T11:00:00Z") };
  it("not before its planned moment, and from that moment on", () => {
    expect(mayTake(held, at("2026-06-04T12:02:59Z"))).toBe(false);
    expect(mayTake(held, at("2026-06-04T12:03:00Z"))).toBe(true);
    expect(mayTake(held, at("2026-06-06T00:00:00Z"))).toBe(true);
  });
  it("until its last moment, one hour before the hold ends, and never after", () => {
    expect(lastMomentToTake(at("2026-06-08T12:00:00Z"))).toEqual(at("2026-06-08T11:00:00Z"));
    expect(mayTake(held, at("2026-06-08T11:00:00Z"))).toBe(true);
    expect(mayTake(held, at("2026-06-08T11:00:01Z"))).toBe(false);
  });
  it("never once it was given up, set aside for the founder, or is not held", () => {
    const now = at("2026-06-05T00:00:00Z");
    expect(mayTake({ ...held, endedHow: "cancelled" }, now)).toBe(false);
    expect(mayTake({ ...held, problem: "look at this" }, now)).toBe(false);
    expect(mayTake({ ...held, status: "to_pay" }, now)).toBe(false);
    expect(mayTake({ ...held, status: "taken" }, now)).toBe(false);
    expect(mayTake({ ...held, takeBy: null }, now)).toBe(false);
  });
});

describe("the wait before a host can collect", () => {
  it("is 7 days from the taking, or 30", () => {
    const taken = at("2026-06-04T12:03:00Z");
    expect(collectFrom(taken, false)).toEqual(at("2026-06-11T12:03:00Z"));
    expect(collectFrom(taken, true)).toEqual(at("2026-07-04T12:03:00Z"));
  });
});

describe("the $1,000 rule", () => {
  const now = at("2026-07-01T00:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
  const taken = (id: string, amountCents: number, days: number, more: Partial<PairPayment> = {}): PairPayment => ({ id, amountCents, state: "taken", takenAt: daysAgo(days), sent: false, released: false, ...more });
  const held = (id: string, amountCents: number): PairPayment => ({ id, amountCents, state: "held", takenAt: null, sent: false, released: false });

  it("exactly $1,000 does not cross the line; one cent more does", () => {
    expect(waitFor([taken("a", 60_000, 3), taken("b", 40_000, 1)], now)).toMatchObject({ countedCents: 100_000, over: false, thirtyDays: [], markHeld: [] });
    const over = waitFor([taken("a", 60_000, 3), taken("b", 40_001, 1)], now);
    expect(over.over).toBe(true);
    expect(over.thirtyDays).toEqual(["a", "b"]);
  });
  it("counts what the contributor paid, each payment once, with holds that are in place", () => {
    const result = waitFor([taken("a", 50_000, 2), held("b", 50_001)], now);
    expect(result).toMatchObject({ countedCents: 100_001, over: true, markHeld: ["b"], thirtyDays: ["a"] });
  });
  it("two payments made together are counted together", () => {
    expect(waitFor([held("a", 60_000), held("b", 60_000)], now)).toMatchObject({ over: true, markHeld: ["a", "b"] });
  });
  it("does not count a hold that was let go or failed, nor money taken more than 30 days ago", () => {
    const gone: PairPayment = { id: "g", amountCents: 90_000, state: "other", takenAt: null, sent: false, released: false };
    expect(waitFor([gone, taken("old", 90_000, 31), taken("a", 20_000, 1)], now)).toMatchObject({ countedCents: 20_000, over: false });
    expect(waitFor([taken("edge", 100_001, 30)], now).over).toBe(false);
    expect(waitFor([taken("inside", 100_001, 29.99)], now).over).toBe(true);
  });
  it("a refund does not reset the count, and money that was collected still counts", () => {
    // (A refunded payment is still a taken payment of its full amount here: the caller does not lower it.)
    const result = waitFor([taken("collected", 70_000, 10, { sent: true }), taken("new", 40_000, 0)], now);
    expect(result).toMatchObject({ countedCents: 110_000, over: true });
    expect(result.thirtyDays).toEqual(["new"]);
  });
  it("earlier payments that are not sent yet wait too, also one taken long ago; sent money is left alone", () => {
    const result = waitFor([taken("long ago", 10_000, 45), taken("sent", 30_000, 5, { sent: true }), taken("waiting", 30_000, 4), taken("crossing", 80_000, 0)], now);
    expect(result.over).toBe(true);
    expect(result.thirtyDays).toEqual(["long ago", "waiting", "crossing"]);
  });
  it("a payment the founder released stays released", () => {
    expect(waitFor([taken("released", 60_000, 2, { released: true }), taken("b", 60_000, 1)], now).thirtyDays).toEqual(["b"]);
  });
  it("gives nothing back below the line: a wait never gets shorter by counting again", () => {
    expect(waitFor([taken("a", 60_000, 3)], now)).toMatchObject({ over: false, thirtyDays: [], markHeld: [] });
  });
  it("crossing while held marks the hold, whatever happens to the other hold afterwards", () => {
    const both = waitFor([held("a", 60_000), held("b", 60_000)], now);
    expect(both.markHeld).toEqual(["a", "b"]);
    // The other hold was cancelled: the count is under the line again, and nothing is given back. The mark that was written stays written.
    expect(waitFor([held("a", 60_000), { ...held("b", 60_000), state: "other" }], now)).toMatchObject({ over: false, markHeld: [] });
  });
  it("uses the limits the rulebook names", () => {
    expect([CONTRIBUTION.minCents, CONTRIBUTION.maxCents, CONTRIBUTION.lineCents]).toEqual([500, 10_000_000, 100_000]);
  });
});

describe("the amounts a host suggests", () => {
  it("reads up to three boxes, leaves empty ones out, and sorts them", () => {
    expect(readSuggested(["25", "", " 5 "])).toEqual([500, 2500]);
    expect(readSuggested(["", "", ""])).toEqual([]);
    expect(readSuggested(["10", "10.00", "$10"])).toEqual([1000]);
  });
  it("refuses an amount that is not a valid contribution, and a fourth amount", () => {
    expect(() => readSuggested(["4"])).toThrow(ContributionError);
    expect(() => readSuggested(["abc"])).toThrow(ContributionError);
    expect(() => readSuggested(["5", "6", "7", "8"])).toThrow(ContributionError);
  });
  it("reads what is kept strictly", () => {
    expect(suggestedOf("500,2500,10000")).toEqual([500, 2500, 10000]);
    expect(suggestedOf("")).toEqual([]);
    expect(suggestedOf("500,abc,-3,100,99999999999")).toEqual([500]);
    expect(suggestedOf("500,600,700,800")).toEqual([500, 600, 700]);
  });
  it("a kind without a suggested amount is not offered", () => {
    expect(kindsOffered({ suggestedOnce: "500", suggestedMonthly: "" })).toEqual(["once"]);
    expect(kindsOffered({ suggestedOnce: "", suggestedMonthly: "1000,2000" })).toEqual(["monthly"]);
    expect(kindsOffered({ suggestedOnce: "", suggestedMonthly: "" })).toEqual([]);
  });
});
