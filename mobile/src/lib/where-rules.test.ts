import type { AppStart } from "../../../src/lib/app-door/types";
import { firstTimeZone, frontStart, isWelcome, whereFor, zonesMatching } from "./where-rules";

const start: AppStart = { updateNeeded: false, switches: { memberships: "on", tips: false, availableNow: true }, me: null, termsVersion: "2026-11-rules", supportEmail: "support@connect.example" };
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

  it("takes the server's answer for the step only when it has what the screen reads", () => {
    const agreements = [{ name: "terms-of-service", title: "Terms of Service", version: "2026-11-20", href: "/terms?version=2026-11-20" }];
    expect(isWelcome({ done: false, returning: false, agreements, coming: [], timeZone: null, timeZones: accepted })).toBe(true);
    expect(isWelcome({ done: true, returning: true, agreements: [], coming: [], timeZone: "UTC", timeZones: [] })).toBe(true);
    // A version that is announced and not yet in effect: its fixed sentence and its link, or the step is not shown.
    const coming = { name: "payment-terms", title: "Payment Terms", version: "2026-12-10", from: "2027-01-12", accepted: true, words: "From 12 January 2027 a new version of the Payment Terms applies. You will be asked to accept it then.", link: "Read it", href: "/payment-terms?version=2026-12-10" };
    expect(isWelcome({ done: false, returning: false, agreements, coming: [coming], timeZone: null, timeZones: accepted })).toBe(true);
    expect(isWelcome({ done: false, returning: false, agreements, timeZone: null, timeZones: accepted })).toBe(false);
    expect(isWelcome({ done: false, returning: false, agreements, coming: [{ ...coming, words: "" }], timeZone: null, timeZones: accepted })).toBe(false);
    expect(isWelcome({ done: false, returning: false, agreements, coming: [{ ...coming, href: undefined }], timeZone: null, timeZones: accepted })).toBe(false);
    expect(isWelcome({ done: false, returning: false, agreements, coming: [{ ...coming, accepted: "yes" }], timeZone: null, timeZones: accepted })).toBe(false);
    // Without the documents, or with one that does not say its version, the step could not say what was agreed to.
    expect(isWelcome({ done: false, returning: false, coming: [], timeZone: null, timeZones: accepted })).toBe(false);
    expect(isWelcome({ done: false, returning: false, agreements: [{ name: "terms-of-service", title: "Terms of Service", href: "/terms" }], coming: [], timeZone: null, timeZones: accepted })).toBe(false);
    for (const bad of [{}, null, [], { done: false, returning: false, timeZone: null }, { done: false, returning: false, timeZone: 3, timeZones: accepted }, { done: "no", returning: false, timeZone: null, timeZones: accepted }, { done: false, returning: false, timeZone: null, timeZones: ["UTC", 5] }]) {
      expect(isWelcome(bad)).toBe(false);
    }
  });

  it("finds zones by part of their name", () => {
    expect(zonesMatching("lon", accepted)).toEqual(["Europe/London"]);
    expect(zonesMatching("new york", accepted)).toEqual(["America/New_York"]);
    expect(zonesMatching("europe", accepted, 1)).toEqual(["Europe/London"]);
    expect(zonesMatching("  ", accepted)).toEqual([]);
  });
});
