import { describe, expect, it } from "vitest";
import { instantStartAt, lengthsThatFit, mayOfferMoreTime, reservationFor, startsWhileAvailable } from "./instant-rules";

const at = (iso: string) => new Date(iso);
const MINUTE = 60_000;

describe("when an instant call starts", () => {
  it("is 5 minutes after the button, on a whole second, never later than that (so the room is open at once)", () => {
    expect(instantStartAt(at("2026-01-01T09:00:00.000Z"))).toEqual(at("2026-01-01T09:05:00.000Z"));
    expect(instantStartAt(at("2026-01-01T09:00:00.750Z"))).toEqual(at("2026-01-01T09:05:00.000Z"));
  });
  it("must fall inside the host's available-now window", () => {
    const until = at("2026-01-01T10:00:00Z");
    expect(startsWhileAvailable(at("2026-01-01T10:00:00Z"), until)).toBe(true);
    expect(startsWhileAvailable(at("2026-01-01T10:00:01Z"), until)).toBe(false);
    expect(startsWhileAvailable(at("2026-01-01T09:00:00Z"), null)).toBe(false);
  });
});

describe("what each person is taken for", () => {
  const startsAt = at("2026-01-01T09:05:00Z");
  it("the host through the break, the customer for the call only", () => {
    const r = reservationFor({ startsAt, lengthMinutes: 30, breakMinutes: 5 });
    expect(r.customer).toEqual({ start: startsAt, end: at("2026-01-01T09:35:00Z") });
    expect(r.host).toEqual({ start: startsAt, end: at("2026-01-01T09:40:00Z") });
  });
  it("a part 2's host reservation begins where part 1's break ends, so the two touch", () => {
    const r = reservationFor({ startsAt, lengthMinutes: 15, breakMinutes: 5, hostFrom: at("2026-01-01T09:10:00Z") });
    expect(r.host).toEqual({ start: at("2026-01-01T09:10:00Z"), end: at("2026-01-01T09:25:00Z") });
    expect(r.customer).toEqual({ start: startsAt, end: at("2026-01-01T09:20:00Z") });
  });
});

describe("which lengths fit", () => {
  const startsAt = at("2026-01-01T09:05:00Z");
  const lengths = [15, 30, 45, 60];
  it("all of them when nobody is busy", () => {
    expect(lengthsThatFit({ lengths, startsAt, breakMinutes: 5, hostBusy: [], customerBusy: [] })).toEqual(lengths);
  });
  it("only the ones that end, break included, before the host's next call", () => {
    // The host has a call at 9:40. 30 minutes ends at 9:35 and its break at 9:40: it touches, so it fits. 45 does not.
    const hostBusy = [{ start: at("2026-01-01T09:40:00Z"), end: at("2026-01-01T10:15:00Z") }];
    expect(lengthsThatFit({ lengths, startsAt, breakMinutes: 5, hostBusy, customerBusy: [] })).toEqual([15, 30]);
  });
  it("only the ones that end before the customer's own next call", () => {
    const customerBusy = [{ start: at("2026-01-01T09:35:00Z"), end: at("2026-01-01T10:00:00Z") }];
    expect(lengthsThatFit({ lengths, startsAt, breakMinutes: 5, hostBusy: [], customerBusy })).toEqual([15, 30]);
  });
  it("none while the host is in a call that runs past the start", () => {
    const hostBusy = [{ start: at("2026-01-01T08:30:00Z"), end: at("2026-01-01T09:06:00Z") }];
    expect(lengthsThatFit({ lengths, startsAt, breakMinutes: 5, hostBusy, customerBusy: [] })).toEqual([]);
  });
  it("a part 2 fits right after part 1, whose reservation includes its break", () => {
    const part1Host = { start: at("2026-01-01T08:35:00Z"), end: at("2026-01-01T09:10:00Z") }; // the call ended 9:05, break to 9:10
    const part1Customer = { start: at("2026-01-01T08:35:00Z"), end: at("2026-01-01T09:05:00Z") };
    expect(lengthsThatFit({ lengths, startsAt, breakMinutes: 5, hostFrom: part1Host.end, hostBusy: [part1Host], customerBusy: [part1Customer] })).toEqual(lengths);
  });
});

describe("when more time may be offered", () => {
  const call = { startsAt: at("2026-01-01T09:00:00Z"), endsAt: at("2026-01-01T09:30:00Z"), cancelledAt: null, safetyEndedAt: null };
  it("once the room is open, while at least 5 minutes remain", () => {
    expect(mayOfferMoreTime(call, at("2026-01-01T08:54:00Z"))).toBe(false);
    expect(mayOfferMoreTime(call, at("2026-01-01T08:55:00Z"))).toBe(true);
    expect(mayOfferMoreTime(call, at("2026-01-01T09:25:00Z"))).toBe(true);
    expect(mayOfferMoreTime(call, new Date(call.endsAt.getTime() - 5 * MINUTE + 1))).toBe(false);
  });
  it("never on a cancelled or stopped call", () => {
    expect(mayOfferMoreTime({ ...call, cancelledAt: at("2026-01-01T08:00:00Z") }, at("2026-01-01T09:00:00Z"))).toBe(false);
    expect(mayOfferMoreTime({ ...call, safetyEndedAt: at("2026-01-01T09:01:00Z") }, at("2026-01-01T09:02:00Z"))).toBe(false);
  });
});
