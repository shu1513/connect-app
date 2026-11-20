import type { AppStart } from "../../../src/lib/app-door/types";
import { UNREACHABLE } from "./api-rules";
import { gotThrough, isStart, openingAfter, openingFrom, PLEASE_UPDATE, signedOut, someoneSignedIn } from "./opening-rules";

const start: AppStart = { updateNeeded: false, switches: { memberships: "on", tips: false, availableNow: true }, me: null, termsVersion: "2026-11-rules", supportEmail: "support@connect.example" };

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

  it("does not open on an answer that lacks what the screens read", () => {
    const me = { id: "u1", name: "Ada", email: "ada@example.com", timeZone: null, paused: false, pausedReason: null, next: null, host: null };
    expect(isStart(start)).toBe(true);
    expect(isStart({ ...start, me })).toBe(true);
    expect(isStart({ ...start, me: { ...me, timeZone: "Europe/London", next: "welcome", host: { status: "approved", hidden: false } } })).toBe(true);
    for (const bad of [
      {},
      [],
      null,
      "start",
      { ...start, updateNeeded: undefined },
      { ...start, switches: undefined },
      { ...start, switches: { ...start.switches, memberships: "maybe" } },
      { ...start, switches: { ...start.switches, tips: "off" } },
      { ...start, me: undefined },
      { ...start, me: { ...me, id: 7 } },
      { ...start, me: { ...me, next: "somewhere" } },
      { ...start, me: { ...me, host: { status: "approved" } } },
      { ...start, termsVersion: 3 },
      { ...start, supportEmail: undefined },
      { ...start, me: { ...me, pausedReason: 5 } },
    ]) {
      expect(isStart(bad)).toBe(false);
      expect(openingFrom({ ok: true, data: bad as never })).toEqual({ kind: "unreachable", message: UNREACHABLE });
    }
  });

  it("tells a whole answer from half of one, for the screens that wait on it", () => {
    const me = { id: "u1", name: "Ada", email: "ada@example.com", timeZone: null, paused: false, pausedReason: null, next: null, host: null };
    expect(gotThrough({ ok: true, data: start })).toBe(true);
    expect(gotThrough({ ok: true, data: {} as never })).toBe(false);
    expect(gotThrough({ ok: false, code: "unreachable", message: UNREACHABLE })).toBe(false);
    expect(gotThrough({ ok: false, code: "not_signed_in", message: "Please log in." })).toBe(true);
    expect(someoneSignedIn({ ok: true, data: { ...start, me } })).toBe(true);
    expect(someoneSignedIn({ ok: true, data: start })).toBe(false);
    expect(someoneSignedIn({ ok: true, data: { me } as never })).toBe(false);
    expect(someoneSignedIn({ ok: false, code: "unreachable", message: UNREACHABLE })).toBe(false);
  });

  it("shows nobody signed in the moment someone signs out, and keeps it so when Connect cannot be reached", () => {
    const signedInAs = { kind: "ready", start: { ...start, me: { id: "u1", name: "Ada", email: "ada@example.com", timeZone: null, paused: false, pausedReason: null, next: null, host: null } } } as const;
    const out = signedOut(signedInAs);
    expect(out).toEqual({ kind: "ready", start });
    expect(openingAfter(out, { ok: false, code: "unreachable", message: UNREACHABLE })).toBe(out);
    expect(signedOut({ kind: "asking" })).toEqual({ kind: "asking" });
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
    // "Too old" is understood even when the rest of the answer is from a later server this copy cannot read.
    const later = { updateNeeded: true, switches: { memberships: "a_later_kind" }, somethingNew: 1 } as never;
    expect(openingFrom({ ok: true, data: later })).toEqual({ kind: "update", message: PLEASE_UPDATE });
    expect(openingAfter(ready, { ok: true, data: later }).kind).toBe("update");
    // Half an answer counts as not getting through.
    expect(openingAfter(ready, { ok: true, data: {} as never })).toBe(ready);
    // A refusal is Connect's own word: the old, signed-in screens do not stay.
    expect(openingAfter(ready, { ok: false, code: "not_signed_in", message: "Please log in." })).toEqual({ kind: "unreachable", message: "Please log in." });
  });
});
