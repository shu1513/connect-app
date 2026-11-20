import { describe, expect, it } from "vitest";
import { hasOpenTime, inPlaces, mix, mostPointsFirst, openPoints, peoplePoints, ratingPoints, rests, shortlist, SUGGEST, suggestionDay } from "./rules";

const at = (iso: string) => new Date(iso);
const host = (hostId: string, points: number, seenBy = 0) => ({ hostId, points, seenBy });

describe("points from people", () => {
  it("are nothing below three different people", () => {
    expect(peoplePoints(0)).toBe(0);
    expect(peoplePoints(1)).toBe(0);
    expect(peoplePoints(2)).toBe(0);
  });
  it("start at nine with the third person, and add six each time the number doubles", () => {
    expect(peoplePoints(3)).toBe(9);
    expect(peoplePoints(6)).toBe(15);
    expect(peoplePoints(12)).toBe(21);
    expect(peoplePoints(24)).toBe(27);
    expect(peoplePoints(4)).toBeCloseTo(11.49, 2);
  });
  it("have no ceiling: more people is always more points, however many there are", () => {
    for (let people = 3; people < 5000; people++) expect(peoplePoints(people + 1)).toBeGreaterThan(peoplePoints(people));
    expect(peoplePoints(895)).toBeGreaterThan(peoplePoints(894));
    expect(peoplePoints(10)).toBeGreaterThan(peoplePoints(7));
    expect(peoplePoints(70)).toBeGreaterThan(peoplePoints(7));
  });
  it("grow by less for each further person", () => {
    expect(peoplePoints(5) - peoplePoints(4)).toBeLessThan(peoplePoints(4) - peoplePoints(3));
    expect(peoplePoints(101) - peoplePoints(100)).toBeLessThan(0.1);
  });
  it("make ten times as many people worth about as much as being available now", () => {
    // What the numbers mean side by side: a host needs ten times the people to make up for another host's "available now".
    expect(Math.abs(peoplePoints(30) - peoplePoints(3) - SUGGEST.availableNow)).toBeLessThan(0.5);
    expect(Math.abs(peoplePoints(300) - peoplePoints(30) - SUGGEST.availableNow)).toBeLessThan(0.5);
  });
});

describe("a host who rests", () => {
  const today = "2026-03-20";
  const saw = (day: string) => ({ day, seen: true, openedOn: null });
  const opened = (day: string) => ({ day, seen: true, openedOn: day });
  const notSeen = (day: string) => ({ day, seen: false, openedOn: null });
  it("is one whose card was seen on two different days without being opened", () => {
    expect(rests([], today)).toBe(false);
    expect(rests([saw("2026-03-19")], today)).toBe(false);
    expect(rests([saw("2026-03-18"), saw("2026-03-19")], today)).toBe(true);
    expect(rests([saw("2026-03-10"), saw("2026-03-19")], today)).toBe(true);
  });
  it("does not rest because of cards that never came into view", () => {
    expect(rests([notSeen("2026-03-17"), notSeen("2026-03-18"), saw("2026-03-19")], today)).toBe(false);
  });
  it("comes back when the person opened their page, every time", () => {
    // Seen twice, then opened: the count starts afresh.
    expect(rests([saw("2026-03-16"), saw("2026-03-17"), opened("2026-03-18")], today)).toBe(false);
    expect(rests([saw("2026-03-16"), saw("2026-03-17"), opened("2026-03-18"), saw("2026-03-19")], today)).toBe(false);
    // Opened again and again: never rests.
    expect(rests([opened("2026-03-15"), opened("2026-03-16"), opened("2026-03-17"), opened("2026-03-18"), opened("2026-03-19")], today)).toBe(false);
    // Opened once, then seen twice without opening: rests again.
    expect(rests([opened("2026-03-16"), saw("2026-03-18"), saw("2026-03-19")], today)).toBe(true);
  });
  it("counts an opening on the day it happened, also when the card pressed was an older one", () => {
    // The card of the 16th stayed open in a tab and was pressed on the 19th: the sightings of the 17th and 18th are answered.
    expect(rests([{ day: "2026-03-16", seen: true, openedOn: "2026-03-19" }, saw("2026-03-17"), saw("2026-03-18")], today)).toBe(false);
    // Pressed on the 17th: the sightings of the 18th and 19th came after it, and count.
    expect(rests([{ day: "2026-03-16", seen: true, openedOn: "2026-03-17" }, saw("2026-03-18"), saw("2026-03-19")], today)).toBe(true);
    // A card from long ago, pressed yesterday, answers everything before yesterday.
    expect(rests([{ day: "2026-02-01", seen: true, openedOn: "2026-03-19" }, saw("2026-03-17"), saw("2026-03-18")], today)).toBe(false);
  });
  it("rests for two weeks: a sighting counts for fourteen days, to the day", () => {
    expect(rests([saw("2026-03-06"), saw("2026-03-07")], today)).toBe(true);
    // The older of the two is fifteen days old today: one sighting is left.
    expect(rests([saw("2026-03-05"), saw("2026-03-07")], today)).toBe(false);
    expect(rests([saw("2026-03-01"), saw("2026-03-02")], today)).toBe(false);
  });
  it("does not count today itself, or the same day twice", () => {
    expect(rests([saw("2026-03-19"), saw(today)], today)).toBe(false);
    expect(rests([saw("2026-03-19"), saw("2026-03-19")], today)).toBe(false);
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

describe("filling a thin row", () => {
  it("takes the most points first, and keeps no place for the least seen", () => {
    // The host seen the least has the fewest points: among fillers that earns no place ahead of the others.
    const hosts = [host("d", 10, 0), host("a", 40, 9), host("c", 20, 9), host("b", 30, 9)];
    expect(mostPointsFirst(hosts, "viewer", "2026-01-01").map((h) => h.hostId)).toEqual(["a", "b", "c", "d"]);
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
