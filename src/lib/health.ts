/**
 * Is the money work healthy? Asked by an outside watching service every few
 * minutes, through /api/health. It exists because money is now taken a day or
 * two after a call, close enough to the end of a card hold that a helper which
 * has stopped must be noticed within minutes, by something that does not
 * depend on the helper itself.
 */
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";

/** The helper's last finished round of payment work may be this old. */
export const BEAT_MAX_AGE_MS = 10 * 60_000;
/** A money action that was started may wait this long for its answer (the helper checks after one minute). */
export const UNFINISHED_MAX_AGE_MS = 6 * 60_000;

/** Written by the helper each time it finishes a round of payment work. */
export async function recordBeat(name: "payments", at: Date): Promise<void> {
  await db.insert(schema.helperBeats).values({ name, at }).onConflictDoUpdate({ target: schema.helperBeats.name, set: { at } });
}

/** The reasons the money work is not healthy right now. Empty means healthy. For our own logs only. */
export async function healthProblems(now: Date): Promise<string[]> {
  const problems: string[] = [];

  const [beat] = await db.select().from(schema.helperBeats).where(eq(schema.helperBeats.name, "payments"));
  if (!beat || now.getTime() - beat.at.getTime() > BEAT_MAX_AGE_MS) problems.push("the helper has not finished a round of payment work in the last 10 minutes");

  const [stuck] = await db
    .select({ id: schema.moneyOperations.id })
    .from(schema.moneyOperations)
    .where(and(eq(schema.moneyOperations.status, "started"), lt(schema.moneyOperations.createdAt, new Date(now.getTime() - UNFINISHED_MAX_AGE_MS))))
    .limit(1);
  if (stuck) problems.push("a money action that was started has had no answer for more than 5 minutes after the usual check");

  return problems;
}
