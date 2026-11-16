/**
 * The server's part of the connection check: starting a test (with its
 * limits) and ending tests that were left open. The answer of a test is
 * worked out in the person's browser and never comes here.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { closeTestRoom, openTestRoom, videoServerUrl } from "@/lib/video/livekit";

/** One person can start this many tests in an hour, and no two closer together than this. */
export const TESTS_PER_HOUR = 10;
export const SECONDS_APART = 20;
/** A pass is only handed over when making the test's room took less than this, counted from when the test was written down. */
export const ROOM_WITHIN_MS = 20_000;
/**
 * The helper ends every test this long after it started. A pass can only be used to connect in
 * its first minute, and none is handed over later than 20 seconds after the start, so by now
 * nobody can still connect: the room that is closed is always the last of that test.
 */
export const END_AFTER_MS = 90_000;
/** Rows are removed after a day, but only those whose room is confirmed closed. */
const KEEP_ROWS_MS = 24 * 3_600_000;

export type Started = { ok: true; token: string; serverUrl: string } | { ok: false; why: "limit" | "too_soon" | "slow" };

/**
 * Starts one test for one person. Counting and writing the row happen under a lock of that
 * person's own (not the one joining a call uses), so two starts at the same moment cannot both
 * slip past the limits.
 */
export async function startTest(
  userId: string,
  /** Only the check script passes these, to pretend another time or a slow video service. */
  options: { now?: Date; open?: (testId: string) => Promise<string>; clock?: () => number } = {},
): Promise<Started> {
  const clock = options.clock ?? Date.now;
  const written = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`connection-test:${userId}`}))`);
    // The test's starting moment is read here, with the lock held, never before waiting for it. The helper
    // counts its 90 seconds from the moment that is written down, and the 20 seconds below count from the same
    // moment: so a start that had to wait can never be handed a pass for a room the helper has already tidied up.
    const at = clock();
    const now = options.now ?? new Date(at);
    const recent = await tx
      .select({ startedAt: schema.connectionTests.startedAt })
      .from(schema.connectionTests)
      .where(and(eq(schema.connectionTests.userId, userId), gt(schema.connectionTests.startedAt, new Date(now.getTime() - 3_600_000))))
      .orderBy(desc(schema.connectionTests.startedAt));
    if (recent.length >= TESTS_PER_HOUR) return "limit" as const;
    if (recent[0] && now.getTime() - recent[0].startedAt.getTime() < SECONDS_APART * 1000) return "too_soon" as const;
    const [row] = await tx.insert(schema.connectionTests).values({ userId, startedAt: now }).returning({ id: schema.connectionTests.id });
    return { id: row.id, at };
  });
  if (typeof written === "string") return { ok: false, why: written };

  const token = await (options.open ?? openTestRoom)(written.id);
  // Too slow: no pass. Otherwise a pass could still be used after the helper has tidied this test up.
  if (clock() - written.at >= ROOM_WITHIN_MS) return { ok: false, why: "slow" };
  return { ok: true, token, serverUrl: videoServerUrl() };
}

/**
 * Ends every test that started more than 90 seconds ago: cancels its pass and deletes its room.
 * A row is only marked once the video service confirms the room is gone; otherwise it is tried
 * again on the next pass. Then removes rows older than a day whose room is confirmed closed (a
 * row still waiting is the only record of a room left to close).
 */
export async function endOldTests(
  now: Date,
  close: (testId: string) => Promise<boolean> = closeTestRoom,
  /** Only the check script passes this, so that what it pretends never touches anyone else's tests. */
  only?: { userId: string },
): Promise<void> {
  const mine = only ? eq(schema.connectionTests.userId, only.userId) : undefined;
  const open = await db
    .select({ id: schema.connectionTests.id })
    .from(schema.connectionTests)
    .where(and(isNull(schema.connectionTests.roomClosedAt), lte(schema.connectionTests.startedAt, new Date(now.getTime() - END_AFTER_MS)), mine))
    // In no fixed order: tests that keep failing to close must not keep the same hundred in front of the rest.
    .orderBy(sql`random()`)
    .limit(100);
  for (const { id } of open) {
    try {
      if (await close(id)) await db.update(schema.connectionTests).set({ roomClosedAt: new Date() }).where(eq(schema.connectionTests.id, id));
      else console.warn(`[connection test] the room of test ${id} is not gone yet; will retry`);
    } catch (error) {
      console.error(`[connection test] could not end test ${id}; will retry`, error);
    }
  }
  await db.delete(schema.connectionTests).where(and(isNotNull(schema.connectionTests.roomClosedAt), lt(schema.connectionTests.startedAt, new Date(now.getTime() - KEEP_ROWS_MS)), mine));
}

/**
 * For tools that remove a person: first ends each of that person's tests whose room is not confirmed closed,
 * then removes their test rows. Throws when a room cannot be confirmed closed, and then removes nothing: a
 * row still waiting is the only record of a room left to close.
 */
export async function removeTestsOf(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const open = await db
    .select({ id: schema.connectionTests.id })
    .from(schema.connectionTests)
    .where(and(inArray(schema.connectionTests.userId, userIds), isNull(schema.connectionTests.roomClosedAt)));
  for (const { id } of open) {
    if (!(await closeTestRoom(id))) throw new Error(`The room of connection test ${id} could not be confirmed closed, so its record was kept.`);
    await db.update(schema.connectionTests).set({ roomClosedAt: new Date() }).where(eq(schema.connectionTests.id, id));
  }
  await db.delete(schema.connectionTests).where(inArray(schema.connectionTests.userId, userIds));
}
