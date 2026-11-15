import { describe, expect, it } from "vitest";
import { answerFor, figuresFrom, LIMITS, type Reading } from "./answer";

const report = (madeAt: number, roundTripSeconds: number | null, lossShare: number | null): Reading => ({ report: { madeAt, roundTripSeconds, lossShare } });
const none: Reading = { report: null };

describe("figuresFrom", () => {
  it("averages the round trip and the loss over the reports", () => {
    const figures = figuresFrom(true, [none, report(1000, 0.05, 0), report(2000, 0.15, 0.02), report(3000, 0.1, 0.04)]);
    expect(figures.reports).toBe(3);
    expect(figures.roundTripSeconds).toBeCloseTo(0.1);
    expect(figures.lossShare).toBeCloseTo(0.02);
  });
  it("counts a report once, however many times it was read", () => {
    const figures = figuresFrom(true, [report(1000, 0.1, 0), report(1000, 0.1, 0), report(1000, 0.1, 0), report(2000, 0.3, 0.1)]);
    expect(figures.reports).toBe(2);
    expect(figures.roundTripSeconds).toBeCloseTo(0.2);
    expect(figures.lossShare).toBeCloseTo(0.05);
  });
  it("treats broken figures as not said, never as zero", () => {
    const figures = figuresFrom(true, [report(1000, Number.NaN, -1), report(2000, Infinity, 7), report(3000, 99, null), report(Number.NaN, 0.1, 0)]);
    expect(figures).toEqual({ connected: true, interrupted: false, reports: 0, roundTripSeconds: null, lossShare: null });
  });
  it("only counts a report that carried both figures", () => {
    // One whole report and one with nothing usable in it.
    expect(figuresFrom(true, [report(1000, 0.05, 0), report(2000, null, null)]).reports).toBe(1);
    // One with only the round trip, one with only the loss: neither is whole.
    const split = figuresFrom(true, [report(1000, 0.05, null), report(2000, null, 0)]);
    expect(split).toEqual({ connected: true, interrupted: false, reports: 0, roundTripSeconds: 0.05, lossShare: 0 });
  });
  it("has nothing to say when no report came back", () => {
    expect(figuresFrom(true, [none, none])).toEqual({ connected: true, interrupted: false, reports: 0, roundTripSeconds: null, lossShare: null });
    expect(figuresFrom(false, [])).toEqual({ connected: false, interrupted: false, reports: 0, roundTripSeconds: null, lossShare: null });
  });
});

describe("answerFor", () => {
  const fine = { connected: true, interrupted: false, reports: 5, roundTripSeconds: 0.08, lossShare: 0.001 };
  it("good: connected, enough reports, and both figures fine", () => {
    expect(answerFor(fine)).toBe("good");
    expect(answerFor({ ...fine, roundTripSeconds: LIMITS.roundTripSeconds, lossShare: LIMITS.lossShare })).toBe("good");
  });
  it("weak: one bad figure is enough", () => {
    expect(answerFor({ ...fine, roundTripSeconds: 0.41 })).toBe("weak");
    expect(answerFor({ ...fine, lossShare: 0.031 })).toBe("weak");
    // Also when the other figure is missing, or there is only one report.
    expect(answerFor({ connected: true, interrupted: false, reports: 1, roundTripSeconds: 0.9, lossShare: null })).toBe("weak");
    expect(answerFor({ connected: true, interrupted: false, reports: 1, roundTripSeconds: null, lossShare: 0.2 })).toBe("weak");
  });
  it("could not connect: whatever else is said", () => {
    expect(answerFor({ ...fine, connected: false })).toBe("no_connection");
  });
  it("not measured: something missing is never taken to be good", () => {
    expect(answerFor({ ...fine, lossShare: null })).toBe("not_measured");
    expect(answerFor({ ...fine, roundTripSeconds: null })).toBe("not_measured");
    expect(answerFor({ ...fine, reports: 1 })).toBe("not_measured");
    expect(answerFor({ connected: true, interrupted: false, reports: 0, roundTripSeconds: null, lossShare: null })).toBe("not_measured");
  });
  it("not measured: one whole report plus scraps is not enough, and broken numbers never pass as good", () => {
    expect(answerFor(figuresFrom(true, [report(1000, 0.05, 0), report(2000, null, null)]))).toBe("not_measured");
    expect(answerFor(figuresFrom(true, [report(1000, 0.05, null), report(2000, null, 0)]))).toBe("not_measured");
    expect(answerFor({ connected: true, interrupted: false, reports: 5, roundTripSeconds: Number.NaN, lossShare: Number.NaN })).toBe("not_measured");
    expect(answerFor({ connected: true, interrupted: false, reports: Number.NaN, roundTripSeconds: 0.05, lossShare: 0 })).toBe("not_measured");
  });
  it("good: two whole reports, both fine", () => {
    expect(answerFor(figuresFrom(true, [report(1000, 0.05, 0), report(2000, 0.07, 0.01)]))).toBe("good");
  });
  it("a connection that dropped or had to reconnect during the test is weak, however good the reports before it were", () => {
    const fineReports = [report(1000, 0.05, 0), report(2000, 0.07, 0.01), report(3000, 0.06, 0)];
    expect(answerFor(figuresFrom(true, fineReports))).toBe("good");
    expect(answerFor(figuresFrom(true, fineReports, true))).toBe("weak");
    expect(answerFor(figuresFrom(true, [], true))).toBe("weak");
    // Never having got through at all is still its own answer.
    expect(answerFor(figuresFrom(false, [], true))).toBe("no_connection");
  });
});
