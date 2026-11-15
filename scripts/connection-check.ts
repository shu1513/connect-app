/**
 * Testing tool: the server's side of the connection check, against the local
 * database and the real video service (LiveKit). The test in the browser is
 * tried by hand; here the rules around it are checked: the limits, the pass, the
 * private test room, that a test can never reach a call's record, and the
 * helper's tidying up.
 *
 * It makes one person of its own and removes that person, with their tests, at the end.
 *
 * Usage: npx tsx scripts/connection-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { startTest, endOldTests, TESTS_PER_HOUR, SECONDS_APART, END_AFTER_MS } = await import("../src/lib/connection/tests");
  const { roomExists, testRoomOf, closeTestRoom } = await import("../src/lib/video/livekit");
  const { saveAttendance } = await import("../src/lib/attendance/save");

  const RUN = randomUUID().slice(0, 8);
  const userId = `cx-${RUN}`;
  const stamp = new Date();
  await db.insert(schema.user).values({ id: userId, name: "Connection check", email: `connectioncheck-${RUN}@example.test`, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
  const rows = () => db.select().from(schema.connectionTests).where(eq(schema.connectionTests.userId, userId));
  /** Stands in for the video service where a check is only about our own limits: no room is made. */
  const noRoom = async () => "a-pass";
  const T0 = Date.now() - 50 * 60_000;
  const at = (seconds: number) => new Date(T0 + seconds * 1000);

  try {
    console.log("\n1. The limits: 10 tests an hour, and at least 20 seconds apart");
    {
      const first = await startTest(userId, { now: at(0), open: noRoom });
      check("a first test starts", first.ok);
      const tooSoon = await startTest(userId, { now: at(SECONDS_APART - 1), open: noRoom });
      check("a second one 19 seconds later is refused", !tooSoon.ok && tooSoon.why === "too_soon");
      check("and exactly 20 seconds later it starts", (await startTest(userId, { now: at(SECONDS_APART), open: noRoom })).ok);
      for (let n = 2; n < TESTS_PER_HOUR; n++) await startTest(userId, { now: at(n * 60), open: noRoom });
      check("ten tests in the hour are allowed", (await rows()).length === TESTS_PER_HOUR, String((await rows()).length));
      const eleventh = await startTest(userId, { now: at(20 * 60), open: noRoom });
      check("an eleventh is refused, and nothing is written for it", !eleventh.ok && eleventh.why === "limit" && (await rows()).length === TESTS_PER_HOUR);
      check("once the first is more than an hour old, another may start", (await startTest(userId, { now: at(3600 + 1), open: noRoom })).ok);

      await db.delete(schema.connectionTests).where(eq(schema.connectionTests.userId, userId));
      const together = await Promise.all([startTest(userId, { now: at(0), open: noRoom }), startTest(userId, { now: at(0), open: noRoom }), startTest(userId, { now: at(1), open: noRoom })]);
      check("three starts at the same moment: one test, not three", together.filter((t) => t.ok).length === 1 && (await rows()).length === 1, together.map((t) => (t.ok ? "ok" : t.why)).join(" "));
      await db.delete(schema.connectionTests).where(eq(schema.connectionTests.userId, userId));
    }

    console.log("\n2. No pass when making the room took too long");
    {
      // A pretend clock: making the room "takes" as long as the clock is moved on.
      let clock = 1_000_000;
      const slow = (seconds: number) => async () => {
        clock += seconds * 1000;
        return "a-pass";
      };
      const quick = await startTest(userId, { now: at(0), open: slow(19), clock: () => clock });
      check("19 seconds: the pass is handed over", quick.ok);
      const late = await startTest(userId, { now: at(60), open: slow(20), clock: () => clock });
      check("20 seconds or more: no pass (the person sees \"not measured\")", !late.ok && late.why === "slow");
      check("the test is still written down, so the helper tidies its room up", (await rows()).length === 2);
      await db.delete(schema.connectionTests).where(eq(schema.connectionTests.userId, userId));
    }

    console.log("\n3. A real test room at the video service, and its pass");
    const started = await startTest(userId);
    check("a test starts against the real video service", started.ok);
    const [row] = await rows();
    if (started.ok && row) {
      const { roomName, identity } = testRoomOf(row.id);
      const claims = JSON.parse(Buffer.from(started.token.split(".")[1], "base64url").toString()) as { sub: string; exp: number; nbf?: number; video: Record<string, unknown> };
      check("the room is the test's own, made up by the server: never a call's room", roomName === `check-${row.id}` && claims.video.room === roomName && !roomName.startsWith("call-"));
      check("it connects under the test's own name, never the person's account", claims.sub === identity && identity === `check:${row.id}` && claims.sub !== userId);
      check("the pass can send and cannot receive", claims.video.roomJoin === true && claims.video.canPublish === true && claims.video.canSubscribe === false);
      check("the pass can only be used to connect in its first minute", claims.exp - Math.floor(Date.now() / 1000) <= 61, String(claims.exp - Math.floor(Date.now() / 1000)));
      check("the room exists at the video service, for one participant", await roomExists(roomName));

      console.log("\n4. A test can never reach a call's record");
      const message = (type: string) => ({ provider: "livekit" as const, id: `EV_${randomUUID()}`, type, roomName, roomSessionId: "RM_check", participantIdentity: identity, participantSessionId: "PA_check", time: new Date() });
      const before = (await db.select({ id: schema.attendanceEvents.id }).from(schema.attendanceEvents).where(eq(schema.attendanceEvents.participantIdentity, identity))).length;
      const kept = [await saveAttendance(message("participant_joined"), "{}"), await saveAttendance(message("participant_left"), "{}"), await saveAttendance(message("room_finished"), "{}")];
      const after = (await db.select({ id: schema.attendanceEvents.id }).from(schema.attendanceEvents).where(eq(schema.attendanceEvents.participantIdentity, identity))).length;
      check("messages about a test room's comings and goings are not kept in any call's attendance log", kept.every((k) => k === false) && before === 0 && after === 0);
      const [asCall] = await db.select({ id: schema.calls.id }).from(schema.calls).where(eq(schema.calls.roomName, roomName));
      check("a test room is not in the list of calls, which is all the closing helper and the \"one call at a time\" rule look at", !asCall);

      console.log("\n5. The helper ends tests left open");
      await endOldTests(new Date(row.startedAt.getTime() + END_AFTER_MS - 1000));
      check("not before 90 seconds have passed", (await rows())[0].roomClosedAt === null && (await roomExists(roomName)));
      await endOldTests(new Date(row.startedAt.getTime() + END_AFTER_MS), async () => false);
      check("when the video service does not confirm the room is gone, the test stays to be tried again", (await rows())[0].roomClosedAt === null);
      await endOldTests(new Date(row.startedAt.getTime() + END_AFTER_MS));
      check("after 90 seconds its room is deleted and the test is marked closed", (await rows())[0].roomClosedAt !== null && !(await roomExists(roomName)));
      check("ending it again does no harm", (await closeTestRoom(row.id)) === true);

      const dayLater = new Date(row.startedAt.getTime() + 25 * 3_600_000);
      const [stillOpen] = await db.insert(schema.connectionTests).values({ userId, startedAt: new Date(row.startedAt.getTime() - 60_000) }).returning();
      await endOldTests(dayLater, async (id) => id !== stillOpen.id);
      const left = await rows();
      check("a day later the closed test's row is removed; one whose room is not confirmed closed is kept", left.length === 1 && left[0].id === stillOpen.id && left[0].roomClosedAt === null, String(left.length));
    }
  } finally {
    // Whatever happened: end this person's test rooms, then remove their tests and the person.
    for (const test of await rows()) await closeTestRoom(test.id).catch(() => false);
    await db.delete(schema.connectionTests).where(eq(schema.connectionTests.userId, userId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
