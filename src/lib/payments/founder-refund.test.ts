import { describe, expect, it, vi } from "vitest";

// The words and the sums only: what asks the database is covered by scripts/owed-check.ts.
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/refunds/emails", () => ({ queueRefundEmail: async () => undefined }));

import { refundAnswer, refundEstimate, refundReason, type RefundOutcome } from "./founder-refund";

const done: RefundOutcome = { paymentId: "p", amountCents: 500, status: "done", stripeRefundId: "re_1", failure: null, afterCollection: true, hostOwesCents: 464, sentCents: 1238, takeBack: "not_yet" };

describe("what the founder is told about a refund (plans/46-part-3-money-owed.md, decision 11)", () => {
  it("says the amount that was written down, never the one a form sent", () => {
    expect(refundAnswer(done, "founder")).toContain("$5.00 was given back to the customer from Connect's money. The host's share shrank by $4.64.");
  });

  it("says nothing was started when there is no line, or the refusal the request came back with", () => {
    expect(refundAnswer(null, "founder")).toContain("No refund was started");
    expect(refundAnswer(null, "founder", "That is more than what is left to refund.")).toBe("That is more than what is left to refund.");
  });

  it("tells a refund Stripe has accepted from one it has not answered about", () => {
    expect(refundAnswer({ ...done, status: "in_progress" }, "founder")).toContain("Stripe has accepted it and has not confirmed it yet");
    const unknown = refundAnswer({ ...done, status: "in_progress", stripeRefundId: null }, "founder");
    expect(unknown).toContain("it is not known whether Stripe received the request");
    expect(unknown).toContain("do not refund it a second time meanwhile");
    expect(unknown).not.toContain("accepted");
  });

  it("gives Stripe's reason for a refusal", () => {
    expect(refundAnswer({ ...done, status: "failed", failure: "insufficient_funds" }, "founder")).toBe("Stripe refused the refund of $5.00 (insufficient_funds). Nothing was given back. You can try again.");
    expect(refundAnswer({ ...done, status: "failed" }, "founder")).toBe("Stripe refused the refund of $5.00. Nothing was given back. You can try again.");
  });

  it("promises a notice only where something can be owed", () => {
    expect(refundAnswer(done, "founder")).toContain("never more than the $12.38 that was sent to them");
    const none = refundAnswer({ ...done, sentCents: 0 }, "founder");
    expect(none).toContain("Nothing can be taken back for it");
    expect(none).not.toContain("tells them");
    expect(refundAnswer({ ...done, takeBack: "nothing" }, "founder")).toContain("Nothing can be taken back for it");
    expect(refundAnswer({ ...done, takeBack: { status: "told", amountCents: 464 } }, "founder")).toContain("The host owes $4.64 and has been told.");
    expect(refundAnswer({ ...done, takeBack: { status: "waiting", amountCents: 464 } }, "founder")).toContain("The app does not take it by itself");
  });

  it("before collection nobody owes anything, and a host is told only that it was sent", () => {
    expect(refundAnswer({ ...done, afterCollection: false, hostOwesCents: 0 }, "founder")).toBe("$5.00 was given back to the customer. The host had not collected this share, so nobody owes anything.");
    expect(refundAnswer({ ...done, afterCollection: false, hostOwesCents: 0 }, "host")).toBe("The refund of $5.00 was sent to the customer.");
  });
});

describe("the estimate before the button is pressed", () => {
  const payment = { chargedCents: 10000, refundedCents: 0, originalHostShareCents: 8000, transferStatus: "sent", transferCents: 7975 };

  it("is what her share would lose, and never more than was really sent", () => {
    expect(refundEstimate(payment, 5000)).toEqual({ leftCents: 10000, hostOwesCents: 4000 });
    expect(refundEstimate(payment)).toEqual({ leftCents: 10000, hostOwesCents: 7975 });
  });

  it("is nothing when nothing was sent, or the host has not collected", () => {
    expect(refundEstimate({ ...payment, transferCents: 0 }).hostOwesCents).toBe(0);
    expect(refundEstimate({ ...payment, transferStatus: "due" }).hostOwesCents).toBe(0);
  });

  it("joins the ground and the founder's sentence", () => {
    expect(refundReason("host_absent", "  They never came.  ")).toBe("The host did not join the call. They never came.");
  });
});
