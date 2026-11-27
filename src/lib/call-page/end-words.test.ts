import { describe, expect, it } from "vitest";
import { reportNotice } from "@/lib/safety/report-words";
import { END_WORDS, endCostFor, endMoneyFor, type EndMoney } from "./end-words";

const names = { host: "Maya", customer: "Sam" };

describe("what a press costs, for the question before it", () => {
  it("a customer on a booked call is told his whole booked time is still charged", () => {
    expect(endCostFor({ role: "customer", billing: "host", pricePer15Cents: 2000, wholeBookingSaid: true })).toBe("whole_booking");
    expect(END_WORDS.sure("whole_booking")).toBe("End this call for both of you? Nobody will be able to come back in. Your whole booked time is still charged, except time the host was not in the call.");
    // Before the booked start it is charged as a cancellation at that moment would be, and the question says that.
    expect(endCostFor({ role: "customer", billing: "host", pricePer15Cents: 2000, wholeBookingSaid: true, beforeStart: true })).toBe("before_start");
    expect(END_WORDS.sure("before_start")).toContain("is charged as cancelling it now would be");
    // No question says that nobody CAN come back in: that is only known once the room is confirmed closed.
    for (const cost of ["free", "together", "host_minutes", "whole_booking", "before_start", "customer_minutes"] as const) expect(END_WORDS.sure(cost)).not.toMatch(/Nobody can come back in/);
  });
  it("a customer whose booking was made under words that did not say so is asked with what he was told: the host's time", () => {
    expect(endCostFor({ role: "customer", billing: "host", pricePer15Cents: 2000, wholeBookingSaid: false })).toBe("customer_minutes");
    expect(END_WORDS.sure("customer_minutes")).toContain("You pay for the time the host was in the call up to now.");
    expect(END_WORDS.sure("customer_minutes")).not.toContain("whole booked time");
  });
  it("a host is told she is paid for her time up to now", () => {
    expect(endCostFor({ role: "host", billing: "host", pricePer15Cents: 2000, wholeBookingSaid: true })).toBe("host_minutes");
    expect(END_WORDS.sure("host_minutes")).toContain("You are paid for your time up to now.");
  });
  it('an "available now" call charges the time both were in, whoever asks', () => {
    expect(endCostFor({ role: "customer", billing: "together", pricePer15Cents: 2000, wholeBookingSaid: true })).toBe("together");
    expect(endCostFor({ role: "host", billing: "together", pricePer15Cents: 2000, wholeBookingSaid: true })).toBe("together");
    expect(END_WORDS.sure("together")).toContain("The time you were both in the call is charged.");
  });
  it("a free call says nothing about money", () => {
    expect(endCostFor({ role: "customer", billing: "host", pricePer15Cents: 0, wholeBookingSaid: true })).toBe("free");
    expect(END_WORDS.sure("free")).toBe("End this call for both of you? Nobody will be able to come back in.");
  });
});

describe("how a call ended with the button is charged, from what is written on it", () => {
  const start = new Date("2027-01-10T20:00:00Z");
  const call = (over: Partial<Parameters<typeof endMoneyFor>[0]> = {}): Parameters<typeof endMoneyFor>[0] => ({ billing: "host", pricePer15Cents: 2000, endedNowBy: "customer", endReportEffect: null, startsAt: start, safetyEndedAt: new Date(start.getTime() + 600_000), freeCancelMinutes: 0, ...over });
  it("each case", () => {
    expect(endMoneyFor(call())).toBe("whole");
    expect(endMoneyFor(call({ endedNowBy: "host" }))).toBe("minutes");
    // The customer pressed without having been told that it costs the whole booking: by the host's time.
    expect(endMoneyFor(call({ endedNowBy: "customer_untold" }))).toBe("minutes");
    expect(endMoneyFor(call({ endReportEffect: "minutes" }))).toBe("lowered");
    expect(endMoneyFor(call({ endReportEffect: "minutes_uncounted" }))).toBe("lowered");
    expect(endMoneyFor(call({ endReportEffect: "whole" }))).toBe("not_lowered");
    expect(endMoneyFor(call({ billing: "together" }))).toBe("together");
    expect(endMoneyFor(call({ pricePer15Cents: 0 }))).toBe("free");
  });
  it("pressed before the booked start: as his cancelling at that moment would be charged", () => {
    const early = new Date(start.getTime() - 120_000);
    expect(endMoneyFor(call({ safetyEndedAt: early, freeCancelMinutes: 0 }))).toBe("free_early");
    expect(endMoneyFor(call({ safetyEndedAt: early, freeCancelMinutes: 60 }))).toBe("whole_early");
    // A customer who was never told pays nothing there either; the host's own press is by her minutes, which are none.
    expect(endMoneyFor(call({ safetyEndedAt: early, freeCancelMinutes: 0, endedNowBy: "customer_untold" }))).toBe("free_early");
    expect(endMoneyFor(call({ safetyEndedAt: early, freeCancelMinutes: 60, endedNowBy: "customer_untold" }))).toBe("minutes");
    expect(endMoneyFor(call({ safetyEndedAt: early, freeCancelMinutes: 60, endedNowBy: "host" }))).toBe("minutes");
    // A report after a late press before the start lowers it like any other.
    expect(endMoneyFor(call({ safetyEndedAt: early, freeCancelMinutes: 60, endReportEffect: "minutes" }))).toBe("lowered");
  });
});

describe("what the call's page says about the money", () => {
  const all: EndMoney[] = ["free", "together", "minutes", "whole", "free_early", "whole_early", "lowered", "not_lowered"];
  it("a host is never told that she was reported: a lowered charge reads like any charge by the minutes", () => {
    for (const money of all) expect(END_WORDS.money("host", money, names) ?? "").not.toMatch(/report/i);
    expect(END_WORDS.money("host", "lowered", names)).toBe(END_WORDS.money("host", "minutes", names));
    // And a report that did not lower the charge reads, for her, like no report at all.
    expect(END_WORDS.money("host", "not_lowered", names)).toBe(END_WORDS.money("host", "whole", names));
  });
  it("the customer is told what his report did", () => {
    expect(END_WORDS.money("customer", "lowered", names)).toContain("You reported Maya after ending it");
    // No promise that a block stands: the block follows the report and can fail by itself.
    expect(END_WORDS.customerText("Maya")).not.toMatch(/blocked/i);
    expect(END_WORDS.money("customer", "not_lowered", names)).toContain("It does not change what this call is charged");
    expect(END_WORDS.money("customer", "whole", names)).toContain("Time you waited for Maya is not charged");
  });
  it("no sentence promises the whole booking where the host may not have been in the call, or where the money can come to nothing", () => {
    // While it is not known whether she was there at that moment, both people read the condition.
    expect(END_WORDS.money("customer", "whole", names)).toContain("if Maya was not in the call when you ended it, neither is the rest");
    expect(END_WORDS.money("host", "whole", names)).toContain("if you were in the call at that moment");
    // A report that was not lowered says only that it changes nothing, never an amount.
    expect(`${END_WORDS.thanksNotLowered} ${END_WORDS.customerText("Maya")} ${END_WORDS.money("customer", "not_lowered", names)}`).not.toMatch(/still charged for (the|your) whole booked time/);
    expect(END_WORDS.money("customer", "free_early", names)).toContain("nothing is charged");
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
    // A part of the call's money was already taken: that is said, and nothing more is promised.
    expect(reportNotice({ ...base, endEffect: "minutes", endPartly: true }).notice).toBe(`${usual} ${END_WORDS.thanksLoweredPartly}`);
    // All of it was taken before the report arrived: said too, so the form's promise is not left hanging.
    expect(reportNotice({ ...base, endEffect: null, endTooLate: true }).notice).toBe(`${usual} ${END_WORDS.thanksTooLate}`);
    // The receipt (with its Block button) is still decided by the block alone.
    expect(reportNotice({ ...base, block: "not_done", endEffect: "minutes" }).needsReceipt).toBe(true);
    expect(reportNotice({ ...base, endEffect: "whole" }).needsReceipt).toBe(false);
  });
});
