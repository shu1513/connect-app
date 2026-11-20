import { describe, expect, it } from "vitest";
import { asksByTime, dollars, hostedTotal } from "./calendar";
import { unsettled } from "./earned";

const at = (iso: string) => new Date(iso);
const asked = (startsAt: string, endsAt: string) => ({ startsAt: at(startsAt), endsAt: at(endsAt) });
const part = (status: string, shareCents = 0, needsReview = false) => ({ status, shareCents, needsReview });

describe("requests on the calendar", () => {
  const around = { from: at("2026-11-10T00:00:00Z"), to: at("2026-11-28T00:00:00Z") };
  it("are one for each time asked for, with how many asked, the soonest first", () => {
    const asks = asksByTime(
      [asked("2026-11-20T20:00:00Z", "2026-11-20T20:15:00Z"), asked("2026-11-19T18:00:00Z", "2026-11-19T18:30:00Z"), asked("2026-11-20T20:00:00Z", "2026-11-20T20:30:00Z"), asked("2026-11-20T20:00:00Z", "2026-11-20T20:05:00Z")],
      around,
    );
    expect(asks).toEqual([
      { startsAt: "2026-11-19T18:00:00.000Z", endsAt: "2026-11-19T18:30:00.000Z", count: 1 },
      // Three people asked for the same start; the block is as long as the longest of their calls.
      { startsAt: "2026-11-20T20:00:00.000Z", endsAt: "2026-11-20T20:30:00.000Z", count: 3 },
    ]);
  });
  it("leave out a time that does not touch the days the calendar was loaded for", () => {
    expect(asksByTime([asked("2026-12-05T20:00:00Z", "2026-12-05T20:30:00Z"), asked("2026-11-01T20:00:00Z", "2026-11-01T20:30:00Z")], around)).toEqual([]);
    expect(asksByTime([], around)).toEqual([]);
  });
  it("carry nothing but the times and the number", () => {
    const [one] = asksByTime([{ ...asked("2026-11-20T20:00:00Z", "2026-11-20T20:15:00Z"), note: "private words", customerId: "someone" } as { startsAt: Date; endsAt: Date }], around);
    expect(Object.keys(one).sort()).toEqual(["count", "endsAt", "startsAt"]);
  });
});

describe("the total over the calendar", () => {
  const hosted = (cents: number | null, moneyOpen = false) => ({ hosting: true, finished: true, moneyOpen, ...(cents === null ? {} : { earned: { cents } }) });
  it("is nothing to say when she hosted no call that is over", () => {
    expect(hostedTotal([])).toBeNull();
    expect(
      hostedTotal([
        { hosting: true, finished: false },
        { hosting: false, finished: true, earned: { cents: 500 } },
      ]),
    ).toBeNull();
  });
  it("counts the calls she hosted that are over, and adds what they earned", () => {
    expect(hostedTotal([hosted(3774), hosted(1872), hosted(0), { hosting: false, finished: true }, { hosting: true, finished: false }])).toEqual({ calls: 3, cents: 5646, soFar: false });
  });
  it("never adds what a call she booked cost, whatever it carries", () => {
    expect(hostedTotal([hosted(3774), { hosting: false, finished: true, earned: { cents: 9999 } }])).toEqual({ calls: 1, cents: 3774, soFar: false });
  });
  it("counts a call with no figure yet, and says so far while any money is not settled", () => {
    expect(hostedTotal([hosted(3774), hosted(null, true)])).toEqual({ calls: 2, cents: 3774, soFar: true });
    expect(hostedTotal([hosted(null)])).toEqual({ calls: 1, cents: 0, soFar: false });
  });
});

describe("money in the browser", () => {
  it("is written as everywhere else on the site", () => {
    expect(dollars(0)).toBe("$0.00");
    expect(dollars(5)).toBe("$0.05");
    expect(dollars(1333)).toBe("$13.33");
    expect(dollars(21240)).toBe("$212.40");
    expect(dollars(-250)).toBe("-$2.50");
  });
});

describe("money that is not settled yet", () => {
  it("is a part that is held, not paid, or waiting for a decision", () => {
    expect(unsettled([part("held")])).toBe(true);
    expect(unsettled([part("awaiting_payment")])).toBe(true);
    expect(unsettled([part("closed_uncharged", 0, true)])).toBe(true);
  });
  it("is not a call that is free, charged, or closed without a charge", () => {
    expect(unsettled([])).toBe(false);
    expect(unsettled([part("charged", 3800), part("closed_uncharged")])).toBe(false);
  });
});
