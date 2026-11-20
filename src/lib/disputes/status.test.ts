import { describe, expect, it } from "vitest";
import { anyBlocksMoney, blocksMoney, isAppeal, isCompliance, outcomeOf, reasonWords, stageOf, standingOf } from "./status";

/** Every status Stripe's library names (node_modules/stripe, Disputes.d.ts, `Dispute.Status`). */
const ALL = ["warning_needs_response", "warning_under_review", "warning_closed", "needs_response", "under_review", "appeal_needs_response", "appeal_under_review", "won", "lost", "prevented"];

describe("where a dispute stands", () => {
  it("knows which statuses wait for an answer", () => {
    expect(ALL.filter((status) => standingOf(status) === "waiting")).toEqual(["warning_needs_response", "needs_response"]);
  });

  it("knows which statuses are with the bank, the appeal states among them", () => {
    expect(ALL.filter((status) => standingOf(status) === "with_bank")).toEqual(["warning_under_review", "under_review", "appeal_needs_response", "appeal_under_review"]);
  });

  it("knows the three endings", () => {
    expect(outcomeOf("won")).toBe("won");
    expect(outcomeOf("lost")).toBe("lost");
    expect(outcomeOf("warning_closed")).toBe("closed");
    expect(outcomeOf("prevented")).toBe("closed");
    expect(ALL.filter((status) => outcomeOf(status) === null)).toEqual(["warning_needs_response", "warning_under_review", "needs_response", "under_review", "appeal_needs_response", "appeal_under_review"]);
  });

  it("never takes a status it does not know for an ending", () => {
    expect(standingOf("something_new")).toBe("with_bank");
    expect(outcomeOf("something_new")).toBeNull();
    expect(blocksMoney("something_new")).toBe(true);
  });
});

describe("the stage", () => {
  it("is a question for everything Stripe marks as a warning, a chargeback otherwise", () => {
    expect(ALL.filter((status) => stageOf(status) === "question")).toEqual(["warning_needs_response", "warning_under_review", "warning_closed"]);
    expect(stageOf("needs_response")).toBe("chargeback");
    expect(stageOf("lost")).toBe("chargeback");
  });

  it("changes when a question that was answered becomes a chargeback", () => {
    expect([stageOf("warning_under_review"), stageOf("needs_response")]).toEqual(["question", "chargeback"]);
    expect([standingOf("warning_under_review"), standingOf("needs_response")]).toEqual(["with_bank", "waiting"]);
  });
});

describe("what keeps money from moving", () => {
  it("knows an appeal, which is with the bank and not an ending", () => {
    expect(ALL.filter(isAppeal)).toEqual(["appeal_needs_response", "appeal_under_review"]);
    expect(ALL.filter(isAppeal).map(outcomeOf)).toEqual([null, null]);
  });

  it("is every open status and a lost dispute, as before", () => {
    // The list the money code used before this rule was written in one place (it was called BLOCKING_DISPUTE).
    const before = ["lost", "warning_needs_response", "warning_under_review", "needs_response", "under_review", "appeal_needs_response", "appeal_under_review"];
    expect(ALL.filter(blocksMoney).sort()).toEqual([...before].sort());
  });

  it("lets money move again after a win, and after a question that ended quietly", () => {
    expect(blocksMoney("won")).toBe(false);
    expect(blocksMoney("warning_closed")).toBe(false);
    expect(blocksMoney("prevented")).toBe(false);
  });

  it("looks at all disputes on one charge together", () => {
    expect(anyBlocksMoney([])).toBe(false);
    expect(anyBlocksMoney(["won"])).toBe(false);
    expect(anyBlocksMoney(["won", "warning_closed"])).toBe(false);
    // One won, and a second one still open or lost: the money stays where it is.
    expect(anyBlocksMoney(["won", "needs_response"])).toBe(true);
    expect(anyBlocksMoney(["won", "under_review"])).toBe(true);
    expect(anyBlocksMoney(["won", "lost"])).toBe(true);
    expect(anyBlocksMoney(["warning_closed", "warning_under_review"])).toBe(true);
    // The order Stripe lists them in makes no difference.
    expect(anyBlocksMoney(["lost", "won"])).toBe(true);
  });
});

describe("a compliance dispute", () => {
  it("is known by its reason or by Stripe's marks, for Visa and for Mastercard", () => {
    expect(isCompliance({ reason: "noncompliant" })).toBe(true);
    expect(isCompliance({ reason: "general", enhanced_eligibility_types: ["visa_compliance"] })).toBe(true);
    expect(isCompliance({ reason: "general", enhanced_eligibility_types: ["mastercard_compliance"] })).toBe(true);
  });

  it("is not every dispute with one of Stripe's marks", () => {
    expect(isCompliance({ reason: "fraudulent", enhanced_eligibility_types: ["visa_compelling_evidence_3"] })).toBe(false);
    expect(isCompliance({ reason: "fraudulent", enhanced_eligibility_types: [] })).toBe(false);
    expect(isCompliance({ reason: "fraudulent", enhanced_eligibility_types: null })).toBe(false);
    expect(isCompliance({ reason: "fraudulent" })).toBe(false);
  });
});

describe("the bank's reason in words", () => {
  it("has words for the reasons a card can give, and plain ones for anything else", () => {
    expect(reasonWords("fraudulent")).toContain("did not make");
    expect(reasonWords("product_not_received")).toContain("did not get");
    expect(reasonWords("general")).toBe("the bank gave no particular reason");
    expect(reasonWords("something_new")).toBe("the bank gave no particular reason");
  });
});
