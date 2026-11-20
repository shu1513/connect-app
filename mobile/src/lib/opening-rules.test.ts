import type { AppStart } from "../../../src/lib/app-door/types";
import { UNREACHABLE } from "./api-rules";
import { openingAfter, openingFrom, PLEASE_UPDATE } from "./opening-rules";

const start: AppStart = { updateNeeded: false, switches: { memberships: "on", tips: false, availableNow: true }, me: null, termsVersion: "2026-11-rules" };

describe("what the app shows when it opens", () => {
  it("carries on with the server's answer", () => {
    expect(openingFrom({ ok: true, data: start })).toEqual({ kind: "ready", start });
  });

  it("shows the update screen when the server says this copy is too old", () => {
    expect(openingFrom({ ok: true, data: { ...start, updateNeeded: true } })).toEqual({ kind: "update", message: PLEASE_UPDATE });
    expect(openingFrom({ ok: false, code: "update_needed", message: "Please update." })).toEqual({ kind: "update", message: "Please update." });
  });

  it("says Connect cannot be reached for anything else, and never guesses", () => {
    expect(openingFrom({ ok: false, code: "unreachable", message: UNREACHABLE })).toEqual({ kind: "unreachable", message: UNREACHABLE });
    expect(openingFrom({ ok: false, code: "not_the_app", message: "This address is for the Connect app." }).kind).toBe("unreachable");
  });

  it("keeps the screen the person was on when a quiet question does not get through", () => {
    const ready = { kind: "ready", start } as const;
    const lost = { ok: false, code: "unreachable", message: UNREACHABLE } as const;
    expect(openingAfter(ready, lost)).toBe(ready);
    // Before the app is open, and after "Try again", not getting through is said plainly.
    expect(openingAfter({ kind: "asking" }, lost)).toEqual({ kind: "unreachable", message: UNREACHABLE });
    expect(openingAfter({ kind: "unreachable", message: UNREACHABLE }, lost).kind).toBe("unreachable");
    // A real answer always counts: a newer one replaces the old, and "too old" closes the app.
    const signedOutLater = { ...start, termsVersion: "newer" };
    expect(openingAfter(ready, { ok: true, data: signedOutLater })).toEqual({ kind: "ready", start: signedOutLater });
    expect(openingAfter(ready, { ok: false, code: "update_needed", message: "Please update." }).kind).toBe("update");
    expect(openingAfter(ready, { ok: true, data: { ...start, updateNeeded: true } }).kind).toBe("update");
  });
});
