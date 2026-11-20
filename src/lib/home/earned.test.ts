import { describe, expect, it } from "vitest";
import { earnedFrom } from "./earned";

const part = (status: string, shareCents = 0, needsReview = false) => ({ status, shareCents, needsReview });

describe("what a call earned its host", () => {
  it("is nothing to say while nothing is charged", () => {
    expect(earnedFrom([])).toBeNull();
    expect(earnedFrom([part("held")])).toBeNull();
    expect(earnedFrom([part("awaiting_payment")])).toBeNull();
    expect(earnedFrom([part("closed_uncharged")])).toBeNull();
  });
  it("is her share of what was charged", () => {
    expect(earnedFrom([part("charged", 3800)])).toEqual({ cents: 3800, soFar: false });
  });
  it("adds the time that was added during the call", () => {
    expect(earnedFrom([part("charged", 3800), part("charged", 1900)])).toEqual({ cents: 5700, soFar: false });
  });
  it("is nothing earned, said plainly, after a refund in full", () => {
    expect(earnedFrom([part("charged", 0)])).toEqual({ cents: 0, soFar: false });
  });
  it("is so far while another part is held, not paid, or waits for a decision", () => {
    expect(earnedFrom([part("charged", 3800), part("held")])).toEqual({ cents: 3800, soFar: true });
    expect(earnedFrom([part("charged", 3800), part("awaiting_payment")])).toEqual({ cents: 3800, soFar: true });
    expect(earnedFrom([part("charged", 3800), part("closed_uncharged", 0, true)])).toEqual({ cents: 3800, soFar: true });
  });
  it("does not count a part that ended uncharged", () => {
    expect(earnedFrom([part("charged", 3800), part("closed_uncharged")])).toEqual({ cents: 3800, soFar: false });
  });
});
