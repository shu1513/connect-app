/**
 * "People you have talked to", and a host's private notes about a customer.
 *
 * Contacts are worked out from calls that happened; nothing is stored for
 * them. A note is one-way: a host keeps it about someone who was their
 * customer or really asked them for a call, and only that host can ever read
 * it. Every check is here, so every page that shows a note goes through it.
 */
import { and, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lockCalendars } from "@/lib/booking/bookings";
import { NOTE_MAX, tidyNote } from "./note-rules";

/** A problem the person can understand. Its message is safe to show them. */
export class NoteError extends Error {}

/** The stored note is no longer what the page that wants to save was showing. */
export class NoteChangedError extends NoteError {
  constructor() {
    super("This note was changed somewhere else. Copy what you typed, then reload the page to see the newer note.");
  }
}

export { NOTE_MAX };

type Reader = Pick<typeof db, "select">;
/** The database, or a step of its own inside it, for something that also writes. */
type Writer = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export type Contact = {
  userId: string;
  name: string;
  calls: number;
  lastCallAt: Date;
  /** Their host page: only for someone who was this person's host, and only when it is public right now. */
  hostHandle: string | null;
  /** True when they were this person's customer at least once: a note can be kept about them. */
  wasMyCustomer: boolean;
  note: string | null;
};

const joined = (who: typeof schema.calls.hostId | typeof schema.calls.customerId) =>
  sql`exists (select 1 from ${schema.attendanceEvents} a where a.call_id = ${schema.calls.id} and a.type = 'participant_joined' and a.participant_identity = ${who})`;

/**
 * A call that counts as "they have talked": over by its booked end, not cancelled, not made by a
 * check script, and joined by each of the two. Written once: "People you have talked to" and the
 * count a host sees beside a booked call (plans/38) can never disagree. For a query over calls
 * joined with their bookings.
 */
const talked = (now: Date) =>
  and(ne(schema.bookings.source, "admin"), isNull(schema.calls.cancelledAt), lte(schema.calls.endsAt, now), joined(schema.calls.hostId), joined(schema.calls.customerId));

/**
 * How often this person has talked with each of these others, in either role, and when the last
 * of those calls started: by the rule of `talked`. Someone they have never talked with is not in
 * the answer. One question, however many people. It says nothing about blocks or closed accounts:
 * whoever shows the answer asks about those first.
 */
export async function talkedBefore(userId: string, otherIds: string[], now: Date): Promise<Map<string, { calls: number; lastCallAt: Date }>> {
  const ids = [...new Set(otherIds)].filter((id) => id !== userId);
  const before = new Map<string, { calls: number; lastCallAt: Date }>();
  if (ids.length === 0) return before;
  const calls = await db
    .select({ hostId: schema.calls.hostId, customerId: schema.calls.customerId, startsAt: schema.calls.startsAt })
    .from(schema.calls)
    .innerJoin(schema.bookings, eq(schema.bookings.callId, schema.calls.id))
    .where(
      and(
        or(and(eq(schema.calls.hostId, userId), inArray(schema.calls.customerId, ids)), and(eq(schema.calls.customerId, userId), inArray(schema.calls.hostId, ids))),
        talked(now),
      ),
    );
  for (const call of calls) {
    const other = call.hostId === userId ? call.customerId : call.hostId;
    const entry = before.get(other) ?? { calls: 0, lastCallAt: call.startsAt };
    entry.calls++;
    if (call.startsAt > entry.lastCallAt) entry.lastCallAt = call.startsAt;
    before.set(other, entry);
  }
  return before;
}

/** The people this person has had calls with, most recent first. Never an email, a blocked person or a closed account. */
export async function contactsOf(userId: string, now: Date): Promise<Contact[]> {
  const calls = await db
    .select({ hostId: schema.calls.hostId, customerId: schema.calls.customerId, startsAt: schema.calls.startsAt })
    .from(schema.calls)
    .innerJoin(schema.bookings, eq(schema.bookings.callId, schema.calls.id))
    .where(and(or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)), talked(now)));
  const byPerson = new Map<string, { calls: number; lastCallAt: Date; wasMyCustomer: boolean; wasMyHost: boolean }>();
  for (const call of calls) {
    const iWasHost = call.hostId === userId;
    const other = iWasHost ? call.customerId : call.hostId;
    const entry = byPerson.get(other) ?? { calls: 0, lastCallAt: call.startsAt, wasMyCustomer: false, wasMyHost: false };
    entry.calls++;
    if (call.startsAt > entry.lastCallAt) entry.lastCallAt = call.startsAt;
    if (iWasHost) entry.wasMyCustomer = true;
    else entry.wasMyHost = true;
    byPerson.set(other, entry);
  }
  if (byPerson.size === 0) return [];
  const ids = [...byPerson.keys()];

  // Closed accounts and people blocked either way are left out before anything about them is returned.
  const [people, blocks] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        displayName: schema.hostProfiles.displayName,
        handle: schema.hostProfiles.handle,
        status: schema.hostProfiles.status,
        hidden: schema.hostProfiles.hidden,
      })
      .from(schema.user)
      .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
      .where(and(inArray(schema.user.id, ids), isNull(schema.user.closedAt))),
    db
      .select({ blockerId: schema.blocks.blockerId, blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(or(and(eq(schema.blocks.blockerId, userId), inArray(schema.blocks.blockedId, ids)), and(eq(schema.blocks.blockedId, userId), inArray(schema.blocks.blockerId, ids)))),
  ]);
  const blocked = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  const shown = people.filter((p) => !blocked.has(p.id));
  const customers = shown.filter((p) => byPerson.get(p.id)!.wasMyCustomer).map((p) => p.id);
  const notes =
    customers.length > 0
      ? await db.select().from(schema.hostNotes).where(and(eq(schema.hostNotes.hostId, userId), inArray(schema.hostNotes.customerId, customers)))
      : [];
  const noteOf = new Map(notes.map((n) => [n.customerId, n.text]));

  return shown
    .map((person) => {
      const entry = byPerson.get(person.id)!;
      const publicHost = person.status === "approved" && person.hidden === false;
      return {
        userId: person.id,
        // Each person as they were met. Someone who was this person's host is known by their host name,
        // the one shown when booking them, never their account name. Someone who was only their customer
        // is known by their own name: that they are a host too is theirs to tell.
        name: entry.wasMyHost ? (person.displayName ?? person.name) : person.name,
        calls: entry.calls,
        lastCallAt: entry.lastCallAt,
        hostHandle: entry.wasMyHost && publicHost ? person.handle : null,
        wasMyCustomer: entry.wasMyCustomer,
        note: noteOf.get(person.id) ?? null,
      };
    })
    .sort((a, b) => b.lastCallAt.getTime() - a.lastCallAt.getTime());
}

/**
 * Of these people, those whose account is open and who have no block with this person in either
 * direction. Two questions, however many people.
 */
export async function openAndUnblocked(personId: string, otherIds: string[], reader: Reader = db): Promise<Set<string>> {
  const ids = [...new Set(otherIds)].filter((id) => id !== personId);
  if (ids.length === 0) return new Set();
  // One after the other, not side by side: the reader may be a transaction, which has one connection.
  const open = await reader
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(inArray(schema.user.id, ids), isNull(schema.user.closedAt)));
  const blocks = await reader
    .select({ blockerId: schema.blocks.blockerId, blockedId: schema.blocks.blockedId })
    .from(schema.blocks)
    .where(or(and(eq(schema.blocks.blockerId, personId), inArray(schema.blocks.blockedId, ids)), and(eq(schema.blocks.blockedId, personId), inArray(schema.blocks.blockerId, ids))));
  const blocked = new Set(blocks.map((block) => (block.blockerId === personId ? block.blockedId : block.blockerId)));
  return new Set(open.map((person) => person.id).filter((id) => !blocked.has(id)));
}

/**
 * Which of these people have really asked this host for a call, as things stand right now: the
 * person sent them a request (which every call of theirs came from; not one abandoned at the card
 * step, not a test call), neither has blocked the other, and the person's account is not closed.
 *
 * A member's booking counts only once its call exists (plans/35). It is written down, with its
 * time, before the month's payment has gone through, and the host cannot see it until the call
 * is made: a booking the host cannot see gives them nothing about the person.
 *
 * Two things hang on this one rule: whether the host may keep (and read) a note about the person
 * (plans/32), and whether the host is handed the person's photo (plans/35).
 *
 * Three questions, however many people (plans/38): a list asks once for everyone on it. The
 * answer for one person (`hasAskedHost`) is this same code, so the two can never differ.
 */
export async function haveAskedHost(hostId: string, customerIds: string[], reader: Reader = db): Promise<Set<string>> {
  const ids = [...new Set(customerIds)].filter((id) => id !== hostId);
  if (ids.length === 0) return new Set();
  const asked = await reader
    .select({ customerId: schema.bookings.customerId })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostId, hostId),
        inArray(schema.bookings.customerId, ids),
        ne(schema.bookings.source, "admin"),
        isNotNull(schema.bookings.requestedAt),
        or(ne(schema.bookings.source, "member"), isNotNull(schema.bookings.callId)),
      ),
    )
    .groupBy(schema.bookings.customerId);
  return openAndUnblocked(
    hostId,
    asked.map((row) => row.customerId),
    reader,
  );
}

/** Whether this one person has really asked this host for a call: the rule of `haveAskedHost`. */
export async function hasAskedHost(hostId: string, customerId: string, reader: Reader = db): Promise<boolean> {
  return (await haveAskedHost(hostId, [customerId], reader)).has(customerId);
}
const mayNote = hasAskedHost;

/** The host's note about this person, or null: also null when it may not be read right now. */
export async function hostNoteAbout(hostId: string, customerId: string): Promise<{ allowed: boolean; text: string | null }> {
  if (!(await mayNote(hostId, customerId))) return { allowed: false, text: null };
  const [note] = await db.select({ text: schema.hostNotes.text }).from(schema.hostNotes).where(and(eq(schema.hostNotes.hostId, hostId), eq(schema.hostNotes.customerId, customerId)));
  return { allowed: true, text: note?.text ?? null };
}

/**
 * The host's notes about several people at once, for a list: only the people there is a note
 * about are in the answer. Every rule of the single check holds for each of them; being on the
 * list (a waiting request, say) is never taken as proof of anything.
 */
export async function hostNotesAbout(hostId: string, customerIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return new Map();
  const notes = await db
    .select({ customerId: schema.hostNotes.customerId, text: schema.hostNotes.text })
    .from(schema.hostNotes)
    .where(and(eq(schema.hostNotes.hostId, hostId), inArray(schema.hostNotes.customerId, ids)));
  const allowed = await haveAskedHost(
    hostId,
    notes.map((note) => note.customerId),
  );
  return new Map(notes.filter((note) => allowed.has(note.customerId)).map((note) => [note.customerId, note.text]));
}

/**
 * Saves the host's note about a customer, and answers with the note as it is now stored (null:
 * there is none). An empty note removes it.
 *
 * `shown` is the note as the page that saves was showing it (null: it showed none). The same
 * note can be open in several places, so a save goes through only if the stored note is still
 * exactly that. The comparison is part of the write itself, one statement each time: of two
 * saves from the same starting point, the database lets one through and the other finds nothing
 * to change. A save that finds nothing to change is refused (NoteChangedError); it never falls
 * back to writing anyway.
 */
export async function saveHostNote(input: { hostId: string; customerId: string; text: string; shown: string | null; now: Date }): Promise<string | null> {
  const text = tidyNote(input.text);
  // Tidied like a stored note, so a note nobody changed always compares equal, whatever a browser did to its line breaks.
  const shown = tidyNote(input.shown ?? "") || null;
  if (text.length > NOTE_MAX) throw new NoteError(`A note can be at most ${NOTE_MAX.toLocaleString("en-US")} characters.`);
  // Whether she may keep a note about this person, and the writing of it, are one step. A block between the two
  // takes both calendars' locks, and closing an account changes the person's own row: this step holds both while it
  // looks and writes, so neither can come in between "she may" and "it is saved".
  return db.transaction(async (tx) => {
    await lockCalendars(tx, [input.hostId, input.customerId]);
    const both = await tx.select({ id: schema.user.id, closedAt: schema.user.closedAt }).from(schema.user).where(inArray(schema.user.id, [input.hostId, input.customerId])).for("share");
    // Both people must be there and neither account closed: the host's own too (hers may have been closed a moment
    // after she pressed Save; a closed account keeps no notepad).
    const open = both.length === 2 && both.every((person) => person.closedAt === null);
    if (!open || !(await mayNote(input.hostId, input.customerId, tx))) throw new NoteError("You can keep a note only about someone who has asked you for a call.");
    return writeNote(tx, { ...input, text, shown });
  });
}

/** The writing itself: only if the stored note is still the one the page was showing. */
async function writeNote(db: Writer, input: { hostId: string; customerId: string; text: string; shown: string | null; now: Date }): Promise<string | null> {
  const { text, shown } = input;
  const theirs = and(eq(schema.hostNotes.hostId, input.hostId), eq(schema.hostNotes.customerId, input.customerId));
  const one = { hostId: schema.hostNotes.hostId };

  if (shown === null) {
    if (text === "") {
      // Nothing shown, nothing to save. A note that exists now was written elsewhere and is never deleted from here.
      const [there] = await db.select(one).from(schema.hostNotes).where(theirs);
      if (there) throw new NoteChangedError();
      return null;
    }
    // A first note: only if there is still none.
    const written = await db.insert(schema.hostNotes).values({ hostId: input.hostId, customerId: input.customerId, text, updatedAt: input.now }).onConflictDoNothing().returning(one);
    if (written.length === 0) throw new NoteChangedError();
    return text;
  }

  const unchanged = and(theirs, eq(schema.hostNotes.text, shown));
  const done =
    text === ""
      ? await db.delete(schema.hostNotes).where(unchanged).returning(one)
      : await db.update(schema.hostNotes).set({ text, updatedAt: input.now }).where(unchanged).returning(one);
  if (done.length === 0) throw new NoteChangedError();
  return text === "" ? null : text;
}
