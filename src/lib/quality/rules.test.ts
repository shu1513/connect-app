import { describe, expect, it } from "vitest";
import { NOTES_PER_BATCH, readNotes } from "./rules";

const at = (iso: string) => new Date(iso);
const room = { opensAt: at("2027-01-13T08:55:00Z"), closesAt: at("2027-01-13T10:00:00Z"), now: at("2027-01-13T09:30:00Z") };
const t = (iso: string) => Date.parse(iso);
const note = (over: Record<string, unknown> = {}) => ({ about: "me", grade: "good", seenAt: t("2027-01-13T09:29:58Z"), seq: 0, ...over });
const batch = (notes: unknown[], connectionId: unknown = "c0nnect1on-id") => ({ connectionId, notes });

describe("reading the notes a call screen sends", () => {
  it("reads a well-formed batch", () => {
    const read = readNotes(batch([note(), note({ about: "other", grade: "poor", seq: 1 })]), room);
    expect(read?.connectionId).toBe("c0nnect1on-id");
    expect(read?.notes).toEqual([
      { about: "me", grade: "good", seenAt: at("2027-01-13T09:29:58Z"), seq: 0 },
      { about: "other", grade: "poor", seenAt: at("2027-01-13T09:29:58Z"), seq: 1 },
    ]);
  });
  it("refuses anything that is not what the call screen sends", () => {
    expect(readNotes(null, room)).toBeNull();
    expect(readNotes("notes", room)).toBeNull();
    expect(readNotes(batch([]), room)).toBeNull();
    expect(readNotes(batch([note()], "short"), room)).toBeNull();
    expect(readNotes(batch([note()], "has spaces in it"), room)).toBeNull();
    expect(readNotes(batch([note({ about: "someone-else" })]), room)).toBeNull();
    expect(readNotes(batch([note({ grade: "terrible" })]), room)).toBeNull();
    expect(readNotes(batch([note({ seq: 1.5 })]), room)).toBeNull();
    expect(readNotes(batch([note({ seq: -1 })]), room)).toBeNull();
    expect(readNotes(batch([note({ seenAt: "now" })]), room)).toBeNull();
    expect(readNotes(batch(Array.from({ length: NOTES_PER_BATCH + 1 }, (_, seq) => note({ seq }))), room)).toBeNull();
  });
  it("drops single notes from before the room opened, from the future, or after its end", () => {
    const read = readNotes(
      batch([
        note({ seq: 0, seenAt: t("2027-01-13T08:54:59Z") }),
        note({ seq: 1, seenAt: t("2027-01-13T08:55:00Z") }),
        note({ seq: 2, seenAt: t("2027-01-13T09:30:04Z") }), // a browser clock a few seconds ahead is fine
        note({ seq: 3, seenAt: t("2027-01-13T09:30:06Z") }),
      ]),
      room,
    );
    expect(read?.notes.map((n) => n.seq)).toEqual([1, 2]);
    const atTheEnd = { ...room, now: at("2027-01-13T09:59:59Z") };
    expect(readNotes(batch([note({ seq: 0, seenAt: t("2027-01-13T10:00:00Z") }), note({ seq: 1, seenAt: t("2027-01-13T10:00:01Z") })]), atTheEnd)?.notes.map((n) => n.seq)).toEqual([0]);
  });
  it("counts a number that appears twice in one batch once", () => {
    expect(readNotes(batch([note({ seq: 7 }), note({ seq: 7, grade: "lost" })]), room)?.notes).toHaveLength(1);
  });
});
