import { describe, expect, it } from "vitest";
import {
  attendanceChargeCents,
  bookedTotalCents,
  DEFAULT_FEE_TERMS,
  payoutAfterFee,
  splitAfterRefunds,
  splitCharge,
} from "./pricing";

// The founder's example: $20 per 15 minutes.
const PRICE = 2000;
const HOUR = 3600;

describe("the booked total", () => {
  it("is $80 for one hour at $20 per 15 minutes", () => {
    expect(bookedTotalCents(PRICE, HOUR)).toBe(8000);
  });
  it("is $20 for 15 minutes", () => {
    expect(bookedTotalCents(PRICE, 900)).toBe(2000);
  });
  it("is zero for a free call", () => {
    expect(bookedTotalCents(0, HOUR)).toBe(0);
  });
  it("rounds to the nearest cent, halves up", () => {
    // $5.00 per 15 minutes for 61 seconds = 33.888… cents
    expect(bookedTotalCents(500, 61)).toBe(34);
    // 1 cent per 15 minutes for 450 seconds = exactly half a cent
    expect(bookedTotalCents(1, 450)).toBe(1);
  });
});

describe("what the customer owes for a call that took place", () => {
  const call = { pricePer15Cents: PRICE, bookedSeconds: HOUR };

  it("is the full price when the host was there the whole time", () => {
    expect(attendanceChargeCents({ ...call, countedSeconds: HOUR })).toBe(8000);
  });
  it("drops when the host is 5 minutes late", () => {
    // 55 minutes at $20 per 15 minutes = $73.33
    expect(attendanceChargeCents({ ...call, countedSeconds: 3300 })).toBe(7333);
  });
  it("drops when the host leaves 4 minutes early", () => {
    // 56 minutes = $74.67
    expect(attendanceChargeCents({ ...call, countedSeconds: 3360 })).toBe(7467);
  });
  it("is nothing when the host never showed up", () => {
    expect(attendanceChargeCents({ ...call, countedSeconds: 0 })).toBe(0);
  });
  it("does not depend on the customer: it is charged for the time the host waited", () => {
    // The pricing rule only ever sees the host's time. A late or absent customer changes nothing.
    expect(attendanceChargeCents({ ...call, countedSeconds: HOUR })).toBe(8000);
  });
  it("is counted to the second", () => {
    // 1 second at $20 per 15 minutes = 2.22 cents; 100 seconds = $2.22
    expect(attendanceChargeCents({ ...call, countedSeconds: 100 })).toBe(222);
  });
  it("is never more than the booked total, even if more time is reported", () => {
    expect(attendanceChargeCents({ ...call, countedSeconds: HOUR + 500 })).toBe(8000);
  });
  it("is nothing when it would come to less than 50 cents", () => {
    // 20 seconds = 44 cents
    expect(attendanceChargeCents({ ...call, countedSeconds: 20 })).toBe(0);
    // 23 seconds = 51 cents
    expect(attendanceChargeCents({ ...call, countedSeconds: 23 })).toBe(51);
  });
  it("is nothing for a free call", () => {
    expect(attendanceChargeCents({ pricePer15Cents: 0, bookedSeconds: HOUR, countedSeconds: HOUR })).toBe(0);
  });
});

describe("the split between our fee and the host", () => {
  it("on an $80 call with a US card: fee $4.22, host $75.78", () => {
    // 4.9% of $80 = $3.92, plus 30 cents
    expect(splitCharge(8000, DEFAULT_FEE_TERMS, false)).toEqual({ feeCents: 422, hostShareCents: 7578 });
  });
  it("on a $20 call with a US card: fee $1.28, host $18.72", () => {
    expect(splitCharge(2000, DEFAULT_FEE_TERMS, false)).toEqual({ feeCents: 128, hostShareCents: 1872 });
  });
  it("adds 1.5% for a card from outside the United States", () => {
    // $3.92 + 30 cents + $1.20
    expect(splitCharge(8000, DEFAULT_FEE_TERMS, true)).toEqual({ feeCents: 542, hostShareCents: 7458 });
  });
  it("rounds the fee once, not once per percentage", () => {
    // $5.00 with a foreign card: 6.4% = 32 cents exactly. Rounding 4.9% and 1.5% separately would give 33.
    expect(splitCharge(500, DEFAULT_FEE_TERMS, true)).toEqual({ feeCents: 62, hostShareCents: 438 });
  });
  it("is nothing and nothing when there is no charge", () => {
    expect(splitCharge(0, DEFAULT_FEE_TERMS, false)).toEqual({ feeCents: 0, hostShareCents: 0 });
  });
  it("never takes a fee bigger than the charge", () => {
    expect(splitCharge(50, { percentBps: 490, fixedCents: 100, foreignCardBps: 150 }, false)).toEqual({
      feeCents: 50,
      hostShareCents: 0,
    });
  });
  it("uses the fee settings the call was created with", () => {
    expect(splitCharge(8000, { percentBps: 1000, fixedCents: 0, foreignCardBps: 0 }, true)).toEqual({
      feeCents: 800,
      hostShareCents: 7200,
    });
  });
  it("always adds up to the charge exactly, for every amount", () => {
    for (let charge = 0; charge <= 30_000; charge += 7) {
      for (const foreign of [false, true]) {
        const { feeCents, hostShareCents } = splitCharge(charge, DEFAULT_FEE_TERMS, foreign);
        expect(feeCents + hostShareCents).toBe(charge);
        expect(feeCents).toBeGreaterThanOrEqual(0);
        expect(hostShareCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("the split after a refund", () => {
  const original = { chargeCents: 8000, originalHostShareCents: 7578 };

  it("is unchanged when nothing was refunded", () => {
    expect(splitAfterRefunds({ ...original, refundedCents: 0 })).toEqual({ feeCents: 422, hostShareCents: 7578 });
  });
  it("is nothing and nothing after a full refund, so a full refund is truly full", () => {
    expect(splitAfterRefunds({ ...original, refundedCents: 8000 })).toEqual({ feeCents: 0, hostShareCents: 0 });
  });
  it("halves both parts after a half refund", () => {
    expect(splitAfterRefunds({ ...original, refundedCents: 4000 })).toEqual({ feeCents: 211, hostShareCents: 3789 });
  });
  it("always adds up to what the customer has paid, for every refund amount", () => {
    for (let refunded = 0; refunded <= 8000; refunded += 13) {
      const { feeCents, hostShareCents } = splitAfterRefunds({ ...original, refundedCents: refunded });
      expect(feeCents + hostShareCents).toBe(8000 - refunded);
      expect(feeCents).toBeGreaterThanOrEqual(0);
      expect(hostShareCents).toBeLessThanOrEqual(7578);
    }
  });
  it("refuses a refund bigger than the charge", () => {
    expect(() => splitAfterRefunds({ ...original, refundedCents: 8001 })).toThrow();
  });
});

describe("the payout charge", () => {
  it("takes 25 cents from a payout", () => {
    expect(payoutAfterFee(7578)).toEqual({ payoutCents: 7553, payoutFeeCents: 25 });
  });
  it("is charged once for several calls paid together", () => {
    expect(payoutAfterFee(7578 + 1872)).toEqual({ payoutCents: 9425, payoutFeeCents: 25 });
  });
  it("is never more than the payout itself", () => {
    expect(payoutAfterFee(10)).toEqual({ payoutCents: 0, payoutFeeCents: 10 });
    expect(payoutAfterFee(0)).toEqual({ payoutCents: 0, payoutFeeCents: 0 });
  });
});

describe("bad inputs are refused, not guessed", () => {
  it("refuses fractions of a cent or of a second", () => {
    expect(() => bookedTotalCents(19.99, 900)).toThrow();
    expect(() => attendanceChargeCents({ pricePer15Cents: 2000, bookedSeconds: 900, countedSeconds: 1.5 })).toThrow();
  });
  it("refuses negative numbers", () => {
    expect(() => bookedTotalCents(-1, 900)).toThrow();
    expect(() => splitCharge(-5, DEFAULT_FEE_TERMS, false)).toThrow();
  });
});
