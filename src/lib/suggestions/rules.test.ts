import { describe, expect, it } from "vitest";
import { hasOpenTime, inPlaces, mix, openPoints, peoplePoints, ratingPoints, shortlist, SUGGEST, suggestionDay } from "./rules";

const at = (iso: string) => new Date(iso);
const host = (hostId: string, points: number, seenBy = 0) => ({ hostId, points, seenBy });

describe("points from people", () => {
  it("are nothing below three different people", () => {
    expect(peoplePoints(0)).toBe(0);
    expect(peoplePoints(1)).toBe(0);
    expect(peoplePoints(2)).toBe(0);
  });
  it("start with the third person, three points each", () => {
    expect(peoplePoints(3)).toBe(9);
    expect(peoplePoints(4)).toBe(12);
    expect(peoplePoints(6)).toBe(18);
  });
  it("stop at twenty", () => {
    expect(peoplePoints(7)).toBe(20);
    expect(peoplePoints(500)).toBe(20);
  });
});

describe("points from ratings", () => {
  it("are four for a host with no shown rating", () => {
    expect(ratingPoints(null)).toBe(4);
  });
  it("move slowly from four toward the shown average", () => {
    expect(ratingPoints({ average: 5, count: 3 })).toBeCloseTo(4.375, 5);
    expect(ratingPoints({ average: 4.8, count: 6 })).toBeCloseTo(4.436, 3);
    expect(ratingPoints({ average: 5, count: 300 })).toBeGreaterThan(4.98);
    expect(ratingPoints({ average: 1, count: 3 })).toBeCloseTo(2.875, 5);
  });
  it("stay between one and five", () => {
    expect(ratingPoints({ average: 1, count: 10_000 })).toBeGreaterThanOrEqual(1);
    expect(ratingPoints({ average: 5, count: 10_000 })).toBeLessThanOrEqual(5);
  });
});

describe("points for open times", () => {
  const now = at("2026-01-01T12:00:00Z");
  it("are twenty for a host who is available now, whatever their next open time", () => {
    expect(openPoints({ availableNow: true, nextOpen: null }, now)).toBe(20);
    expect(openPoints({ availableNow: true, nextOpen: at("2026-02-01T12:00:00Z") }, now)).toBe(20);
  });
  it("are ten for an open time within seven days, to the minute", () => {
    expect(openPoints({ availableNow: false, nextOpen: at("2026-01-01T13:00:00Z") }, now)).toBe(10);
    expect(openPoints({ availableNow: false, nextOpen: at("2026-01-08T12:00:00Z") }, now)).toBe(10);
    expect(openPoints({ availableNow: false, nextOpen: at("2026-01-08T12:01:00Z") }, now)).toBe(0);
  });
  it("are nothing for a later open time, and a host with none cannot be suggested at all", () => {
    expect(openPoints({ availableNow: false, nextOpen: at("2026-01-20T12:00:00Z") }, now)).toBe(0);
    expect(hasOpenTime({ availableNow: false, nextOpen: at("2026-01-20T12:00:00Z") })).toBe(true);
    expect(hasOpenTime({ availableNow: true, nextOpen: null })).toBe(true);
    expect(hasOpenTime({ availableNow: false, nextOpen: null })).toBe(false);
  });
});

describe("the day of a person's suggestions", () => {
  it("is the calendar day in UTC", () => {
    expect(suggestionDay(at("2026-01-01T23:59:59Z"))).toBe("2026-01-01");
    expect(suggestionDay(at("2026-01-02T00:00:00Z"))).toBe("2026-01-02");
  });
});

describe("the order for equal scores", () => {
  it("is the same for the same person, host and day", () => {
    expect(mix("viewer", "host", "2026-01-01")).toBe(mix("viewer", "host", "2026-01-01"));
  });
  it("is a number from 0 up to, not including, 1", () => {
    for (let i = 0; i < 200; i++) {
      const n = mix(`viewer-${i}`, `host-${i * 7}`, "2026-01-01");
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
  it("changes with the day and with the person", () => {
    const hosts = Array.from({ length: 12 }, (_, i) => host(`h${i}`, 10));
    const order = (viewer: string, day: string) => inPlaces(hosts, viewer, day).map((p) => p.host.hostId).join();
    expect(order("anna", "2026-01-01")).toBe(order("anna", "2026-01-01"));
    expect(order("anna", "2026-01-01")).not.toBe(order("anna", "2026-01-02"));
    expect(order("anna", "2026-01-01")).not.toBe(order("ben", "2026-01-01"));
  });
});

describe("the six places", () => {
  const day = "2026-01-01";
  it("give places 1, 2, 4 and 5 to the most points, and 3 and 6 to the hosts seen the least", () => {
    // Eight hosts with falling points; the two with the fewest points are the ones nobody has seen.
    const hosts = [host("a", 30, 9), host("b", 28, 9), host("c", 26, 9), host("d", 24, 9), host("e", 22, 9), host("f", 20, 9), host("new1", 5, 0), host("new2", 4, 1)];
    const placed = inPlaces(hosts, "viewer", day);
    expect(placed.map((p) => [p.place, p.host.hostId, p.kept])).toEqual([
      [1, "a", false],
      [2, "b", false],
      [3, "new1", true],
      [4, "c", false],
      [5, "d", false],
      [6, "new2", true],
    ]);
  });
  it("never place a host twice, also when the least seen host has the most points", () => {
    const hosts = [host("a", 30, 0), host("b", 28, 1), host("c", 26, 2), host("d", 24, 3), host("e", 22, 4), host("f", 20, 5), host("g", 18, 6)];
    const placed = inPlaces(hosts, "viewer", day);
    expect(placed.map((p) => p.host.hostId)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(new Set(placed.map((p) => p.host.hostId)).size).toBe(6);
    expect(placed.filter((p) => p.kept).map((p) => p.place)).toEqual([3, 6]);
  });
  it("fill from the first place on when there are fewer hosts than places", () => {
    expect(inPlaces([host("a", 5), host("b", 9)], "viewer", day).map((p) => [p.place, p.host.hostId])).toEqual([
      [1, "b"],
      [2, "a"],
    ]);
    expect(inPlaces([], "viewer", day)).toEqual([]);
  });
  it("hold exactly six when there are many", () => {
    const hosts = Array.from({ length: 40 }, (_, i) => host(`h${i}`, i, i));
    expect(inPlaces(hosts, "viewer", day)).toHaveLength(SUGGEST.places);
  });
});

describe("the hosts whose open time is looked up", () => {
  const day = "2026-01-01";
  it("are everyone while there are few", () => {
    const hosts = Array.from({ length: 12 }, (_, i) => host(`h${i}`, i, i));
    expect(shortlist(hosts, "viewer", day)).toHaveLength(12);
  });
  it("are the twenty with the most points and the ten seen the least, each once", () => {
    // 100 hosts: points rise with the number, and so does how many people have seen them.
    const hosts = Array.from({ length: 100 }, (_, i) => host(`h${i}`, i, i));
    const chosen = shortlist(hosts, "viewer", day).map((h) => h.hostId);
    expect(chosen).toHaveLength(SUGGEST.lookUpTop + SUGGEST.lookUpLeastSeen);
    expect(new Set(chosen).size).toBe(chosen.length);
    expect(chosen.slice(0, 3)).toEqual(["h99", "h98", "h97"]);
    expect(chosen).toContain("h80");
    expect(chosen).not.toContain("h79");
    expect(chosen).toContain("h0");
    expect(chosen).toContain("h9");
    expect(chosen).not.toContain("h10");
  });
});
