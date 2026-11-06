/**
 * The always-on helper. It closes rooms, and does the payment work that has
 * to happen on a schedule (see src/lib/payments/jobs.ts).
 *
 * Every few seconds it looks for calls past their closing time and makes sure
 * nobody is left in the room. It keeps watching each call for a while after
 * closing, so that an old entry pass cannot be used to slip back in.
 *
 * Run with: npm run worker
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { CLOSE_LATE_SECONDS } from "../src/lib/calls";

const TICK_MS = 5_000;
/** Entry passes last 10 minutes, so watch a closed call a little longer than that. */
const WATCH_AFTER_CLOSE_SECONDS = 11 * 60;

async function main() {
  const { db, schema } = await import("../src/db");
  const { closeRoom, roomExists } = await import("../src/lib/video/livekit");
  const { stripeConfigured } = await import("../src/lib/payments/stripe");
  const { runPaymentJobs } = await import("../src/lib/payments/jobs");
  const { runBookingJobs } = await import("../src/lib/booking/jobs");

  const closesAt = sql`${schema.calls.endsAt} + make_interval(secs => ${CLOSE_LATE_SECONDS})`;
  // Counted from when the room was actually closed, in case this helper was down at the scheduled time.
  const watchUntil = sql`${schema.calls.closedAt} + make_interval(secs => ${WATCH_AFTER_CLOSE_SECONDS})`;

  async function tick() {
    // The same clock the join check uses (this server's), written out for the database.
    const now = sql`${new Date().toISOString()}::timestamptz`;
    const due = await db
      .select()
      .from(schema.calls)
      .where(
        and(
          // Past its closing time, or cancelled (a cancelled call's room closes at once).
          or(lte(closesAt, now), isNotNull(schema.calls.cancelledAt)),
          // Not yet confirmed closed, or closed recently and still being watched.
          or(isNull(schema.calls.closedAt), gt(watchUntil, now)),
        ),
      );

    for (const call of due) {
      try {
        // Already closed and only being watched: one quick look is enough
        // unless someone has slipped back in.
        if (call.closedAt) {
          if (!(await roomExists(call.roomName))) continue;
          console.warn(`[closer] someone re-entered call ${call.id} after closing; removing them`);
        }
        const empty = await closeRoom(call.roomName, [call.hostId, call.customerId]);
        if (empty && !call.closedAt) {
          await db
            .update(schema.calls)
            .set({ closedAt: new Date() })
            .where(and(eq(schema.calls.id, call.id), isNull(schema.calls.closedAt)));
          console.log(`[closer] closed call ${call.id}`);
        } else if (!empty) {
          console.warn(`[closer] call ${call.id} still has people in the room; will retry`);
        }
      } catch (err) {
        console.error(`[closer] could not close call ${call.id}; will retry`, err);
      }
    }
  }

  /** One full pass: close rooms that are due, then do the payment work. */
  async function pass() {
    await tick();
    const now = new Date();
    // Payments first, so anything whose outcome was unknown is settled before bookings act on it.
    if (stripeConfigured()) await runPaymentJobs(now);
    await runBookingJobs(now);
  }

  // "npm run worker -- --once" does a single pass and exits. Handy for testing.
  if (process.argv.includes("--once")) {
    await pass();
    process.exit(0);
  }

  console.log("[closer] running");
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));

  while (!stopping) {
    try {
      await pass();
    } catch (err) {
      console.error("[closer] pass failed; will retry", err);
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
  process.exit(0);
}

main();
