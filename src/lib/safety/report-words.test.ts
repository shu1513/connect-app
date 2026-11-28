import { describe, expect, it } from "vitest";
import { reportedBackWords, reportNotice } from "./report-words";

describe("what a reporter reads after a report was saved", () => {
  it("a report about a post, and a report whose block went through: the usual thank-you, no receipt", () => {
    expect(reportNotice({ reference: 7, block: "none", callsNotCancelled: 0 })).toEqual({ notice: "Thank you. Your report is R-7. We will look at it.", needsReceipt: false });
    const done = reportNotice({ reference: 7, block: "done", callsNotCancelled: 0 });
    expect(done.needsReceipt).toBe(false);
    expect(done.notice).toContain("R-7");
    expect(done.notice).toContain("you will not hear from this person");
  });

  it("blocked, but a future call could not be cancelled: said so, on the receipt with its Block button", () => {
    const one = reportNotice({ reference: 12, block: "done", callsNotCancelled: 1 });
    expect(one.needsReceipt).toBe(true);
    expect(one.notice).toContain("R-12");
    expect(one.notice).toContain("1 future call between you could not be cancelled");
    expect(reportNotice({ reference: 12, block: "done", callsNotCancelled: 2 }).notice).toContain("2 future calls");
  });

  it("the block is not there, or nobody could find out: the report's number, the truth, and the receipt", () => {
    const not = reportNotice({ reference: 31, block: "not_done", callsNotCancelled: 0 });
    expect(not).toEqual({ notice: "Your report was saved: R-31. This person is not blocked yet. Please block them.", needsReceipt: true });
    const unknown = reportNotice({ reference: 31, block: "unknown", callsNotCancelled: 0 });
    expect(unknown.needsReceipt).toBe(true);
    expect(unknown.notice).toContain("R-31");
    expect(unknown.notice).toContain("could not confirm the block");
    // Never the promise that only a block that stands can keep.
    for (const told of [not.notice, unknown.notice]) expect(told).not.toContain("will not hear from this person");
  });

  it("blocked, but the step stumbled after saving the block: the calls still to come are not called cancelled", () => {
    const unsure = reportNotice({ reference: 40, block: "done_unsure", callsNotCancelled: 0 });
    expect(unsure.needsReceipt).toBe(true);
    expect(unsure.notice).toContain("R-40");
    expect(unsure.notice).toContain("could not confirm that the future calls between you were cancelled");
  });

  it("no sentence names a button: the phone app shows the same sentence and has none there", () => {
    for (const block of ["none", "done", "done_unsure", "not_done", "unknown"] as const) {
      for (const callsNotCancelled of [0, 2]) expect(reportNotice({ reference: 1, block, callsNotCancelled }).notice).not.toMatch(/below|button|press/i);
    }
  });
});

describe("what the founder's list says when the two reported each other", () => {
  const names = { reporter: "Cory", reported: "Hana" };
  it("nothing when the reported person has made no report about the reporter", () => {
    expect(reportedBackWords({ count: 0, same: null }, names)).toBeNull();
  });
  it("both from one call or one request: said so, with any further reports counted apart", () => {
    expect(reportedBackWords({ count: 1, same: "call" }, names)).toBe("Both reported each other from this call: Hana has also reported Cory.");
    expect(reportedBackWords({ count: 1, same: "request" }, names)).toBe("Both reported each other from this request: Hana has also reported Cory.");
    expect(reportedBackWords({ count: 3, same: "call" }, names)).toBe("Both reported each other from this call: Hana has also reported Cory. Hana has made 2 other reports about Cory.");
    expect(reportedBackWords({ count: 2, same: "call" }, names)).toContain("1 other report about Cory.");
  });
  it("a report the other way from somewhere else: said, with how many", () => {
    expect(reportedBackWords({ count: 1, same: null }, names)).toBe("Both have reported each other: Hana has made 1 report about Cory, from somewhere else than this report.");
    expect(reportedBackWords({ count: 2, same: null }, names)).toContain("2 reports about Cory");
  });
});
