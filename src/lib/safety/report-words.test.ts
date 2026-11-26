import { describe, expect, it } from "vitest";
import { reportNotice } from "./report-words";

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
    expect(not).toEqual({ notice: 'Your report was saved: R-31. This person is not blocked yet. Press "Block" below.', needsReceipt: true });
    const unknown = reportNotice({ reference: 31, block: "unknown", callsNotCancelled: 0 });
    expect(unknown.needsReceipt).toBe(true);
    expect(unknown.notice).toContain("R-31");
    expect(unknown.notice).toContain("could not confirm the block");
    // Never the promise that only a block that stands can keep.
    for (const told of [not.notice, unknown.notice]) expect(told).not.toContain("will not hear from this person");
  });
});
