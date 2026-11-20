import { describe, expect, it } from "vitest";
import { AFTER_CALL_MINUTES, BREAK_CHOICES_MINUTES, takenUntil, answerDeadline, canMoveBooking, cardReminderDue, DEFAULT_LENGTHS, earliestStartFor, firstLength, latestRequestAt, LENGTH_CHOICES_MINUTES, lengthRange, lengthWords, payCutoff, readLengths } from "./rules";

const S = new Date("2026-11-10T20:00:00Z");
const hoursBefore = (date: Date, hours: number) => new Date(date.getTime() - hours * 3_600_000);

describe("payCutoff", () => {
  it("is 24 hours before the start, whatever free-cancelling period the host chose", () => {
    expect(payCutoff(S, 0)).toEqual(hoursBefore(S, 24));
    expect(payCutoff(S, 60)).toEqual(hoursBefore(S, 24));
    expect(payCutoff(S, 720)).toEqual(hoursBefore(S, 24));
    expect(payCutoff(S, 1440)).toEqual(hoursBefore(S, 24));
  });

  it("would follow a free-cancelling period longer than 24 hours, so a failed card never dodges the host's rule", () => {
    expect(payCutoff(S, 2880)).toEqual(hoursBefore(S, 48));
  });
});

describe("cardReminderDue", () => {
  const payBy = hoursBefore(S, 24);
  const due = (nowHoursBeforeCutoff: number, failedHoursBeforeCutoff: number) =>
    cardReminderDue({ now: hoursBefore(payBy, nowHoursBeforeCutoff), payBy, holdFailedAt: hoursBefore(payBy, failedHoursBeforeCutoff) });

  it("is due from 12 hours before the cut-off, for a card that failed 2 days before the call", () => {
    expect(due(12.01, 24)).toBe(false);
    expect(due(12, 24)).toBe(true);
    expect(due(1, 24)).toBe(true);
  });

  it("is never due at or after the cut-off", () => {
    expect(due(0, 24)).toBe(false);
    expect(due(-1, 24)).toBe(false);
  });

  it("waits 6 hours after the first email when the card failed late", () => {
    expect(due(12, 14)).toBe(false);
    expect(due(8.01, 14)).toBe(false);
    expect(due(8, 14)).toBe(true);
  });

  it("is never due for a card that failed in the last 6 hours before the cut-off", () => {
    for (const hours of [5.5, 3, 0.5]) expect(due(hours, 6)).toBe(false);
    expect(due(0.01, 6)).toBe(false);
  });
});

describe("latestRequestAt", () => {
  it("for a free call is just the notice", () => {
    expect(latestRequestAt({ startsAt: S, paid: false, freeCancelMinutes: 1440, noticeHours: 24 })).toEqual(hoursBefore(S, 24));
  });

  it("for a paid call also leaves 8 hours before the payment cut-off", () => {
    expect(latestRequestAt({ startsAt: S, paid: true, freeCancelMinutes: 0, noticeHours: 24 })).toEqual(hoursBefore(S, 32));
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
    expect(answerDeadline({ startsAt: S, paid: true, freeCancelMinutes: 0, requestedAt: hoursBefore(S, 32) })).toEqual(hoursBefore(S, 30));
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
  it("a member's booking that waits for its month's payment can only be booked or end", () => {
    expect(canMoveBooking("paying", "accepted")).toBe(true);
    expect(canMoveBooking("paying", "ran_out")).toBe(true);
    expect(canMoveBooking("paying", "waiting")).toBe(false);
    expect(canMoveBooking("paying", "card")).toBe(false);
    expect(canMoveBooking("card", "paying")).toBe(false);
    expect(canMoveBooking("ran_out", "paying")).toBe(false);
  });
});

describe("readLengths", () => {
  it("keeps only the lengths that can be offered, once each, in order", () => {
    expect(readLengths("60,15,15,20,abc")).toEqual([15, 20, 60]);
    // A list ticked before hosts set a range is kept as it is.
    expect(readLengths("5,10,15,30,45,60")).toEqual([5, 10, 15, 30, 45, 60]);
    // Steps of 5 minutes from 5 minutes to 6 hours. Nothing shorter, longer, or in between.
    expect(readLengths("0,1,4,5,7,10,90,360,365,3.5")).toEqual([5, 10, 90, 360]);
    expect(readLengths("")).toEqual([]);
  });
});

describe("the lengths a host can offer", () => {
  it("are every step of 5 minutes from 5 minutes to 6 hours", () => {
    expect(LENGTH_CHOICES_MINUTES.length).toBe(72);
    expect(LENGTH_CHOICES_MINUTES[0]).toBe(5);
    expect(LENGTH_CHOICES_MINUTES[71]).toBe(360);
    expect(LENGTH_CHOICES_MINUTES.every((n, i) => n === (i + 1) * 5)).toBe(true);
  });
  it("a host's shortest and longest call give every step between them", () => {
    expect(lengthRange(10, 30)).toEqual([10, 15, 20, 25, 30]);
    expect(lengthRange(45, 45)).toEqual([45]);
    expect(lengthRange(5, 360)).toEqual(LENGTH_CHOICES_MINUTES);
  });
  it("two values that are not a range are refused, before any list is made", () => {
    expect(lengthRange(30, 15)).toBeNull();
    expect(lengthRange(7, 30)).toBeNull();
    expect(lengthRange(5, 365)).toBeNull();
    expect(lengthRange(0, 30)).toBeNull();
    expect(lengthRange(3.5, 30)).toBeNull();
    expect(lengthRange(NaN, 30)).toBeNull();
    expect(lengthRange(5, 1e9)).toBeNull();
  });
  it("a new calendar starts with 30 minutes to 2 hours", () => {
    expect(DEFAULT_LENGTHS[0]).toBe(30);
    expect(DEFAULT_LENGTHS[DEFAULT_LENGTHS.length - 1]).toBe(120);
    expect(DEFAULT_LENGTHS.length).toBe(19);
    expect(readLengths(DEFAULT_LENGTHS.join(","))).toEqual(DEFAULT_LENGTHS);
  });
  it("the length shown first is the one closest to 30 minutes, the shorter when two are equally close", () => {
    expect(firstLength([5, 10, 15, 30, 45])).toBe(30);
    expect(firstLength([45, 60, 90])).toBe(45);
    expect(firstLength([5, 10, 15])).toBe(15);
    expect(firstLength([25, 35])).toBe(25);
    expect(firstLength([60, 15])).toBe(15);
    expect(firstLength([120])).toBe(120);
    expect(firstLength([])).toBeNull();
  });
  it("a length in words: minutes under an hour, hours from an hour on", () => {
    expect(lengthWords(5)).toBe("5 minutes");
    expect(lengthWords(45)).toBe("45 minutes");
    expect(lengthWords(60)).toBe("1 hour");
    expect(lengthWords(65)).toBe("1 hour 5 minutes");
    expect(lengthWords(90)).toBe("1 hour 30 minutes");
    expect(lengthWords(120)).toBe("2 hours");
    expect(lengthWords(360)).toBe("6 hours");
  });
});

describe("the time kept free after every call (plans/42)", () => {
  it("is 2 minutes, and a customer is taken until then", () => {
    expect(AFTER_CALL_MINUTES).toBe(2);
    expect(takenUntil(S)).toEqual(new Date(S.getTime() + 2 * 60_000));
  });
  it("is the shortest break a host can choose: 1 minute is no longer offered", () => {
    expect([...BREAK_CHOICES_MINUTES]).toEqual([2, 5, 10, 15, 30]);
    expect(Math.min(...BREAK_CHOICES_MINUTES)).toBe(AFTER_CALL_MINUTES);
  });
});
