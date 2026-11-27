import { describe, expect, it } from "vitest";
import { endReportEffect, lowers } from "./end-guard";

const L = "minutes"; // lowered, and counts
const U = "minutes_uncounted"; // lowered, does not count
const W = "whole"; // reported, not lowered
const N = null; // a call with no such report

const decide = (earlier: Array<string | null>, othersReported = false) => endReportEffect({ earlier, othersReported });

describe("the guard: three of the last five", () => {
  it("a first report lowers the charge and tells nobody", () => {
    expect(decide([])).toEqual({ effect: "minutes", crossesLine: false });
    expect(decide([N, N, N, N])).toEqual({ effect: "minutes", crossesLine: false });
  });
  it("2 of 5: lowered, nobody told", () => {
    expect(decide([L, N, N, N])).toEqual({ effect: "minutes", crossesLine: false });
    expect(decide([N, N, N, L])).toEqual({ effect: "minutes", crossesLine: false });
  });
  it("3 of 5: lowered, and the line is crossed (the founder is told)", () => {
    expect(decide([L, L])).toEqual({ effect: "minutes", crossesLine: true });
    expect(decide([L, N, L, N])).toEqual({ effect: "minutes", crossesLine: true });
    expect(decide([N, N, L, L])).toEqual({ effect: "minutes", crossesLine: true });
  });
  it("past the line: not lowered, and nobody is told again", () => {
    expect(decide([L, L, L])).toEqual({ effect: "whole", crossesLine: false });
    expect(decide([L, L, L, N])).toEqual({ effect: "whole", crossesLine: false });
    expect(decide([L, L, L, L])).toEqual({ effect: "whole", crossesLine: false });
  });
  it("three in a row with normal calls after them are still caught", () => {
    expect(decide([N, L, L, L])).toEqual({ effect: "whole", crossesLine: false });
  });
  it("only the 4 calls before this one are read: a sixth call pushes the oldest out", () => {
    // Newest first. The third lowered call is the fifth back, and no longer one of "his last 5".
    expect(decide([N, N, L, L, L])).toEqual({ effect: "minutes", crossesLine: true });
    expect(decide([N, N, N, L, L, L])).toEqual({ effect: "minutes", crossesLine: false });
  });
  it("someone who reports now and then, with normal calls in between, is never caught", () => {
    expect(decide([N, L, N, N])).toEqual({ effect: "minutes", crossesLine: false });
    expect(decide([N, N, L, N, N, L, N, N, L])).toEqual({ effect: "minutes", crossesLine: false });
  });
  it("a report that did not count, or was not lowered, is not one of the three", () => {
    expect(decide([U, U, U, U])).toEqual({ effect: "minutes", crossesLine: false });
    expect(decide([W, W, L, L])).toEqual({ effect: "minutes", crossesLine: true });
    expect(decide([U, L, L, N])).toEqual({ effect: "minutes", crossesLine: true });
  });
  it("a report about a host another person also reported: lowered like any other, and never counted", () => {
    expect(decide([], true)).toEqual({ effect: "minutes_uncounted", crossesLine: false });
    // It would have been the third: it is not counted, so the line is not crossed and nobody is told.
    expect(decide([L, L], true)).toEqual({ effect: "minutes_uncounted", crossesLine: false });
  });
  it("past the line nothing lowers the charge, whoever else reported that host: what he sees never depends on other people's reports", () => {
    expect(decide([L, L, L], true)).toEqual(decide([L, L, L], false));
    expect(decide([L, L, L, L], true)).toEqual({ effect: "whole", crossesLine: false });
  });
});

describe("which effects mean 'by the minutes'", () => {
  it("both lowered ones do; not lowered, nothing and anything else do not", () => {
    expect(lowers("minutes")).toBe(true);
    expect(lowers("minutes_uncounted")).toBe(true);
    expect(lowers("whole")).toBe(false);
    expect(lowers(null)).toBe(false);
    expect(lowers(undefined)).toBe(false);
    expect(lowers("something else")).toBe(false);
  });
});
