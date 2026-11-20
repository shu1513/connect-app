import { describe, expect, it } from "vitest";
import { APP_HEADER, comesTheAppsWay, isTooOld, readAppHeader, whyNot, type Standing, type Who } from "./rules";

const headers = (values: Record<string, string>) => new Headers(values);

describe("what the app says about itself", () => {
  it("reads the kind of phone and the version", () => {
    expect(readAppHeader("android 1.0.0")).toEqual({ platform: "android", version: "1.0.0" });
    expect(readAppHeader("ios 12.4.31")).toEqual({ platform: "ios", version: "12.4.31" });
  });

  it("is nothing when the header is missing or not in the app's form", () => {
    for (const value of [null, "", "android", "android 1.0", "windows 1.0.0", "android 1.0.0 extra", "1.0.0 android", "android v1.0.0", "android 1.0.0-beta"]) {
      expect(readAppHeader(value), String(value)).toBeNull();
    }
  });
});

describe("whether a request comes the app's way", () => {
  it("does with the app's header and no mark of a browser", () => {
    expect(comesTheAppsWay(headers({ [APP_HEADER]: "android 1.0.0" }))).toEqual({ platform: "android", version: "1.0.0" });
  });

  it("does not without the header", () => {
    expect(comesTheAppsWay(headers({}))).toBeNull();
    expect(comesTheAppsWay(headers({ cookie: "a=b" }))).toBeNull();
  });

  it("does not with any mark of a browser, even with the header and even from our own pages", () => {
    for (const mark of ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
      for (const value of ["same-origin", "cross-site", "none", ""]) {
        expect(comesTheAppsWay(headers({ [APP_HEADER]: "android 1.0.0", [mark]: value })), `${mark}: ${value}`).toBeNull();
      }
    }
  });
});

describe("whether a copy of the app is too old", () => {
  it("compares the three numbers as numbers", () => {
    expect(isTooOld("1.0.0", "1.0.1")).toBe(true);
    expect(isTooOld("1.9.0", "1.10.0")).toBe(true);
    expect(isTooOld("1.10.0", "1.9.0")).toBe(false);
    expect(isTooOld("2.0.0", "1.99.99")).toBe(false);
    expect(isTooOld("1.2.3", "1.2.3")).toBe(false);
  });

  it("is never too old when no oldest version is set, or it is not a version", () => {
    for (const oldest of ["", "soon", "1.0", "v2.0.0", " 2.0.0"]) expect(isTooOld("1.0.0", oldest), oldest).toBe(false);
  });
});

describe("who may ask an address", () => {
  const full: Standing = { emailVerified: true, welcomed: true, closed: false, paused: false };
  const cases: { name: string; person: Standing | null; expected: Record<Who, string | null> }[] = [
    { name: "nobody", person: null, expected: { anyone: null, confirmed: "not_signed_in", member: "not_signed_in", active: "not_signed_in" } },
    {
      name: "an account whose email is not confirmed",
      person: { ...full, emailVerified: false, welcomed: false },
      expected: { anyone: null, confirmed: "confirm_email", member: "confirm_email", active: "confirm_email" },
    },
    {
      name: "a confirmed account before 18-and-terms",
      person: { ...full, welcomed: false },
      expected: { anyone: null, confirmed: null, member: "welcome_needed", active: "welcome_needed" },
    },
    { name: "a full account", person: full, expected: { anyone: null, confirmed: null, member: null, active: null } },
    { name: "a paused account", person: { ...full, paused: true }, expected: { anyone: null, confirmed: null, member: null, active: "paused" } },
    {
      name: "a closed account (answered exactly like nobody)",
      person: { ...full, closed: true },
      expected: { anyone: null, confirmed: "not_signed_in", member: "not_signed_in", active: "not_signed_in" },
    },
    {
      name: "a paused account before 18-and-terms (the earlier step is named first)",
      person: { ...full, welcomed: false, paused: true },
      expected: { anyone: null, confirmed: null, member: "welcome_needed", active: "welcome_needed" },
    },
  ];
  for (const { name, person, expected } of cases) {
    it(name, () => {
      for (const who of ["anyone", "confirmed", "member", "active"] as const) expect(whyNot(who, person), who).toBe(expected[who]);
    });
  }
});
