/**
 * Testing tool: the emails to followers (plans/31) against the local database. It makes its own
 * people, hosts, projects and posts, reads what lands in the outbox, sends through a pretend
 * sending service, touches no other account, needs neither Stripe nor the app running, and
 * removes what it made. Stop the helper (`npm run worker`) first: it would make the same
 * announcements at the same time.
 *
 * Usage: npx tsx scripts/follow-emails-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const ADDRESS = "Connect Check, 1 Test Street, Springfield";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail !== "" ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  process.env.FOLLOW_EMAILS_ADDRESS = ADDRESS;
  const { db, schema } = await import("../src/db");
  const { removeTestsOf } = await import("../src/lib/connection/tests");
  const F = await import("../src/lib/follows/follows");
  const E = await import("../src/lib/follows/emails");
  const { FollowError } = F;
  const { EMAILS, minuteOfDay } = await import("../src/lib/follows/rules");
  const N = await import("../src/lib/booking/now");
  const B = await import("../src/lib/booking/bookings");
  const P = await import("../src/lib/projects/posts");
  const { block } = await import("../src/lib/safety/blocks");
  const { deliverEmails } = await import("../src/lib/notifications/delivery");
  const { unsubscribeTokenFor, unsubscribeWithToken } = await import("../src/lib/notifications/unsubscribe");
  type Transport = Parameters<typeof deliverEmails>[1] & object;

  const T0 = new Date();
  const made: string[] = [];
  const projects: string[] = [];
  const ONLY = { toLike: `femail-${RUN}-%` };
  const emailOf = (name: string) => `femail-${RUN}-${name}@example.test`;

  async function person(name: string, extra: Partial<typeof schema.user.$inferInsert> = {}) {
    const id = `fe-${RUN}-${name}`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email: emailOf(name), emailVerified: true, adultConfirmedAt: T0, termsAcceptedAt: T0, termsVersion: TERMS_VERSION, timeZone: "America/New_York", ...extra });
    made.push(id);
    return { id, name: `Check ${name}`, email: emailOf(name) };
  }
  /** A host who can be asked for a free call at any time, with a running project. */
  async function host(name: string, displayName = `Host ${name}`) {
    const p = await person(name);
    const handle = `fe${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle, handleKey: handle, displayName, pricePer15Cents: 0, status: "approved", usConfirmedAt: T0 });
    await db.insert(schema.hostSettings).values({ userId: p.id });
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: p.id, weekday, startMinute: 0, endMinute: 1440 })));
    const [project] = await db.insert(schema.projects).values({ hostId: p.id, name: `Secret project of ${name}`, description: "A description only the site shows.", startedAt: T0 }).returning();
    projects.push(project.id);
    return { ...p, handle, displayName, projectId: project.id };
  }
  /** Someone who follows a host, with the given ticks. */
  async function follower(name: string, hostId: string, choices: { online?: boolean; posts?: boolean; from?: number; to?: number } = { online: true }, extra: Partial<typeof schema.user.$inferInsert> = {}) {
    const p = await person(name, extra);
    await db.insert(schema.follows).values({ followerId: p.id, hostId, how: "self", tellOnline: choices.online ?? false, tellPosts: choices.posts ?? false, hoursFrom: choices.from ?? null, hoursTo: choices.to ?? null });
    return p;
  }
  const calendar = async (hostId: string) => (await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hostId)))[0];
  const line = async (followerId: string, hostId: string) => (await db.select().from(schema.follows).where(and(eq(schema.follows.followerId, followerId), eq(schema.follows.hostId, hostId))))[0];
  const mail = (name: string) => db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, emailOf(name))).orderBy(asc(schema.emailOutbox.createdAt));
  /** Pretends the host's page kept saying "still here" up to this moment. */
  const keptOpen = (hostId: string, at: Date) => db.update(schema.hostCalendars).set({ availableSeenAt: at }).where(eq(schema.hostCalendars.userId, hostId));
  const switchOn = (hostId: string, at: Date) => N.setAvailableNow({ hostId, minutes: 60, now: at });
  const switchOff = (hostId: string, at: Date) => N.setAvailableNow({ hostId, minutes: null, now: at });
  /** The host switches on at `at`; a minute later (their page still open) the helper's round is made. Returns how many emails it wrote. */
  async function onAndAnnounced(hostId: string, at: Date): Promise<number> {
    await switchOn(hostId, at);
    const later = new Date(at.getTime() + (EMAILS.announceAfterSeconds + 1) * SECOND);
    await keptOpen(hostId, later);
    return E.announceAvailable(later, [hostId]);
  }
  /** A post written `minutesAgo` ago, as `writePost` leaves it while the emails are on. */
  async function post(projectId: string, minutesAgo: number, text = "Words only the diary shows.") {
    const at = new Date(T0.getTime() - minutesAgo * MINUTE);
    const [row] = await db.insert(schema.projectPosts).values({ projectId, text, createdAt: at, updatedAt: at }).returning();
    return row;
  }
  const refused = async (work: Promise<unknown>, words: string) => {
    const error = await work.then(() => null).catch((e) => e);
    return error instanceof FollowError && error.message.includes(words) ? true : (console.log(`       got: ${error?.message ?? "no error"}`), false);
  };
  const sent: string[] = [];
  const pretend: Transport = async (email) => {
    sent.push(email.to);
    return { ok: true, providerId: `pretend-${randomUUID()}` };
  };
  /** Follow emails already written to someone in the last day, as plain lines in the outbox. */
  const earlier = (name: string, count: number, status: "queued" | "sent" = "sent") =>
    db.insert(schema.emailOutbox).values(Array.from({ length: count }, () => ({ to: emailOf(name), kind: "follow", subject: "An earlier one", body: "x", dedupeKey: `follow-post:nobody:fe-${RUN}-${name}:${randomUUID()}`, status, sentAt: status === "sent" ? new Date() : null })));
  /**
   * Makes several pieces of work meet at one follower's lock: the lock is held here until every one of them is
   * waiting for it, then let go. `reached` is false if they never all got there: then nothing was proven.
   */
  const together = async (followerId: string, works: Array<() => Promise<number>>) => {
    const waiting = async () => Number((await db.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and objid = (hashtext(${`follows:${followerId}`})::bigint & 4294967295)::oid`))[0].n);
    let running: Promise<number>[] = [];
    let reached = false;
    await db.transaction(async (tx) => {
      await F.lockFollowers(tx, [followerId]);
      running = works.map((work) => work());
      for (let i = 0; i < 200 && !(reached = (await waiting()) >= works.length); i++) await new Promise((resolve) => setTimeout(resolve, 25));
    });
    return { wrote: await Promise.all(running), reached };
  };
  let step = 0;
  /** A fresh moment for each journey, a few minutes apart, so that none sits inside another's minute. */
  const moment = () => new Date(T0.getTime() + ++step * 5 * MINUTE);

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Switched off: nothing is set up, written or sent");
    {
      delete process.env.FOLLOW_EMAILS_ADDRESS;
      const h = await host("off");
      const f = await follower("offf", h.id, { online: true, posts: true });
      const at = moment();
      await switchOn(h.id, at);
      check("a host who switches on while the emails are off gets no announcement set", (await calendar(h.id)).announceAt === null);
      await keptOpen(h.id, new Date(at.getTime() + 61 * SECOND));
      check("and the helper's round writes nothing", (await E.announceAvailable(new Date(at.getTime() + 61 * SECOND), [h.id])) === 0 && (await mail("offf")).length === 0);
      const written = await P.writePost({ hostId: h.id, projectId: h.projectId, text: "Written while off.", links: [], now: new Date(T0.getTime() - 40 * MINUTE) });
      check("a post written while they are off is marked as dealt with in the same step", written.announcedAt !== null);
      check("the choices cannot be saved", await refused(E.saveChoices({ followerId: f.id, hostId: h.id, tellOnline: true, now: T0 }), "not available"));
      await db.insert(schema.emailOutbox).values({ to: f.email, kind: "follow", subject: "Left over", body: "x", dedupeKey: `follow-online:${h.id}:${f.id}:1` });
      check("an email of this kind that exists is not sent", (await E.followEmailProblem(`follow-online:${h.id}:${f.id}:1`, new Date())) === "emails to followers are switched off");
      await deliverEmails(new Date(), pretend, ONLY);
      check("also not by the sending itself", sent.length === 0 && (await mail("offf"))[0].status === "failed");

      process.env.FOLLOW_EMAILS_ADDRESS = ADDRESS;
      check("switching on announces nothing about the time it was off: not the host who was already on", (await E.announceAvailable(new Date(at.getTime() + 2 * MINUTE), [h.id])) === 0 && (await mail("offf")).length === 1);
      check("and not the post", (await E.announcePosts(T0, [written.id])) === 0);
      const laterPost = await P.writePost({ hostId: h.id, projectId: h.projectId, text: "Written while on.", links: [], now: T0 });
      check("a post written while they are on is left to be announced", laterPost.announcedAt === null);
      await db.delete(schema.emailOutbox).where(eq(schema.emailOutbox.to, f.email));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. \"Available now\": only with a yes, a minute after switching on");
    const anna = await host("anna", "Anna Online");
    {
      const yes = await follower("yes", anna.id, { online: true });
      await follower("no", anna.id, { online: false, posts: true });
      const at = moment();
      await switchOn(anna.id, at);
      const waits = (await calendar(anna.id)).announceAt;
      check("switching on sets the announcement for a minute later", waits?.getTime() === at.getTime() + EMAILS.announceAfterSeconds * SECOND);
      await keptOpen(anna.id, new Date(at.getTime() + 30 * SECOND));
      check("inside the minute nothing is written", (await E.announceAvailable(new Date(at.getTime() + 30 * SECOND), [anna.id])) === 0 && (await calendar(anna.id)).announceAt !== null);
      const later = new Date(at.getTime() + 61 * SECOND);
      await keptOpen(anna.id, later);
      const wrote = await E.announceAvailable(later, [anna.id]);
      const [email, ...more] = await mail("yes");
      check("after it, one email goes to the follower who said yes", wrote === 1 && more.length === 0 && Boolean(email));
      check("and none to the follower who did not tick this kind", (await mail("no")).length === 0);
      check("it is stored as an email to a follower, with its key, and runs out when the host's time does", email.kind === "follow" && email.dedupeKey === `follow-online:${anna.id}:${yes.id}:${waits!.getTime()}` && email.expiresAt?.getTime() === (await calendar(anna.id)).availableUntil?.getTime());
      check("it names the host, links to their page, and carries the postal address", email.subject === "Anna Online is available now on Connect" && email.body.includes(`/h/${anna.handle}`) && email.body.includes(ADDRESS));
      const token = await unsubscribeTokenFor(yes.id);
      check("it ends with the link that stops all of them, also for a mail program's own button", email.body.includes(`/unsubscribe?token=${token}&what=follows`) && String(email.headers).includes(`/api/unsubscribe?token=${token}&what=follows`) && String(email.headers).includes("One-Click"));
      check("and with where to choose per host", email.body.includes("/following"));
      check("the announcement is emptied, and the follower's line remembers when they were told", (await calendar(anna.id)).announceAt === null && (await line(yes.id, anna.id)).toldOnlineAt?.getTime() === later.getTime());

      // (The page has kept saying "still here" meanwhile: a host whose page went quiet would be switching on afresh.)
      await keptOpen(anna.id, new Date(later.getTime() + MINUTE - SECOND));
      await switchOn(anna.id, new Date(later.getTime() + MINUTE));
      check("extending while on announces nothing new", (await calendar(anna.id)).announceAt === null);
      await db.update(schema.hostCalendars).set({ availableSeenAt: new Date(later.getTime() - MINUTE) }).where(eq(schema.hostCalendars.userId, anna.id));
      await switchOn(anna.id, new Date(later.getTime() + MINUTE));
      check("but a host whose page had gone quiet is switching on afresh, and is announced", (await calendar(anna.id)).announceAt?.getTime() === later.getTime() + MINUTE + EMAILS.announceAfterSeconds * SECOND);
      await switchOff(anna.id, new Date(later.getTime() + 2 * MINUTE));
      const again = new Date(later.getTime() + 3 * MINUTE);
      const second = await onAndAnnounced(anna.id, again);
      check("switching off and on again is a new announcement, but nobody is told twice in 20 hours", second === 0 && (await mail("yes")).length === 1 && (await calendar(anna.id)).announceAt === null);
      await db.update(schema.follows).set({ toldOnlineAt: new Date(again.getTime() - 21 * HOUR) }).where(eq(schema.follows.followerId, yes.id));
      await switchOff(anna.id, new Date(again.getTime() + 2 * MINUTE));
      check("after 20 hours they are told again", (await onAndAnnounced(anna.id, new Date(again.getTime() + 3 * MINUTE))) === 1 && (await mail("yes")).length === 2);
      await switchOff(anna.id, new Date(again.getTime() + 6 * MINUTE));
    }
    {
      const h = await host("quick");
      await follower("quickf", h.id);
      const at = moment();
      await switchOn(h.id, at);
      await switchOff(h.id, new Date(at.getTime() + 20 * SECOND));
      check("a host who switches off again inside the minute is not announced", (await calendar(h.id)).announceAt === null && (await E.announceAvailable(new Date(at.getTime() + 61 * SECOND), [h.id])) === 0 && (await mail("quickf")).length === 0);

      const at2 = moment();
      await switchOn(h.id, at2);
      const waits = (await calendar(h.id)).announceAt;
      await switchOn(h.id, new Date(at2.getTime() + 10 * SECOND));
      check("extending inside the minute keeps the same announcement", (await calendar(h.id)).announceAt?.getTime() === waits?.getTime());
      const caller = await person("caller");
      await db.insert(schema.identityChecks).values({ userId: caller.id, stripeSessionId: `vs_femail_${randomUUID()}`, status: "verified", adult: true, verifiedName: caller.name, checkedAt: T0 });
      const asked = new Date(at2.getTime() + 15 * SECOND);
      await keptOpen(h.id, asked);
      const { booking } = await B.askNow({ customer: caller, hostId: h.id, lengthMinutes: 15, requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 0 }, now: asked });
      await B.accept({ bookingId: booking.id, hostId: h.id, now: new Date(asked.getTime() + 5 * SECOND) });
      check("accepting a call inside the minute ends being available, and the announcement with it", (await calendar(h.id)).announceAt === null && (await mail("quickf")).length === 0);
    }
    {
      const h = await host("gone");
      await follower("gonef", h.id);
      const at = moment();
      await switchOn(h.id, at);
      // The page was closed without saying so: the minute is over, but the host is not there any more.
      check("a host whose page has gone quiet by then is not announced, and the announcement is emptied", (await E.announceAvailable(new Date(at.getTime() + 61 * SECOND), [h.id])) === 0 && (await calendar(h.id)).announceAt === null && (await mail("gonef")).length === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. The hours");
    {
      const h = await host("hours");
      const at = moment();
      const hour = Math.floor(minuteOfDay(new Date(at.getTime() + 61 * SECOND), "America/New_York") / 60);
      await follower("inside", h.id, { online: true, from: hour * 60, to: ((hour + 1) % 24) * 60 });
      await follower("outside", h.id, { online: true, from: ((hour + 2) % 24) * 60, to: ((hour + 3) % 24) * 60 });
      await follower("pastmidnight", h.id, { online: true, from: ((hour + 23) % 24) * 60, to: ((hour + 1) % 24) * 60 });
      const elsewhere = await follower("elsewhere", h.id, { online: true, from: hour * 60, to: ((hour + 1) % 24) * 60 }, { timeZone: "Asia/Tokyo" });
      const wrote = await onAndAnnounced(h.id, at);
      check("a follower inside their hours is told, one outside is not", (await mail("inside")).length === 1 && (await mail("outside")).length === 0, wrote);
      check("hours that wrap around the day are read as one stretch", (await mail("pastmidnight")).length === 1);
      check("the hours are the follower's own: the same numbers mean another time in Tokyo", (await mail("elsewhere")).length === 0);
      const [email] = await mail("inside");
      const insideId = `fe-${RUN}-inside`;
      check("right before sending, the hours are asked again", (await E.followEmailProblem(email.dedupeKey!, new Date(at.getTime() + 61 * SECOND))) === null && (await E.followEmailProblem(email.dedupeKey!, new Date(at.getTime() + 3 * HOUR))) === "it is outside the hours they chose");
      await E.saveChoices({ followerId: insideId, hostId: h.id, hours: null, now: T0 });
      check("hours can be taken away again", (await line(insideId, h.id)).hoursFrom === null && (await line(insideId, h.id)).tellOnline === true);
      await E.saveChoices({ followerId: elsewhere.id, hostId: h.id, hours: { from: 600, to: 720 }, now: T0 });
      check("and changed, without touching the ticks", (await line(elsewhere.id, h.id)).hoursFrom === 600 && (await line(elsewhere.id, h.id)).hoursTo === 720 && (await line(elsewhere.id, h.id)).tellOnline === true);
      await switchOff(h.id, new Date(at.getTime() + 2 * MINUTE));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Who is never written to");
    {
      const h = await host("who");
      await follower("closed", h.id, { online: true }, { closedAt: T0 });
      await follower("paused", h.id, { online: true }, { pausedAt: T0 });
      await follower("unconfirmed", h.id, { online: true }, { emailVerified: false });
      await follower("accountoff", h.id, { online: true }, { followEmails: false });
      const blockedOne = await follower("blockedbyhost", h.id);
      await db.insert(schema.blocks).values({ blockerId: h.id, blockedId: blockedOne.id });
      const ended = await follower("ended", h.id);
      await F.unfollow({ followerId: ended.id, hostId: h.id, now: T0 });
      await follower("fine", h.id);
      const at = moment();
      const wrote = await onAndAnnounced(h.id, at);
      const none = async (...names: string[]) => (await Promise.all(names.map((name) => mail(name)))).every((rows) => rows.length === 0);
      check("a closed, a paused and an unconfirmed follower get nothing", await none("closed", "paused", "unconfirmed"));
      check("nor one who switched these emails off for their account, although the tick is kept", (await none("accountoff")) && (await line(`fe-${RUN}-accountoff`, h.id)).tellOnline === true);
      check("nor one the host has blocked, whose follow is otherwise untouched", (await none("blockedbyhost")) && (await line(blockedOne.id, h.id)).unfollowedAt === null);
      check("nor one who unfollowed; and unfollowing took the tick with it", (await none("ended")) && (await line(ended.id, h.id)).tellOnline === false);
      check("the one follower all of this leaves is told", wrote === 1 && (await mail("fine")).length === 1);

      await switchOff(h.id, new Date(at.getTime() + 2 * MINUTE));
      await db.update(schema.follows).set({ toldOnlineAt: null }).where(eq(schema.follows.hostId, h.id));
      await db.update(schema.user).set({ pausedAt: T0 }).where(eq(schema.user.id, h.id));
      const at2 = moment();
      await db.update(schema.hostCalendars).set({ availableUntil: new Date(at2.getTime() + HOUR), availableSeenAt: at2, announceAt: at2 }).where(eq(schema.hostCalendars.userId, h.id));
      check("a paused host is not announced to anyone", (await E.announceAvailable(new Date(at2.getTime() + SECOND), [h.id])) === 0 && (await mail("fine")).length === 1);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, h.id));
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, h.id));
      await db.update(schema.hostCalendars).set({ availableUntil: new Date(at2.getTime() + HOUR), availableSeenAt: at2, announceAt: at2 }).where(eq(schema.hostCalendars.userId, h.id));
      check("nor a host whose page is hidden", (await E.announceAvailable(new Date(at2.getTime() + SECOND), [h.id])) === 0 && (await mail("fine")).length === 1);
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, h.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The limits, also when things happen at the same moment");
    {
      const [h1, h2, h3] = [await host("lim1"), await host("lim2"), await host("lim3")];
      const f = await follower("busy", h1.id);
      for (const h of [h2, h3]) await db.insert(schema.follows).values({ followerId: f.id, hostId: h.id, how: "self", tellOnline: true });
      await earlier("busy", EMAILS.perDay - 1, "queued");
      const at = moment();
      for (const h of [h1, h2]) {
        await switchOn(h.id, at);
        await keptOpen(h.id, new Date(at.getTime() + 61 * SECOND));
      }
      const { wrote, reached } = await together(f.id, [() => E.announceAvailable(new Date(at.getTime() + 61 * SECOND), [h1.id]), () => E.announceAvailable(new Date(at.getTime() + 61 * SECOND), [h2.id])]);
      check(`two hosts announced at the same moment to someone who has had ${EMAILS.perDay - 1} today: one more email, not two`, reached && wrote[0] + wrote[1] === 1 && (await mail("busy")).length === EMAILS.perDay, { wrote, reached });
      check("and a third host that day writes none", (await onAndAnnounced(h3.id, moment())) === 0 && (await mail("busy")).length === EMAILS.perDay);
      for (const h of [h1, h2, h3]) await switchOff(h.id, new Date(T0.getTime() + 20 * HOUR));
    }
    {
      // The helper stops between two followers and starts again: the same announcement is gone through once more.
      const h = await host("crash");
      await follower("crash1", h.id);
      await follower("crash2", h.id);
      const at = moment();
      await switchOn(h.id, at);
      const announcement = (await calendar(h.id)).announceAt!;
      const later = new Date(at.getTime() + 61 * SECOND);
      await keptOpen(h.id, later);
      await E.announceAvailable(later, [h.id]);
      await db.update(schema.hostCalendars).set({ announceAt: announcement }).where(eq(schema.hostCalendars.userId, h.id));
      await E.announceAvailable(new Date(later.getTime() + SECOND), [h.id]);
      check("an announcement that is gone through twice tells each follower once", (await mail("crash1")).length === 1 && (await mail("crash2")).length === 1);
      await db.update(schema.follows).set({ toldOnlineAt: null }).where(eq(schema.follows.hostId, h.id));
      await db.update(schema.hostCalendars).set({ announceAt: announcement }).where(eq(schema.hostCalendars.userId, h.id));
      await E.announceAvailable(new Date(later.getTime() + 2 * SECOND), [h.id]);
      check("also if the note of having told them were lost: the email's key is unique", (await mail("crash1")).length === 1 && (await mail("crash2")).length === 1);
      check("and an email that was there already does not start the follower's 20 hours again", (await line(`fe-${RUN}-crash1`, h.id)).toldOnlineAt === null);
      await switchOff(h.id, new Date(at.getTime() + 2 * MINUTE));
    }
    {
      // A host switches off and on while a round is under way: the old round must not announce the new period.
      const h = await host("swap");
      const f = await follower("swapf", h.id);
      const at = moment();
      await switchOn(h.id, at);
      const later = new Date(at.getTime() + 61 * SECOND);
      await keptOpen(h.id, later);
      const waitingFor = async () => Number((await db.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and objid = (hashtext(${`follows:${f.id}`})::bigint & 4294967295)::oid`))[0].n);
      let round: Promise<number> = Promise.resolve(-1);
      let reached = false;
      let stillHereMs = -1;
      await db.transaction(async (tx) => {
        await F.lockFollowers(tx, [f.id]);
        round = E.announceAvailable(later, [h.id]);
        for (let i = 0; i < 200 && !(reached = (await waitingFor()) > 0); i++) await new Promise((resolve) => setTimeout(resolve, 25));
        // While the round waits for a follower, the host's page still gets its answer at once: no calendar is held.
        const before = Date.now();
        await N.stillHere(h.id, later);
        stillHereMs = Date.now() - before;
        await switchOff(h.id, new Date(later.getTime() + SECOND));
        await switchOn(h.id, new Date(later.getTime() + 2 * SECOND));
      });
      const wrote = await round;
      const fresh = (await calendar(h.id)).announceAt;
      check("the round really was under way when the host switched off and on", reached);
      check("the host's \"still here\" is answered at once while a round is writing", stillHereMs >= 0 && stillHereMs < 1000, `${stillHereMs} ms`);
      check("the old round writes nothing for the new period", wrote === 0 && (await mail("swapf")).length === 0);
      check("and does not empty the new announcement, which keeps its own minute", fresh?.getTime() === later.getTime() + 2 * SECOND + EMAILS.announceAfterSeconds * SECOND);
      const due = new Date(fresh!.getTime() + SECOND);
      await keptOpen(h.id, due);
      check("which is then made", (await E.announceAvailable(due, [h.id])) === 1 && (await mail("swapf")).length === 1);
      await switchOff(h.id, new Date(due.getTime() + MINUTE));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The last look before sending, and taking a yes back");
    {
      const h = await host("look", "Look Host");
      const f = await follower("lookf", h.id, { online: true, posts: true });
      const at = moment();
      await onAndAnnounced(h.id, at);
      // For the rest of this journey the host stays available at the real time of day, as the sending sees it.
      await db.update(schema.hostCalendars).set({ availableUntil: new Date(Date.now() + 2 * HOUR), availableSeenAt: new Date(Date.now() + HOUR) }).where(eq(schema.hostCalendars.userId, h.id));
      const [online] = await mail("lookf");
      const p = await post(h.projectId, 31);
      await E.announcePosts(T0, [p.id]);
      const diary = (await mail("lookf")).find((row) => row.dedupeKey?.startsWith("follow-post:"))!;
      check("both kinds are waiting for this follower", Boolean(online) && Boolean(diary));
      check("as things stand, both may be sent", (await E.followEmailProblem(online.dedupeKey!, new Date())) === null && (await E.followEmailProblem(diary.dedupeKey!, new Date())) === null);
      check("an email written to an address the follower no longer has is not sent", (await E.followEmailProblem(online.dedupeKey!, new Date(), "an-old-address@example.test")) === "the follower's address has changed" && (await E.followEmailProblem(online.dedupeKey!, new Date(), f.email.toUpperCase())) === null);
      check("an email of another kind is none of this function's business", (await E.followEmailProblem("reminder:x:y:hour", new Date())) === undefined);

      await db.update(schema.projectPosts).set({ removedAt: T0 }).where(eq(schema.projectPosts.id, p.id));
      check("a post removed after its email was written: the email is not sent", (await E.followEmailProblem(diary.dedupeKey!, new Date())) === "the post is no longer there");
      await db.update(schema.projectPosts).set({ removedAt: null, hiddenAt: T0 }).where(eq(schema.projectPosts.id, p.id));
      check("nor for a post the founder has hidden since", (await E.followEmailProblem(diary.dedupeKey!, new Date())) === "the post is no longer there");
      await db.update(schema.projectPosts).set({ hiddenAt: null }).where(eq(schema.projectPosts.id, p.id));

      await earlier("lookf", EMAILS.perDay, "sent");
      check(`someone who was really sent ${EMAILS.perDay} in the last day gets no more, however late this one is`, String(await E.followEmailProblem(online.dedupeKey!, new Date())).includes(`${EMAILS.perDay} of these emails`));
      await db.delete(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, f.email), eq(schema.emailOutbox.subject, "An earlier one")));

      await db.insert(schema.blocks).values({ blockerId: h.id, blockedId: f.id });
      check("a block that came after it was written stops it", (await E.followEmailProblem(online.dedupeKey!, new Date())) === "one of the two has blocked the other");
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, h.id));
      await db.update(schema.user).set({ pausedAt: T0 }).where(eq(schema.user.id, f.id));
      check("so does a pause of the follower", (await E.followEmailProblem(online.dedupeKey!, new Date())) === "the account is paused");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, f.id));

      await E.saveChoices({ followerId: f.id, hostId: h.id, tellOnline: false, now: T0 });
      const afterTick = await mail("lookf");
      check("clearing one tick drops the waiting email of that kind at once", afterTick.find((row) => row.id === online.id)?.status === "failed" && String(afterTick.find((row) => row.id === online.id)?.lastError).includes("taken back"));
      check("and leaves the waiting email of the other kind alone", afterTick.find((row) => row.id === diary.id)?.status === "queued");
      await E.saveChoices({ followerId: f.id, hostId: h.id, tellOnline: true, now: T0 });
      check("saying yes again does not bring the dropped email back", (await mail("lookf")).find((row) => row.id === online.id)?.status === "failed");

      // Only this follower's emails are of interest here: what the earlier journeys left waiting is put aside.
      await db.update(schema.emailOutbox).set({ status: "failed", lastError: "put aside by the check" }).where(and(like(schema.emailOutbox.to, ONLY.toLike), eq(schema.emailOutbox.status, "queued"), sql`${schema.emailOutbox.to} <> ${f.email}`));
      sent.length = 0;
      await deliverEmails(new Date(), pretend, ONLY);
      check("the sending sends the one that still holds, and only that", sent.length === 1 && sent[0] === f.email && (await mail("lookf")).find((row) => row.id === diary.id)?.status === "sent", sent);
    }
    {
      const h = await host("went");
      const f = await follower("wentf", h.id);
      await onAndAnnounced(h.id, moment());
      const [email] = await mail("wentf");
      await db.update(schema.hostCalendars).set({ availableUntil: null, availableSeenAt: null }).where(eq(schema.hostCalendars.userId, h.id));
      await db.update(schema.emailOutbox).set({ status: "failed", lastError: "put aside by the check" }).where(and(like(schema.emailOutbox.to, ONLY.toLike), eq(schema.emailOutbox.status, "queued"), sql`${schema.emailOutbox.to} <> ${f.email}`));
      sent.length = 0;
      await db.update(schema.emailOutbox).set({ expiresAt: new Date(Date.now() + HOUR) }).where(eq(schema.emailOutbox.id, email.id));
      await deliverEmails(new Date(), pretend, ONLY);
      const [after] = await mail("wentf");
      check("an email about a host who has gone by the time it is sent is dropped, not sent", sent.length === 0 && after.status === "failed" && String(after.lastError).includes("no longer available"), after.lastError);

      const h2 = await host("unf");
      const f2 = await follower("unff", h2.id, { online: true, posts: true });
      await onAndAnnounced(h2.id, moment());
      await F.unfollow({ followerId: f2.id, hostId: h2.id, now: T0 });
      check("unfollowing drops what was waiting, and takes both ticks with it", (await mail("unff")).every((row) => row.status === "failed") && (await mail("unff")).length === 1 && !(await line(f2.id, h2.id)).tellOnline && !(await line(f2.id, h2.id)).tellPosts);
      await F.follow({ followerId: f2.id, handle: h2.handle, now: T0 });
      check("following again starts with both choices off", !(await line(f2.id, h2.id)).tellOnline && !(await line(f2.id, h2.id)).tellPosts && (await line(f2.id, h2.id)).hoursFrom === null);

      const h3 = await host("blk");
      const f3 = await follower("blkf", h3.id);
      await onAndAnnounced(h3.id, moment());
      await block({ blockerId: h3.id, blockedId: f3.id, now: T0 });
      check("a block by the host drops the email that was waiting for the follower, and leaves their follow as it was", (await mail("blkf"))[0].status === "failed" && (await line(f3.id, h3.id)).unfollowedAt === null && (await line(f3.id, h3.id)).tellOnline === true);
    }

    // ----------------------------------------------------------------------
    console.log("\n7. The stop link and the account's switch");
    {
      const h = await host("stop");
      const f = await follower("stopf", h.id, { online: true, posts: true });
      await onAndAnnounced(h.id, moment());
      const token = await unsubscribeTokenFor(f.id);
      check("a link that is not ours stops nothing", !(await E.stopFollowEmailsWithToken("nonsense")) && !(await E.stopFollowEmailsWithToken("a".repeat(32))) && (await E.followEmailsOf(f.id)));
      check("the stop link switches these emails off for the account", (await E.stopFollowEmailsWithToken(token)) && !(await E.followEmailsOf(f.id)));
      const [me] = await db.select().from(schema.user).where(eq(schema.user.id, f.id));
      check("it leaves reminder emails as they were, and the ticks too", me.reminderEmails === true && (await line(f.id, h.id)).tellOnline && (await line(f.id, h.id)).tellPosts);
      check("and drops every one of these emails that was waiting", (await mail("stopf")).length === 1 && (await mail("stopf"))[0].status === "failed");
      await db.update(schema.follows).set({ toldOnlineAt: null }).where(eq(schema.follows.followerId, f.id));
      await switchOff(h.id, new Date(T0.getTime() + 21 * HOUR));
      check("nothing more is written while it is off", (await onAndAnnounced(h.id, moment())) === 0);
      await E.setFollowEmails(f.id, true);
      await switchOff(h.id, new Date(T0.getTime() + 22 * HOUR));
      check("switched on again on the account page, the choices are as they were and emails come again", (await onAndAnnounced(h.id, moment())) === 1);
      check("the stop link of reminders stops reminders and not these", (await unsubscribeWithToken(token)) && (await E.followEmailsOf(f.id)) && (await db.select().from(schema.user).where(eq(schema.user.id, f.id)))[0].reminderEmails === false);

      const pausedOne = await follower("pausedchoice", h.id, { online: true, posts: false }, { pausedAt: T0 });
      check("a paused person cannot switch an email on", await refused(E.saveChoices({ followerId: pausedOne.id, hostId: h.id, tellPosts: true, now: T0 }), "paused"));
      await E.saveChoices({ followerId: pausedOne.id, hostId: h.id, tellOnline: false, now: T0 });
      check("but can switch one off", (await line(pausedOne.id, h.id)).tellOnline === false);
      const stranger = await person("stranger");
      check("choices for a host one does not follow are refused, and nobody can set someone else's", (await refused(E.saveChoices({ followerId: stranger.id, hostId: h.id, tellOnline: true, now: T0 }), "do not follow")) && (await line(stranger.id, h.id)) === undefined);
      await switchOff(h.id, new Date(T0.getTime() + 23 * HOUR));
    }

    // ----------------------------------------------------------------------
    console.log("\n8. The diary email");
    {
      const h = await host("diary", "Diary Host");
      const f = await follower("diaryf", h.id, { posts: true });
      await follower("diaryno", h.id, { online: true });
      const young = await post(h.projectId, 10);
      check("a post is not announced before it is half an hour old", (await E.announcePosts(T0, [young.id])) === 0 && (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, young.id)))[0].announcedAt === null);
      const ripe = await post(h.projectId, 31, "SECRET WORDS of the host https://example.test/elsewhere");
      const wrote = await E.announcePosts(T0, [ripe.id]);
      const [email] = await mail("diaryf");
      check("after that it is, once, to the follower who ticked it and nobody else", wrote === 1 && (await mail("diaryf")).length === 1 && (await mail("diaryno")).length === 0);
      check("the email names the host and links to the diary", email.subject === "Diary Host wrote in their diary" && email.body.includes(`/h/${h.handle}/project/${h.projectId}`) && email.kind === "follow");
      check("and carries nothing the host wrote: not the post, not its link, not the project's name", !email.body.includes("SECRET") && !email.body.includes("example.test/elsewhere") && !email.body.includes("Secret project"));
      check(`it runs out ${EMAILS.postExpiresHours} hours after it was written`, email.expiresAt?.getTime() === T0.getTime() + EMAILS.postExpiresHours * HOUR);
      check("the post is marked as announced, and is not announced again", (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, ripe.id)))[0].announcedAt !== null && (await E.announcePosts(T0, [ripe.id])) === 0);
      const secondPost = await post(h.projectId, 35);
      check("a second post the same day is not announced to someone who got the first", (await E.announcePosts(T0, [secondPost.id])) === 0 && (await mail("diaryf")).length === 1);

      const marked = async (id: string) => (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, id)))[0].announcedAt !== null;
      await db.update(schema.follows).set({ toldPostAt: null }).where(eq(schema.follows.followerId, f.id));
      const removed = await post(h.projectId, 40);
      await db.update(schema.projectPosts).set({ removedAt: T0 }).where(eq(schema.projectPosts.id, removed.id));
      const hidden = await post(h.projectId, 41);
      await db.update(schema.projectPosts).set({ hiddenAt: T0 }).where(eq(schema.projectPosts.id, hidden.id));
      const old = await post(h.projectId, EMAILS.postTooOldHours * 60 + 5);
      check("a post removed or hidden inside the half hour, and one that is too old, are marked as dealt with and nobody is told", (await E.announcePosts(T0, [removed.id, hidden.id, old.id])) === 0 && (await marked(removed.id)) && (await marked(hidden.id)) && (await marked(old.id)) && (await mail("diaryf")).length === 1);
      const [ended] = await db.insert(schema.projects).values({ hostId: h.id, name: "Ended", description: "", status: "ended", startedAt: T0, endedAt: T0, endedBy: "host" }).returning();
      projects.push(ended.id);
      const inEnded = await post(ended.id, 45);
      check("nor a post in a project that has ended", (await E.announcePosts(T0, [inEnded.id])) === 0 && (await marked(inEnded.id)));

      const [a, b] = [await post(h.projectId, 50), await post(h.projectId, 51)];
      const both = await together(f.id, [() => E.announcePosts(T0, [a.id]), () => E.announcePosts(T0, [b.id])]);
      check("two posts of one host announced at the same moment: one email", both.reached && both.wrote[0] + both.wrote[1] === 1 && (await mail("diaryf")).length === 2, both);
    }

    // ----------------------------------------------------------------------
    console.log("\n9. \"New in diaries\" on the home page");
    {
      const reader = await person("reader");
      const hosts = [await host("n1", "News One"), await host("n2", "News Two"), await host("n3", "News Three")];
      for (const h of hosts) await db.insert(schema.follows).values({ followerId: reader.id, hostId: h.id, how: "self" });
      const shown = await post(hosts[0].projectId, 5, "The newest post.");
      const older = await post(hosts[1].projectId, 60, "An older post.");
      const gone = await post(hosts[0].projectId, 6, "Removed.");
      await db.update(schema.projectPosts).set({ removedAt: T0 }).where(eq(schema.projectPosts.id, gone.id));
      const hid = await post(hosts[1].projectId, 7, "Hidden by Connect.");
      await db.update(schema.projectPosts).set({ hiddenAt: T0 }).where(eq(schema.projectPosts.id, hid.id));
      await post(hosts[2].projectId, 31 * 24 * 60, "Thirty-one days old.");
      // Older than the old limit of a week, and inside the 30 days.
      const weeksOld = await post(hosts[2].projectId, 20 * 24 * 60, "Twenty days old.");
      let news = await F.diaryNews(reader.id, T0);
      check("the posts of followed hosts from the last 30 days, the newest first", news.map((n) => n.postId).join() === [shown.id, older.id, weeksOld.id].join(), news.map((n) => n.text));
      check("with the host's name, the project and the way to the diary, and nothing else", news[0].hostName === "News One" && news[0].handle === hosts[0].handle && news[0].projectId === hosts[0].projectId && news[0].hostId === hosts[0].id && Object.keys(news[0]).sort().join() === "handle,hostId,hostName,postId,projectId,projectName,text,writtenAt");
      check("never a removed post, a hidden post or one older than 30 days", !news.some((n) => [gone.id, hid.id].includes(n.postId)) && !news.some((n) => n.text === "Thirty-one days old."));
      await db.insert(schema.blocks).values({ blockerId: hosts[0].id, blockedId: reader.id });
      check("a follower the host has blocked sees what any visitor could read: the same", (await F.diaryNews(reader.id, T0)).some((n) => n.postId === shown.id));
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, hosts[1].id));
      check("a host who hides their page is gone from it", !(await F.diaryNews(reader.id, T0)).some((n) => n.postId === older.id));
      await F.unfollow({ followerId: reader.id, hostId: hosts[0].id, now: T0 });
      check("and so is a host who is no longer followed", !(await F.diaryNews(reader.id, T0)).some((n) => n.postId === shown.id));
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, hosts[1].id));
      // One more than the limit, so the cut is really made.
      for (let i = 0; i < 11; i++) await post(hosts[2].projectId, 20 + i, `Post ${i}`);
      news = await F.diaryNews(reader.id, T0);
      check("ten at most", news.length === 10 && news[0].text === "Post 0");
      check("someone who follows nobody has none", (await F.diaryNews(hosts[0].id, T0)).length === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n10. Three cases from the review of the code");
    {
      /** Starts `work`, waits until it is waiting for this follower's lock (held here), does `meanwhile`, and lets go. */
      const whileItWaits = async (followerId: string, work: () => Promise<number>, meanwhile: () => Promise<unknown>) => {
        const waiting = async () => Number((await db.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and objid = (hashtext(${`follows:${followerId}`})::bigint & 4294967295)::oid`))[0].n);
        let round: Promise<number> = Promise.resolve(-1);
        let reached = false;
        await db.transaction(async (tx) => {
          await F.lockFollowers(tx, [followerId]);
          round = work();
          for (let i = 0; i < 200 && !(reached = (await waiting()) > 0); i++) await new Promise((resolve) => setTimeout(resolve, 25));
          await meanwhile();
        });
        return { wrote: await round, reached };
      };

      // An email a helper had already picked up when the yes was taken back.
      const h = await host("claimed");
      const f = await follower("claimedf", h.id, { online: true, posts: true });
      const lease = new Date(Date.now() + 2 * MINUTE);
      await db.insert(schema.emailOutbox).values({ to: f.email, kind: "follow", subject: "Picked up", body: "x", dedupeKey: `follow-online:${h.id}:${f.id}:7`, status: "sending", leaseUntil: lease });
      await E.saveChoices({ followerId: f.id, hostId: h.id, tellOnline: false, now: T0 });
      const [claimed] = await mail("claimedf");
      check("taking a yes back also closes an email a helper had already picked up, and takes its claim away", claimed.status === "failed" && claimed.leaseUntil === null);

      // Writing to one follower fails (here: the statement is cancelled while it waits). The announcement must stay.
      const at = moment();
      await db.update(schema.follows).set({ tellOnline: true }).where(eq(schema.follows.followerId, f.id));
      await switchOn(h.id, at);
      const announcement = (await calendar(h.id)).announceAt;
      const later = new Date(at.getTime() + 61 * SECOND);
      await keptOpen(h.id, later);
      console.log("       (one error is written to the log below, on purpose)");
      const broken = await whileItWaits(f.id, () => E.announceAvailable(later, [h.id]), async () => {
        await db.execute(sql`select pg_cancel_backend(pid) from pg_locks where locktype = 'advisory' and not granted and objid = (hashtext(${`follows:${f.id}`})::bigint & 4294967295)::oid`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      check("when writing to a follower fails, nothing is written and the announcement is kept for the next round", broken.reached && broken.wrote === 0 && (await calendar(h.id)).announceAt?.getTime() === announcement?.getTime() && (await mail("claimedf")).length === 1, broken);
      check("which then makes it", (await E.announceAvailable(new Date(later.getTime() + SECOND), [h.id])) === 1 && (await calendar(h.id)).announceAt === null && (await mail("claimedf")).length === 2);
      await switchOff(h.id, new Date(later.getTime() + MINUTE));

      // A post removed while its round is under way.
      const ripe = await post(h.projectId, 31);
      const removed = await whileItWaits(f.id, () => E.announcePosts(T0, [ripe.id]), () => db.update(schema.projectPosts).set({ removedAt: T0 }).where(eq(schema.projectPosts.id, ripe.id)));
      const after = await line(f.id, h.id);
      check("a post removed while its round is under way is not written about, and uses up nobody's diary email", removed.reached && removed.wrote === 0 && after.toldPostAt === null && (await mail("claimedf")).length === 2, removed);
      check("and is marked as dealt with", (await db.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, ripe.id)))[0].announcedAt !== null);
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const projectIds = projects.length ? projects : [randomUUID()];
    await db.delete(schema.emailOutbox).where(or(like(schema.emailOutbox.to, ONLY.toLike), like(schema.emailOutbox.to, `nowcheck-none-${RUN}%`)));
    await db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.userId, ids));
    const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)));
    await db.delete(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)));
    if (calls.length > 0) await db.delete(schema.calls).where(inArray(schema.calls.id, calls.map((c) => c.id)));
    await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.id, projectIds));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, ids));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
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
