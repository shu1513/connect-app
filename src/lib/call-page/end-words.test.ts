import { describe, expect, it } from "vitest";
import { reportNotice } from "@/lib/safety/report-words";
import { END_WORDS, endCostFor, endMoneyFor, type EndMoney } from "./end-words";

const names = { host: "Maya", customer: "Sam" };

describe("what a press costs, for the question before it", () => {
  it("a customer on a booked call is told his whole booked time is still charged", () => {
    expect(endCostFor({ role: "customer", billing: "host", pricePer15Cents: 2000 })).toBe("whole_booking");
    expect(END_WORDS.sure("whole_booking")).toBe("End this call for both of you? Nobody can come back in. Your whole booked time is still charged.");
  });
  it("a host is told she is paid for her time up to now", () => {
    expect(endCostFor({ role: "host", billing: "host", pricePer15Cents: 2000 })).toBe("host_minutes");
    expect(END_WORDS.sure("host_minutes")).toContain("You are paid for your time up to now.");
  });
  it('an "available now" call charges the time both were in, whoever asks', () => {
    expect(endCostFor({ role: "customer", billing: "together", pricePer15Cents: 2000 })).toBe("together");
    expect(endCostFor({ role: "host", billing: "together", pricePer15Cents: 2000 })).toBe("together");
    expect(END_WORDS.sure("together")).toContain("The time you were both in the call is charged.");
  });
  it("a free call says nothing about money", () => {
    expect(endCostFor({ role: "customer", billing: "host", pricePer15Cents: 0 })).toBe("free");
    expect(END_WORDS.sure("free")).toBe("End this call for both of you? Nobody can come back in.");
  });
});

describe("how a call ended with the button is charged, from what is written on it", () => {
  const call = (over: Partial<Parameters<typeof endMoneyFor>[0]> = {}) => ({ billing: "host", pricePer15Cents: 2000, endedNowBy: "customer", endReportEffect: null, ...over });
  it("each case", () => {
    expect(endMoneyFor(call())).toBe("whole");
    expect(endMoneyFor(call({ endedNowBy: "host" }))).toBe("minutes");
    expect(endMoneyFor(call({ endReportEffect: "minutes" }))).toBe("lowered");
    expect(endMoneyFor(call({ endReportEffect: "minutes_uncounted" }))).toBe("lowered");
    expect(endMoneyFor(call({ endReportEffect: "whole" }))).toBe("not_lowered");
    expect(endMoneyFor(call({ billing: "together" }))).toBe("together");
    expect(endMoneyFor(call({ pricePer15Cents: 0 }))).toBe("free");
  });
});

describe("what the call's page says about the money", () => {
  const all: EndMoney[] = ["free", "together", "minutes", "whole", "lowered", "not_lowered"];
  it("a host is never told that she was reported: a lowered charge reads like any charge by the minutes", () => {
    for (const money of all) expect(END_WORDS.money("host", money, names) ?? "").not.toMatch(/report/i);
    expect(END_WORDS.money("host", "lowered", names)).toBe(END_WORDS.money("host", "minutes", names));
    // And a report that did not lower the charge reads, for her, like no report at all.
    expect(END_WORDS.money("host", "not_lowered", names)).toBe(END_WORDS.money("host", "whole", names));
  });
  it("the customer is told what his report did", () => {
    expect(END_WORDS.money("customer", "lowered", names)).toContain("You reported Maya after ending it");
    expect(END_WORDS.money("customer", "not_lowered", names)).toContain("still charged for your whole booked time");
    expect(END_WORDS.money("customer", "whole", names)).toContain("Time you waited for Maya is not charged");
  });
  it("no sentence accuses anybody", () => {
    for (const viewer of ["host", "customer", "admin"] as const) for (const money of all) expect(END_WORDS.money(viewer, money, names) ?? "").not.toMatch(/abus|fraud|cheat|false|lie/i);
    expect(`${END_WORDS.customerText("Maya")} ${END_WORDS.thanksNotLowered} ${END_WORDS.reportDoesNotLower}`).not.toMatch(/abus|fraud|cheat|false|lie/i);
  });
  it("a free call has no money line", () => {
    for (const viewer of ["host", "customer", "admin"] as const) expect(END_WORDS.money(viewer, "free", names)).toBeNull();
  });
  it("what the founder is told names the customer, the count, and no detail of a report", () => {
    const told = END_WORDS.founderText({ name: "Sam Customer", email: "sam@example.test" });
    expect(told).toContain("Sam Customer (sam@example.test)");
    expect(told).toContain("3 times among their last 5 calls");
    expect(told).toContain("Their reports and blocks still go through");
  });
});

describe("the thank-you after a report that decided a call's charge", () => {
  it("says what it did, after the usual thank-you; any other report says nothing about money", () => {
    const base = { reference: 9, block: "done" as const, callsNotCancelled: 0 };
    const usual = reportNotice(base).notice;
    expect(reportNotice({ ...base, endEffect: null }).notice).toBe(usual);
    expect(reportNotice({ ...base, endEffect: "minutes" }).notice).toBe(`${usual} ${END_WORDS.thanksLowered}`);
    expect(reportNotice({ ...base, endEffect: "minutes_uncounted" }).notice).toBe(`${usual} ${END_WORDS.thanksLowered}`);
    expect(reportNotice({ ...base, endEffect: "whole" }).notice).toBe(`${usual} ${END_WORDS.thanksNotLowered}`);
    // The receipt (with its Block button) is still decided by the block alone.
    expect(reportNotice({ ...base, block: "not_done", endEffect: "minutes" }).needsReceipt).toBe(true);
    expect(reportNotice({ ...base, endEffect: "whole" }).needsReceipt).toBe(false);
  });
});
