/**
 * Checks the pause the app makes by itself (plans/52-automatic-pause.md) against the local database.
 *
 * What it proves: 4 reporters do nothing and the 5th pauses; each thing that makes a report not
 * count, and two that must not; the share (5 reporters are not enough for an account with many
 * customers); a lifted pause is a fresh start, and the rule works again after it; a customer is
 * paused like a host; an admin's and a closed account never; ratings warn once, and pause at 2.0
 * or lower from 10 or more people no sooner than 14 days after the warning; a count that no
 * longer holds at the moment of the pause is not acted on.
 *
 * Needs: the local database with the test accounts (npm run seed). The app need not run.
 * Usage: npx tsx scripts/auto-pause-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq, inArray, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);
const DAY = 24 * 3_600_000;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { runAutoPauses, countedReporters, reportFacts } = await import("../src/lib/safety/auto-pause");
  const { AUTO_PAUSE, AUTO_PAUSE_WORDS } = await import("../src/lib/safety/auto-pause-rules");
  const { liftPause, pauseByItself } = await import("../src/lib/safety/reports");

  const now = new Date();
  const made: string[] = [];
  const calls: string[] = [];
  let counter = 0;

  async function person(name: string) {
    const id = `ap-${RUN}-${name}-${counter++}`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email: `autopause-${RUN}-${name}-${counter}@example.test`, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Check ${name}`, email: `autopause-${RUN}-${name}-${counter}@example.test` };
  }
  /** A call that ended `daysAgo` days ago. `paid`: money was taken for it and kept; "refunded": taken and given back in full; false: a free call. */
  async function call(hostId: string, customerId: string, opts: { daysAgo?: number; paid?: boolean | "refunded"; cancelled?: boolean } = {}) {
    const endsAt = new Date(Math.floor((now.getTime() - (opts.daysAgo ?? 10) * DAY) / 1000) * 1000);
    const startsAt = new Date(endsAt.getTime() - 30 * 60_000);
    const [c] = await db
      .insert(schema.calls)
      .values({ hostId, customerId, startsAt, endsAt, roomName: `autopause-${randomUUID()}`, closedAt: endsAt, pricePer15Cents: 2000, cancelledAt: opts.cancelled ? startsAt : null, cancelledBy: opts.cancelled ? "host" : null })
      .returning();
    calls.push(c.id);
    if (opts.paid !== false) {
      await db.insert(schema.payments).values({ callId: c.id, coversFrom: startsAt, coversUntil: endsAt, pricePer15Cents: 2000, bookedCents: 4000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150, status: "charged", chargedCents: 4000, chargedAt: endsAt, refundedCents: opts.paid === "refunded" ? 4000 : 0, originalFeeCents: 226, originalHostShareCents: 3774 });
    }
    return c;
  }
  async function report(reporterId: string, reportedId: string, opts: { daysAgo?: number; closed?: boolean } = {}) {
    await db.insert(schema.reports).values({ reporterId, reportedId, context: "profile", contextId: reportedId, reason: "other", text: "check", status: opts.closed ? "closed" : "open", createdAt: new Date(now.getTime() - (opts.daysAgo ?? 1) * DAY) });
  }
  /** `count` customers who each had a paid call with the host; the first `reporting` of them have reported her. */
  async function customersOf(hostId: string, count: number, reporting: number) {
    const people = [];
    for (let i = 0; i < count; i++) {
      const p = await person("c");
      await call(hostId, p.id);
      if (i < reporting) await report(p.id, hostId);
      people.push(p);
    }
    return people;
  }
  const userRow = async (id: string) => (await db.select().from(schema.user).where(eq(schema.user.id, id)))[0];
  /** Emails to this address with this subject; `about`: only those whose text names this person (the founder gets such emails about many accounts). */
  const emailsOf = async (to: string, subject: string, about?: string) => (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, to))).filter((m) => m.subject === subject && (!about || m.body.includes(about))).length;
  const disputes: string[] = [];
  const extensions: string[] = [];
  const [anAdmin] = await db.select({ id: schema.admins.userId, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId)).limit(1);
  if (!anAdmin) throw new Error("No admin account in the local database. Run: npm run seed");

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Reports: the fifth person pauses");
    {
      const hana = await person("host");
      const customers = await customersOf(hana.id, 12, 4);
      const first = await runAutoPauses(now, hana.id);
      check("4 different people who had paid calls with her reported her: nothing happens", first.paused.length === 0 && (await userRow(hana.id)).pausedAt === null);
      await report(customers[0].id, hana.id);
      await runAutoPauses(now, hana.id);
      check("a second report from one of the four changes nothing: people are counted, not reports", (await userRow(hana.id)).pausedAt === null && (await countedReporters(now, hana.id)).get(hana.id)?.size === 4);
      await report(customers[4].id, hana.id);
      const second = await runAutoPauses(now, hana.id);
      const paused = await userRow(hana.id);
      check("the 5th person's report pauses the account (5 of her 12 customers)", second.paused.length === 1 && second.paused[0] === hana.id && paused.pausedAt !== null);
      check("the reason on her paused page names the rule and nobody", paused.pausedReason === AUTO_PAUSE_WORDS.reports.reason);
      check("she is told by email, and the founder is told that it happened", (await emailsOf(hana.email, "Your Connect account is paused")) === 1 && (await emailsOf(anAdmin.email, AUTO_PAUSE_WORDS.reports.founderSubject, hana.email)) === 1);
      const again = await runAutoPauses(now, hana.id);
      check("the next round does nothing more", again.paused.length === 0 && (await emailsOf(hana.email, "Your Connect account is paused")) === 1);

      const pausedSince = (await userRow(hana.id)).pausedAt!;
      const wrongOne = await liftPause({ adminId: anAdmin.id, userId: hana.id, since: new Date(pausedSince.getTime() - 60_000) });
      check("a page that shows an earlier pause of hers cannot lift this one", wrongOne === false && (await userRow(hana.id)).pausedAt !== null);
      check("the page that shows this pause lifts it", (await liftPause({ adminId: anAdmin.id, userId: hana.id, since: pausedSince })) === true);
      const afterLift = await runAutoPauses(new Date(), hana.id);
      const lifted = await userRow(hana.id);
      check("a person lifts the pause: the reports made before that no longer count, and she is not paused again", afterLift.paused.length === 0 && lifted.pausedAt === null && lifted.autoPauseFrom !== null);
      check("pressing the button a second time lifts nothing and does not move her fresh start", (await liftPause({ adminId: anAdmin.id, userId: hana.id })) === false && (await userRow(hana.id)).autoPauseFrom?.getTime() === lifted.autoPauseFrom?.getTime());
      // Five other customers report her after the pause was lifted.
      // (Their moment is set here, a second after her fresh start, so that nothing depends on two clocks agreeing.)
      for (const p of customers.slice(5, 10)) await db.insert(schema.reports).values({ reporterId: p.id, reportedId: hana.id, context: "profile", contextId: hana.id, reason: "other", text: "check", createdAt: new Date(lifted.autoPauseFrom!.getTime() + 1000) });
      const fresh = await runAutoPauses(new Date(Math.max(Date.now(), lifted.autoPauseFrom!.getTime()) + 2000), hana.id);
      check("five other people report her after that: paused again, and told again", fresh.paused.length === 1 && (await userRow(hana.id)).pausedAt !== null && (await emailsOf(hana.email, "Your Connect account is paused")) === 2);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Reports that do not count");
    {
      /** A host with 5 reporters of whom one is spoiled: not paused. Then one more good reporter: paused, so the other four did count. */
      async function spoiled(label: string, spoil: (host: { id: string }, one: { id: string }) => Promise<void>, build?: (hostId: string) => Promise<{ id: string }>) {
        const host = await person("host");
        const good = await customersOf(host.id, 4, 4);
        const one = build ? await build(host.id) : (await customersOf(host.id, 1, 1))[0];
        await spoil(host, one);
        const before = await runAutoPauses(now, host.id);
        const counted = (await countedReporters(now, host.id)).get(host.id)?.size ?? 0;
        await customersOf(host.id, 1, 1);
        const after = await runAutoPauses(now, host.id);
        check(label, before.paused.length === 0 && counted === 4 && after.paused.length === 1, `counted ${counted}, then paused ${after.paused.length}, good ${good.length}`);
      }
      await spoiled("a report from someone who never had a call with her does not count", async () => {}, async (hostId) => {
        const stranger = await person("stranger");
        await report(stranger.id, hostId);
        return stranger;
      });
      await spoiled("nor one from a call that was free", async () => {}, async (hostId) => {
        const p = await person("free");
        await call(hostId, p.id, { paid: false });
        await report(p.id, hostId);
        return p;
      });
      await spoiled("nor one from a call whose money a bank took back, or may yet take back (a dispute)", async () => {}, async (hostId) => {
        const p = await person("disputed");
        const c = await call(hostId, p.id);
        const [payment] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.callId, c.id));
        const id = `du_check_${randomUUID()}`;
        await db.insert(schema.disputes).values({ id, paymentId: payment.id, hostId, customerId: p.id, amountCents: 4000, reason: "fraudulent", stage: "chargeback", status: "lost", openedAt: now });
        disputes.push(id);
        await report(p.id, hostId);
        return p;
      });
      await spoiled("nor one from a call that was cancelled", async () => {}, async (hostId) => {
        const p = await person("cancelled");
        await call(hostId, p.id, { cancelled: true });
        await report(p.id, hostId);
        return p;
      });
      await spoiled("nor one from a person whose account is closed", async (_host, one) => {
        await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, one.id));
      });
      await spoiled("nor one from a person she has reported herself (both reported each other)", async (host, one) => {
        await report(host.id, one.id);
      });
      await spoiled("nor one from a person whose paid call with her was more than 90 days ago", async () => {}, async (hostId) => {
        const p = await person("oldcall");
        await call(hostId, p.id, { daysAgo: 120 });
        await report(p.id, hostId);
        return p;
      });
      {
        // What must NOT take a report out: money the host gave back afterwards, and a report of hers that the team closed.
        const host = await person("host");
        await customersOf(host.id, 3, 3);
        const refunded = await person("refunded");
        await call(host.id, refunded.id, { paid: "refunded" });
        await report(refunded.id, host.id);
        const reportedBack = (await customersOf(host.id, 1, 1))[0];
        await report(host.id, reportedBack.id, { closed: true });
        await report(host.id, reportedBack.id, { daysAgo: AUTO_PAUSE.withinDays + 5 });
        check("a report still counts when the call's money was given back afterwards (or a host could pay complaints away), and when her own reports about that person are closed by the team or older than 90 days", (await countedReporters(now, host.id)).get(host.id)?.size === 5);
        // Counted, then a person on the team closes one of the five reports, then the pause's own step counts again.
        const looked = await reportFacts(host.id, now);
        const [oneReport] = await db.select({ id: schema.reports.id }).from(schema.reports).where(eq(schema.reports.reportedId, host.id)).limit(1);
        await db.update(schema.reports).set({ status: "closed" }).where(eq(schema.reports.id, oneReport.id));
        const words = { reason: "check", because: "check", founder: { subject: "check", text: "check", alreadyText: "check" } };
        const stale = await pauseByItself({ userId: host.id, expectedFrom: looked.from, stillTrue: async (tx) => (await reportFacts(host.id, new Date(), tx)).pauses, ...words, key: `paused:${host.id}:by-itself:check` });
        check("counted at 5, then a person closes one report before the pause is made: the second count, in the pause's own step, stops it", looked.pauses === true && looked.reporters === 5 && stale === "not_paused" && (await userRow(host.id)).pausedAt === null && (await emailsOf(anAdmin.email, "check", "check")) === 0);
        await db.update(schema.reports).set({ status: "open" }).where(eq(schema.reports.id, oneReport.id));
        check("with that report open again the round pauses her", (await runAutoPauses(now, host.id)).paused.length === 1);
      }
      await spoiled("nor a report that a person on the team has closed", async () => {}, async (hostId) => {
        const p = await person("closedreport");
        await call(hostId, p.id);
        await report(p.id, hostId, { closed: true });
        return p;
      });
      await spoiled(`nor a report that is older than ${AUTO_PAUSE.withinDays} days, though the paid call is recent`, async () => {}, async (hostId) => {
        const p = await person("old");
        await call(hostId, p.id, { daysAgo: 5 });
        await report(p.id, hostId, { daysAgo: AUTO_PAUSE.withinDays + 1 });
        return p;
      });
      await spoiled("nor one from a call whose added time is disputed at the bank, though the call's own payment is not", async () => {}, async (hostId) => {
        const p = await person("disputedextra");
        const c = await call(hostId, p.id);
        const [more] = await db.insert(schema.callExtensions).values({ callId: c.id, minutes: 15, oldEndsAt: c.endsAt, newEndsAt: new Date(c.endsAt.getTime() + 15 * 60_000), priceCents: 2000 }).returning();
        extensions.push(more.id);
        await db.insert(schema.payments).values({ callId: c.id, extensionId: more.id, coversFrom: c.endsAt, coversUntil: more.newEndsAt, pricePer15Cents: 2000, bookedCents: 2000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150, status: "charged", chargedCents: 2000, chargedAt: more.newEndsAt, disputeOpen: true, originalFeeCents: 128, originalHostShareCents: 1872 });
        await report(p.id, hostId);
        return p;
      });
      await spoiled("nor one from a call a bank dispute is open on, even before the dispute itself is written down", async () => {}, async (hostId) => {
        const p = await person("disputeopen");
        const c = await call(hostId, p.id);
        await db.update(schema.payments).set({ disputeOpen: true }).where(eq(schema.payments.callId, c.id));
        await report(p.id, hostId);
        return p;
      });
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Reports: the share, a customer, and who is never paused");
    {
      const busy = await person("busy");
      await customersOf(busy.id, 51, 5);
      const many = await runAutoPauses(now, busy.id);
      check("5 reporters out of 51 customers in 90 days are fewer than 1 in 10: not paused", many.paused.length === 0 && (await userRow(busy.id)).pausedAt === null);
      const medium = await person("medium");
      await customersOf(medium.id, 50, 5);
      check("5 out of 50 are exactly 1 in 10: paused", (await runAutoPauses(now, medium.id)).paused.length === 1);

      // A customer whom five hosts reported, each after a paid call with him.
      const cory = await person("customer");
      for (let i = 0; i < 5; i++) {
        const h = await person("h");
        await call(h.id, cory.id);
        await report(h.id, cory.id);
      }
      check("a customer is paused like a host: five hosts he had paid calls with reported him", (await runAutoPauses(now, cory.id)).paused.length === 1 && (await userRow(cory.id)).pausedAt !== null);

      const control = await person("control");
      await customersOf(control.id, 5, 5);
      const nobody = await runAutoPauses(now, "");
      check("a round asked to look at an empty name looks at nobody (an account over the line is left alone)", nobody.paused.length === 0 && nobody.warned.length === 0 && (await userRow(control.id)).pausedAt === null);
      check("and that account is paused when the round is asked to look at it", (await runAutoPauses(now, control.id)).paused.length === 1);

      const boss = await person("admin");
      await db.insert(schema.admins).values({ userId: boss.id });
      await customersOf(boss.id, 6, 6);
      check("an admin's account is never paused by the app", (await runAutoPauses(now, boss.id)).paused.length === 0 && (await userRow(boss.id)).pausedAt === null);
      const gone = await person("closed");
      await customersOf(gone.id, 6, 6);
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, gone.id));
      check("nor a closed account", (await runAutoPauses(now, gone.id)).paused.length === 0 && (await userRow(gone.id)).pausedAt === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Ratings: a warning first, the pause no sooner than 14 days later");
    {
      /** `stars` from as many different people, each for a paid call (unless `paid` says otherwise) with the person that ended `daysAgo` days ago (so the ratings count). */
      async function ratedBy(userId: string, stars: number[], daysAgo = 9, as: "host" | "customer" = "host", paid: boolean | "refunded" = true) {
        for (const [i, s] of stars.entries()) {
          const p = await person("r");
          const c = as === "host" ? await call(userId, p.id, { daysAgo: daysAgo + (stars.length - i) / 1000, paid }) : await call(p.id, userId, { daysAgo: daysAgo + (stars.length - i) / 1000, paid });
          await db.insert(schema.ratings).values({ callId: c.id, raterId: p.id, ratedId: userId, ratedAs: as, stars: s });
        }
      }
      /** As if the warning email had really been sent this many days ago (the 14 days run from when it was sent). */
      const markOf = async (id: string, as: "host" | "customer") => {
        const row = await userRow(id);
        return as === "host" ? row.ratingWarnedAt : row.customerRatingWarnedAt;
      };
      const warnedDaysAgo = async (id: string, days: number, as: "host" | "customer" = "host") => {
        const warnedAt = (await markOf(id, as))!;
        await db.update(schema.emailOutbox).set({ status: "sent", sentAt: new Date(now.getTime() - days * DAY) }).where(eq(schema.emailOutbox.dedupeKey, `rating-warning:${id}:${as}:${warnedAt.getTime()}`));
      };
      const eleven = (stars: number) => Array.from({ length: 11 }, () => stars);

      const lena = await person("low");
      await ratedBy(lena.id, [1, 1, 1, 1, 1, 1, 1, 1]);
      const first = await runAutoPauses(now, lena.id);
      check("8 people gave 1 star: too few people for a pause, so she is warned by email", first.paused.length === 0 && first.warned.length === 1 && (await userRow(lena.id)).pausedAt === null && (await emailsOf(lena.email, AUTO_PAUSE_WORDS.ratings.warnSubject)) === 1);
      const second = await runAutoPauses(now, lena.id);
      check("the warning is sent once", second.warned.length === 0 && (await emailsOf(lena.email, AUTO_PAUSE_WORDS.ratings.warnSubject)) === 1);
      await ratedBy(lena.id, [2, 2, 2], 8);
      const third = await runAutoPauses(now, lena.id);
      check("three more people bring her to the line (1.3 from 11), but the warning has not even been sent yet: not paused", third.paused.length === 0 && (await userRow(lena.id)).pausedAt === null);
      // The mark on her account is made old, but the email itself never left: the days run from the email, not from the mark.
      const mark = (await userRow(lena.id)).ratingWarnedAt!;
      const oldMark = new Date(mark.getTime() - 100 * DAY);
      await db.update(schema.user).set({ ratingWarnedAt: oldMark }).where(eq(schema.user.id, lena.id));
      await db.update(schema.emailOutbox).set({ dedupeKey: `rating-warning:${lena.id}:host:${oldMark.getTime()}` }).where(eq(schema.emailOutbox.dedupeKey, `rating-warning:${lena.id}:host:${mark.getTime()}`));
      check("a warning marked 100 days ago whose email was never sent does not lead to a pause", (await runAutoPauses(now, lena.id)).paused.length === 0);
      await warnedDaysAgo(lena.id, AUTO_PAUSE.warnDays - 1);
      check(`nor ${AUTO_PAUSE.warnDays - 1} days after the warning`, (await runAutoPauses(now, lena.id)).paused.length === 0);
      await warnedDaysAgo(lena.id, AUTO_PAUSE.warnDays + 1);
      const fourth = await runAutoPauses(now, lena.id);
      const paused = await userRow(lena.id);
      check(`${AUTO_PAUSE.warnDays + 1} days after the warning: paused, and the reason gives the rule and no number of hers`, fourth.paused.length === 1 && paused.pausedAt !== null && paused.pausedReason === AUTO_PAUSE_WORDS.ratings.reason("host"), paused.pausedReason ?? "");
      check("the founder is told that it happened, with the numbers", (await emailsOf(anAdmin.email, AUTO_PAUSE_WORDS.ratings.founderSubject, `(${lena.email}) by itself: their average rating as a host, counting paid calls only, is 1.3 from 11 people`)) === 1);
      await liftPause({ adminId: anAdmin.id, userId: lena.id });
      const afterLift = await runAutoPauses(new Date(), lena.id);
      const lifted = await userRow(lena.id);
      check("after a person lifted the pause, the old ratings neither pause nor warn again, and the old warning no longer stands", afterLift.paused.length === 0 && afterLift.warned.length === 0 && lifted.pausedAt === null && lifted.ratingWarnedAt === null && lifted.customerRatingWarnedAt === null);

      // A fresh start long ago: ratings from before it do not count, and the rule works again on what came after.
      const again = await person("again");
      await ratedBy(again.id, eleven(5), 40);
      await db.update(schema.user).set({ autoPauseFrom: new Date(now.getTime() - 30 * DAY) }).where(eq(schema.user.id, again.id));
      {
        // Five calls that began before that fresh start and whose booked end came after it: they belong to before.
        // (Five, because fewer make no average either way: with five, counting them would show "5.0 from 5".)
        const straddling = [];
        for (let i = 0; i < 5; i++) {
          const p = await person("straddle");
          const startsAt = new Date(now.getTime() - 30 * DAY - 10 * 60_000);
          const [c] = await db.insert(schema.calls).values({ hostId: again.id, customerId: p.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), roomName: `autopause-${randomUUID()}`, closedAt: new Date(startsAt.getTime() + 30 * 60_000), pricePer15Cents: 2000 }).returning();
          calls.push(c.id);
          await db.insert(schema.payments).values({ callId: c.id, coversFrom: c.startsAt, coversUntil: c.endsAt, pricePer15Cents: 2000, bookedCents: 4000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150, status: "charged", chargedCents: 4000, chargedAt: c.endsAt, originalFeeCents: 226, originalHostShareCents: 3774 });
          await db.insert(schema.ratings).values({ callId: c.id, raterId: p.id, ratedId: again.id, ratedAs: "host", stars: 5 });
          straddling.push(c.id);
        }
        const { averageSince } = await import("../src/lib/safety/auto-pause");
        check("a call that began before the fresh start does not count, though its booked end came after it", (await averageSince(again.id, "host", new Date(now.getTime() - 30 * DAY), now)) === null && straddling.length === 5 && (await averageSince(again.id, "host", new Date(now.getTime() - 31 * DAY), now))?.count === 5);
      }
      await ratedBy(again.id, eleven(1), 9);
      const warnedAgain = await runAutoPauses(now, again.id);
      check("a pause was lifted 30 days ago: only the eleven 1-star ratings since then count (with the eleven 5-star ones before it there would be no warning)", warnedAgain.warned.length === 1 && warnedAgain.paused.length === 0);
      await warnedDaysAgo(again.id, AUTO_PAUSE.warnDays + 1);
      check("and the pause follows the new warning: a lifted pause does not switch the rule off for good", (await runAutoPauses(now, again.id)).paused.length === 1);

      const straight = await person("straight");
      await ratedBy(straight.id, eleven(1));
      const firstLook = await runAutoPauses(now, straight.id);
      check("an account that is already at the line when it is first looked at is warned, not paused", firstLook.warned.length === 1 && firstLook.paused.length === 0 && (await userRow(straight.id)).pausedAt === null);

      const edge = await person("edge");
      await ratedBy(edge.id, [1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3]); // 23 stars from 11 people: 2.09, shown as 2.1
      const justOver = await runAutoPauses(now, edge.id);
      await warnedDaysAgo(edge.id, AUTO_PAUSE.warnDays + 1);
      check("an average of 2.1 from 11 people is over the line: warned, and not paused however long ago the warning was", justOver.warned.length === 1 && (await runAutoPauses(now, edge.id)).paused.length === 0);
      const onLine = await person("online");
      await ratedBy(onLine.id, [1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 3]); // 22 stars from 11 people: 2.0
      await runAutoPauses(now, onLine.id);
      await warnedDaysAgo(onLine.id, AUTO_PAUSE.warnDays + 1);
      check("an average of exactly 2.0 from 11 people: paused, once the warning is old enough", (await runAutoPauses(now, onLine.id)).paused.length === 1);

      const recent = await person("recent");
      await ratedBy(recent.id, eleven(1), 3);
      const tooSoon = await runAutoPauses(now, recent.id);
      check("ratings of calls from 3 days ago do not count yet (a rating counts a week after the call): nothing", tooSoon.paused.length === 0 && tooSoon.warned.length === 0);

      const cust = await person("lowcustomer");
      await ratedBy(cust.id, eleven(1), 9, "customer");
      await runAutoPauses(now, cust.id);
      await warnedDaysAgo(cust.id, AUTO_PAUSE.warnDays + 1, "customer");
      const asCustomer = await runAutoPauses(now, cust.id);
      check("a customer whom 11 hosts gave 1 star is warned, then paused for his average as a customer", asCustomer.paused.length === 1 && (await userRow(cust.id)).pausedReason === AUTO_PAUSE_WORDS.ratings.reason("customer"));

      // Each role has its own warning: warned long ago about her ratings as a host, she is at the line as a customer.
      const both = await person("bothroles");
      await ratedBy(both.id, [1, 1, 1, 1, 1, 1, 1, 1]);
      await runAutoPauses(now, both.id);
      await warnedDaysAgo(both.id, 60);
      await ratedBy(both.id, eleven(1), 9, "customer");
      const otherRole = await runAutoPauses(now, both.id);
      check("warned 60 days ago about her ratings as a host, now at the line as a customer: she gets a warning about that, and is not paused on the strength of the other one", otherRole.paused.length === 0 && otherRole.warned.length === 1 && (await userRow(both.id)).pausedAt === null && (await emailsOf(both.email, AUTO_PAUSE_WORDS.ratings.warnSubject)) === 2 && (await markOf(both.id, "customer")) !== null);

      // The warning email's line was emptied (as happens two years after it was sent): nobody can say when it went out.
      const emptied = await person("emptied");
      await ratedBy(emptied.id, eleven(1));
      await runAutoPauses(now, emptied.id);
      const emptiedMark = (await markOf(emptied.id, "host"))!;
      await db.update(schema.emailOutbox).set({ dedupeKey: `emptied:ap-${RUN}-${randomUUID()}` }).where(eq(schema.emailOutbox.dedupeKey, `rating-warning:${emptied.id}:host:${emptiedMark.getTime()}`));
      const forgot = await runAutoPauses(now, emptied.id);
      const warnedAfresh = await runAutoPauses(now, emptied.id);
      check("a warning whose email can no longer be found is taken back, no pause rests on it, and she is warned afresh", forgot.paused.length === 0 && warnedAfresh.warned.length === 1 && (await userRow(emptied.id)).pausedAt === null && (await markOf(emptied.id, "host"))!.getTime() !== emptiedMark.getTime());

      const freeCalls = await person("freecalls");
      await ratedBy(freeCalls.id, eleven(1), 9, "host", false);
      const free = await runAutoPauses(now, freeCalls.id);
      check("11 people gave 1 star after calls that were free: neither paused nor warned (a free call costs nothing to make)", free.paused.length === 0 && free.warned.length === 0 && (await userRow(freeCalls.id)).pausedAt === null);
      const givenBack = await person("givenback");
      await ratedBy(givenBack.id, eleven(1), 9, "host", "refunded");
      check("after calls whose money she gave back the stars still count: a host cannot pay a low average away", (await runAutoPauses(now, givenBack.id)).warned.length === 1);

      // A person lifts a pause in the moment between the app's counting and its pause: what was counted is out of date.
      const raced = await person("raced");
      await db.update(schema.user).set({ autoPauseFrom: new Date() }).where(eq(schema.user.id, raced.id));
      const words = { reason: "check", because: "check", founder: { subject: "check", text: "check", alreadyText: "check" } };
      const stale = await pauseByItself({ userId: raced.id, expectedFrom: null, ...words, key: `paused:${raced.id}:by-itself:check` });
      check("a pause counted before a person lifted one is not made: the fresh start is read again in the pause's own step", stale === "not_paused" && (await userRow(raced.id)).pausedAt === null);

      const fine = await person("fine");
      await ratedBy(fine.id, [5, 5, 4, 1, 1, 5, 5, 5, 5, 5, 5]);
      const good = await runAutoPauses(now, fine.id);
      check("a host with a good average and two bad ratings: nothing", good.paused.length === 0 && good.warned.length === 0);
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
    await db.delete(schema.emailOutbox).where(or(like(schema.emailOutbox.dedupeKey, `%ap-${RUN}-%`), like(schema.emailOutbox.to, `autopause-${RUN}-%`)));
    await db.delete(schema.adminActions).where(inArray(schema.adminActions.targetUserId, ids));
    await db.delete(schema.admins).where(inArray(schema.admins.userId, ids));
    await db.delete(schema.ratings).where(inArray(schema.ratings.callId, callIds));
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    if (disputes.length) await db.delete(schema.disputes).where(inArray(schema.disputes.id, disputes));
    await db.delete(schema.payments).where(inArray(schema.payments.callId, callIds));
    if (extensions.length) await db.delete(schema.callExtensions).where(inArray(schema.callExtensions.id, extensions));
    await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
