import { describe, expect, it } from "vitest";
import { LENGTH_CHOICES_MINUTES } from "@/lib/booking/rules";
import {
  ASK_WINDOW_MS,
  DEADLINE_CUSHION_MS,
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
  it("a call whose two people may no longer act is cancelled for free by either of them, whatever the clock says", () => {
    const late = { ...base, by: "customer" as const, now: at("2027-01-13T08:30:00Z"), freeCancelMinutes: 1440 };
    // Past the free period, with the money held: a late charge as things stand, and free once the two may not act.
    expect(cancellationOutcome(late)).toBe("late_charge");
    expect(cancellationOutcome({ ...late, cannotGoAhead: false })).toBe("late_charge");
    expect(cancellationOutcome({ ...late, cannotGoAhead: true })).toBe("free");
    expect(cancellationOutcome({ ...late, by: "host", cannotGoAhead: true })).toBe("free");
  });
  it("a call that has started is not touched by that: it can no longer be cancelled", () => {
    for (const by of ["host", "customer"] as const) {
      expect(cancellationOutcome({ ...base, by, now: START, freeCancelMinutes: 1440, cannotGoAhead: true })).toBe("not_allowed");
    }
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

describe("the longest call that can be booked: 6 hours", () => {
  const HOUR = 3_600_000;
  const SIX_HOUR_END = at("2027-01-13T15:00:00Z");
  it("is covered by the earliest hold a card can have, with 18 hours to spare", () => {
    // Held 2 days before the start, and Stripe did not say when the hold ends: 4 days are assumed.
    const expiry = holdExpiry({ heldAt: at("2027-01-11T09:00:00Z"), captureBefore: null });
    expect(expiry).toEqual(at("2027-01-15T09:00:00Z"));
    expect(holdCoversCall({ now: START, holdExpiresAt: expiry, callEndsAt: SIX_HOUR_END })).toBe(true);
    expect(expiry.getTime() - (SIX_HOUR_END.getTime() + 24 * HOUR)).toBe(18 * HOUR);
    // A hold that ends a second too early does not cover it: the call cannot be joined on that hold.
    expect(holdCoversCall({ now: START, holdExpiresAt: at("2027-01-14T14:59:59Z"), callEndsAt: SIX_HOUR_END })).toBe(false);
  });
  it("leaves the customer 18 hours to ask for a refund, and less when the hold ends unusually early", () => {
    const usual = moneyTiming({ callStartsAt: START, requestedAt: null, holdExpiresAt: at("2027-01-15T09:00:00Z") });
    expect(usual.askBy.getTime() - SIX_HOUR_END.getTime()).toBe(18 * HOUR);
    // A hold that ends 25 hours after the call: the money is taken 12 hours before that, and asking ends 3 minutes earlier.
    const early = moneyTiming({ callStartsAt: START, requestedAt: null, holdExpiresAt: new Date(SIX_HOUR_END.getTime() + 25 * HOUR) });
    expect(early.askBy.getTime() - SIX_HOUR_END.getTime()).toBe(13 * HOUR - 3 * 60_000);
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

  it("nobody asked: the customer can ask until 24 hours after the call's start, and the money is taken 3 minutes later, on any card", () => {
    for (const holdExpiresAt of [VISA, SEVEN_DAYS, NOT_GIVEN]) {
      const timing = moneyTiming({ callStartsAt: START, requestedAt: null, holdExpiresAt });
      expect(timing.askBy).toEqual(plus(START, 24));
      expect(timing.takeAt).toEqual(plus(START, 24, 3));
      expect(timing.answerBy).toBeNull();
    }
  });
  it("the hours of hold left on a Visa card are the ones in the plan", () => {
    const left = (moment: Date) => Math.round((VISA.getTime() - moment.getTime()) / HOUR);
    expect([left(END), left(plus(END, 24)), left(plus(END, 48))]).toEqual([65, 41, 17]);
    expect([left(LONG_END), left(plus(LONG_END, 24)), left(plus(LONG_END, 48))]).toEqual([60, 36, 12]);
  });
  it("a request gives the host 24 hours, and the money is taken 3 minutes after that", () => {
    const requestedAt = plus(END, 3);
    const timing = moneyTiming({ callStartsAt: START, requestedAt, holdExpiresAt: VISA });
    expect(timing.answerBy).toEqual(plus(requestedAt, 24));
    expect(timing.takeAt).toEqual(plus(requestedAt, 24, 3));
  });
  it("a customer who asks in the last minute still leaves the host 24 hours, however long the call was", () => {
    // The times are counted from the call's start, so the call's length (and time added to it) plays no part.
    const requestedAt = plus(START, 23, 59);
    for (const holdExpiresAt of [VISA, SEVEN_DAYS]) {
      const timing = moneyTiming({ callStartsAt: START, requestedAt, holdExpiresAt });
      expect(timing.answerBy).toEqual(plus(requestedAt, 24));
      expect(timing.takeAt.getTime()).toBeLessThanOrEqual(holdExpiresAt.getTime() - 12 * HOUR);
    }
  });
  it("when Stripe gives no end for the hold, the customer's 24 hours still fit; only the host's time shrinks", () => {
    const quiet = moneyTiming({ callStartsAt: START, requestedAt: null, holdExpiresAt: NOT_GIVEN });
    expect(quiet.askBy).toEqual(plus(START, 24));
    const requestedAt = plus(START, 23, 59);
    const asked = moneyTiming({ callStartsAt: START, requestedAt, holdExpiresAt: NOT_GIVEN });
    // Taken exactly 12 hours before the hold ends, and the host is told the shorter time: about 12 hours.
    expect(asked.takeAt).toEqual(plus(NOT_GIVEN, -12));
    expect(asked.answerBy).toEqual(plus(NOT_GIVEN, -12, -3));
    expect(Math.round((asked.answerBy!.getTime() - requestedAt.getTime()) / HOUR)).toBe(12);
  });
  it("a hold that ends unusually soon shortens the customer's time too, and never the 12 hours", () => {
    const soon = plus(END, 30); // the hold ends 30 hours after the call
    const timing = moneyTiming({ callStartsAt: START, requestedAt: null, holdExpiresAt: soon });
    expect(timing.takeAt).toEqual(plus(END, 18));
    expect(timing.askBy).toEqual(plus(END, 17, 57));
  });
  it("by plan the money is never left on hold inside the last 12 hours", () => {
    for (const holdExpiresAt of [VISA, SEVEN_DAYS, NOT_GIVEN]) {
      for (const requestedAt of [null, plus(END, 0, 1), plus(START, 12), plus(START, 24)]) {
        expect(moneyTiming({ callStartsAt: START, requestedAt, holdExpiresAt }).takeAt.getTime()).toBeLessThanOrEqual(holdExpiresAt.getTime() - 12 * HOUR);
      }
    }
  });

  const base = { callStartsAt: START, holdExpiresAt: VISA, requestedAt: null, decided: false };
  it("waits until the moment, then takes", () => {
    expect(takeDecision({ ...base, now: plus(END, 0, 5) })).toBe("wait");
    expect(takeDecision({ ...base, now: plus(START, 24, 2) })).toBe("wait");
    expect(takeDecision({ ...base, now: plus(START, 24, 3) })).toBe("take");
  });
  it("with a request it waits for the host, and takes at once when the host has answered", () => {
    const requestedAt = plus(START, 20);
    expect(takeDecision({ ...base, requestedAt, now: plus(START, 30) })).toBe("wait");
    expect(takeDecision({ ...base, requestedAt, decided: true, now: plus(START, 30) })).toBe("take");
    expect(takeDecision({ ...base, requestedAt, now: plus(requestedAt, 24, 2) })).toBe("wait");
    expect(takeDecision({ ...base, requestedAt, now: plus(requestedAt, 24, 3) })).toBe("take");
  });
  it("keeps trying after a missed moment for as long as the hold lasts, and not after", () => {
    expect(takeDecision({ ...base, now: plus(VISA, -1) })).toBe("take");
    expect(takeDecision({ ...base, now: plus(VISA, 0, -1) })).toBe("take");
    expect(takeDecision({ ...base, now: VISA })).toBe("hold_ended");
    expect(takeDecision({ ...base, decided: true, now: plus(VISA, 1) })).toBe("hold_ended");
  });
});

describe("when a share can be collected", () => {
  // The call ran Wed 13 Jan 09:00 to 10:00. The customer can ask until 24 hours after its start (Thu 09:00), and a
  // request sent in the last seconds is accepted for 3 minutes more. The money of a call nobody asked about is taken then.
  const TAKEN = at("2027-01-14T09:03:00Z");
  const A_DAY_AFTER = at("2027-01-14T10:00:00Z");
  const TWO_DAYS = at("2027-01-15T10:00:00Z");

  it("nobody asked for a refund: ready 24 hours after the call ends", () => {
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: TAKEN, refundAsked: false })).toEqual(A_DAY_AFTER);
    // A charge after a review, an hour after the call, waits just the same.
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: at("2027-01-13T11:00:00Z"), refundAsked: false })).toEqual(A_DAY_AFTER);
  });
  it("and not before the charge is recorded, when that happens later", () => {
    const aLittleLate = at("2027-01-14T10:25:00Z");
    expect(readyToCollectAt({ callEndsAt: END, chargedAt: aLittleLate, refundAsked: false })).toEqual(aLittleLate);
  });
  it("a share is never ready while the customer could still ask, also after the shortest call a host can offer", () => {
    const shortest = Math.min(...LENGTH_CHOICES_MINUTES) * 60_000;
    expect(DEADLINE_CUSHION_MS).toBeLessThan(shortest);
    // A request is accepted before this moment, and not at it.
    const askingOver = START.getTime() + ASK_WINDOW_MS + DEADLINE_CUSHION_MS;
    const ready = readyToCollectAt({ callEndsAt: new Date(START.getTime() + shortest), chargedAt: START, refundAsked: false });
    expect(ready.getTime()).toBeGreaterThan(askingOver);
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
  it("a call paid from a membership can be joined while its money is set aside: there is no hold that could end", () => {
    expect(paymentBlocksJoin({ ...base, payment: { status: "held", holdExpiresAt: null, kind: "member_call" } })).toBeNull();
    expect(paymentBlocksJoin({ ...base, payment: { status: "closed_uncharged", holdExpiresAt: null, kind: "member_call" } })).toBe("not_paid");
    // A card payment with no hold end is still refused.
    expect(paymentBlocksJoin({ ...base, payment: { status: "held", holdExpiresAt: null, kind: "card" } })).toBe("hold_ended");
  });
  it("a paid call cannot be joined when the hold has run out or will not last", () => {
    expect(paymentBlocksJoin({ ...base, payment: { status: "held", holdExpiresAt: at("2027-01-13T12:00:00Z") } })).toBe("hold_ended");
    expect(paymentBlocksJoin({ ...base, payment: { status: "held", holdExpiresAt: null } })).toBe("hold_ended");
  });
});

describe("the moments of a call paid from a membership: no card hold cuts them short", () => {
  it("the customer can ask for 24 hours from the call's start, and the money is used 3 minutes later", () => {
    const timing = moneyTiming({ callStartsAt: START, requestedAt: null, holdExpiresAt: null });
    expect(timing.askBy.getTime()).toBe(START.getTime() + ASK_WINDOW_MS);
    expect(timing.answerBy).toBeNull();
    expect(timing.takeAt.getTime()).toBe(START.getTime() + ASK_WINDOW_MS + DEADLINE_CUSHION_MS);
  });
  it("with a request, the host has a full 24 hours from the request, however late it was sent", () => {
    const requestedAt = at("2027-01-14T08:59:00Z");
    const timing = moneyTiming({ callStartsAt: START, requestedAt, holdExpiresAt: null });
    expect(timing.answerBy!.getTime()).toBe(requestedAt.getTime() + 24 * 3_600_000);
    expect(timing.takeAt.getTime()).toBe(requestedAt.getTime() + 24 * 3_600_000 + DEADLINE_CUSHION_MS);
    // The same request on a card call whose hold ends sooner is cut short; the membership's is not.
    const cut = moneyTiming({ callStartsAt: START, requestedAt, holdExpiresAt: at("2027-01-15T00:00:00Z") });
    expect(cut.takeAt.getTime()).toBeLessThan(timing.takeAt.getTime());
  });
  it("it waits until its moment, is then used, and never counts as a hold that ended", () => {
    const before = { callStartsAt: START, requestedAt: null, decided: false, holdExpiresAt: null };
    expect(takeDecision({ ...before, now: at("2027-01-14T09:02:59Z") })).toBe("wait");
    expect(takeDecision({ ...before, now: at("2027-01-14T09:03:00Z") })).toBe("take");
    expect(takeDecision({ ...before, now: at("2027-03-01T00:00:00Z") })).toBe("take");
    expect(takeDecision({ ...before, decided: true, now: at("2027-01-13T10:30:00Z") })).toBe("take");
  });
});
