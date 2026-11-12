import { describe, expect, it } from "vitest";
import { canJoin, roomState } from "./calls";

const call = {
  hostId: "host-1",
  customerId: "customer-1",
  startsAt: new Date("2026-01-01T09:00:00Z"),
  endsAt: new Date("2026-01-01T10:00:00Z"),
};
const at = (iso: string) => new Date(iso);

describe("when the room can be entered", () => {
  it("is not open more than 5 minutes before the start", () => {
    expect(roomState(call, at("2026-01-01T08:54:59Z"))).toBe("not_open_yet");
  });
  it("opens exactly 5 minutes before the start", () => {
    expect(roomState(call, at("2026-01-01T08:55:00Z"))).toBe("open");
  });
  it("is still open in the last minute after the end", () => {
    expect(roomState(call, at("2026-01-01T10:00:59Z"))).toBe("open");
  });
  it("closes exactly 1 minute after the end", () => {
    expect(roomState(call, at("2026-01-01T10:01:00Z"))).toBe("closed");
  });
  it("a part 2 (more time agreed during a call) opens at its start, not early", () => {
    const part2 = { ...call, continuesCallId: "call-before" };
    expect(roomState(part2, at("2026-01-01T08:59:59Z"))).toBe("not_open_yet");
    expect(roomState(part2, at("2026-01-01T09:00:00Z"))).toBe("open");
  });
});

describe("who may enter", () => {
  const during = at("2026-01-01T09:30:00Z");

  it("lets the host in", () => {
    expect(canJoin(call, "host-1", during)).toEqual({ allowed: true, role: "host" });
  });
  it("lets the customer in", () => {
    expect(canJoin(call, "customer-1", during)).toEqual({ allowed: true, role: "customer" });
  });
  it("refuses a stranger, even while the room is open", () => {
    expect(canJoin(call, "stranger-9", during)).toEqual({ allowed: false, reason: "not_on_call" });
  });
  it("refuses the host before the room opens", () => {
    expect(canJoin(call, "host-1", at("2026-01-01T08:00:00Z"))).toEqual({ allowed: false, reason: "not_open_yet" });
  });
  it("refuses the customer after the room closes", () => {
    expect(canJoin(call, "customer-1", at("2026-01-01T10:01:00Z"))).toEqual({ allowed: false, reason: "closed" });
  });
  it("does not tell a stranger whether the room is open or closed", () => {
    expect(canJoin(call, "stranger-9", at("2026-01-01T12:00:00Z"))).toEqual({ allowed: false, reason: "not_on_call" });
  });
});
