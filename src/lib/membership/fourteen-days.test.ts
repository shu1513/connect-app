import { describe, expect, it, vi } from "vitest";

// The rules below are plain; the file they live in also talks to the database and to Stripe.
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/safety/audit", () => ({}));
vi.mock("@/lib/booking/emails", () => ({}));
vi.mock("./ending", () => ({}));
vi.mock("./join", () => ({}));
vi.mock("./locks", () => ({}));
vi.mock("./state", () => ({}));

import { BEING_TAKEN, callsForNote, CALLS_NOT_CANCELLED, MONTH_ENDED_UNFINISHED, STOPPED_MEANWHILE, dayOf, DAYS_OVER_FOR_MEMBER, fourteenDayNote, lastDayFor, memberInTime, NOTHING_ON_RECORD, NotFinishedYet, requestDayRefusal, requestOnRecord, WHY_FOR_FOUNDER, WHY_FOR_MEMBER, withinTheDays, type CallPayment } from "./fourteen-days";
import { MembershipError } from "./rules";

const at = (iso: string) => new Date(iso);
const joinedAt = at("2026-11-04T22:30:00Z");
const now = at("2026-11-24T09:00:00Z");
const refusal = (requestDay: string, today = now) => requestDayRefusal({ requestDay, joinedAt, now: today });

describe("the 14 days", () => {
  it("count from the day of joining, in UTC", () => {
    expect(dayOf(joinedAt)).toBe("2026-11-04");
    expect(lastDayFor(joinedAt)).toBe("2026-11-18");
  });

  it("the member's own button is open through the whole of day 14, and closed on day 15", () => {
    expect(withinTheDays(joinedAt, at("2026-11-04T22:30:01Z"))).toBe(true);
    expect(withinTheDays(joinedAt, at("2026-11-18T23:59:59Z"))).toBe(true);
    expect(withinTheDays(joinedAt, at("2026-11-19T00:00:00Z"))).toBe(false);
  });
});

describe("the day a written request reached Connect, as the founder enters it", () => {
  it("accepts the day of joining, and day 14, also when it is handled later", () => {
    expect(refusal("2026-11-04")).toBeNull();
    expect(refusal("2026-11-18")).toBeNull();
  });

  it("refuses day 15, and says what the last day was", () => {
    expect(refusal("2026-11-19")).toContain("more than 14 days after joining: the last day was 2026-11-18");
  });

  it("refuses a day before joining", () => {
    expect(refusal("2026-11-03")).toContain("before the day of joining (2026-11-04)");
  });

  it("refuses a day later than today", () => {
    expect(refusal("2026-11-10", at("2026-11-09T23:59:00Z"))).toContain("cannot be later than today");
    expect(refusal("2026-11-09", at("2026-11-09T00:00:01Z"))).toBeNull();
  });

  it("refuses what is not a day", () => {
    for (const typed of ["", "18/11/2026", "2026-11-18T00:00", "2026-02-31", "2026-13-01", "yesterday"]) expect(refusal(typed)).toBe("Enter the day the member's request reached Connect.");
  });
});

describe("a request that is on record", () => {
  const month = "11111111-1111-4111-8111-111111111111";
  const otherMonth = "22222222-2222-4222-8222-222222222222";
  const nothing = { fourteenAskedAt: null, fourteenMonthId: null, fourteenAdminId: null, fourteenRequestDay: null };
  const pressedOnDay14 = { ...nothing, fourteenAskedAt: at("2026-11-18T23:59:30Z"), fourteenMonthId: month };
  const inWriting = { ...pressedOnDay14, fourteenAdminId: "admin-1", fourteenRequestDay: "2026-11-10" };

  it("is there only with its moment, and only for the month it was asked for", () => {
    expect(requestOnRecord(nothing, month)).toBeNull();
    expect(requestOnRecord(pressedOnDay14, month)).toEqual({ askedAt: at("2026-11-18T23:59:30Z"), by: { as: "member" } });
    expect(requestOnRecord(pressedOnDay14, otherMonth)).toBeNull();
  });

  it("says who asked: the member with their own button, or the founder with the day a written request arrived", () => {
    expect(requestOnRecord(inWriting, month)?.by).toEqual({ as: "founder", adminId: "admin-1", requestDay: "2026-11-10" });
    expect(requestOnRecord(pressedOnDay14, month)?.by).toEqual({ as: "member" });
  });

  it("keeps the member's press in time after the last day, and for as long as it takes", () => {
    const onRecord = requestOnRecord(pressedOnDay14, month);
    expect(memberInTime({ joinedAt, now: at("2026-11-19T00:00:01Z"), onRecord })).toBe(true);
    expect(memberInTime({ joinedAt, now: at("2026-12-01T10:00:00Z"), onRecord })).toBe(true);
  });

  it("without one, the member's press is judged by the day it is made: day 14 yes, day 15 no", () => {
    expect(memberInTime({ joinedAt, now: at("2026-11-18T23:59:59Z"), onRecord: null })).toBe(true);
    expect(memberInTime({ joinedAt, now: at("2026-11-19T00:00:00Z"), onRecord: null })).toBe(false);
    // One that was written down for another month counts for nothing.
    expect(memberInTime({ joinedAt, now: at("2026-11-19T00:00:00Z"), onRecord: requestOnRecord(pressedOnDay14, otherMonth) })).toBe(false);
  });

  it("the founder's form is never refused for the day of a press that was in time, whenever it is handled", () => {
    for (const pressed of ["2026-11-04T22:30:01Z", "2026-11-11T08:00:00Z", "2026-11-18T23:59:59Z"]) expect(refusal(dayOf(at(pressed)), at("2026-12-02T09:00:00Z"))).toBeNull();
  });

  it("tells whoever pressed that it is on record and goes on by itself, when it could not be finished", () => {
    for (const sentence of [CALLS_NOT_CANCELLED, BEING_TAKEN]) {
      expect(sentence).toContain("was not cancelled yet");
      expect(sentence).toContain("on record with the moment it was first made, so the 14 days cannot run out on it");
      expect(sentence).toContain("Connect keeps trying to finish it by itself");
      expect(sentence).not.toContain("Nothing was changed");
    }
    // Not a refusal like the others (calls may have been cancelled), but still a sentence for a person.
    expect(new NotFinishedYet(CALLS_NOT_CANCELLED)).toBeInstanceOf(MembershipError);
    expect(NOTHING_ON_RECORD).toContain("No request");
  });

  it("never says \"nothing was changed\" for a rule that stops it after the cancelling had begun, and sends the founder to settle a month that ended", () => {
    expect(STOPPED_MEANWHILE).toContain("may already have been cancelled");
    expect(STOPPED_MEANWHILE).toContain("stays on record");
    expect(STOPPED_MEANWHILE).not.toContain("Nothing was changed");
    expect(MONTH_ENDED_UNFINISHED).toContain("settle this case by hand");
  });
});

describe("why it is not open", () => {
  it("has a sentence for the founder and one for the member, for every reason", () => {
    for (const why of Object.keys(WHY_FOR_FOUNDER) as Array<keyof typeof WHY_FOR_FOUNDER>) {
      expect(WHY_FOR_FOUNDER[why].length).toBeGreaterThan(10);
      expect(WHY_FOR_MEMBER[why].length).toBeGreaterThan(10);
    }
  });

  it("never tells a member to settle something by hand, and points to the normal way where there is one", () => {
    for (const sentence of [...Object.values(WHY_FOR_MEMBER), DAYS_OVER_FOR_MEMBER]) expect(sentence).not.toContain("by hand");
    expect(DAYS_OVER_FOR_MEMBER).toContain("The normal way of cancelling is still there");
    expect(WHY_FOR_MEMBER.month_over).toContain("The normal way of cancelling is still there");
    expect(WHY_FOR_FOUNDER.month_over).toContain("settle this case by hand");
    // No button is named that may not be on the page (one who already stopped the renewal has no such button).
    for (const sentence of [...Object.values(WHY_FOR_MEMBER), DAYS_OVER_FOR_MEMBER]) expect(sentence).not.toContain("Cancel at the end of the month");
  });

  it("sends a month whose payment has a problem to the founder, and the member to us", () => {
    expect(WHY_FOR_FOUNDER.problem).toContain("settle the payment by hand");
    expect(WHY_FOR_MEMBER.problem).toContain("please write to us");
  });
});

describe("what the member is told", () => {
  it("says who cancelled: the member themselves, or Connect on the day their request arrived", () => {
    expect(fourteenDayNote({ requestDay: null, monthTaken: false, stays: [], unsettled: 0 })).toContain("You cancelled your new membership within 14 days of joining.");
    expect(fourteenDayNote({ requestDay: "2026-11-10", monthTaken: false, stays: [], unsettled: 0 })).toContain("your request reached us on 2026-11-10");
  });

  it("says nothing was charged when the month was only held", () => {
    const note = fourteenDayNote({ requestDay: null, monthTaken: false, stays: [], unsettled: 0 });
    expect(note).toContain("Nothing was charged for it: the amount that was only held on your card is let go.");
    expect(note).not.toContain("an email of its own");
    expect(note).not.toContain("stay paid for");
  });

  it("says the whole month goes back when nothing was used, with no list to point at", () => {
    const note = fourteenDayNote({ requestDay: null, monthTaken: true, stays: [], unsettled: 0 });
    expect(note).toContain("What you paid for this month is given back to your card. Each amount is confirmed");
    expect(note).not.toContain("listed below");
  });

  it("names each call that stays paid for, and why", () => {
    const note = fourteenDayNote({
      requestDay: null,
      monthTaken: true,
      stays: [
        { when: "Monday, November 9 at 3:00 PM", amount: "$40.00", why: "used" },
        { when: "Tuesday, November 10 at 3:00 PM", amount: "$20.00", why: "late" },
      ],
      unsettled: 0,
    });
    expect(note).toContain("What you paid for this month is given back to your card, except for what is listed below.");
    expect(note).toContain("These stay paid for, at the member price, under your booking's terms:");
    expect(note).toContain("- your call on Monday, November 9 at 3:00 PM: $40.00 (charged for the call)");
    expect(note).toContain("- your call on Tuesday, November 10 at 3:00 PM: $20.00 (charged because it was cancelled late)");
  });

  it("says that a call that has begun and is not worked out yet is paid for as usual", () => {
    expect(fourteenDayNote({ requestDay: null, monthTaken: true, stays: [], unsettled: 1 })).toContain("One call that had already begun or taken place is not worked out yet. What it comes to is paid for at the member price");
    expect(fourteenDayNote({ requestDay: null, monthTaken: true, stays: [], unsettled: 2 })).toContain("2 calls that had already begun or taken place are not worked out yet. What they come to is paid for");
  });
});

describe("the calls the note lists", () => {
  const at0 = new Date("2026-11-10T12:00:00Z");
  const call = (over: Partial<CallPayment>): CallPayment => ({ callId: "a", startsAt: new Date("2026-11-09T15:00:00Z"), cancelledAt: null, status: "charged", chargedCents: 1500, refundedCents: 0, chargeReason: "attendance", ...over });

  it("lists what is kept now: after a part was given back, only the rest; nothing for a call given back whole", () => {
    expect(callsForNote([call({ refundedCents: 1000 })], at0).stays).toEqual([{ startsAt: new Date("2026-11-09T15:00:00Z"), keptCents: 500, why: "used" }]);
    expect(callsForNote([call({ refundedCents: 1500 })], at0).stays).toEqual([]);
  });

  it("is one line for a call, also when time was added to it from the membership", () => {
    const both = callsForNote([call({}), call({ chargedCents: 750 })], at0);
    expect(both.stays).toHaveLength(1);
    expect(both.stays[0].keptCents).toBe(2250);
  });

  it("says a late cancellation as one", () => {
    expect(callsForNote([call({ chargeReason: "late_cancel" })], at0).stays[0].why).toBe("late");
  });

  it("counts a call that has begun and is not worked out once, and never one still to come", () => {
    const begun = { status: "held", chargedCents: null, startsAt: new Date("2026-11-10T11:50:00Z") };
    expect(callsForNote([call({ callId: "b", ...begun }), call({ callId: "b", ...begun })], at0).unsettled).toBe(1);
    expect(callsForNote([call({ callId: "c", status: "held", chargedCents: null, startsAt: new Date("2026-11-12T15:00:00Z") })], at0).unsettled).toBe(0);
  });
});
