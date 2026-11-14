/**
 * The always-on helper. It closes rooms. Beside that, in loops of their own, it
 * does the payment and booking work that has to happen on a schedule (see
 * src/lib/payments/jobs.ts), writes reminders and sends what is in the outbox.
 *
 * Every few seconds it looks for calls past their closing time and makes sure
 * nobody is left in the room. It keeps watching each call for a while after
 * closing, so that an old entry pass cannot be used to slip back in.
 *
 * Run with: npm run worker
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { CLOSE_LATE_SECONDS } from "../src/lib/calls";

const TICK_MS = 5_000;
/** Entry passes last 10 minutes, so watch a closed call a little longer than that. */
const WATCH_AFTER_CLOSE_SECONDS = 11 * 60;

async function main() {
  const { db, schema } = await import("../src/db");
  const { closeRoom, roomExists } = await import("../src/lib/video/livekit");
  const { closeCallIfDue } = await import("../src/lib/video/closing");
  const { stripeConfigured } = await import("../src/lib/payments/stripe");
  const { runPaymentJobs } = await import("../src/lib/payments/jobs");
  const { runBookingJobs } = await import("../src/lib/booking/jobs");
  const { refreshPendingIdentityChecks } = await import("../src/lib/safety/identity");
  const { writeCallReminders, writeRequestReminders } = await import("../src/lib/notifications/reminders");
  const { deliverEmails } = await import("../src/lib/notifications/delivery");

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
          // Past its closing time, cancelled, or ended for safety (those rooms close at once).
          or(lte(closesAt, now), isNotNull(schema.calls.cancelledAt), isNotNull(schema.calls.safetyEndedAt)),
          // Not yet confirmed closed, or closed recently and still being watched.
          or(isNull(schema.calls.closedAt), gt(watchUntil, now)),
        ),
      );

    for (const found of due) {
      try {
        // Already closed and only being watched: one quick look is enough
        // unless someone has slipped back in.
        if (found.closedAt) {
          if (!(await roomExists(found.roomName))) continue;
          console.warn(`[closer] someone re-entered call ${found.id} after closing; removing them`);
          if (!(await closeRoom(found.roomName, [found.hostId, found.customerId]))) console.warn(`[closer] call ${found.id} still has people in the room; will retry`);
          continue;
        }
        const outcome = await closeCallIfDue(found.id);
        if (outcome === "closed") console.log(`[closer] closed call ${found.id}`);
        else if (outcome === "not empty") console.warn(`[closer] call ${found.id} still has people in the room; will retry`);
      } catch (err) {
        console.error(`[closer] could not close call ${found.id}; will retry`, err);
      }
    }
  }

  /**
   * The payment and booking work. Closing rooms (tick, above) runs in a loop of its own, so that
   * slow money work can never keep a room open past its end.
   */
  let passes = 0;
  async function pass() {
    const now = new Date();
    // Payments first, so anything whose outcome was unknown is settled before bookings act on it.
    if (stripeConfigured()) await runPaymentJobs(now);
    await runBookingJobs(now);
    // Identity checks are read back on their own rhythm (about once a minute), so slow answers from
    // Stripe never hold up closing rooms or the money jobs.
    if (stripeConfigured() && passes++ % 12 === 0) await refreshPendingIdentityChecks().catch((error) => console.error("[identity] refresh failed; will retry", error));
  }

  /**
   * Reminders have their own loop: each may only be written inside its window, so a money job
   * that fails for a while, or a slow one, must not make a reminder miss its moment.
   */
  async function remindPass() {
    const now = new Date();
    await writeCallReminders(now).catch((error) => console.error("[reminders] failed; will retry", error));
    await writeRequestReminders(now).catch((error) => console.error("[reminders] failed; will retry", error));
  }

  /** Sending emails runs beside the main pass, so a slow sending service never delays closing a room or the money work. */
  async function sendPass() {
    await deliverEmails(new Date()).catch((error) => console.error("[email] delivery failed; will retry", error));
  }

  // "npm run worker -- --once" does a single pass and exits. Handy for testing.
  if (process.argv.includes("--once")) {
    await tick();
    await pass();
    await remindPass();
    await sendPass();
    process.exit(0);
  }

  console.log("[closer] running");
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));

  const sleep = () => new Promise((resolve) => setTimeout(resolve, TICK_MS));
  async function loop(name: string, work: () => Promise<void>) {
    while (!stopping) {
      try {
        await work();
      } catch (err) {
        console.error(`[${name}] pass failed; will retry`, err);
      }
      await sleep();
    }
  }
  await Promise.all([loop("closer", tick), loop("jobs", pass), loop("reminders", remindPass), loop("email", sendPass)]);
  process.exit(0);
}

main();
