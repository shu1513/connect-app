import { describe, expect, it } from "vitest";
import { hostMinutesInFourWeeks, placesKept } from "./rules";

const at = (iso: string) => new Date(iso);

describe("what a host's weekly hours offer in four weeks", () => {
  it("is the week's total times four", () => {
    expect(hostMinutesInFourWeeks([{ weekday: 1, startMinute: 540, endMinute: 600 }])).toBe(240);
    expect(
      hostMinutesInFourWeeks([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 3, startMinute: 1080, endMinute: 1440 },
      ]),
    ).toBe((180 + 360) * 4);
  });
  it("does not count two stretches that overlap twice", () => {
    expect(
      hostMinutesInFourWeeks([
        { weekday: 2, startMinute: 540, endMinute: 660 },
        { weekday: 2, startMinute: 600, endMinute: 720 },
        { weekday: 2, startMinute: 600, endMinute: 630 },
      ]),
    ).toBe(180 * 4);
  });
  it("is no room at all without weekly hours", () => {
    expect(hostMinutesInFourWeeks([])).toBe(0);
    expect(hostMinutesInFourWeeks([{ weekday: 1, startMinute: 600, endMinute: 600 }])).toBe(0);
  });
});

describe("who keeps their place at a renewal", () => {
  const older = { id: "a", since: at("2026-01-01T00:00:00Z"), minutes: 360 };
  const newer = { id: "b", since: at("2026-06-01T00:00:00Z"), minutes: 120 };
  it("gives the longest-standing members who fit a place", () => {
    expect([...placesKept({ hostMinutes: 480, members: [newer, older] })]).toEqual(["a", "b"]);
    expect([...placesKept({ hostMinutes: 360, members: [newer, older] })]).toEqual(["a"]);
  });
  it("lets a newer member with less time stay when an older one no longer fits (the rulebook's example)", () => {
    // Room for 4 hours, an older member at 6 hours and a newer one at 2: the newer one stays, in either order.
    expect([...placesKept({ hostMinutes: 240, members: [older, newer] })]).toEqual(["b"]);
    expect([...placesKept({ hostMinutes: 240, members: [newer, older] })]).toEqual(["b"]);
  });
  it("gives the same answer for members who joined at the same moment", () => {
    const twin = { id: "c", since: older.since, minutes: 360 };
    expect([...placesKept({ hostMinutes: 360, members: [twin, older] })]).toEqual(["a"]);
    expect([...placesKept({ hostMinutes: 360, members: [older, twin] })]).toEqual(["a"]);
  });
  it("keeps nobody without hours", () => {
    expect(placesKept({ hostMinutes: 0, members: [older, newer] }).size).toBe(0);
  });
});
