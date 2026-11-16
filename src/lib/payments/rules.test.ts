import { describe, expect, it } from "vitest";
import {
  cancellationOutcome,
  canMovePayment,
  canMoveTransfer,
  decisionDeadline,
  holdCoversCall,
  holdExpiry,
  moneyTiming,
  paymentBlocksJoin,
  canCollectAgainAt,
  heldBack,
  payWindow,
  readyToCollectAt,
  takeDecision,
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

describe("when the money for a call is taken", () => {
  const HOUR = 3_600_000;
  const plus = (date: Date, hours: number, minutes = 0) => new Date(date.getTime() + hours * HOUR + minutes * 60_000);
  // A booked call: the hold is placed 2 days before the start. START and END are a one-hour call.
  const HELD = plus(START, -48);
  const VISA = plus(HELD, 114); // 4 days 18 hours
  const SEVEN_DAYS = plus(HELD, 168); // Mastercard, American Express, Discover
  const NOT_GIVEN = plus(HELD, 96); // Stripe did not say: 4 days are assumed
  const LONG_END = plus(START, 6); // the same call with time added, up to six hours

  it("nobody asked: 24 hours and 10 minutes after the call, on any card", () => {
    for (const holdExpiresAt of [VISA, SEVEN_DAYS, NOT_GIVEN]) {
      const timing = moneyTiming({ callEndsAt: END, requestedAt: null, holdExpiresAt });
      expect(timing.askBy).toEqual(plus(END, 24));
      expect(timing.takeAt).toEqual(plus(END, 24, 10));
      expect(timing.answerBy).toBeNull();
    }
  });
  it("the hours of hold left on a Visa card are the ones in the plan", () => {
    const left = (moment: Date) => Math.round((VISA.getTime() - moment.getTime()) / HOUR);
    expect([left(END), left(plus(END, 24)), left(plus(END, 48))]).toEqual([65, 41, 17]);
    expect([left(LONG_END), left(plus(LONG_END, 24)), left(plus(LONG_END, 48))]).toEqual([60, 36, 12]);
  });
  it("a request gives the host 24 hours, and the money is taken 10 minutes after that", () => {
    const requestedAt = plus(END, 3);
    const timing = moneyTiming({ callEndsAt: END, requestedAt, holdExpiresAt: VISA });
    expect(timing.answerBy).toEqual(plus(requestedAt, 24));
    expect(timing.takeAt).toEqual(plus(requestedAt, 24, 10));
  });
  it("a customer who asks in the last minute of a one-hour call still leaves the host 24 hours", () => {
    const requestedAt = plus(END, 23, 59);
    for (const holdExpiresAt of [VISA, SEVEN_DAYS]) {
      const timing = moneyTiming({ callEndsAt: END, requestedAt, holdExpiresAt });
      expect(timing.answerBy).toEqual(plus(requestedAt, 24));
      expect(timing.takeAt.getTime()).toBeLessThanOrEqual(holdExpiresAt.getTime() - 12 * HOUR);
    }
  });
  it("the longest call on Visa, asked in the last minute: taken exactly 12 hours before the hold ends, and the host is told the shorter time", () => {
    const requestedAt = plus(LONG_END, 23, 59);
    const timing = moneyTiming({ callEndsAt: LONG_END, requestedAt, holdExpiresAt: VISA });
    expect(timing.takeAt).toEqual(plus(VISA, -12));
    expect(timing.answerBy).toEqual(plus(VISA, -12, -10));
    // A few minutes less than 24 hours, never more than the limit allows.
    expect(timing.answerBy!.getTime() - requestedAt.getTime()).toBe(24 * HOUR - 9 * 60_000);
  });
  it("when Stripe gives no end for the hold, the customer's 24 hours still fit; only the host's time shrinks", () => {
    for (const callEndsAt of [END, LONG_END]) {
      const quiet = moneyTiming({ callEndsAt, requestedAt: null, holdExpiresAt: NOT_GIVEN });
      expect(quiet.askBy).toEqual(plus(callEndsAt, 24));
      const asked = moneyTiming({ callEndsAt, requestedAt: plus(callEndsAt, 23, 59), holdExpiresAt: NOT_GIVEN });
      expect(asked.takeAt).toEqual(plus(NOT_GIVEN, -12));
      expect(asked.answerBy!.getTime()).toBeGreaterThan(plus(callEndsAt, 23, 59).getTime());
    }
    // About 11 hours after a one-hour call, about 6 after a six-hour call.
    const hostHours = (callEndsAt: Date) => {
      const requestedAt = plus(callEndsAt, 23, 59);
      return Math.round((moneyTiming({ callEndsAt, requestedAt, holdExpiresAt: NOT_GIVEN }).answerBy!.getTime() - requestedAt.getTime()) / HOUR);
    };
    expect([hostHours(END), hostHours(LONG_END)]).toEqual([11, 6]);
  });
  it("a hold that ends unusually soon shortens the customer's time too, and never the 12 hours", () => {
    const soon = plus(END, 30); // the hold ends 30 hours after the call
    const timing = moneyTiming({ callEndsAt: END, requestedAt: null, holdExpiresAt: soon });
    expect(timing.takeAt).toEqual(plus(END, 18));
    expect(timing.askBy).toEqual(plus(END, 17, 50));
  });
  it("by plan the money is never left on hold inside the last 12 hours", () => {
    for (const holdExpiresAt of [VISA, SEVEN_DAYS, NOT_GIVEN]) {
      for (const callEndsAt of [END, LONG_END]) {
        for (const requestedAt of [null, plus(callEndsAt, 0, 1), plus(callEndsAt, 12), plus(callEndsAt, 24)]) {
          expect(moneyTiming({ callEndsAt, requestedAt, holdExpiresAt }).takeAt.getTime()).toBeLessThanOrEqual(holdExpiresAt.getTime() - 12 * HOUR);
        }
      }
    }
  });

  const base = { callEndsAt: END, holdExpiresAt: VISA, requestedAt: null, decided: false };
  it("waits until the moment, then takes", () => {
    expect(takeDecision({ ...base, now: plus(END, 0, 5) })).toBe("wait");
    expect(takeDecision({ ...base, now: plus(END, 24, 9) })).toBe("wait");
    expect(takeDecision({ ...base, now: plus(END, 24, 10) })).toBe("take");
  });
  it("with a request it waits for the host, and takes at once when the host has answered", () => {
    const requestedAt = plus(END, 20);
    expect(takeDecision({ ...base, requestedAt, now: plus(END, 30) })).toBe("wait");
    expect(takeDecision({ ...base, requestedAt, decided: true, now: plus(END, 30) })).toBe("take");
    expect(takeDecision({ ...base, requestedAt, now: plus(requestedAt, 24, 9) })).toBe("wait");
    expect(takeDecision({ ...base, requestedAt, now: plus(requestedAt, 24, 10) })).toBe("take");
  });
  it("keeps trying after a missed moment for as long as the hold lasts, and not after", () => {
    expect(takeDecision({ ...base, now: plus(VISA, -1) })).toBe("take");
    expect(takeDecision({ ...base, now: plus(VISA, 0, -1) })).toBe("take");
    expect(takeDecision({ ...base, now: VISA })).toBe("hold_ended");
    expect(takeDecision({ ...base, decided: true, now: plus(VISA, 1) })).toBe("hold_ended");
  });
});

describe("when a share can be collected", () => {
  // The call ended Wed 13 Jan 10:00.
  const ONE_DAY = at("2027-01-14T10:00:00Z");
  const TWO_DAYS = at("2027-01-15T10:00:00Z");

  it("nobody asked for a refund: 24 hours after the call ends, and not before the charge is recorded", () => {
    // A charge recorded early (a late cancellation, a charge after a review) waits for the 24 hours.
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: at("2027-01-13T10:05:00Z"), refundAsked: false })).toEqual(ONE_DAY);
    // The usual case: the money is taken 24 hours and 10 minutes after the call, and the share is ready at that moment.
    const taken = at("2027-01-14T10:10:00Z");
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: taken, refundAsked: false })).toEqual(taken);
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: ONE_DAY, refundAsked: false })).toEqual(ONE_DAY);
  });
  it("the customer asked for a refund: 2 days after the call ends, to the minute, on any day of the week", () => {
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: at("2027-01-13T12:00:00Z"), refundAsked: true })).toEqual(TWO_DAYS);
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: at("2027-01-14T10:10:00Z"), refundAsked: true })).toEqual(TWO_DAYS);
  });
  it("with a request too, not before the charge is recorded, when that happens after the 2 days", () => {
    const late = at("2027-01-15T10:10:00Z");
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: late, refundAsked: true })).toEqual(late);
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: TWO_DAYS, refundAsked: true })).toEqual(TWO_DAYS);
  });
  it("just before the moment it is held back, and exactly at it it is not", () => {
    const share = { readyAt: TWO_DAYS, disputeOpen: false, refundOnItsWay: false, actionUnfinished: false };
    expect(heldBack({ ...share, now: at("2027-01-15T09:59:59Z") })).toBe("not_yet");
    expect(heldBack({ ...share, now: TWO_DAYS })).toBeNull();
    expect(heldBack({ ...share, readyAt: null, now: TWO_DAYS })).toBe("not_yet");
  });
  it("a dispute, a refund on its way or an unfinished money action each hold it back", () => {
    const share = { now: at("2027-01-20T00:00:00Z"), readyAt: TWO_DAYS, disputeOpen: false, refundOnItsWay: false, actionUnfinished: false };
    expect(heldBack({ ...share, disputeOpen: true })).toBe("dispute");
    expect(heldBack({ ...share, refundOnItsWay: true })).toBe("refund");
    expect(heldBack({ ...share, actionUnfinished: true })).toBe("being_sent");
    expect(heldBack({ ...share, disputeOpen: true, refundOnItsWay: true, actionUnfinished: true })).toBe("dispute");
    // A refund request on the call that is not answered, or whose answer is still being applied.
    expect(heldBack({ ...share, request: "request" })).toBe("request");
    expect(heldBack({ ...share, request: "answer_applying" })).toBe("answer_applying");
    expect(heldBack({ ...share, request: null })).toBeNull();
  });
  it("a host can collect again exactly 24 hours after the last time", () => {
    expect(canCollectAgainAt(null)).toBeNull();
    expect(canCollectAgainAt(at("2027-01-15T15:10:00Z"))).toEqual(at("2027-01-16T15:10:00Z"));
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
