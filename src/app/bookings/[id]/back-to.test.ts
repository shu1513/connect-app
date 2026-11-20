import { describe, expect, it } from "vitest";
import { backTo } from "./back-to";

describe("where Accept and Decline go back to", () => {
  it("is the list the button was on", () => {
    expect(backTo("requests", "b1")).toBe("/host/requests");
    expect(backTo("home", "b1")).toBe("/");
  });
  it("is the page of the request for anything else", () => {
    expect(backTo(null, "b1")).toBe("/bookings/b1");
    expect(backTo("", "b1")).toBe("/bookings/b1");
    expect(backTo("https://elsewhere.example", "b1")).toBe("/bookings/b1");
    expect(backTo("/account", "b1")).toBe("/bookings/b1");
    // A name every object has is not a page of ours.
    expect(backTo("constructor", "b1")).toBe("/bookings/b1");
    expect(backTo("toString", "b1")).toBe("/bookings/b1");
  });
});
