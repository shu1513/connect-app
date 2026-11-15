/**
 * The notes a call screen sends about connection quality: what a note may
 * look like, and the limits. Plain functions, no database.
 */

/** The video service's grades, in its own words. "unknown" is what it says before it has measured. */
export const GRADES = ["excellent", "good", "poor", "lost", "unknown"] as const;
export type Grade = (typeof GRADES)[number];

/** The call screen confirms "still reporting" this often, and sends what it has noted this often. */
export const CONFIRM_EVERY_MS = 30_000;
export const SEND_EVERY_MS = 5_000;
/** One batch never holds more than this. */
export const NOTES_PER_BATCH = 60;
/**
 * One person can send at most this many notes about one call. A six-hour call
 * with two notes twice a minute is 1,440; the rest is room for changes. One
 * person's limit never uses up the other's.
 */
export const NOTES_PER_PERSON_PER_CALL = 4_000;
/** A browser's clock reading may be this far ahead of ours before a note is dropped. */
const CLOCK_SLACK_MS = 5_000;

export type IncomingNote = { about: "me" | "other"; grade: Grade; seenAt: Date; seq: number };

/**
 * Reads what a browser sent. Null when it is not what the call screen sends.
 * Single notes that cannot be right (a time outside the room's opening, a time
 * in the future) are dropped; the rest of the batch is kept.
 */
export function readNotes(
  body: unknown,
  room: { opensAt: Date; closesAt: Date; now: Date },
): { connectionId: string; notes: IncomingNote[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const { connectionId, notes } = body as { connectionId?: unknown; notes?: unknown };
  if (typeof connectionId !== "string" || !/^[A-Za-z0-9_-]{8,40}$/.test(connectionId)) return null;
  if (!Array.isArray(notes) || notes.length === 0 || notes.length > NOTES_PER_BATCH) return null;

  const latest = Math.min(room.now.getTime() + CLOCK_SLACK_MS, room.closesAt.getTime());
  const read: IncomingNote[] = [];
  const seen = new Set<number>();
  for (const note of notes) {
    if (typeof note !== "object" || note === null) return null;
    const { about, grade, seenAt, seq } = note as Record<string, unknown>;
    if (about !== "me" && about !== "other") return null;
    if (typeof grade !== "string" || !(GRADES as readonly string[]).includes(grade)) return null;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq > 1_000_000) return null;
    if (typeof seenAt !== "number" || !Number.isFinite(seenAt)) return null;
    if (seenAt < room.opensAt.getTime() || seenAt > latest || seen.has(seq)) continue;
    seen.add(seq);
    read.push({ about, grade: grade as Grade, seenAt: new Date(seenAt), seq });
  }
  return { connectionId, notes: read };
}
