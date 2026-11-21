import { describe, expect, it, vi } from "vitest";

// The dates only: what is emptied and deleted is covered by scripts/retention-check.ts.
vi.mock("@/db", () => ({ db: {}, schema: { emailOutbox: {} } }));

import { emailCutoff, loginCutoff, monthsBefore } from "./retention";

const at = (iso: string) => new Date(iso);

describe("the end dates", () => {
  it("counts months on the calendar, keeping the day and the time", () => {
    expect(monthsBefore(at("2028-11-20T10:15:00.000Z"), 12).toISOString()).toBe("2027-11-20T10:15:00.000Z");
    expect(monthsBefore(at("2028-03-05T00:00:00.000Z"), 5).toISOString()).toBe("2027-10-05T00:00:00.000Z");
  });

  it("takes the last day of a month that is too short", () => {
    expect(monthsBefore(at("2028-03-31T12:00:00.000Z"), 1).toISOString()).toBe("2028-02-29T12:00:00.000Z");
    expect(monthsBefore(at("2028-02-29T12:00:00.000Z"), 12).toISOString()).toBe("2027-02-28T12:00:00.000Z");
    expect(monthsBefore(at("2027-05-31T12:00:00.000Z"), 3).toISOString()).toBe("2027-02-28T12:00:00.000Z");
  });

  it("empties emails two years after, and deletes login records twelve months after", () => {
    expect(emailCutoff(at("2028-11-20T10:15:00.000Z")).toISOString()).toBe("2026-11-20T10:15:00.000Z");
    expect(loginCutoff(at("2028-11-20T10:15:00.000Z")).toISOString()).toBe("2027-11-20T10:15:00.000Z");
  });

  it("does not change the moment it was given", () => {
    const now = at("2028-03-31T12:00:00.000Z");
    monthsBefore(now, 1);
    expect(now.toISOString()).toBe("2028-03-31T12:00:00.000Z");
  });
});
