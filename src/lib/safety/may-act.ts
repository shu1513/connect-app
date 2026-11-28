/**
 * The one rule for "may these two still act" (plans/45-phone-apps/09a-what-is-built-put-right.md,
 * decision 6): both accounts open, neither paused, and no block between them in either direction.
 *
 * A pause, the closing of an account and a block each end the waiting requests and the coming
 * calls of the people concerned, but a moment later and in a step of their own, which can fail.
 * Until that has run, whoever lists, shows or moves on something between two people asks here
 * first. Kept tiny, like block-check.ts, so any code can ask without pulling in the rest.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";

type Reader = Pick<typeof db, "select">;

/**
 * Of these people, those with whom this person may still act. Two questions, however many people.
 *
 * `ownPauseAside`: the same question with this person's own pause left out of it, and nothing else: the answer
 * then holds the people for whom that pause is the ONLY thing in the way (their account open and not paused, no
 * block either way, and this person's own account not closed). For what a paused person may still read of their own.
 */
export async function mayActWith(personId: string, otherIds: string[], reader: Reader = db, options: { ownPauseAside?: boolean } = {}): Promise<Set<string>> {
  const ids = [...new Set(otherIds)];
  if (ids.length === 0) return new Set();
  // One after the other, not side by side: the reader may be a transaction, which has one connection.
  const people = await reader
    .select({ id: schema.user.id, closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt })
    .from(schema.user)
    .where(inArray(schema.user.id, [personId, ...ids]));
  const fine = new Set(people.filter((person) => !person.closedAt && !person.pausedAt).map((person) => person.id));
  // This person's own account first: closed or paused, they may act with nobody.
  const self = people.find((person) => person.id === personId);
  if (!self || self.closedAt || (self.pausedAt && !options.ownPauseAside)) return new Set();
  const blocks = await reader
    .select({ blockerId: schema.blocks.blockerId, blockedId: schema.blocks.blockedId })
    .from(schema.blocks)
    .where(or(and(eq(schema.blocks.blockerId, personId), inArray(schema.blocks.blockedId, ids)), and(eq(schema.blocks.blockedId, personId), inArray(schema.blocks.blockerId, ids))));
  const blocked = new Set(blocks.map((block) => (block.blockerId === personId ? block.blockedId : block.blockerId)));
  // (Asked about themselves, with their own pause set aside, a person is only held to their own account being open.)
  return new Set(ids.filter((id) => (fine.has(id) || (id === personId && options.ownPauseAside)) && !blocked.has(id)));
}

/** Whether these two may still act with each other: the same rule, for one pair. */
export async function mayStillAct(a: string, b: string, reader: Reader = db): Promise<boolean> {
  return (await mayActWith(a, [b], reader)).has(b);
}
