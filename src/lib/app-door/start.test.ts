import { describe, expect, it, vi } from "vitest";

// Only the plain rule is tried here: what the app is told is on, from the founder's switches.
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {}, schema: {} }));

import type { Switches } from "@/lib/safety/switches";
import { switchesForApps } from "./start";

const all: Switches = { requestsOff: false, joiningOff: false, memberships: "everyone", membershipsHosts: [], projects: "everyone", projectsHosts: [], tipsOff: false, appMemberships: "on", appTips: false, appAvailableNow: true, appOldestVersion: "" };

describe("what is on for the phone apps", () => {
  it("tips reach the apps only when the website's own switch and the apps' switch are both on", () => {
    expect(switchesForApps({ ...all, tipsOff: false, appTips: true }).tips).toBe(true);
    expect(switchesForApps({ ...all, tipsOff: false, appTips: false }).tips).toBe(false);
    expect(switchesForApps({ ...all, tipsOff: true, appTips: true }).tips).toBe(false);
    expect(switchesForApps({ ...all, tipsOff: true, appTips: false }).tips).toBe(false);
  });

  it("tips are off for the apps until the founder switches them on there", () => {
    expect(switchesForApps(all).tips).toBe(false);
  });

  it("memberships: off for everyone is off in the apps, whatever the apps' switch says", () => {
    expect(switchesForApps({ ...all, memberships: "off", appMemberships: "on" }).memberships).toBe("off");
    expect(switchesForApps({ ...all, appMemberships: "use_only" }).memberships).toBe("use_only");
    expect(switchesForApps({ ...all, memberships: "named", appMemberships: "on" }).memberships).toBe("on");
  });

  it("'available now' is off in the apps while Connect takes no new requests", () => {
    expect(switchesForApps(all).availableNow).toBe(true);
    expect(switchesForApps({ ...all, requestsOff: true }).availableNow).toBe(false);
    expect(switchesForApps({ ...all, appAvailableNow: false }).availableNow).toBe(false);
  });
});
