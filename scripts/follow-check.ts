/**
 * Testing tool: following (plans/30) against the local database. It makes its own people, hosts
 * and calls (with the "connected / disconnected" messages a real call leaves behind), touches no
 * other account, needs neither Stripe nor the app running, and removes what it made.
 *
 * Usage: npx tsx scripts/follow-check.ts
 *
 * With --app=http://localhost:3000 it also asks the running app for the pages themselves, logged
 * in as the seeded test customer (npm run seed; the password is read from test-accounts.local.md):
 * what a follower the host has blocked is shown must be the same, button for button, as what
 * anyone else is shown.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const APP = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? null;
const RUN = randomUUID().slice(0, 8);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { removeTestsOf } = await import("../src/lib/connection/tests");
  const F = await import("../src/lib/follows/follows");
  const { FollowError } = F;
  const { FOLLOW } = await import("../src/lib/follows/rules");
  const { block, unblock } = await import("../src/lib/safety/blocks");
  const { NOW } = await import("../src/lib/booking/now-rules");

  const now = new Date();
  const made: string[] = [];
  const calls: string[] = [];

  async function person(name: string, extra: Partial<typeof schema.user.$inferInsert> = {}) {
    const id = `fw-${RUN}-${name}`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email: `followcheck-${RUN}-${name}@example.test`, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York", ...extra });
    made.push(id);
    return { id, name: `Check ${name}` };
  }
  async function host(name: string, displayName = `Host ${name}`, extra: Partial<typeof schema.hostProfiles.$inferInsert> = {}) {
    const p = await person(name);
    const handle = `fw${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle, handleKey: handle, displayName, pricePer15Cents: 0, status: "approved", usConfirmedAt: now, ...extra });
    return { ...p, handle, displayName };
  }
  /** A host who can be asked for a call right now: free calls, a calendar open all week, "Available now" on. */
  async function goOnline(hostId: string, minutes = 60, seenSecondsAgo = 0) {
    await db.insert(schema.hostCalendars).values({ userId: hostId, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 }).onConflictDoNothing();
    const [hours] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hostId)).limit(1);
    if (!hours) await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId, weekday, startMinute: 0, endMinute: 1440 })));
    const at = new Date();
    await db.update(schema.hostCalendars).set({ availableUntil: new Date(at.getTime() + minutes * MINUTE), availableSeenAt: new Date(at.getTime() - seenSecondsAgo * 1000) }).where(eq(schema.hostCalendars.userId, hostId));
  }
  /**
   * A call that ended `endedMinutesAgo` ago (or starts in the future), with its booking, as the helper leaves it once the
   * room is closed. `host` and `customer` say when each connected and left, in seconds from the start (null: never joined).
   */
  async function call(input: {
    hostId: string;
    customerId: string;
    endedMinutesAgo?: number;
    startsInMinutes?: number;
    source?: string;
    host?: [number, number] | null;
    customer?: [number, number] | null;
    cancelled?: boolean;
    safetyEnded?: boolean;
    closed?: boolean;
    closedMinutesAgo?: number;
  }) {
    const future = input.startsInMinutes !== undefined;
    const endsAt = future ? new Date(Math.floor((now.getTime() + (input.startsInMinutes! + 30) * MINUTE) / 1000) * 1000) : new Date(Math.floor((now.getTime() - (input.endedMinutesAgo ?? 10) * MINUTE) / 1000) * 1000);
    const startsAt = new Date(endsAt.getTime() - 30 * MINUTE);
    const [c] = await db
      .insert(schema.calls)
      .values({
        hostId: input.hostId,
        customerId: input.customerId,
        startsAt,
        endsAt,
        roomName: `follow-${randomUUID()}`,
        closedAt: future || input.closed === false ? null : input.closedMinutesAgo !== undefined ? new Date(now.getTime() - input.closedMinutesAgo * MINUTE) : new Date(endsAt.getTime() + 1000),
        cancelledAt: input.cancelled ? startsAt : null,
        cancelledBy: input.cancelled ? "host" : null,
        safetyEndedAt: input.safetyEnded ? new Date(startsAt.getTime() + 5 * MINUTE) : null,
      })
      .returning();
    calls.push(c.id);
    await db.insert(schema.bookings).values({ hostId: input.hostId, customerId: input.customerId, startsAt, endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "accepted", source: input.source ?? "customer", requestKey: randomUUID(), requestedAt: input.source === "admin" ? null : startsAt, decidedAt: startsAt, callId: c.id });
    if (future) return c;
    const connections: Array<[string, [number, number] | null | undefined]> = [
      [input.hostId, input.host === undefined ? [0, 600] : input.host],
      [input.customerId, input.customer === undefined ? [0, 600] : input.customer],
    ];
    for (const [who, span] of connections) {
      if (!span) continue;
      const session = `PA_${randomUUID().slice(0, 12)}`;
      for (const [type, at] of [["participant_joined", span[0]], ["participant_left", span[1]]] as const) {
        await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `follow-${randomUUID()}`, callId: c.id, type, participantIdentity: who, participantSessionId: session, providerTime: new Date(startsAt.getTime() + at * 1000), payload: "{}" });
      }
    }
    return c;
  }
  const refused = async (work: Promise<unknown>, words: string) => {
    const error = await work.then(() => null).catch((e) => e);
    return error instanceof FollowError && error.message.includes(words) ? true : (console.log(`       got: ${error?.message ?? "no error"}`), false);
  };
  const line = async (followerId: string, hostId: string) => (await db.select().from(schema.follows).where(and(eq(schema.follows.followerId, followerId), eq(schema.follows.hostId, hostId))))[0] ?? null;
  const checkedAt = async (callId: string) => (await db.select({ at: schema.calls.followCheckedAt }).from(schema.calls).where(eq(schema.calls.id, callId)))[0].at;
  const list = (userId: string) => F.followedHosts(userId, new Date());
  /** Decides exactly these calls, as the helper would. */
  const decide = (ids: string[], at = now) => F.followAfterCalls(at, ids);
  /** One customer, one host, one call that went as `shape` says; decided; did the customer end up following? */
  async function after(name: string, shape: Partial<Parameters<typeof call>[0]> = {}, before?: (who: { hostId: string; customerId: string; callId: string }) => Promise<void>) {
    const h = await host(`${name}h`);
    const c = await person(`${name}c`);
    const made = await call({ hostId: h.id, customerId: c.id, ...shape });
    if (before) await before({ hostId: h.id, customerId: c.id, callId: made.id });
    const began = await decide([made.id]);
    return { began, follows: (await F.followingOf(c.id, h.id)) === "following", decided: (await checkedAt(made.id)) !== null, hostId: h.id, customerId: c.id, callId: made.id };
  }

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Following and unfollowing");
    const anna = await host("anna", "Anna Follow");
    const cust = await person("cust");
    {
      check("someone who never followed stands at 'none'", (await F.followingOf(cust.id, anna.id)) === "none");
      const result = await F.follow({ followerId: cust.id, handle: anna.handle, now });
      check("following a host whose page is open works, and says who", result.hostId === anna.id && result.displayName === "Anna Follow" && (await F.followingOf(cust.id, anna.id)) === "following");
      await F.follow({ followerId: cust.id, handle: anna.handle.toUpperCase(), now });
      check("pressing again changes nothing; there is one line per pair", (await db.select().from(schema.follows).where(eq(schema.follows.followerId, cust.id))).length === 1);
      const mine = await list(cust.id);
      check("the host is on the follower's list, with a link to their page", mine.length === 1 && mine[0].name === "Anna Follow" && mine[0].handle === anna.handle && !mine[0].available && mine[0].nextCall === null);
      check("nobody else's list has them, and the host's own list is empty", (await list(anna.id)).length === 0);
      await F.unfollow({ followerId: cust.id, hostId: anna.id, now });
      check("unfollowing ends it: the line is kept, marked as ended, and the list is empty", (await F.followingOf(cust.id, anna.id)) === "ended" && (await list(cust.id)).length === 0);
      await F.unfollow({ followerId: anna.id, hostId: cust.id, now });
      check("nobody can end someone else's follow, and no line is written about someone who is not a host", (await line(anna.id, cust.id)) === null && (await F.followingOf(cust.id, anna.id)) === "ended");
      await F.follow({ followerId: cust.id, handle: anna.handle, now });
      check("following again brings it back", (await F.followingOf(cust.id, anna.id)) === "following");

      check("nobody follows themselves", await refused(F.follow({ followerId: anna.id, handle: anna.handle, now }), "yourself"));
      const hidden = await host("hidden", "Hidden Host", { hidden: true });
      const pending = await host("pending", "Pending Host", { status: "pending" });
      check(
        "a page that is hidden, one that is not approved and one that does not exist give the same answer",
        (await refused(F.follow({ followerId: cust.id, handle: hidden.handle, now }), "cannot be followed")) && (await refused(F.follow({ followerId: cust.id, handle: pending.handle, now }), "cannot be followed")) && (await refused(F.follow({ followerId: cust.id, handle: `fw${RUN}nobody`, now }), "cannot be followed")),
      );
      const paused = await person("paused", { pausedAt: now });
      check("a paused person cannot follow", await refused(F.follow({ followerId: paused.id, handle: anna.handle, now }), "cannot follow anyone"));
      await db.insert(schema.follows).values({ followerId: paused.id, hostId: anna.id, how: "self" });
      await F.unfollow({ followerId: paused.id, hostId: anna.id, now });
      check("but can unfollow", (await F.followingOf(paused.id, anna.id)) === "ended");
    }

    // ----------------------------------------------------------------------
    console.log("\n2. The limit");
    {
      const many = await person("many");
      const ids = Array.from({ length: FOLLOW.limit }, (_, i) => `fw-${RUN}-bulk${i}`);
      await db.insert(schema.user).values(ids.map((id, i) => ({ id, name: `Bulk ${i}`, email: `followcheck-${RUN}-bulk${i}@example.test`, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION })));
      made.push(...ids);
      await db.insert(schema.hostProfiles).values(ids.map((id, i) => ({ userId: id, handle: `fw${RUN}bulk${i}`, handleKey: `fw${RUN}bulk${i}`, displayName: `Bulk ${i}`, pricePer15Cents: 0, status: "approved", usConfirmedAt: now })));
      await db.insert(schema.follows).values(ids.slice(0, FOLLOW.limit - 1).map((hostId) => ({ followerId: many.id, hostId, how: "self" })));
      await F.follow({ followerId: many.id, handle: `fw${RUN}bulk${FOLLOW.limit - 1}`, now });
      check(`the ${FOLLOW.limit}th host can be followed`, (await list(many.id)).length === FOLLOW.limit);
      check("one more is refused, and says why", await refused(F.follow({ followerId: many.id, handle: anna.handle, now }), `at most ${FOLLOW.limit}`));
      const full = await after("full", {}, async ({ customerId }) => {
        await db.insert(schema.follows).values(ids.map((hostId) => ({ followerId: customerId, hostId, how: "self" })));
      });
      check("a call does not push anyone over the limit either", !full.follows && full.decided);
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, ids[0]));
      await F.follow({ followerId: many.id, handle: anna.handle, now });
      check("a host whose account is closed is off the list and does not count", (await list(many.id)).length === FOLLOW.limit && (await list(many.id)).some((h) => h.hostId === anna.id) && !(await list(many.id)).some((h) => h.hostId === ids[0]));
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, ids[0]));
      check("and is back when it is opened again", (await list(many.id)).some((h) => h.hostId === ids[0]));

      // Two different calls decided at the same moment for someone one short of the limit: one follow, not two.
      const edge = await person("edge");
      await db.insert(schema.follows).values(ids.slice(0, FOLLOW.limit - 1).map((hostId) => ({ followerId: edge.id, hostId, how: "self" })));
      const [h1, h2] = [await host("edge1"), await host("edge2")];
      const [c1, c2] = [await call({ hostId: h1.id, customerId: edge.id }), await call({ hostId: h2.id, customerId: edge.id, endedMinutesAgo: 50 })];
      const began = await Promise.all([decide([c1.id]), decide([c2.id])]);
      check("two calls decided at the same moment for someone with one place left: one follow, not two", began[0] + began[1] === 1 && (await list(edge.id)).length === FOLLOW.limit, `began ${began.join("+")}`);
      check("and both calls are decided for good", (await checkedAt(c1.id)) !== null && (await checkedAt(c2.id)) !== null);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. The follow that comes by itself after a call");
    {
      const good = await after("good");
      const saved = await line(good.customerId, good.hostId);
      check("after a call the two were in together, the customer follows the host", good.began === 1 && good.follows && saved?.how === "call" && saved.callId === good.callId);
      check("the host does not follow the customer", (await line(good.hostId, good.customerId)) === null);
      check("the call is marked as decided", good.decided);
      check("deciding again does nothing", (await decide([good.callId])) === 0);
      check("a call now and a membership booking count as well", (await after("now", { source: "now" })).follows && (await after("member", { source: "member" })).follows);

      check("not after a call made by a check script", !(await after("admin", { source: "admin" })).follows);
      check("not after a cancelled call", !(await after("cancel", { cancelled: true })).follows);
      check("not after a call ended with 'End call and report'", !(await after("safety", { safetyEnded: true })).follows);
      check("not when the customer never joined", !(await after("noshow", { customer: null })).follows);
      check("not when the two were together for less than two minutes", !(await after("short", { host: [0, 600], customer: [500, 600] })).follows);
      check("but two minutes together is enough", (await after("twomin", { host: [0, 600], customer: [480, 600] })).follows);
      const review = await after("review", {}, async ({ callId, customerId }) => {
        // A second "connected" with no "disconnected" before it: a record that contradicts itself.
        await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `follow-${randomUUID()}`, callId, type: "participant_left", participantIdentity: customerId, participantSessionId: "PA_never_joined", providerTime: new Date(now.getTime() - 30 * MINUTE), payload: "{}" });
      });
      const { loadAttendance } = await import("../src/lib/attendance/load");
      const [reviewCall] = await db.select().from(schema.calls).where(eq(schema.calls.id, review.callId));
      const record = (await loadAttendance(reviewCall, now)).result.status;
      check("a record that does not add up is never guessed at: decided, and no follow", record === "needs_review" && review.decided && !review.follows, record);
      const reportOf = (reporterId: string, reportedId: string, callId: string) => db.insert(schema.reports).values({ reporterId, reportedId, context: "call", contextId: callId, reason: "other", text: "check" });
      check("not when the customer has reported the host", !(await after("rep1", {}, ({ customerId, hostId, callId }) => reportOf(customerId, hostId, callId).then(() => undefined))).follows);
      check("not when the customer has blocked the host", !(await after("blk1", {}, ({ customerId, hostId }) => db.insert(schema.blocks).values({ blockerId: customerId, blockedId: hostId }).then(() => undefined))).follows);
      // What the host did does not stop it: a missing follow would tell the customer. It is a quiet one.
      const blockedByHost = await after("blk2", {}, async ({ customerId, hostId, callId }) => {
        await reportOf(hostId, customerId, callId);
        await db.insert(schema.blocks).values({ blockerId: hostId, blockedId: customerId });
        await goOnline(hostId);
      });
      const quiet = (await list(blockedByHost.customerId))[0];
      check("when the host has reported and blocked the customer, the customer still follows, so that nothing tells them", blockedByHost.follows);
      check("and that follow is quiet: the host is never available to them", quiet?.hostId === blockedByHost.hostId && quiet.available === false);
      const notNow = await after("blk3", {}, ({ customerId, hostId }) => db.insert(schema.blocks).values({ blockerId: customerId, blockedId: hostId }).then(() => undefined));
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, notNow.customerId));
      check("a call is decided once: lifting the customer's block later does not bring a follow", (await decide([notNow.callId])) === 0 && (await line(notNow.customerId, notNow.hostId)) === null);
      check("not when the customer asked for a refund of the call", !(await after("refund", {}, ({ customerId, callId }) => db.insert(schema.refundRequests).values({ callId, customerId, reason: "other", askedAt: now }).then(() => undefined))).follows);
      check("not for a host whose page is hidden", !(await after("hid", {}, ({ hostId }) => db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, hostId)).then(() => undefined))).follows);
      check("not for a host who is suspended", !(await after("susp", {}, ({ hostId }) => db.update(schema.hostProfiles).set({ status: "suspended" }).where(eq(schema.hostProfiles.userId, hostId)).then(() => undefined))).follows);
      check("not when the host is paused", !(await after("hpause", {}, ({ hostId }) => db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, hostId)).then(() => undefined))).follows);
      check("not when the customer is paused", !(await after("cpause", {}, ({ customerId }) => db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, customerId)).then(() => undefined))).follows);
      check("not when the customer's account is closed", !(await after("cclosed", {}, ({ customerId }) => db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, customerId)).then(() => undefined))).follows);

      const said = await after("saidno", {}, ({ customerId, hostId }) => F.unfollow({ followerId: customerId, hostId, now }));
      check("'Don't follow', pressed before the decision, is kept: the call does not follow for them", !said.follows && (await F.followingOf(said.customerId, said.hostId)) === "ended" && said.decided);
      const un = await after("unf");
      await F.unfollow({ followerId: un.customerId, hostId: un.hostId, now });
      const again = await call({ hostId: un.hostId, customerId: un.customerId, endedMinutesAgo: 60 });
      check("someone who unfollowed is never made to follow again by a later call", (await decide([again.id])) === 0 && (await F.followingOf(un.customerId, un.hostId)) === "ended" && (await checkedAt(again.id)) !== null);
      const byHand = await after("byhand", {}, ({ customerId, hostId }) => db.insert(schema.follows).values({ followerId: customerId, hostId, how: "self" }).then(() => undefined));
      check("someone who already follows by the button keeps that line as it is", byHand.began === 0 && (await line(byHand.customerId, byHand.hostId))?.how === "self");

      console.log("   …and when it is decided");
      const h = await host("when");
      const c = await person("whenc");
      const fresh = await call({ hostId: h.id, customerId: c.id, endedMinutesAgo: 1, closedMinutesAgo: 0.5 });
      check("a call whose record is not final yet is left alone", (await decide([fresh.id])) === 0 && (await checkedAt(fresh.id)) === null);
      check("and decided once it is", (await decide([fresh.id], new Date(now.getTime() + 3 * MINUTE))) === 1 && (await F.followingOf(c.id, h.id)) === "following");
      const open = await after("open", { closed: false });
      check("a call whose room is not confirmed closed is not looked at", !open.follows && !open.decided);
      const old = await after("old", { endedMinutesAgo: (FOLLOW.lookBackDays * DAY) / MINUTE + 60 });
      check(`nor one that ended more than ${FOLLOW.lookBackDays} days ago`, !old.follows && !old.decided);
      const twice = await host("twice");
      const twiceC = await person("twicec");
      const one = await call({ hostId: twice.id, customerId: twiceC.id });
      const runs = await Promise.all([decide([one.id]), decide([one.id]), decide([one.id])]);
      check("three helpers deciding the same call at the same moment: one follow", runs.reduce((a, b) => a + b, 0) === 1 && (await db.select().from(schema.follows).where(eq(schema.follows.followerId, twiceC.id))).length === 1, runs.join("+"));
      const [untouched] = await db.select({ n: schema.calls.id }).from(schema.calls).where(and(isNull(schema.calls.followCheckedAt), inArray(schema.calls.id, [good.callId, said.callId])));
      check("nothing is left undecided that was decided", untouched === undefined);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Blocking");
    {
      const h = await host("blockh", "Blocked Host");
      const f = await person("blockf");
      await F.follow({ followerId: f.id, handle: h.handle, now });
      await block({ blockerId: f.id, blockedId: h.id, now });
      check("when a follower blocks the host, their follow ends in the same step", (await F.followingOf(f.id, h.id)) === "ended" && (await list(f.id)).length === 0);
      check("and they cannot follow while they block", (await refused(F.follow({ followerId: f.id, handle: h.handle, now }), "unblock")) && (await F.hasBlocked(f.id, h.id)));
      await unblock(f.id, h.id);
      const later = await call({ hostId: h.id, customerId: f.id, endedMinutesAgo: 40 });
      check("after the unblock it stays ended, also after another call", (await decide([later.id])) === 0 && (await F.followingOf(f.id, h.id)) === "ended");
      await F.follow({ followerId: f.id, handle: h.handle, now });
      check("until they press Follow themselves", (await F.followingOf(f.id, h.id)) === "following");

      const h2 = await host("blockh2", "Blocking Host");
      const f2 = await person("blockf2");
      await F.follow({ followerId: f2.id, handle: h2.handle, now });
      await goOnline(h2.id);
      const before = await list(f2.id);
      await block({ blockerId: h2.id, blockedId: f2.id, now });
      const afterBlock = await list(f2.id);
      check("when the host blocks a follower, the follower's line stays exactly as it was", (await F.followingOf(f2.id, h2.id)) === "following" && afterBlock.length === 1 && afterBlock[0].handle === h2.handle && afterBlock[0].name === before[0].name);
      check("but the host is never shown as available to them", before[0].available === true && afterBlock[0].available === false);
      check("the blocked follower is not told by the button either: it is their own block that takes it away, and they have none", !(await F.hasBlocked(f2.id, h2.id)));
      const f3 = await person("blockf3");
      await block({ blockerId: h2.id, blockedId: f3.id, now });
      await F.follow({ followerId: f3.id, handle: h2.handle, now });
      check("someone the host has blocked can press Follow like anyone: it works, and stays quiet", (await F.followingOf(f3.id, h2.id)) === "following" && (await list(f3.id))[0].available === false);
      await unblock(h2.id, f2.id);
      check("after the host's unblock the follower sees them available again", (await list(f2.id))[0].available === true);

      // A block and the decision at the same moment, in each order and each direction. The order is forced: both
      // steps are made to wait for the customer's lock, which is held here, and are let go in the order they came.
      const waitingFor = async (customerId: string) =>
        Number((await db.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and objid = (hashtext(${`follows:${customerId}`})::bigint & 4294967295)::oid`))[0].n);
      const inOrder = async (customerId: string, first: () => Promise<unknown>, second: () => Promise<unknown>) => {
        const running: Promise<unknown>[] = [];
        await db.transaction(async (tx) => {
          await F.lockFollowers(tx, [customerId]);
          for (const step of [first, second]) {
            const before = await waitingFor(customerId);
            running.push(step());
            for (let i = 0; i < 200 && (await waitingFor(customerId)) <= before; i++) await new Promise((resolve) => setTimeout(resolve, 25));
          }
        });
        await Promise.all(running);
      };
      const raced = async (name: string, who: "customer" | "host", order: "block first" | "decision first") => {
        const rh = await host(`${name}h`);
        const rc = await person(`${name}c`);
        const made = await call({ hostId: rh.id, customerId: rc.id });
        const blocks = () => block({ blockerId: who === "customer" ? rc.id : rh.id, blockedId: who === "customer" ? rh.id : rc.id, now });
        const decides = () => decide([made.id]);
        await inOrder(rc.id, order === "block first" ? blocks : decides, order === "block first" ? decides : blocks);
        return { state: await F.followingOf(rc.id, rh.id), decided: (await checkedAt(made.id)) !== null };
      };
      const r1 = await raced("race1", "customer", "block first");
      check("the customer blocks, then the decision: no follow at all", r1.state === "none" && r1.decided, r1.state);
      const r2 = await raced("race2", "customer", "decision first");
      check("the decision, then the customer blocks: the follow that had just begun is ended", r2.state === "ended" && r2.decided, r2.state);
      const r3 = await raced("race3", "host", "block first");
      check("the host blocks, then the decision: the customer follows, quietly, and is told nothing", r3.state === "following" && r3.decided, r3.state);
      const r4 = await raced("race4", "host", "decision first");
      check("the decision, then the host blocks: the customer's follow stays", r4.state === "following" && r4.decided, r4.state);

      const rh = await host("togh");
      const rc = await person("togc");
      await Promise.all([F.follow({ followerId: rc.id, handle: rh.handle, now }), F.unfollow({ followerId: rc.id, hostId: rh.id, now }), F.follow({ followerId: rc.id, handle: rh.handle, now }), F.unfollow({ followerId: rc.id, hostId: rh.id, now })]);
      const lines = await db.select().from(schema.follows).where(eq(schema.follows.followerId, rc.id));
      check("following and unfollowing at the same moment leaves one clean line", lines.length === 1 && ["following", "ended"].includes(await F.followingOf(rc.id, rh.id)));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The list: available now, the next call, the order");
    {
      const me = await person("lister");
      const [abe, bea, cy, dee] = [await host("abe", "Abe"), await host("bea", "Bea"), await host("cy", "Cy"), await host("dee", "Dee")];
      for (const h of [abe, bea, cy, dee]) await F.follow({ followerId: me.id, handle: h.handle, now });
      check("by name when nothing else is known", (await list(me.id)).map((h) => h.name).join() === "Abe,Bea,Cy,Dee");
      await goOnline(dee.id);
      await call({ hostId: cy.id, customerId: me.id, startsInMinutes: 300 });
      const soon = await call({ hostId: bea.id, customerId: me.id, startsInMinutes: 120 });
      await call({ hostId: abe.id, customerId: me.id, startsInMinutes: 60, cancelled: true });
      const sorted = await list(me.id);
      check("the available host first, then calls coming up by the soonest, then the rest", sorted.map((h) => h.name).join() === "Dee,Bea,Cy,Abe", sorted.map((h) => h.name).join());
      check("the next call is the soonest one that is still on, with its time", sorted[1].nextCall?.id === soon.id && sorted[3].nextCall === null);
      check("available is true only for the host who is", sorted.map((h) => h.available).join() === "true,false,false,false");

      await goOnline(dee.id, 60, NOW.presenceSeconds + 5);
      check("a host whose page has gone quiet is not available", !(await list(me.id)).find((h) => h.hostId === dee.id)!.available);
      await goOnline(dee.id, -1);
      check("nor one whose time is over", !(await list(me.id)).find((h) => h.hostId === dee.id)!.available);
      await goOnline(dee.id);
      const waiting = await Promise.all(Array.from({ length: NOW.waitingPerHost }, (_, i) => person(`wait${i}`)));
      const start = new Date(now.getTime() + 5 * MINUTE);
      await db.insert(schema.bookings).values(waiting.map((w) => ({ hostId: dee.id, customerId: w.id, startsAt: start, endsAt: new Date(start.getTime() + 15 * MINUTE), lengthMinutes: 15, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "waiting", source: "now", requestKey: randomUUID(), requestedAt: now, respondBy: new Date(now.getTime() + 2 * MINUTE) })));
      check("nor one who has no room for another request, as on their own page", !(await list(me.id)).find((h) => h.hostId === dee.id)!.available);
      await db.delete(schema.bookings).where(and(eq(schema.bookings.hostId, dee.id), eq(schema.bookings.stage, "waiting")));
      check("with room again, they are available again", (await list(me.id)).find((h) => h.hostId === dee.id)!.available);

      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, dee.id));
      const hiddenNow = (await list(me.id)).find((h) => h.hostId === dee.id);
      check("a host who hides their page stays on the list by name, without a link, and is not available", hiddenNow?.name === "Dee" && hiddenNow.handle === null && !hiddenNow.available);
      await F.unfollow({ followerId: me.id, hostId: dee.id, now });
      check("and can be taken off it", !(await list(me.id)).some((h) => h.hostId === dee.id));
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, dee.id));
      await db.update(schema.hostProfiles).set({ status: "suspended" }).where(eq(schema.hostProfiles.userId, cy.id));
      check("a suspended host is listed the same way", (await list(me.id)).find((h) => h.hostId === cy.id)?.handle === null);
      await db.update(schema.hostProfiles).set({ status: "approved" }).where(eq(schema.hostProfiles.userId, cy.id));
      check("and has their link back when their page is open again", (await list(me.id)).find((h) => h.hostId === cy.id)?.handle === cy.handle);
      check("followsAnyone says yes for a follower and no for someone who follows nobody", (await F.followsAnyone(me.id)) && !(await F.followsAnyone(dee.id)));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The results page's question");
    {
      const base = { followCheckedAt: null, cancelledAt: null, safetyEndedAt: null, endsAt: new Date(now.getTime() - 5 * MINUTE) };
      check("'Don't follow' is offered while the decision is still to come", F.followStillToCome(base, "customer", now) && F.followStillToCome(base, "now", now) && F.followStillToCome(base, "member", now));
      check("not once it is decided, for a call that cannot lead to a follow, or for an old one", !F.followStillToCome({ ...base, followCheckedAt: now }, "customer", now) && !F.followStillToCome({ ...base, cancelledAt: now }, "customer", now) && !F.followStillToCome({ ...base, safetyEndedAt: now }, "customer", now) && !F.followStillToCome(base, "admin", now) && !F.followStillToCome({ ...base, endsAt: new Date(now.getTime() - 8 * DAY) }, "customer", now));
    }

    // ----------------------------------------------------------------------
    if (!APP) {
      console.log("\n7. The pages themselves: skipped (run with --app=http://localhost:3000 and the app running)");
    } else {
      console.log(`\n7. The pages themselves, from ${APP}, as the seeded test customer`);
      const [cory] = await db.select().from(schema.user).where(eq(schema.user.email, "customer@test.local"));
      const password = readFileSync("test-accounts.local.md", "utf8").split("\n").find((l) => l.includes("customer@test.local"))?.split("|").map((c) => c.trim())[3] ?? "";
      const jar = new Map<string, string>();
      const get = async (path: string, loggedIn = true) => {
        const headers: Record<string, string> = { origin: APP };
        if (loggedIn && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
        const response = await fetch(`${APP}${path}`, { headers, redirect: "manual" });
        return { status: response.status, text: await response.text() };
      };
      const signIn = await fetch(`${APP}/api/auth/sign-in/email`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify({ email: "customer@test.local", password }) });
      for (const cookie of signIn.headers.getSetCookie()) {
        const pair = cookie.split(";")[0];
        jar.set(pair.slice(0, pair.indexOf("=")).trim(), pair.slice(pair.indexOf("=") + 1));
      }
      check("the test customer can log in", signIn.status === 200 && Boolean(cory), String(signIn.status));
      const button = (html: string) => html.match(/data-follow="([a-z]+)"/)?.[1] ?? "none-drawn";
      const box = (html: string) => html.match(/data-follow-box="([a-z-]+)"/)?.[1] ?? "none-drawn";
      try {
        const plain = await host("pageplain", "Page Plain");
        const blocking = await host("pageblocking", "Page Blocking");
        const mine = await host("pagemine", "Page Mine");
        await db.insert(schema.blocks).values([{ blockerId: blocking.id, blockedId: cory.id }, { blockerId: cory.id, blockedId: mine.id }]);
        check("a visitor who is not logged in is offered 'Log in to follow'", button((await get(`/h/${plain.handle}`, false)).text) === "visitor");
        check("the Follow button is the same on the page of a host who has blocked the viewer", button((await get(`/h/${plain.handle}`)).text) === "none" && button((await get(`/h/${blocking.handle}`)).text) === "none");
        check("and is not drawn for a host the viewer has blocked themselves", button((await get(`/h/${mine.handle}`)).text) === "none-drawn");
        await F.follow({ followerId: cory.id, handle: plain.handle, now });
        await F.follow({ followerId: cory.id, handle: blocking.handle, now });
        check("following, both pages say so in the same way", button((await get(`/h/${plain.handle}`)).text) === "following" && button((await get(`/h/${blocking.handle}`)).text) === "following");
        const listPage = (await get("/following")).text;
        check("both are on the list, each with its link", listPage.includes("Page Plain") && listPage.includes("Page Blocking") && listPage.includes(`/h/${blocking.handle}`));
        await F.unfollow({ followerId: cory.id, hostId: plain.id, now });
        await F.unfollow({ followerId: cory.id, hostId: blocking.id, now });
        await db.delete(schema.follows).where(and(eq(schema.follows.followerId, cory.id), inArray(schema.follows.hostId, made)));

        const [callPlain, callBlocking] = [await call({ hostId: plain.id, customerId: cory.id, endedMinutesAgo: 20 }), await call({ hostId: blocking.id, customerId: cory.id, endedMinutesAgo: 70 })];
        const results = async (id: string) => box((await get(`/calls/${id}/results`)).text);
        check("before the decision, the results page offers 'Don't follow' in both cases", (await results(callPlain.id)) === "to-come" && (await results(callBlocking.id)) === "to-come");
        await decide([callPlain.id, callBlocking.id]);
        check("after it, both say 'You follow'", (await results(callPlain.id)) === "following" && (await results(callBlocking.id)) === "following");
        const stranger = await host("pagestranger");
        const notMine = await call({ hostId: stranger.id, customerId: (await person("pageother")).id });
        check("the results of a call the viewer was not in are 'not found'", (await get(`/calls/${notMine.id}/results`)).status === 404);
        check("the list needs a login", [302, 303, 307].includes((await get("/following", false)).status));
      } finally {
        await db.delete(schema.follows).where(and(eq(schema.follows.followerId, cory.id), inArray(schema.follows.hostId, made)));
      }
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
    await db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids)));
    await db.delete(schema.refundRequests).where(inArray(schema.refundRequests.callId, callIds));
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, callIds));
    await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.userId, ids));
    await db.delete(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)));
    await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await removeTestsOf(ids);
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
