import { describe, expect, it } from "vitest";
import { cancelledWords, cancelWords } from "./words";

describe("what cancelling would mean, said before it", () => {
  it("an ordinary call: free, or the booked price", () => {
    expect(cancelWords({ member: false, outcome: "free", bookedPrice: "$40.00" })).toBe("Cancelling now is free. Nothing is charged.");
    expect(cancelWords({ member: false, outcome: "late_charge", bookedPrice: "$40.00" })).toBe("Cancelling now is past the free period: the full $40.00 is charged. The host may choose to refund you.");
  });

  it("a member's call: the time is given back, or used", () => {
    expect(cancelWords({ member: true, outcome: "free", bookedPrice: "$40.00" })).toBe("Cancelling now is free. The membership time booked for this call is given back.");
    expect(cancelWords({ member: true, outcome: "late_charge", bookedPrice: "$40.00" })).toContain("all the membership time booked for this call ($40.00) is used");
  });

  it("a member's call in a frozen month: the time stays where it is, and what becomes of it afterwards is said", () => {
    for (const outcome of ["free", "late_charge"] as const) {
      const words = cancelWords({ member: true, outcome, bookedPrice: "$40.00", frozen: true });
      expect(words).toContain("frozen because of a dispute at the bank");
      expect(words).toContain("stays where it is");
      expect(words).toContain("If the month is freed again");
    }
    // What is agreed to, with its amount, for the day the month is freed again.
    expect(cancelWords({ member: true, outcome: "late_charge", bookedPrice: "$40.00", frozen: true })).toContain("all the membership time booked for this call ($40.00) is used");
    expect(cancelWords({ member: true, outcome: "free", bookedPrice: "$40.00", frozen: true })).toContain("the time booked for this call is given back");
    expect(cancelWords({ member: true, outcome: "free", bookedPrice: "$40.00", frozen: true })).not.toContain("is used");
  });
});

describe("what is said after a call was cancelled", () => {
  it("an ordinary call", () => {
    expect(cancelledWords({ member: false, outcome: "free" })).toBe("The call was cancelled. Nothing is charged.");
    expect(cancelledWords({ member: false, outcome: "late_charge" })).toBe("The call was cancelled after the free period, so the booked price is charged.");
  });

  it("a hold that is being let go is said to be on its way, not gone", () => {
    expect(cancelledWords({ member: false, outcome: "free", holdLetGo: true })).toBe("The call was cancelled. Nothing is charged, and the hold on the card is being let go.");
  });

  it("a member's call says what really became of the time", () => {
    expect(cancelledWords({ member: true, outcome: "free", memberMoney: "free" })).toBe("The call was cancelled. The time booked for it is back in the membership and can be booked again.");
    expect(cancelledWords({ member: true, outcome: "free", memberMoney: "card" })).toBe("The call was cancelled. What was set aside for it from the membership will be paid back to the card.");
    expect(cancelledWords({ member: true, outcome: "late_charge", memberMoney: "used" })).toBe("The call was cancelled after the free period, so all the membership time booked for it is used.");
    expect(cancelledWords({ member: true, outcome: "late_charge", memberMoney: "kept" })).toContain("stays where it is while that lasts");
    // Nothing was settled (the money waits for a review, say): nothing is promised.
    expect(cancelledWords({ member: true, outcome: "free", memberMoney: null })).toBe("The call was cancelled.");
  });

  it("never points at a part of a page that the phone app does not have", () => {
    for (const member of [true, false]) for (const outcome of ["free", "late_charge"] as const) for (const memberMoney of ["free", "card", "used", "kept", null] as const) expect(cancelledWords({ member, outcome, memberMoney })).not.toContain("below");
  });
});
