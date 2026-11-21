import { describe, expect, it } from "vitest";
import { canCancel, dueToTake, NOTICE_MS, owedCents, RETRY_MS, takebackLabel, TELL_FOUNDER_AFTER_MS, tellFounderOfRefusals } from "./takeback-rules";

const at = (iso: string) => new Date(iso);
const NOW = at("2027-02-01T12:00:00Z");
const whole = { sentCents: 1238, disputedCents: 1333, chargeLeftCents: 1333, transferLeftCents: 1238, othersOpenCents: 0 };

describe("what a host owes for a share after a lost dispute", () => {
  it("is the whole share when the bank disputed all that was left of the charge", () => {
    expect(owedCents(whole)).toBe(1238);
    expect(owedCents({ ...whole, disputedCents: 2000 })).toBe(1238);
  });

  it("is the same part of the share when the bank disputed a part, rounded down to the cent", () => {
    expect(owedCents({ ...whole, disputedCents: 500 })).toBe(Math.floor((1238 * 500) / 1333));
    expect(owedCents({ ...whole, disputedCents: 1 })).toBe(0);
  });

  it("is never more than is left of the transfer at Stripe", () => {
    expect(owedCents({ ...whole, transferLeftCents: 400 })).toBe(400);
    expect(owedCents({ ...whole, transferLeftCents: 0 })).toBe(0);
  });

  it("leaves room for other take-backs on the same share that are still to take: together never more than was sent", () => {
    const first = owedCents({ ...whole, disputedCents: 800 });
    const second = owedCents({ ...whole, disputedCents: 800, othersOpenCents: first });
    expect(first + second).toBeLessThanOrEqual(1238);
    expect(second).toBe(1238 - first);
    expect(owedCents({ ...whole, othersOpenCents: 1238 })).toBe(0);
  });

  it("is nothing for a share that sent nothing, a dispute over nothing, or numbers that are not numbers", () => {
    expect(owedCents({ ...whole, sentCents: 0 })).toBe(0);
    expect(owedCents({ ...whole, disputedCents: 0 })).toBe(0);
    expect(owedCents({ ...whole, transferLeftCents: Number.NaN })).toBe(0);
  });

  it("is never more than the bank took back, also when a refund Connect paid for had made the charge smaller than the share", () => {
    // $100 paid, $90 sent to the host, $80 refunded at Connect's cost; the bank takes back the $20 that was left.
    expect(owedCents({ sentCents: 9000, disputedCents: 2000, chargeLeftCents: 2000, transferLeftCents: 9000, othersOpenCents: 0 })).toBe(2000);
  });

  it("counts all shares under one dispute together: a month with two shares never owes more than the bank took", () => {
    // A $100 month paid two $40 shares; $80 was refunded at Connect's cost; the bank takes back the $20 that was left.
    const share = { sentCents: 4000, disputedCents: 2000, chargeLeftCents: 2000, transferLeftCents: 4000, othersOpenCents: 0 };
    const first = owedCents({ ...share, sameDisputeCents: 0 });
    const second = owedCents({ ...share, sameDisputeCents: first });
    expect(first).toBe(2000);
    expect(second).toBe(0);
    // With nothing refunded, the two shares of a month the bank took back whole are both owed in full.
    const whole = { sentCents: 4000, disputedCents: 10_000, chargeLeftCents: 10_000, transferLeftCents: 4000, othersOpenCents: 0 };
    expect(owedCents({ ...whole, sameDisputeCents: 0 }) + owedCents({ ...whole, sameDisputeCents: 4000 })).toBe(8000);
  });

  it("takes the whole share when what was left of the charge is not known", () => {
    expect(owedCents({ ...whole, chargeLeftCents: 0 })).toBe(1238);
  });
});

describe("when a take-back is asked of Stripe", () => {
  const debt = { status: "told", dueAt: new Date(NOW.getTime() + NOTICE_MS), refusedAt: null };
  it("is never before the 14 days are over, and is at them", () => {
    expect(dueToTake(debt, NOW)).toBe(false);
    expect(dueToTake(debt, new Date(debt.dueAt.getTime() - 1))).toBe(false);
    expect(dueToTake(debt, debt.dueAt)).toBe(true);
  });

  it("is a day after a refusal, not sooner", () => {
    const refused = { ...debt, refusedAt: debt.dueAt };
    expect(dueToTake(refused, new Date(debt.dueAt.getTime() + RETRY_MS - 1))).toBe(false);
    expect(dueToTake(refused, new Date(debt.dueAt.getTime() + RETRY_MS))).toBe(true);
  });

  it("is never for one that was cancelled, is being taken, or was taken", () => {
    for (const status of ["cancelled", "taking", "taken"]) expect(dueToTake({ ...debt, status }, new Date(debt.dueAt.getTime() + 1))).toBe(false);
  });
});

describe("cancelling, and telling the founder", () => {
  it("can be cancelled only while the host has their notice", () => {
    expect(canCancel({ status: "told" })).toBe(true);
    for (const status of ["cancelled", "taking", "taken"]) expect(canCancel({ status })).toBe(false);
  });

  it("tells the founder once, 30 days after the first refusal", () => {
    const first = at("2027-01-01T00:00:00Z");
    const refused = { status: "told", firstRefusedAt: first, founderToldAt: null };
    expect(tellFounderOfRefusals(refused, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS - 1))).toBe(false);
    expect(tellFounderOfRefusals(refused, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS))).toBe(true);
    expect(tellFounderOfRefusals({ ...refused, founderToldAt: NOW }, new Date(first.getTime() + 2 * TELL_FOUNDER_AFTER_MS))).toBe(false);
    expect(tellFounderOfRefusals({ ...refused, firstRefusedAt: null }, NOW)).toBe(false);
    expect(tellFounderOfRefusals({ ...refused, status: "taken" }, new Date(first.getTime() + 2 * TELL_FOUNDER_AFTER_MS))).toBe(false);
  });

  it("names the request to Stripe after the take-back", () => {
    expect(takebackLabel("abc")).toBe("takeback:abc");
  });
});
