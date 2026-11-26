import { describe, expect, it } from "vitest";
import { chargedSeconds, hostThereAt, HOST_THERE_LEEWAY_SECONDS, restIsCharged, type EndedNow } from "./ended";
import { attendanceChargeCents } from "./pricing";

const pressed = (over: Partial<EndedNow>): EndedNow => ({ by: "customer", loweredByReport: false, beforeStart: false, lateToCancel: false, hostThere: true, ...over });

describe("whether the rest of the booking is charged", () => {
  it("the customer pressed with the host in the call: yes", () => {
    expect(restIsCharged("host", pressed({}))).toBe(true);
  });
  it("the host pressed: never", () => {
    expect(restIsCharged("host", pressed({ by: "host" }))).toBe(false);
    expect(restIsCharged("host", pressed({ by: "host", beforeStart: true, lateToCancel: true }))).toBe(false);
  });
  it("his report lowered it: no, whatever else is true", () => {
    expect(restIsCharged("host", pressed({ loweredByReport: true }))).toBe(false);
    expect(restIsCharged("host", pressed({ loweredByReport: true, beforeStart: true, lateToCancel: true }))).toBe(false);
  });
  it("the host was not in the call when he pressed: no", () => {
    expect(restIsCharged("host", pressed({ hostThere: false }))).toBe(false);
  });
  it("pressed before the booked start: as his cancelling then would be charged, whether or not she was there", () => {
    expect(restIsCharged("host", pressed({ beforeStart: true, lateToCancel: true, hostThere: false }))).toBe(true);
    expect(restIsCharged("host", pressed({ beforeStart: true, lateToCancel: false, hostThere: true }))).toBe(false);
  });
  it('an "available now" call: never', () => {
    expect(restIsCharged("together", pressed({}))).toBe(false);
  });
  it("a call that was not ended with the button, or with the old one: never", () => {
    expect(restIsCharged("host", null)).toBe(false);
  });
});

describe("whether the host was in the call at the press", () => {
  const at = 10_000;
  it("her connection reached the press", () => {
    expect(hostThereAt([{ start: at - 600, end: at }], at)).toBe(true);
  });
  it("it ended a moment before: still yes, up to the leeway", () => {
    expect(hostThereAt([{ start: at - 600, end: at - HOST_THERE_LEEWAY_SECONDS }], at)).toBe(true);
    expect(hostThereAt([{ start: at - 600, end: at - HOST_THERE_LEEWAY_SECONDS - 1 }], at)).toBe(false);
  });
  it("she never came", () => {
    expect(hostThereAt([], at)).toBe(false);
  });
  it("she came, left long ago, and the latest period is what counts", () => {
    expect(hostThereAt([{ start: at - 900, end: at - 800 }, { start: at - 700, end: at - 500 }], at)).toBe(false);
    expect(hostThereAt([{ start: at - 900, end: at - 800 }, { start: at - 100, end: at }], at)).toBe(true);
  });
});

describe("the seconds a payment is charged for", () => {
  // A 30-minute call at $20 per 15 minutes, ended after 10 minutes; the host was there for 8 of them.
  const before = { countedSeconds: 480, countedLength: 600, fullLength: 1800 };
  const cents = (restCharged: boolean) => {
    const { seconds, outOf } = chargedSeconds({ ...before, restCharged });
    return attendanceChargeCents({ pricePer15Cents: 2000, bookedSeconds: outOf, countedSeconds: seconds });
  };
  it("by the minutes: her time before the press", () => {
    expect(chargedSeconds({ ...before, restCharged: false })).toEqual({ seconds: 480, outOf: 600 });
    expect(cents(false)).toBe(1067);
  });
  it("the whole booking: her time before the press, plus the rest, and not the minutes he waited", () => {
    expect(chargedSeconds({ ...before, restCharged: true })).toEqual({ seconds: 480 + 1200, outOf: 1800 });
    expect(cents(true)).toBe(3733);
  });
  it("she was there all along: exactly the booked price", () => {
    const { seconds, outOf } = chargedSeconds({ countedSeconds: 600, countedLength: 600, fullLength: 1800, restCharged: true });
    expect(attendanceChargeCents({ pricePer15Cents: 2000, bookedSeconds: outOf, countedSeconds: seconds })).toBe(4000);
  });
  it("a stretch that lies wholly after the press (time added, then the call ended): all of it, or none of it", () => {
    expect(chargedSeconds({ countedSeconds: 0, countedLength: 0, fullLength: 600, restCharged: true })).toEqual({ seconds: 600, outOf: 600 });
    expect(chargedSeconds({ countedSeconds: 0, countedLength: 0, fullLength: 600, restCharged: false })).toEqual({ seconds: 0, outOf: 0 });
  });
  it("pressed at the very end: nothing is left to add", () => {
    expect(chargedSeconds({ countedSeconds: 1700, countedLength: 1800, fullLength: 1800, restCharged: true })).toEqual({ seconds: 1700, outOf: 1800 });
  });
  it("under 50 cents nothing is charged, also with the rest", () => {
    const { seconds, outOf } = chargedSeconds({ countedSeconds: 0, countedLength: 0, fullLength: 20, restCharged: true });
    expect(attendanceChargeCents({ pricePer15Cents: 2000, bookedSeconds: outOf, countedSeconds: seconds })).toBe(0);
  });
});
