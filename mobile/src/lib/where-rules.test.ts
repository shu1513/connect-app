import type { AppStart } from "../../../src/lib/app-door/types";
import { firstTimeZone, frontStart, whereFor, zonesMatching } from "./where-rules";

const start: AppStart = { updateNeeded: false, switches: { memberships: "on", tips: false, availableNow: true }, me: null, termsVersion: "2026-11-rules" };
const me = { id: "u1", name: "Ada", email: "ada@example.com", timeZone: null, paused: false, next: null, host: null };

describe("which part of the app a person is in", () => {
  it("is the first screens when nobody is signed in", () => {
    expect(whereFor(start)).toBe("front");
  });

  it("is '18 and terms' while that step is still to do", () => {
    expect(whereFor({ ...start, me: { ...me, next: "welcome" } })).toBe("welcome");
  });

  it("is home otherwise, for a paused person too (the home page says so)", () => {
    expect(whereFor({ ...start, me })).toBe("home");
    expect(whereFor({ ...start, me: { ...me, paused: true } })).toBe("home");
  });

  it("starts at 'check your email' when this phone remembers that step", () => {
    expect(frontStart("ada@example.com")).toBe("check-email");
    expect(frontStart(null)).toBe("first");
  });
});

describe("the time zone on the '18 and terms' step", () => {
  const accepted = ["UTC", "America/New_York", "Europe/London", "Europe/Lisbon"];

  it("offers the saved one first, else the phone's own, when the server accepts it", () => {
    expect(firstTimeZone("Europe/London", "America/New_York", accepted)).toBe("Europe/London");
    expect(firstTimeZone(null, "America/New_York", accepted)).toBe("America/New_York");
    expect(firstTimeZone("Old/Gone", "America/New_York", accepted)).toBe("America/New_York");
  });

  it("offers none when the phone's is not one the server accepts", () => {
    expect(firstTimeZone(null, "Asia/Calcutta", accepted)).toBeNull();
    expect(firstTimeZone(null, null, accepted)).toBeNull();
  });

  it("finds zones by part of their name", () => {
    expect(zonesMatching("lon", accepted)).toEqual(["Europe/London"]);
    expect(zonesMatching("new york", accepted)).toEqual(["America/New_York"]);
    expect(zonesMatching("europe", accepted, 1)).toEqual(["Europe/London"]);
    expect(zonesMatching("  ", accepted)).toEqual([]);
  });
});
