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
import { isBlockedEitherWay } from "@/lib/safety/block-check";

/** A problem the person can understand. Its message is safe to show them. */
export class NoteError extends Error {}

export const NOTE_MAX = 1000;

type Reader = Pick<typeof db, "select">;

export type Contact = {
  userId: string;
  name: string;
  calls: number;
  lastCallAt: Date;
  /** Their host page, only when it is public right now. */
  hostHandle: string | null;
  /** True when they were this person's customer at least once: a note can be kept about them. */
  wasMyCustomer: boolean;
  note: string | null;
};

/** The people this person has had calls with, most recent first. Never an email, a blocked person or a closed account. */
export async function contactsOf(userId: string, now: Date): Promise<Contact[]> {
  const joined = (who: typeof schema.calls.hostId | typeof schema.calls.customerId) =>
    sql`exists (select 1 from ${schema.attendanceEvents} a where a.call_id = ${schema.calls.id} and a.type = 'participant_joined' and a.participant_identity = ${who})`;
  const calls = await db
    .select({ hostId: schema.calls.hostId, customerId: schema.calls.customerId, startsAt: schema.calls.startsAt })
    .from(schema.calls)
    .innerJoin(schema.bookings, eq(schema.bookings.callId, schema.calls.id))
    .where(
      and(
        or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)),
        // Calls that are over, were not cancelled, did not come from the admin test page, and that both people joined.
        ne(schema.bookings.source, "admin"),
        isNull(schema.calls.cancelledAt),
        lte(schema.calls.endsAt, now),
        joined(schema.calls.hostId),
        joined(schema.calls.customerId),
      ),
    );
  const byPerson = new Map<string, { calls: number; lastCallAt: Date; wasMyCustomer: boolean }>();
  for (const call of calls) {
    const iWasHost = call.hostId === userId;
    const other = iWasHost ? call.customerId : call.hostId;
    const entry = byPerson.get(other) ?? { calls: 0, lastCallAt: call.startsAt, wasMyCustomer: false };
    entry.calls++;
    if (call.startsAt > entry.lastCallAt) entry.lastCallAt = call.startsAt;
    if (iWasHost) entry.wasMyCustomer = true;
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
        // A public host is known by their display name; anyone else by their own name.
        name: publicHost ? person.displayName! : person.name,
        calls: entry.calls,
        lastCallAt: entry.lastCallAt,
        hostHandle: publicHost ? person.handle : null,
        wasMyCustomer: entry.wasMyCustomer,
        note: noteOf.get(person.id) ?? null,
      };
    })
    .sort((a, b) => b.lastCallAt.getTime() - a.lastCallAt.getTime());
}

/**
 * Whether this host may keep (and read) a note about this person right now:
 * the person really sent them a request (which every call of theirs came
 * from; not one abandoned at the card step, not a test call), neither has
 * blocked the other, and the person's account is not closed.
 */
async function mayNote(hostId: string, customerId: string, reader: Reader = db): Promise<boolean> {
  if (hostId === customerId) return false;
  const [asked] = await reader
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.hostId, hostId), eq(schema.bookings.customerId, customerId), ne(schema.bookings.source, "admin"), isNotNull(schema.bookings.requestedAt)))
    .limit(1);
  if (!asked) return false;
  const [customer] = await reader.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, customerId));
  if (!customer || customer.closedAt) return false;
  return !(await isBlockedEitherWay(hostId, customerId, reader));
}

/** The host's note about this person, or null: also null when it may not be read right now. */
export async function hostNoteAbout(hostId: string, customerId: string): Promise<{ allowed: boolean; text: string | null }> {
  if (!(await mayNote(hostId, customerId))) return { allowed: false, text: null };
  const [note] = await db.select({ text: schema.hostNotes.text }).from(schema.hostNotes).where(and(eq(schema.hostNotes.hostId, hostId), eq(schema.hostNotes.customerId, customerId)));
  return { allowed: true, text: note?.text ?? null };
}

/** Saves the host's note about a customer. An empty note removes it. */
export async function saveHostNote(input: { hostId: string; customerId: string; text: string; now: Date }): Promise<void> {
  // Plain text: no control or invisible characters; line breaks are kept.
  const text = input.text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n]/gu, " ")
    .replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .trim();
  if (text.length > NOTE_MAX) throw new NoteError(`A note can be at most ${NOTE_MAX} characters.`);
  if (!(await mayNote(input.hostId, input.customerId))) throw new NoteError("You can keep a note only about someone who has asked you for a call.");
  if (text === "") {
    await db.delete(schema.hostNotes).where(and(eq(schema.hostNotes.hostId, input.hostId), eq(schema.hostNotes.customerId, input.customerId)));
    return;
  }
  await db
    .insert(schema.hostNotes)
    .values({ hostId: input.hostId, customerId: input.customerId, text, updatedAt: input.now })
    .onConflictDoUpdate({ target: [schema.hostNotes.hostId, schema.hostNotes.customerId], set: { text, updatedAt: input.now } });
}
