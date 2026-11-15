import { describe, expect, it } from "vitest";
import { recordVisibleTo } from "./rules";

const nobody = { founder: false, requestReason: null, canStillAsk: false };

describe("who may open a call's quality record", () => {
  it("without a request: only the customer, and only while they can still ask", () => {
    expect(recordVisibleTo({ ...nobody, role: "customer", canStillAsk: true })).toBe(true);
    expect(recordVisibleTo({ ...nobody, role: "customer" })).toBe(false);
    expect(recordVisibleTo({ ...nobody, role: "host", canStillAsk: true })).toBe(false);
    expect(recordVisibleTo({ ...nobody, role: "admin", founder: true })).toBe(false);
    expect(recordVisibleTo({ ...nobody, role: "host", founder: true })).toBe(false);
  });
  it("a request about the connection: the customer and the host", () => {
    expect(recordVisibleTo({ ...nobody, role: "customer", requestReason: "connection" })).toBe(true);
    expect(recordVisibleTo({ ...nobody, role: "host", requestReason: "connection" })).toBe(true);
  });
  it("a request about something else: neither of them", () => {
    expect(recordVisibleTo({ ...nobody, role: "customer", requestReason: "other" })).toBe(false);
    expect(recordVisibleTo({ ...nobody, role: "host", requestReason: "other" })).toBe(false);
  });
  it("the founder, for any request", () => {
    expect(recordVisibleTo({ ...nobody, role: "admin", founder: true, requestReason: "other" })).toBe(true);
    expect(recordVisibleTo({ ...nobody, role: "admin", founder: true, requestReason: "connection" })).toBe(true);
    expect(recordVisibleTo({ ...nobody, role: "host", founder: true, requestReason: "other" })).toBe(true);
  });
});
