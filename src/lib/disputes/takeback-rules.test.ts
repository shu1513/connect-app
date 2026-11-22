import { describe, expect, it } from "vitest";
import { AFTER_ANSWER_MS, againstBank, paidBackCents, canAnswer, canCancel, canHold, canObject, canSettle, dueDay, dueToTake, leftAfterRefunds, NOTICE_MS, OPEN, owedCents, refundOwes, RESERVED, RETRY_MS, roomOn, stateBeforeTaking, TAKEABLE, takebackLabel, TELL_FOUNDER_AFTER_MS, tellFounderOfRefusals } from "./takeback-rules";

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

  it("is never while it has no due day: the notice has not gone out yet, or did not arrive", () => {
    expect(dueToTake({ ...debt, dueAt: null }, new Date(NOW.getTime() + 10 * NOTICE_MS))).toBe(false);
  });

  it("is never while the host's objection is open, and is again once it was answered and its day has come", () => {
    expect(dueToTake({ ...debt, status: "objected" }, new Date(debt.dueAt.getTime() + 1))).toBe(false);
    expect(dueToTake({ ...debt, status: "objected", dueAt: null }, new Date(debt.dueAt.getTime() + 1))).toBe(false);
    expect(dueToTake({ ...debt, status: "answered", dueAt: null }, new Date(debt.dueAt.getTime() + 1))).toBe(false);
    expect(dueToTake({ ...debt, status: "answered" }, debt.dueAt)).toBe(true);
  });
});

describe("the due day", () => {
  const sent = at("2027-03-01T10:00:00Z");
  const told = { status: "told", promisedAt: null, noticeArrivedAt: sent, answerArrivedAt: null };
  it("is 14 days after the notice email was really sent", () => {
    expect(dueDay(told)?.toISOString()).toBe("2027-03-15T10:00:00.000Z");
  });

  it("is none while the notice has not gone out, whatever else is known", () => {
    expect(dueDay({ ...told, noticeArrivedAt: null })).toBeNull();
    expect(dueDay({ ...told, noticeArrivedAt: null, promisedAt: at("2027-03-10T00:00:00Z") })).toBeNull();
    expect(dueDay({ status: "answered", promisedAt: null, noticeArrivedAt: null, answerArrivedAt: at("2027-03-02T10:00:00Z") })).toBeNull();
  });

  it("is never earlier than a day an earlier notice named", () => {
    // A take-back from before this rule: its notice named 20 March; the email is confirmed as sent on 1 March.
    expect(dueDay({ ...told, promisedAt: at("2027-03-20T00:00:00Z") })?.toISOString()).toBe("2027-03-20T00:00:00.000Z");
    // Its email only went out on 12 March: 14 days from then, later than the day it named.
    expect(dueDay({ ...told, promisedAt: at("2027-03-20T00:00:00Z"), noticeArrivedAt: at("2027-03-12T10:00:00Z") })?.toISOString()).toBe("2027-03-26T10:00:00.000Z");
  });

  it("after an answered objection is also never earlier than 3 days after the answer was sent", () => {
    const answered = { status: "answered", promisedAt: null, noticeArrivedAt: sent, answerArrivedAt: at("2027-03-05T10:00:00Z") };
    // Answered early: the notice's own 14 days still hold. An objection never brings the day forward.
    expect(dueDay(answered)?.toISOString()).toBe("2027-03-15T10:00:00.000Z");
    // Objected and answered on the very first day: still 14 days from the notice, not 3 from the answer.
    expect(dueDay({ ...answered, answerArrivedAt: sent })?.toISOString()).toBe("2027-03-15T10:00:00.000Z");
    // Answered late: 3 days from the answer.
    expect(dueDay({ ...answered, answerArrivedAt: at("2027-03-20T10:00:00Z") })?.toISOString()).toBe("2027-03-23T10:00:00.000Z");
    expect(AFTER_ANSWER_MS).toBe(3 * 24 * 3_600_000);
  });

  it("is none while the answer has not gone out, and none while the objection is open or the take-back is over", () => {
    expect(dueDay({ status: "answered", promisedAt: null, noticeArrivedAt: sent, answerArrivedAt: null })).toBeNull();
    for (const status of ["objected", "taking", "taken", "cancelled", "nothing"]) expect(dueDay({ ...told, status })).toBeNull();
  });
});

describe("objecting", () => {
  it("is possible while the host only has their notice, and not a second time after an answer", () => {
    expect(canObject({ status: "told" })).toBe(true);
    for (const status of ["objected", "answered", "taking", "taken", "cancelled"]) expect(canObject({ status })).toBe(false);
  });

  it("can be answered by the founder only while it is open, and held by the founder only while there is just the notice", () => {
    expect(canAnswer({ status: "objected" })).toBe(true);
    for (const status of ["told", "answered", "taking", "taken", "cancelled"]) expect(canAnswer({ status })).toBe(false);
    expect(canHold({ status: "told" })).toBe(true);
    for (const status of ["objected", "answered", "taking", "taken", "cancelled"]) expect(canHold({ status })).toBe(false);
  });

  it("goes back to where it stood when Stripe does not take it: answered stays answered", () => {
    expect(stateBeforeTaking({ answer: null })).toBe("told");
    expect(stateBeforeTaking({ answer: "We looked at it." })).toBe("answered");
  });
});

describe("cancelling, and telling the founder", () => {
  it("can be cancelled until the app starts taking it: with its notice, objected to, or answered", () => {
    for (const status of ["told", "objected", "answered"]) expect(canCancel({ status })).toBe(true);
    for (const status of ["cancelled", "taking", "taken", "nothing"]) expect(canCancel({ status })).toBe(false);
    expect([...OPEN]).toEqual(["told", "objected", "answered"]);
    expect([...TAKEABLE]).toEqual(["told", "answered"]);
  });

  it("tells the founder once, 30 days after the first refusal", () => {
    const first = at("2027-01-01T00:00:00Z");
    const refused = { status: "told", firstRefusedAt: first, founderToldAt: null };
    expect(tellFounderOfRefusals(refused, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS - 1))).toBe(false);
    expect(tellFounderOfRefusals(refused, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS))).toBe(true);
    expect(tellFounderOfRefusals({ ...refused, founderToldAt: NOW }, new Date(first.getTime() + 2 * TELL_FOUNDER_AFTER_MS))).toBe(false);
    expect(tellFounderOfRefusals({ ...refused, firstRefusedAt: null }, NOW)).toBe(false);
    expect(tellFounderOfRefusals({ ...refused, status: "taken" }, new Date(first.getTime() + 2 * TELL_FOUNDER_AFTER_MS))).toBe(false);
    expect(tellFounderOfRefusals({ ...refused, status: "answered" }, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS))).toBe(true);
    expect(tellFounderOfRefusals({ ...refused, status: "objected" }, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS))).toBe(false);
    // Not while it has no due day (its notice did not arrive): nothing is being tried then.
    expect(tellFounderOfRefusals({ ...refused, dueAt: null }, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS))).toBe(false);
    expect(tellFounderOfRefusals({ ...refused, dueAt: first }, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS))).toBe(true);
    // Nor while its day lies ahead again (its notice was sent again after the refusals).
    expect(tellFounderOfRefusals({ ...refused, dueAt: new Date(first.getTime() + 2 * TELL_FOUNDER_AFTER_MS) }, new Date(first.getTime() + TELL_FOUNDER_AFTER_MS))).toBe(false);
  });

  it("names the request to Stripe after the take-back", () => {
    expect(takebackLabel("abc")).toBe("takeback:abc");
  });
});

describe("what a refund after the sending makes a host owe (plans/46-part-3-money-owed.md, decision 4)", () => {
  const room = 1_000_000;
  it("is what her share lost to that refund", () => {
    // 100 charged, 80 sent; 50 refunded: her share goes from 80 to 40.
    expect(refundOwes({ sentCents: 8000, reductionsBeforeCents: 0, reductionCents: 4000, roomCents: room })).toBe(4000);
  });

  it("adds up over several refunds to no more than was sent: 30 and then 70 of 100 give 24 and 56", () => {
    expect(refundOwes({ sentCents: 8000, reductionsBeforeCents: 0, reductionCents: 2400, roomCents: room })).toBe(2400);
    expect(refundOwes({ sentCents: 8000, reductionsBeforeCents: 2400, reductionCents: 5600, roomCents: room })).toBe(5600);
  });

  it("for a share that carried the collection charge is at most what was sent: 79.75 of 80", () => {
    expect(refundOwes({ sentCents: 7975, reductionsBeforeCents: 0, reductionCents: 4000, roomCents: room })).toBe(4000);
    expect(refundOwes({ sentCents: 7975, reductionsBeforeCents: 0, reductionCents: 8000, roomCents: room })).toBe(7975);
  });

  it("adds nothing once refunds have used up all that was sent, whatever became of the earlier take-backs", () => {
    // 99.75 refunded took 79.80 off her share (a take-back of 79.75, called off). The last 25 cents take another 20 cents off.
    expect(refundOwes({ sentCents: 7975, reductionsBeforeCents: 7980, reductionCents: 20, roomCents: room })).toBe(0);
  });

  it("is never more than the room on the transfer, and nothing for nothing", () => {
    expect(refundOwes({ sentCents: 8000, reductionsBeforeCents: 0, reductionCents: 4000, roomCents: 1500 })).toBe(1500);
    expect(refundOwes({ sentCents: 8000, reductionsBeforeCents: 0, reductionCents: 4000, roomCents: 0 })).toBe(0);
    expect(refundOwes({ sentCents: 0, reductionsBeforeCents: 0, reductionCents: 4000, roomCents: room })).toBe(0);
    expect(refundOwes({ sentCents: 8000, reductionsBeforeCents: 0, reductionCents: 0, roomCents: room })).toBe(0);
    expect(refundOwes({ sentCents: Number.NaN, reductionsBeforeCents: 0, reductionCents: 4000, roomCents: room })).toBe(0);
  });

  it("works the room out from what Stripe shows as not reversed, less what is still set aside, less what she paid back outside Stripe", () => {
    expect(roomOn({ transferLeftCents: 8000, reservedCents: 0, repaidOutsideCents: 0 })).toBe(8000);
    expect(roomOn({ transferLeftCents: 8000, reservedCents: 4000, repaidOutsideCents: 0 })).toBe(4000);
    // She paid 40 back to Connect's bank account: Stripe still shows 80, and 40 of it is spoken for.
    expect(roomOn({ transferLeftCents: 8000, reservedCents: 0, repaidOutsideCents: 4000 })).toBe(4000);
    // A reversal made by hand at Stripe is in the first number already, and is not entered as paid back.
    expect(roomOn({ transferLeftCents: 4000, reservedCents: 0, repaidOutsideCents: 0 })).toBe(4000);
    expect(roomOn({ transferLeftCents: 1000, reservedCents: 4000, repaidOutsideCents: 0 })).toBe(0);
  });

  it("starts a dispute after refunds from what was sent less what her share lost to them", () => {
    // 100 charged, 80 sent; 50 refunded after, so her share lost 40; the bank then takes 25 of the 50 that are left: half of 40.
    const left = leftAfterRefunds(8000, 4000);
    expect(left).toBe(4000);
    expect(owedCents({ sentCents: left, disputedCents: 2500, chargeLeftCents: 5000, transferLeftCents: 8000, othersOpenCents: 4000 })).toBe(2000);
    // The same whatever became of the refund's take-back: taken (40 reversed), or called off (nothing reversed, nothing set aside).
    expect(owedCents({ sentCents: left, disputedCents: 2500, chargeLeftCents: 5000, transferLeftCents: 4000, othersOpenCents: 0 })).toBe(2000);
    expect(owedCents({ sentCents: left, disputedCents: 2500, chargeLeftCents: 5000, transferLeftCents: 8000, othersOpenCents: 0 })).toBe(2000);
    // With no refund after the sending it is what was sent, also for a share that carried the charge: half of 79.75 is 39.87.
    expect(owedCents({ sentCents: leftAfterRefunds(7975, 0), disputedCents: 5000, chargeLeftCents: 10000, transferLeftCents: 7975, othersOpenCents: 0 })).toBe(3987);
    expect(leftAfterRefunds(8000, 9000)).toBe(0);
  });

  it("keeps an amount set aside while a take-back is open or waiting, and lets the founder settle or call off exactly those", () => {
    expect([...RESERVED]).toEqual(["told", "objected", "answered", "waiting"]);
    for (const status of ["told", "objected", "answered", "waiting"]) expect(canSettle({ status }) && canCancel({ status })).toBe(true);
    for (const status of ["taking", "taken", "cancelled", "settled", "nothing"]) expect(canSettle({ status }) || canCancel({ status })).toBe(false);
    // One that waits for the founder is never due, whatever day is on it.
    expect(dueToTake({ status: "waiting", dueAt: new Date(0), refusedAt: null }, NOW)).toBe(false);
  });
});

describe("what a take-back counts for, once money has moved in more than one way", () => {
  const row = (status: string, amountCents: number, more: { repaidCents?: number | null; byHandCents?: number } = {}) => ({ status, amountCents, repaidCents: more.repaidCents ?? null, byHandCents: more.byHandCents ?? 0 });

  it("counts what was really paid back, whichever way", () => {
    expect(paidBackCents(row("taken", 4000))).toBe(4000);
    // Paid in full by a reversal made by hand: "taken" with nothing left on the row.
    expect(paidBackCents(row("taken", 0, { byHandCents: 4000 }))).toBe(4000);
    // $10 by hand, then the rest settled outside for $20 of $30.
    expect(paidBackCents(row("settled", 3000, { repaidCents: 2000, byHandCents: 1000 }))).toBe(3000);
    expect(paidBackCents(row("cancelled", 3000))).toBe(0);
    expect(paidBackCents(row("told", 3000, { byHandCents: 1000 }))).toBe(1000);
  });

  it("counts against what the bank took: what is still reserved and what was paid, and not what was waived", () => {
    expect(againstBank(row("told", 2000))).toBe(2000);
    expect(againstBank(row("taking", 2000))).toBe(2000);
    expect(againstBank(row("taken", 2000))).toBe(2000);
    // The bank took 30 and the first share repaid 20 outside (10 let go): only 20 is used up, 10 is room again.
    expect(againstBank(row("settled", 3000, { repaidCents: 2000 }))).toBe(2000);
    // Fully paid by hand: the row has nothing left on it, and still counts for all of it.
    expect(againstBank(row("taken", 0, { byHandCents: 4000 }))).toBe(4000);
    expect(againstBank(row("cancelled", 4000))).toBe(0);
    expect(againstBank(row("waiting", 4000))).toBe(0);
    expect(againstBank(row("nothing", 0))).toBe(0);
  });
});

