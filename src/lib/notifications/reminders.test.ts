import { describe, expect, it } from "vitest";
import { dueReminders } from "./reminder-rules";

const S = new Date("2026-11-10T20:00:00Z");
const before = (hours: number, minutes = 0) => new Date(S.getTime() - hours * 3_600_000 - minutes * 60_000);

describe("dueReminders", () => {
  it("sends the day-before reminder only in the hour after the 24-hour mark", () => {
    expect(dueReminders(S, before(24, 30))).toEqual([]);
    expect(dueReminders(S, before(24))).toEqual(["day"]);
    expect(dueReminders(S, before(23, 30))).toEqual(["day"]);
    expect(dueReminders(S, before(22, 59))).toEqual([]); // the helper was down: too late, do not send a stale one
  });

  it("sends the hour-before reminder between 60 and 30 minutes before", () => {
    expect(dueReminders(S, before(1))).toEqual(["hour"]);
    expect(dueReminders(S, before(0, 31))).toEqual(["hour"]);
    expect(dueReminders(S, before(0, 29))).toEqual([]);
  });

  it("sends the room-open reminder from 5 minutes before until the start", () => {
    expect(dueReminders(S, before(0, 5))).toEqual(["open"]);
    expect(dueReminders(S, before(0, 1))).toEqual(["open"]);
    expect(dueReminders(S, S)).toEqual([]);
    expect(dueReminders(S, new Date(S.getTime() + 60_000))).toEqual([]);
  });
});
