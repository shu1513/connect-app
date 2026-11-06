import { describe, expect, it } from "vitest";
import {
  cancellationOutcome,
  canMovePayment,
  canMoveTransfer,
  decisionDeadline,
  holdCoversCall,
  holdExpiry,
  paymentBlocksJoin,
  payWindow,
  transferDueAt,
} from "./rules";

const at = (iso: string) => new Date(iso);
// A call on Wednesday 13 January 2027, 09:00 to 10:00 UTC.
const START = at("2027-01-13T09:00:00Z");
const END = at("2027-01-13T10:00:00Z");

describe("payment stages", () => {
  it("allows the normal path: waiting, held, charged", () => {
    expect(canMovePayment("awaiting_payment", "held")).toBe(true);
    expect(canMovePayment("held", "charged")).toBe(true);
  });
  it("allows letting go without a charge, from waiting or from held", () => {
    expect(canMovePayment("awaiting_payment", "closed_uncharged")).toBe(true);
    expect(canMovePayment("held", "closed_uncharged")).toBe(true);
  });
  it("never charges without a hold first", () => {
    expect(canMovePayment("awaiting_payment", "charged")).toBe(false);
  });
  it("never goes backwards from charged or from closed", () => {
    for (const to of ["awaiting_payment", "held", "closed_uncharged"] as const) {
      expect(canMovePayment("charged", to)).toBe(false);
    }
    for (const to of ["awaiting_payment", "held", "charged"] as const) {
      expect(canMovePayment("closed_uncharged", to)).toBe(false);
    }
  });
});

describe("host share stages", () => {
  it("allows: not due, due, sent", () => {
    expect(canMoveTransfer("not_due", "due")).toBe(true);
    expect(canMoveTransfer("due", "sent")).toBe(true);
  });
  it("allows nothing owed, for example after a full refund", () => {
    expect(canMoveTransfer("not_due", "not_owed")).toBe(true);
    expect(canMoveTransfer("due", "not_owed")).toBe(true);
  });
  it("never sends before it is due, and never un-sends", () => {
    expect(canMoveTransfer("not_due", "sent")).toBe(false);
    expect(canMoveTransfer("sent", "due")).toBe(false);
    expect(canMoveTransfer("sent", "not_owed")).toBe(false);
  });
});

describe("cancelling", () => {
  const base = { startsAt: START, held: true };

  it("is always free for the host before the start", () => {
    expect(
      cancellationOutcome({ ...base, by: "host", now: at("2027-01-13T08:59:59Z"), freeCancelMinutes: 1440 }),
    ).toBe("free");
  });
  it("default rule: free for the customer right up to the start", () => {
    expect(
      cancellationOutcome({ ...base, by: "customer", now: at("2027-01-13T08:59:59Z"), freeCancelMinutes: 0 }),
    ).toBe("free");
  });
  it("is not allowed for anyone once the call has started", () => {
    for (const by of ["host", "customer"] as const) {
      expect(cancellationOutcome({ ...base, by, now: START, freeCancelMinutes: 0 })).toBe("not_allowed");
    }
  });
  it("12-hour rule: free one second before the cut-off, charged at the cut-off", () => {
    const rule = { ...base, by: "customer" as const, freeCancelMinutes: 720 };
    expect(cancellationOutcome({ ...rule, now: at("2027-01-12T20:59:59Z") })).toBe("free");
    expect(cancellationOutcome({ ...rule, now: at("2027-01-12T21:00:00Z") })).toBe("late_charge");
  });
  it("1-hour and 24-hour rules use their own cut-offs", () => {
    expect(
      cancellationOutcome({ ...base, by: "customer", now: at("2027-01-13T07:59:59Z"), freeCancelMinutes: 60 }),
    ).toBe("free");
    expect(
      cancellationOutcome({ ...base, by: "customer", now: at("2027-01-13T08:00:00Z"), freeCancelMinutes: 60 }),
    ).toBe("late_charge");
    expect(
      cancellationOutcome({ ...base, by: "customer", now: at("2027-01-12T09:00:00Z"), freeCancelMinutes: 1440 }),
    ).toBe("late_charge");
  });
  it("charges nothing for a late cancellation when no money was held", () => {
    expect(
      cancellationOutcome({
        by: "customer",
        now: at("2027-01-13T08:30:00Z"),
        startsAt: START,
        freeCancelMinutes: 1440,
        held: false,
      }),
    ).toBe("free");
  });
});

describe("when the customer can pay", () => {
  const call = { startsAt: START, endsAt: END };
  it("not more than 2 days before the start", () => {
    expect(payWindow({ ...call, now: at("2027-01-11T08:59:59Z") })).toBe("too_early");
    expect(payWindow({ ...call, now: at("2027-01-11T09:00:00Z") })).toBe("open");
  });
  it("still possible for a late customer while the call is running", () => {
    expect(payWindow({ ...call, now: at("2027-01-13T09:30:00Z") })).toBe("open");
  });
  it("not after the call is over", () => {
    expect(payWindow({ ...call, now: END })).toBe("call_over");
  });
});

describe("whether a hold is good enough to start the call", () => {
  it("is fine when the hold outlasts the call by more than a day", () => {
    expect(
      holdCoversCall({ now: at("2027-01-13T08:55:00Z"), holdExpiresAt: at("2027-01-16T00:00:00Z"), callEndsAt: END }),
    ).toBe(true);
  });
  it("is not fine once the hold has run out", () => {
    expect(
      holdCoversCall({ now: at("2027-01-16T00:00:00Z"), holdExpiresAt: at("2027-01-16T00:00:00Z"), callEndsAt: END }),
    ).toBe(false);
  });
  it("is not fine when the hold would run out less than a day after the call", () => {
    expect(
      holdCoversCall({ now: at("2027-01-13T08:55:00Z"), holdExpiresAt: at("2027-01-14T09:59:59Z"), callEndsAt: END }),
    ).toBe(false);
  });
  it("uses Stripe's expiry when given, and a cautious 4 days when not", () => {
    const heldAt = at("2027-01-11T12:00:00Z");
    expect(holdExpiry({ heldAt, captureBefore: at("2027-01-18T12:00:00Z") })).toEqual(at("2027-01-18T12:00:00Z"));
    expect(holdExpiry({ heldAt, captureBefore: null })).toEqual(at("2027-01-15T12:00:00Z"));
  });
});

describe("the deadline for deciding a call that needs review", () => {
  it("is 3 days after the call when the hold lasts long enough", () => {
    expect(decisionDeadline({ callEndsAt: END, holdExpiresAt: at("2027-01-20T00:00:00Z") })).toEqual(
      at("2027-01-16T10:00:00Z"),
    );
  });
  it("is 1 day before the hold runs out when that comes first", () => {
    expect(decisionDeadline({ callEndsAt: END, holdExpiresAt: at("2027-01-15T12:00:00Z") })).toEqual(
      at("2027-01-14T12:00:00Z"),
    );
  });
});

describe("the weekly payday", () => {
  it("is the first Monday at least 7 days after the call", () => {
    // Call ends Wed 13 Jan 10:00. Seven days later is Wed 20 Jan 10:00. Next Monday is 25 Jan.
    expect(transferDueAt(END)).toEqual(at("2027-01-25T00:00:00Z"));
  });
  it("is that same Monday when the 7 days end exactly at its start", () => {
    // Call ends Mon 11 Jan 00:00. Seven days later is Mon 18 Jan 00:00.
    expect(transferDueAt(at("2027-01-11T00:00:00Z"))).toEqual(at("2027-01-18T00:00:00Z"));
  });
  it("waits a week when the 7 days end partway through a Monday", () => {
    // Call ends Mon 11 Jan 10:00. Seven days later is Mon 18 Jan 10:00, after that payday began.
    expect(transferDueAt(at("2027-01-11T10:00:00Z"))).toEqual(at("2027-01-25T00:00:00Z"));
  });
});

describe("whether payment allows joining", () => {
  const base = { callEndsAt: END, now: at("2027-01-13T08:55:00Z") };
  const goodHold = at("2027-01-16T00:00:00Z");

  it("a free call can always be joined", () => {
    expect(paymentBlocksJoin({ ...base, payment: null })).toBeNull();
  });
  it("a paid call with a good hold can be joined", () => {
    expect(paymentBlocksJoin({ ...base, payment: { status: "held", holdExpiresAt: goodHold } })).toBeNull();
  });
  it("a paid call cannot be joined before the customer has paid", () => {
    expect(paymentBlocksJoin({ ...base, payment: { status: "awaiting_payment", holdExpiresAt: null } })).toBe("not_paid");
  });
  it("a paid call cannot be joined after its payment was closed", () => {
    expect(paymentBlocksJoin({ ...base, payment: { status: "closed_uncharged", holdExpiresAt: goodHold } })).toBe("not_paid");
  });
  it("a paid call cannot be joined when the hold has run out or will not last", () => {
    expect(paymentBlocksJoin({ ...base, payment: { status: "held", holdExpiresAt: at("2027-01-13T12:00:00Z") } })).toBe("hold_ended");
    expect(paymentBlocksJoin({ ...base, payment: { status: "held", holdExpiresAt: null } })).toBe("hold_ended");
  });
});
