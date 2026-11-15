/**
 * Saving the notes a call screen sends about connection quality, and removing
 * them when they are old. What a note may look like is in rules.ts.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { roleOnCall, roomClosesAt, roomOpensAt, roomState } from "@/lib/calls";
import { fromThisSite } from "@/lib/same-site";
import { NOTES_PER_PERSON_PER_CALL, readNotes, type IncomingNote } from "./rules";

/** Notes are removed this long after the call. */
export const KEEP_NOTES_DAYS = 60;

/**
 * Saves one batch from one person on the call. "me" and "other" are turned
 * into the host or the customer here, from the call itself: a browser cannot
 * name anyone. A note that arrives twice is saved once.
 */
export async function saveNotes(input: {
  call: Pick<Call, "id" | "hostId" | "customerId">;
  reporterId: string;
  connectionId: string;
  notes: IncomingNote[];
}): Promise<"saved" | "limit_reached"> {
  const { call, reporterId } = input;
  const otherId = reporterId === call.hostId ? call.customerId : call.hostId;
  return db.transaction(async (tx) => {
    // One batch at a time per person and call, so batches sent at the same moment cannot slip past the limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`quality:${call.id}:${reporterId}`}))`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.qualityNotes)
      .where(and(eq(schema.qualityNotes.callId, call.id), eq(schema.qualityNotes.reporterId, reporterId)));
    const room = NOTES_PER_PERSON_PER_CALL - count;
    if (room <= 0) return "limit_reached" as const;
    const rows = input.notes.slice(0, room).map((note) => ({
      callId: call.id,
      reporterId,
      aboutId: note.about === "me" ? reporterId : otherId,
      grade: note.grade,
      connectionId: input.connectionId,
      seq: note.seq,
      seenAt: note.seenAt,
    }));
    if (rows.length > 0) await tx.insert(schema.qualityNotes).values(rows).onConflictDoNothing();
    return "saved" as const;
  });
}

/**
 * Everything the server checks before it keeps a batch of notes, in one place.
 * Accepted only from a logged-in person who is on this call, from our own
 * pages, while the room is open and the call was not cancelled or stopped.
 * Gives back the status to answer with, and nothing else: the call screen
 * does not wait for it.
 */
export async function receiveNotes(input: { userId: string | null; callId: string; headers: { get(name: string): string | null }; text: string; now: Date }): Promise<number> {
  if (!fromThisSite(input.headers)) return 403;
  if (!input.userId) return 401;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.callId)) return 404;
  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, input.callId));
  // A stranger gets the same answer whether or not the call exists.
  if (!call || !roleOnCall(call, input.userId)) return 404;
  if (call.cancelledAt || call.safetyEndedAt || roomState(call, input.now) !== "open") return 409;

  if (input.text.length === 0 || input.text.length > 20_000) return 400;
  let body: unknown;
  try {
    body = JSON.parse(input.text);
  } catch {
    return 400;
  }
  const read = readNotes(body, { opensAt: roomOpensAt(call), closesAt: roomClosesAt(call), now: input.now });
  if (!read) return 400;
  const outcome = await saveNotes({ call, reporterId: input.userId, connectionId: read.connectionId, notes: read.notes });
  return outcome === "saved" ? 204 : 429;
}

/** Removes the notes of calls that ended more than 60 days ago. Returns how many calls were cleared. */
export async function removeOldNotes(now: Date): Promise<number> {
  const before = new Date(now.getTime() - KEEP_NOTES_DAYS * 24 * 3_600_000);
  const old = await db
    .selectDistinct({ callId: schema.qualityNotes.callId })
    .from(schema.qualityNotes)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.qualityNotes.callId))
    .where(lt(schema.calls.endsAt, before))
    .limit(500);
  if (old.length === 0) return 0;
  await db.delete(schema.qualityNotes).where(inArray(schema.qualityNotes.callId, old.map((row) => row.callId)));
  return old.length;
}
