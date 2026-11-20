import { describe, expect, it } from "vitest";
import { readNote, readPhotoNote, writeNote, writePhotoNote } from "./login-note";

const SECRET = "a-fixed-test-secret";
const NOW = new Date(1_800_000_000_000);
const LATER = new Date(NOW.getTime() + 10 * 60_000);
const TRY = "0b6f5c1e-2d3a-4b7c-8e9f-a1b2c3d4e5f6";
const started = { state: "the-value-sent-along", userId: "user:one/1", expiresAt: LATER };

describe("an ordinary sign-in's note", () => {
  it("is written exactly as it always was", () => {
    // The same note as the fixed one in tiktok.test.ts, written before this file changed.
    expect(writeNote("tiktok-login", { state: "fixed-state-value", userId: "user:fixed/1", expiresAt: new Date(1_900_000_000_000) }, SECRET)).toBe("fixed-state-value.dXNlcjpmaXhlZC8x.1900000000000.1wRwzwSETl6gKXtpwRap7MHzpIzK2omECXH2JbEp1P8");
  });

  it("is read back under its own label only", () => {
    const note = writeNote("tiktok-login", started, SECRET);
    expect(readNote("tiktok-login", note, SECRET, NOW)).toEqual({ state: started.state, userId: started.userId });
    expect(readNote("instagram-login", note, SECRET, NOW)).toBeNull();
    expect(readPhotoNote(note, SECRET, NOW)).toBeNull();
  });
});

describe("the note of a sign-in for a host's photo", () => {
  const note = writePhotoNote({ ...started, tryId: TRY }, SECRET);

  it("carries the try's id, and is read back with it", () => {
    expect(note.split(".")).toHaveLength(5);
    expect(readPhotoNote(note, SECRET, NOW)).toEqual({ state: started.state, userId: started.userId, tryId: TRY });
  });

  it("is never read as an ordinary sign-in's note, with the try's id or with it cut off", () => {
    expect(readNote("tiktok-login", note, SECRET, NOW)).toBeNull();
    expect(readNote("instagram-login", note, SECRET, NOW)).toBeNull();
    const [state, user, expires, , signature] = note.split(".");
    expect(readNote("tiktok-login", [state, user, expires, signature].join("."), SECRET, NOW)).toBeNull();
    // An ordinary note with a try's id put in is not a photo's note either.
    const ordinary = writeNote("tiktok-login", started, SECRET).split(".");
    expect(readPhotoNote([ordinary[0], ordinary[1], ordinary[2], TRY, ordinary[3]].join("."), SECRET, NOW)).toBeNull();
  });

  it("is refused when any part was changed, when it is out of date, or signed with another secret", () => {
    const parts = note.split(".");
    const other = "1c7a6d2f-3e4b-4c8d-9fa0-b2c3d4e5f6a7";
    for (const [index, value] of [[0, "another-value"], [1, Buffer.from("user:two/2").toString("base64url")], [2, String(LATER.getTime() + 60_000)], [3, other], [4, `${parts[4]}x`]] as const) {
      const changed = [...parts];
      changed[index] = value;
      expect(readPhotoNote(changed.join("."), SECRET, NOW), `part ${index}`).toBeNull();
    }
    expect(readPhotoNote(note, SECRET, LATER)).toBeNull();
    expect(readPhotoNote(note, SECRET, new Date(LATER.getTime() - 1))).not.toBeNull();
    expect(readPhotoNote(note, "another-secret", NOW)).toBeNull();
    for (const nothing of [undefined, "", "a.b.c", "a.b.c.d.e", "a.b.c.d.e.f"]) expect(readPhotoNote(nothing, SECRET, NOW)).toBeNull();
  });

  it("cannot be written without a try's id of the right shape", () => {
    for (const tryId of ["", "not-an-id", "-".repeat(36), `${TRY}.extra`]) expect(() => writePhotoNote({ ...started, tryId }, SECRET)).toThrow();
  });
});
