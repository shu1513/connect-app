/**
 * The always-on helper. It closes rooms. Beside that, in loops of their own, it
 * does the payment and booking work that has to happen on a schedule (see
 * src/lib/payments/jobs.ts), writes reminders, sends what is in the outbox,
 * has the pictures of diaries checked, and decides the follows after calls.
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
  const { runMembershipJobs } = await import("../src/lib/membership/jobs");
  const { runContributionJobs } = await import("../src/lib/contributions/jobs");
  const { runBookingJobs } = await import("../src/lib/booking/jobs");
  const { closeFinishedExtensions } = await import("../src/lib/extend/extend");
  const { refreshPendingIdentityChecks } = await import("../src/lib/safety/identity");
  const { finishPausesAndClosures } = await import("../src/lib/profiles/closing");
  const { writeCallReminders, writeRequestReminders } = await import("../src/lib/notifications/reminders");
  const { writeMembershipReminders } = await import("../src/lib/notifications/membership-reminders");
  const { deliverEmails } = await import("../src/lib/notifications/delivery");
  const { recordBeat } = await import("../src/lib/health");
  const { removeOldNotes } = await import("../src/lib/quality/notes");
  const { removeOldSuggestions } = await import("../src/lib/suggestions/suggestions");
  const { forgetOldRequests, writeAnswerReminders } = await import("../src/lib/refunds/requests");
  const { endOldTests } = await import("../src/lib/connection/tests");
  const { runPictureRound } = await import("../src/lib/projects/queue");
  const { followAfterCalls } = await import("../src/lib/follows/follows");
  const { catchUpFromStripe, lookAtOpenDisputes } = await import("../src/lib/disputes/record");
  const { answerDisputes } = await import("../src/lib/disputes/answer");
  const { takeBackPass } = await import("../src/lib/disputes/takeback");
  const { announceAvailable, announcePosts } = await import("../src/lib/follows/emails");
  const { runNoticeRound } = await import("../src/legal/notices");
  const { runRetention } = await import("../src/lib/retention");
  const { collectUncollected, followUpUncollected } = await import("../src/lib/payments/uncollected");

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
    // If the payment work fails, the booking work waits for a pass in which it went through.
    try {
      if (stripeConfigured()) {
        await runPaymentJobs(now);
        // Memberships right after. A round in which the membership work failed is not a finished round
        // (so the health address notices), but it never holds up the booking work that follows.
        const membershipsDone = await runMembershipJobs(now).then(
          () => true,
          (error) => {
            console.error("[membership] the membership work of this round failed; will retry", error);
            return false;
          },
        );
        // Contributions after that, on the same terms: a failure here is not a finished round, and holds nothing else up.
        const contributionsDone = await runContributionJobs(now).then(
          () => true,
          (error) => {
            console.error("[contributions] the contribution work of this round failed; will retry", error);
            return false;
          },
        );
        // Only a round that ran and finished counts. The health address goes "not healthy" when this gets old,
        // also when Stripe's key has gone missing: then no payment work is being done at all.
        if (membershipsDone && contributionsDone) await recordBeat("payments", new Date());
      }
    } finally {
      // Requests for more time that nobody answered, and holds of requests that were not accepted.
      // This does not depend on the payment work, so it runs whether or not that went through:
      // a hold on a customer's card is never kept waiting behind an unrelated failure.
      await closeFinishedExtensions(now).catch((error) => console.error("[more time] closing requests failed; will retry", error));
    }
    await runBookingJobs(now);
    // Identity checks are read back on their own rhythm (about once a minute), so slow answers from
    // Stripe never hold up closing rooms or the money jobs.
    if (stripeConfigured() && passes % 12 === 0) await refreshPendingIdentityChecks().catch((error) => console.error("[identity] refresh failed; will retry", error));
    // About once a minute: what a pause or a closure left behind when the server stopped in the middle of it.
    if (passes % 12 === 0) await finishPausesAndClosures(now).catch((error) => console.error("[accounts] finishing pauses and closures failed; will retry", error));
    // About once an hour: the notes about connection quality of calls that ended more than 60 days ago are removed.
    if (passes % 720 === 0) await removeOldNotes(now).catch((error) => console.error("[quality] removing old notes failed; will retry", error));
    // The summary and the two short texts of a refund request are kept for one year.
    if (passes % 720 === 0) await forgetOldRequests(now).catch((error) => console.error("[refunds] forgetting old requests failed; will retry", error));
    // About once an hour: emails are emptied two years after they were sent, and login records deleted twelve months
    // after they ran out (plans/46, part 4). It catches its own failures.
    if (passes % 720 === 0) await runRetention(now);
    // What was suggested to whom is kept for 90 days (plans/37).
    if (passes % 720 === 0) await removeOldSuggestions(now).catch((error) => console.error("[suggestions] removing old suggestions failed; will retry", error));
    passes++;
  }

  /**
   * Reminders have their own loop: each may only be written inside its window, so a money job
   * that fails for a while, or a slow one, must not make a reminder miss its moment.
   */
  async function remindPass() {
    const now = new Date();
    await writeCallReminders(now).catch((error) => console.error("[reminders] failed; will retry", error));
    await writeRequestReminders(now).catch((error) => console.error("[reminders] failed; will retry", error));
    // To a host with a refund request waiting, once, halfway through their time to answer.
    await writeAnswerReminders(now).catch((error) => console.error("[reminders] failed; will retry", error));
    // To a member, once, three days before their paid month ends: what is left, and what comes then.
    await writeMembershipReminders(now).catch((error) => console.error("[reminders] membership reminders failed; will retry", error));
  }

  /**
   * Connection checks left open are ended in a loop of their own, so that nothing about them can
   * slow down closing a call's room or the money work.
   */
  async function testPass() {
    await endOldTests(new Date()).catch((error) => console.error("[connection test] ending old tests failed; will retry", error));
  }

  /**
   * After a call that really took place, the customer follows the host (plans/30). Decided once per call, in a
   * loop of its own: each decision waits for the follower's lock, and that wait must never hold up closing a
   * room or the money work.
   */
  let followPasses = 0;
  async function followPass() {
    await followAfterCalls(new Date()).catch((error) => console.error("[follows] deciding the follows after calls failed; will retry", error));
    // The emails to followers (plans/31), in this loop too: writing to many followers must never delay a room or the money work.
    // A host who is available now is told about a minute after switching on; a new diary post is looked for about once a minute.
    await announceAvailable(new Date()).catch((error) => console.error("[follows] telling followers who is available failed; will retry", error));
    if (followPasses % 12 === 0) await announcePosts(new Date()).catch((error) => console.error("[follows] telling followers about diary posts failed; will retry", error));
    followPasses++;
  }

  /**
   * Bank disputes (plans/47), in a loop of their own: Stripe's list of a shared account can be long, and reading it
   * must never delay closing a room or the money work. Every pass: the open ones not asked about for an hour are
   * asked about again (a few each time). About once an hour: Stripe's own list of the last 7 days, for any the app
   * does not have or has out of date. About once a day, and when the helper starts: the same for the last 130 days,
   * which is as long as a dispute can stay open.
   */
  let disputePasses = 0;
  async function disputePass() {
    if (!stripeConfigured()) return;
    const now = new Date();
    await lookAtOpenDisputes(now).catch((error) => console.error("[disputes] the look at open disputes failed; will retry", error));
    // The answer to the bank, for every dispute whose answer is due: the host chose, their time is up, or it is a bank's question.
    // (The clock is read again: the look above can take a while, and deadlines are judged from now.)
    await answerDisputes(new Date()).catch((error) => console.error("[disputes] answering the bank failed; will retry", error));
    // A share a host had collected before a dispute was lost: told, and taken back 14 days later.
    await takeBackPass(new Date()).catch((error) => console.error("[disputes] taking shares back failed; will retry", error));
    if (disputePasses % 720 === 0) await catchUpFromStripe(now, disputePasses % 17_280 === 0 ? 130 : 7).catch((error) => console.error("[disputes] catching up from Stripe failed; will retry", error));
    disputePasses++;
  }

  /**
   * The notices of a coming version of a legal document (plans/46, part 2), in a loop of their own, about once a
   * minute: writing to many people must never delay a room or the money work, and a failure there must never hold up
   * a notice that has a date. With nothing coming, this asks the database nothing.
   */
  let noticePasses = 0;
  async function noticePass() {
    if (noticePasses++ % 12 !== 0) return;
    await runNoticeRound(new Date()).catch((error) => console.error("[agreements] the round of notices of a coming version failed; will retry", error));
  }

  /**
   * Earnings a host has not collected for 12 months are sent to her without being asked (plans/46, part 3b), in a
   * loop of its own: it asks Stripe about each such host's payout account, and that must never delay closing a room
   * or the money work. Two loops, so that a long daily round never keeps the follow-up waiting. About once a day,
   * and when the helper starts: every such host gets a try. About once a minute: a try the helper stopped in the
   * middle of is run again, and a host whose transfers are all answered is told what was sent.
   */
  let uncollectedRounds = 0;
  async function uncollectedPass() {
    if (!stripeConfigured()) return;
    if (uncollectedRounds++ % 17_280 !== 0) return;
    await collectUncollected().catch((error) => console.error("[uncollected] the daily round failed; will retry", error));
  }
  let uncollectedFollowUps = 0;
  async function uncollectedFollowUpPass() {
    if (!stripeConfigured()) return;
    if (uncollectedFollowUps++ % 12 !== 0) return;
    await followUpUncollected().catch((error) => console.error("[uncollected] the follow-up failed; will retry", error));
  }

  /** Sending emails runs beside the main pass, so a slow sending service never delays closing a room or the money work. */
  async function sendPass() {
    await deliverEmails(new Date()).catch((error) => console.error("[email] delivery failed; will retry", error));
  }

  /**
   * The pictures of diaries are checked in a loop of their own: a slow checking service never
   * delays closing a room or the money work. The heavy part of Connect's own checker runs in a
   * thread of its own on top of that (src/lib/projects/checks/own.ts).
   */
  async function picturePass() {
    await runPictureRound().catch((error) => console.error("[pictures] the checking round failed; will retry", error));
  }

  // "npm run worker -- --once" does a single pass and exits. Handy for testing.
  if (process.argv.includes("--once")) {
    await tick();
    await pass();
    await remindPass();
    await sendPass();
    await testPass();
    await picturePass();
    await followPass();
    await disputePass();
    await noticePass();
    await uncollectedPass();
    await uncollectedFollowUpPass();
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
  await Promise.all([loop("closer", tick), loop("jobs", pass), loop("reminders", remindPass), loop("email", sendPass), loop("connection tests", testPass), loop("pictures", picturePass), loop("follows", followPass), loop("disputes", disputePass), loop("notices", noticePass), loop("uncollected", uncollectedPass), loop("uncollected follow-up", uncollectedFollowUpPass)]);
  process.exit(0);
}

main();
