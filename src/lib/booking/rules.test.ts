import { describe, expect, it } from "vitest";
import { answerDeadline, canMoveBooking, earliestStartFor, latestRequestAt, payCutoff, readLengths } from "./rules";

const S = new Date("2026-11-10T20:00:00Z");
const hoursBefore = (date: Date, hours: number) => new Date(date.getTime() - hours * 3_600_000);

describe("payCutoff", () => {
  it("is 12 hours before the start, or the end of the free-cancelling period if that is earlier", () => {
    expect(payCutoff(S, 0)).toEqual(hoursBefore(S, 12));
    expect(payCutoff(S, 60)).toEqual(hoursBefore(S, 12));
    expect(payCutoff(S, 720)).toEqual(hoursBefore(S, 12));
    expect(payCutoff(S, 1440)).toEqual(hoursBefore(S, 24));
  });
});

describe("latestRequestAt", () => {
  it("for a free call is just the notice", () => {
    expect(latestRequestAt({ startsAt: S, paid: false, freeCancelMinutes: 1440, noticeHours: 24 })).toEqual(hoursBefore(S, 24));
  });

  it("for a paid call also leaves 8 hours before the payment cut-off", () => {
    expect(latestRequestAt({ startsAt: S, paid: true, freeCancelMinutes: 0, noticeHours: 24 })).toEqual(hoursBefore(S, 24));
    expect(latestRequestAt({ startsAt: S, paid: true, freeCancelMinutes: 1440, noticeHours: 24 })).toEqual(hoursBefore(S, 32));
    expect(latestRequestAt({ startsAt: S, paid: true, freeCancelMinutes: 1440, noticeHours: 72 })).toEqual(hoursBefore(S, 72));
  });

  it("agrees with earliestStartFor", () => {
    for (const freeCancelMinutes of [0, 60, 720, 1440]) {
      for (const noticeHours of [24, 48, 72]) {
        for (const paid of [true, false]) {
          const now = new Date("2026-11-01T00:00:00Z");
          const earliest = earliestStartFor({ now, paid, freeCancelMinutes, noticeHours });
          expect(latestRequestAt({ startsAt: earliest, paid, freeCancelMinutes, noticeHours })).toEqual(now);
        }
      }
    }
  });
});

describe("answerDeadline", () => {
  it("is 24 hours after the request when the call is far away", () => {
    const requestedAt = hoursBefore(S, 200);
    expect(answerDeadline({ startsAt: S, paid: true, freeCancelMinutes: 0, requestedAt })).toEqual(hoursBefore(S, 176));
  });

  it("for a paid call is never later than 6 hours before the payment cut-off", () => {
    expect(answerDeadline({ startsAt: S, paid: true, freeCancelMinutes: 0, requestedAt: hoursBefore(S, 24) })).toEqual(hoursBefore(S, 18));
    expect(answerDeadline({ startsAt: S, paid: true, freeCancelMinutes: 1440, requestedAt: hoursBefore(S, 32) })).toEqual(hoursBefore(S, 30));
  });

  it("for a free call is never later than 2 hours before the start", () => {
    expect(answerDeadline({ startsAt: S, paid: false, freeCancelMinutes: 0, requestedAt: hoursBefore(S, 24) })).toEqual(hoursBefore(S, 2));
  });

  it("always leaves the host at least 2 hours when the request is sent in time", () => {
    for (const freeCancelMinutes of [0, 60, 720, 1440]) {
      for (const paid of [true, false]) {
        const requestedAt = latestRequestAt({ startsAt: S, paid, freeCancelMinutes, noticeHours: 24 });
        const deadline = answerDeadline({ startsAt: S, paid, freeCancelMinutes, requestedAt });
        expect(deadline.getTime() - requestedAt.getTime()).toBeGreaterThanOrEqual(2 * 3_600_000);
      }
    }
  });
});

describe("stages", () => {
  it("only lets a waiting request be answered, and only an accepted one be cancelled", () => {
    expect(canMoveBooking("waiting", "accepted")).toBe(true);
    expect(canMoveBooking("waiting", "passed_over")).toBe(true);
    expect(canMoveBooking("accepted", "cancelled")).toBe(true);
    expect(canMoveBooking("card", "accepted")).toBe(false);
    expect(canMoveBooking("ran_out", "accepted")).toBe(false);
    expect(canMoveBooking("declined", "waiting")).toBe(false);
    expect(canMoveBooking("accepted", "declined")).toBe(false);
  });
});

describe("readLengths", () => {
  it("keeps only the lengths we offer, once each, in order", () => {
    expect(readLengths("60,15,15,20,abc")).toEqual([15, 60]);
    expect(readLengths("")).toEqual([]);
  });
});
