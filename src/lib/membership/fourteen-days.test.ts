import { describe, expect, it, vi } from "vitest";

// The rules below are plain; the file they live in also talks to the database and to Stripe.
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/safety/audit", () => ({}));
vi.mock("@/lib/booking/emails", () => ({}));
vi.mock("./ending", () => ({}));
vi.mock("./join", () => ({}));
vi.mock("./locks", () => ({}));
vi.mock("./state", () => ({}));

import { dayOf, DAYS_OVER_FOR_MEMBER, fourteenDayNote, lastDayFor, requestDayRefusal, WHY_FOR_FOUNDER, WHY_FOR_MEMBER, withinTheDays } from "./fourteen-days";

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

describe("why it is not open", () => {
  it("has a sentence for the founder and one for the member, for every reason", () => {
    for (const why of Object.keys(WHY_FOR_FOUNDER) as Array<keyof typeof WHY_FOR_FOUNDER>) {
      expect(WHY_FOR_FOUNDER[why].length).toBeGreaterThan(10);
      expect(WHY_FOR_MEMBER[why].length).toBeGreaterThan(10);
    }
  });

  it("never tells a member to settle something by hand, and points to the normal way where there is one", () => {
    for (const sentence of [...Object.values(WHY_FOR_MEMBER), DAYS_OVER_FOR_MEMBER]) expect(sentence).not.toContain("by hand");
    expect(DAYS_OVER_FOR_MEMBER).toContain('"Cancel at the end of the month"');
    expect(WHY_FOR_MEMBER.month_over).toContain('"Cancel at the end of the month"');
    expect(WHY_FOR_FOUNDER.month_over).toContain("settle this case by hand");
  });
});

describe("what the member is told", () => {
  it("says who cancelled: the member themselves, or Connect on the day their request arrived", () => {
    expect(fourteenDayNote({ requestDay: null, monthTaken: false, stays: [], unsettled: 0 })).toContain("You cancelled your new membership within 14 days of joining.");
    expect(fourteenDayNote({ requestDay: "2026-11-10", monthTaken: false, stays: [], unsettled: 0 })).toContain("your request reached us on 2026-11-10");
  });

  it("says nothing was charged when the month was only held", () => {
    const note = fourteenDayNote({ requestDay: null, monthTaken: false, stays: [], unsettled: 0 });
    expect(note).toContain("Nothing was charged for it: an amount that was only held on your card is let go.");
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
    expect(note).toContain("These stay paid for, at the member price:");
    expect(note).toContain("- your call on Monday, November 9 at 3:00 PM: $40.00 (the time you used)");
    expect(note).toContain("- your call on Tuesday, November 10 at 3:00 PM: $20.00 (it was cancelled late or missed, and charged under your booking's terms)");
  });

  it("says that a call that has begun and is not worked out yet is paid for as usual", () => {
    expect(fourteenDayNote({ requestDay: null, monthTaken: true, stays: [], unsettled: 1 })).toContain("One call that had already begun or taken place is not worked out yet. What it comes to is paid for at the member price");
    expect(fourteenDayNote({ requestDay: null, monthTaken: true, stays: [], unsettled: 2 })).toContain("2 calls that had already begun or taken place are not worked out yet. What they come to is paid for");
  });
});
