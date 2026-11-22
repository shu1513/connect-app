import { describe, expect, it, vi } from "vitest";

// The words and the sums only: what asks the database is covered by scripts/owed-check.ts.
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/refunds/emails", () => ({ queueRefundEmail: async () => undefined }));

import { refundAnswer, refundEstimate, refundReason, type RefundOutcome } from "./founder-refund";

const done: RefundOutcome = { paymentId: "p", amountCents: 500, status: "done", stripeRefundId: "re_1", failure: null, failedAfterAll: false, afterCollection: true, hostOwesCents: 464, sentCents: 1238, takeBack: "not_yet" };

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
    // Nothing is said that is not known: neither that Stripe was asked, nor that an answer comes in minutes.
    expect(unknown).toContain("what came of it at Stripe is not confirmed yet: it may have gone through, or it may not have reached Stripe");
    expect(unknown).toContain("at the longest a day");
    expect(unknown).toContain("do not refund it a second time before that");
    expect(unknown).not.toContain("the app asked Stripe");
    expect(unknown).not.toContain("accepted");
  });

  it("does not say \"given back\" for a refund Stripe has failed after all, while the app is still undoing it", () => {
    const told = refundAnswer({ ...done, failedAfterAll: true, failure: "expired_or_canceled_card" }, "founder");
    expect(told).toContain("failed at Stripe after it had first gone through (expired_or_canceled_card): the customer did not get the money");
    expect(told).not.toContain("was given back");
  });

  it("gives Stripe's reason for a refusal", () => {
    expect(refundAnswer({ ...done, status: "failed", failure: "insufficient_funds" }, "founder")).toBe("Stripe refused the refund of $5.00 (insufficient_funds). Nothing was given back. You can try again.");
    expect(refundAnswer({ ...done, status: "failed" }, "founder")).toBe("Stripe refused the refund of $5.00. Nothing was given back. You can try again.");
  });

  it("promises a notice only where something can be owed, and nothing it does not know yet", () => {
    const early = refundAnswer(done, "founder");
    expect(early).toContain("works out whether the host owes anything for it (never more than is left of the $12.38 that was sent to them)");
    expect(early).toContain("If they do, they are told");
    expect(early).not.toContain("and tells them");
    const none = refundAnswer({ ...done, sentCents: 0 }, "founder");
    expect(none).toContain("Nothing can be taken back for it");
    expect(none).not.toContain("tells them");
    expect(refundAnswer({ ...done, takeBack: "nothing" }, "founder")).toContain("Nothing can be taken back for it");
    expect(refundAnswer({ ...done, takeBack: { status: "told", amountCents: 464 } }, "founder")).toContain("The host owes $4.64 and has been told.");
    expect(refundAnswer({ ...done, takeBack: { status: "waiting", amountCents: 464 } }, "founder")).toContain("The app does not take it by itself");
  });

  it("says where the take-back stands now, also when the same form is sent again later", () => {
    const at = (status: string, amountCents = 464) => refundAnswer({ ...done, takeBack: { status, amountCents } }, "founder");
    expect(at("objected")).toContain("has objected: nothing is taken until you have decided");
    expect(at("answered")).toContain("their objection was answered");
    expect(at("taking")).toContain("Stripe is being asked right now");
    expect(at("taken", 0)).toContain("What the host owed for it has been taken back.");
    expect(at("settled")).toContain("was settled outside the app");
    expect(at("cancelled")).toContain("was called off: the host owes nothing for it");
    // Never "owes ... and has been told" once it is over.
    for (const status of ["taken", "settled", "cancelled", "taking"]) expect(at(status)).not.toContain("and has been told");
  });

  it("before collection nobody owes anything, and a host is told only that it was sent", () => {
    expect(refundAnswer({ ...done, afterCollection: false, hostOwesCents: 0 }, "founder")).toBe("$5.00 was given back to the customer. The host had not collected this share, so nobody owes anything.");
    expect(refundAnswer({ ...done, afterCollection: false, hostOwesCents: 0 }, "host")).toBe("The refund of $5.00 was sent to the customer.");
  });
});

describe("the estimate before the button is pressed", () => {
  const payment = { chargedCents: 10000, refundedCents: 0, originalHostShareCents: 8000, transferStatus: "sent", transferCents: 7975 };

  it("is what her share would lose, and never more than was really sent", () => {
    expect(refundEstimate(payment, 5000)).toEqual({ leftCents: 10000, hostOwesCents: 4000, sentCents: 7975 });
    expect(refundEstimate(payment)).toEqual({ leftCents: 10000, hostOwesCents: 7975, sentCents: 7975 });
  });

  it("counts what earlier refunds already took: once they have used up all that was sent, a further refund adds nothing", () => {
    // 99.75 of 100 was refunded after the sending and took 79.80 off her share; the last 25 cents take 20 cents more.
    const late = { ...payment, refundedCents: 9975 };
    expect(refundEstimate(late, undefined, 7980).hostOwesCents).toBe(0);
    // Half was refunded and took 40.00: the other half can still cost her 39.75, not 40.00.
    expect(refundEstimate({ ...payment, refundedCents: 5000 }, undefined, 4000).hostOwesCents).toBe(3975);
  });

  it("is nothing when nothing was sent, or the host has not collected", () => {
    expect(refundEstimate({ ...payment, transferCents: 0 }).hostOwesCents).toBe(0);
    expect(refundEstimate({ ...payment, transferStatus: "due" }).hostOwesCents).toBe(0);
  });

  it("joins the ground and the founder's sentence", () => {
    expect(refundReason("host_absent", "  They never came.  ")).toBe("The host did not join the call. They never came.");
  });
});
