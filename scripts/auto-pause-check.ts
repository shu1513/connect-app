/**
 * Checks the pause the app makes by itself (plans/52-automatic-pause.md) against the local database.
 *
 * What it proves: 4 reporters do nothing and the 5th pauses; each thing that makes a report not
 * count; the share (5 reporters are not enough for an account with many customers); a lifted pause
 * is not made again from what was there before; a customer is paused like a host; an admin's and a
 * closed account never; ratings warn once, and pause at 2.0 or lower from 10 or more people.
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
  const { runAutoPauses, countedReporters } = await import("../src/lib/safety/auto-pause");
  const { AUTO_PAUSE, AUTO_PAUSE_WORDS } = await import("../src/lib/safety/auto-pause-rules");
  const { liftPause } = await import("../src/lib/safety/reports");

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
  const emailsOf = async (to: string, subject: string) => (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, to))).filter((m) => m.subject === subject).length;
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
      check("she is told by email, and the founder is told that it happened", (await emailsOf(hana.email, "Your Connect account is paused")) === 1 && (await emailsOf(anAdmin.email, AUTO_PAUSE_WORDS.reports.founderSubject)) >= 1);
      const again = await runAutoPauses(now, hana.id);
      check("the next round does nothing more", again.paused.length === 0 && (await emailsOf(hana.email, "Your Connect account is paused")) === 1);

      await liftPause({ adminId: anAdmin.id, userId: hana.id });
      const afterLift = await runAutoPauses(new Date(), hana.id);
      const lifted = await userRow(hana.id);
      check("a person lifts the pause: the reports made before that no longer count, and she is not paused again", afterLift.paused.length === 0 && lifted.pausedAt === null && lifted.autoPauseFrom !== null);
      // Five other customers report her after the pause was lifted.
      const later = new Date(Date.now() + 60_000);
      for (const p of customers.slice(5, 10)) await db.insert(schema.reports).values({ reporterId: p.id, reportedId: hana.id, context: "profile", contextId: hana.id, reason: "other", text: "check", createdAt: new Date(Date.now() + 30_000) });
      const fresh = await runAutoPauses(later, hana.id);
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
      await spoiled("nor one from a call whose money was given back in full", async () => {}, async (hostId) => {
        const p = await person("refunded");
        await call(hostId, p.id, { paid: "refunded" });
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
      await spoiled("nor a report that a person on the team has closed", async () => {}, async (hostId) => {
        const p = await person("closedreport");
        await call(hostId, p.id);
        await report(p.id, hostId, { closed: true });
        return p;
      });
      await spoiled(`nor a report that is older than ${AUTO_PAUSE.withinDays} days`, async () => {}, async (hostId) => {
        const p = await person("old");
        await call(hostId, p.id, { daysAgo: 120 });
        await report(p.id, hostId, { daysAgo: AUTO_PAUSE.withinDays + 1 });
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
    console.log("\n4. Ratings: a warning, then the pause");
    {
      /** `stars` from as many different people, each for a call with the host that ended `daysAgo` days ago (so the ratings count). */
      async function ratedBy(hostId: string, stars: number[], daysAgo = 9, as: "host" | "customer" = "host") {
        for (const [i, s] of stars.entries()) {
          const p = await person("r");
          const c = as === "host" ? await call(hostId, p.id, { daysAgo: daysAgo + (stars.length - i) / 1000, paid: false }) : await call(p.id, hostId, { daysAgo: daysAgo + (stars.length - i) / 1000, paid: false });
          await db.insert(schema.ratings).values({ callId: c.id, raterId: p.id, ratedId: hostId, ratedAs: as, stars: s });
        }
      }
      const lena = await person("low");
      await ratedBy(lena.id, [1, 1, 1, 1, 1, 1, 1, 1]);
      const first = await runAutoPauses(now, lena.id);
      check("8 people gave 1 star: an average of 1.0 from 8, too few people for a pause, so she is warned", first.paused.length === 0 && first.warned.length === 1 && (await userRow(lena.id)).pausedAt === null && (await emailsOf(lena.email, AUTO_PAUSE_WORDS.ratings.warnSubject)) === 1);
      const second = await runAutoPauses(now, lena.id);
      check("the warning is sent once", second.warned.length === 0 && (await emailsOf(lena.email, AUTO_PAUSE_WORDS.ratings.warnSubject)) === 1);
      await ratedBy(lena.id, [2, 2, 2], 8);
      const third = await runAutoPauses(now, lena.id);
      const paused = await userRow(lena.id);
      check("three more people: 1.3 from 11, at or under 2.0 from 10 or more: paused", third.paused.length === 1 && paused.pausedAt !== null && paused.pausedReason === AUTO_PAUSE_WORDS.ratings.reason("host", { average: 1.3, count: 11 }), paused.pausedReason ?? "");
      check("the founder is told that it happened", (await emailsOf(anAdmin.email, AUTO_PAUSE_WORDS.ratings.founderSubject)) >= 1);
      await liftPause({ adminId: anAdmin.id, userId: lena.id });
      const afterLift = await runAutoPauses(new Date(), lena.id);
      check("after a person lifted the pause, the old ratings neither pause nor warn again", afterLift.paused.length === 0 && afterLift.warned.length === 0 && (await userRow(lena.id)).pausedAt === null);

      const edge = await person("edge");
      await ratedBy(edge.id, [1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3]); // 23 stars from 11 people: 2.09, shown as 2.1
      const justOver = await runAutoPauses(now, edge.id);
      check("an average of 2.1 from 11 people is over the line: warned, not paused", justOver.paused.length === 0 && justOver.warned.length === 1);
      const onLine = await person("online");
      await ratedBy(onLine.id, [1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 3]); // 22 stars from 11 people: 2.0
      check("an average of exactly 2.0 from 11 people: paused", (await runAutoPauses(now, onLine.id)).paused.length === 1);

      const recent = await person("recent");
      await ratedBy(recent.id, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 3);
      const tooSoon = await runAutoPauses(now, recent.id);
      check("ratings of calls from 3 days ago do not count yet (a rating counts a week after the call): nothing", tooSoon.paused.length === 0 && tooSoon.warned.length === 0);

      const cust = await person("lowcustomer");
      await ratedBy(cust.id, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 9, "customer");
      const asCustomer = await runAutoPauses(now, cust.id);
      check("a customer whom 11 hosts gave 1 star is paused for his average as a customer", asCustomer.paused.length === 1 && (await userRow(cust.id)).pausedReason === AUTO_PAUSE_WORDS.ratings.reason("customer", { average: 1, count: 11 }));

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
    await db.delete(schema.payments).where(inArray(schema.payments.callId, callIds));
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
