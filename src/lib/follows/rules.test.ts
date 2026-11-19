import { describe, expect, it } from "vitest";
import { FOLLOW, followsAfterCall, inListOrder, type AfterCallFacts } from "./rules";

const good: AfterCallFacts = {
  source: "customer",
  cancelled: false,
  safetyEnded: false,
  recordComplete: true,
  togetherSeconds: 600,
  reported: false,
  blocked: false,
  refundAsked: false,
  hostPageOpen: true,
  eitherClosedOrPaused: false,
  hasLine: false,
  following: 0,
};

describe("followsAfterCall", () => {
  it("follows after a call that took place and went well", () => {
    expect(followsAfterCall(good)).toBe(true);
    expect(followsAfterCall({ ...good, source: "now" })).toBe(true);
    expect(followsAfterCall({ ...good, source: "member" })).toBe(true);
  });

  it("never after a call made by a check script, or one with no booking", () => {
    expect(followsAfterCall({ ...good, source: "admin" })).toBe(false);
    expect(followsAfterCall({ ...good, source: null })).toBe(false);
  });

  it("needs the two together for at least two minutes, by a complete record", () => {
    expect(followsAfterCall({ ...good, togetherSeconds: FOLLOW.minTogetherSeconds })).toBe(true);
    expect(followsAfterCall({ ...good, togetherSeconds: FOLLOW.minTogetherSeconds - 1 })).toBe(false);
    expect(followsAfterCall({ ...good, togetherSeconds: null })).toBe(false);
    expect(followsAfterCall({ ...good, recordComplete: false })).toBe(false);
    expect(followsAfterCall({ ...good, cancelled: true })).toBe(false);
  });

  it.each(["safetyEnded", "reported", "blocked", "refundAsked", "eitherClosedOrPaused", "hasLine"] as const)("never when %s", (fact) => {
    expect(followsAfterCall({ ...good, [fact]: true })).toBe(false);
  });

  it("never for a host whose page is not open to everyone", () => {
    expect(followsAfterCall({ ...good, hostPageOpen: false })).toBe(false);
  });

  it("never pushes anyone over the limit", () => {
    expect(followsAfterCall({ ...good, following: FOLLOW.limit - 1 })).toBe(true);
    expect(followsAfterCall({ ...good, following: FOLLOW.limit })).toBe(false);
  });
});

describe("inListOrder", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 19, 12, minutes));
  const host = (name: string, available = false, nextCallAt: Date | null = null) => ({ name, available, nextCallAt });

  it("puts the available first, then those with a call coming up, then the rest", () => {
    const sorted = inListOrder([host("Zed"), host("Cara", false, at(30)), host("Bea", true), host("Abe")]);
    expect(sorted.map((h) => h.name)).toEqual(["Bea", "Cara", "Abe", "Zed"]);
  });

  it("orders calls coming up by the soonest, and everything else by name", () => {
    const sorted = inListOrder([host("Ann", false, at(50)), host("bob", false, at(10)), host("Dee", true, at(5)), host("cy", true)]);
    expect(sorted.map((h) => h.name)).toEqual(["cy", "Dee", "bob", "Ann"]);
    expect(inListOrder([host("b"), host("A"), host("c")]).map((h) => h.name)).toEqual(["A", "b", "c"]);
  });

  it("does not change the list it was given", () => {
    const given = [host("b"), host("a")];
    inListOrder(given);
    expect(given.map((h) => h.name)).toEqual(["b", "a"]);
  });
});
