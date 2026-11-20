/**
 * Testing tool: "Suggested hosts" (plans/37) against the local database. It makes its own people
 * and hosts, reads and writes nothing of any other account, needs neither Stripe nor the app
 * running, and removes what it made.
 *
 * The test database is shared with other work, whose hosts would turn up in a person's
 * suggestions. So every time suggestions are made here, the hosts that are looked at are limited
 * to this script's own (`among`, the one opening `makeSuggestions` has for this).
 *
 * Usage: npx tsx scripts/suggestions-check.ts
 *
 * With --app=http://localhost:3000 it also asks the running app for the home page itself, logged
 * in as a person it signs up: that drawing the page writes nothing, what the row shows, and what
 * it never shows. Only then it also clears the local "too many attempts" counters at the start and
 * the end of that part, as the other scripts that sign people up do, because every request here
 * comes from one network address. What only happens in a browser (the row appearing by itself,
 * cards being reported as seen, the X) is not covered here; it is tried by hand.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
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
  const S = await import("../src/lib/suggestions/suggestions");
  const { mix, SUGGEST, suggestionDay } = await import("../src/lib/suggestions/rules");

  const now = new Date();
  const day = suggestionDay(now);
  const made: string[] = [];
  const calls: string[] = [];

  async function person(name: string, extra: Partial<typeof schema.user.$inferInsert> = {}) {
    const id = `sg-${RUN}-${name}`;
    // Everyone here has had their account for a month, unless a check says otherwise: an account counts as a person behind a host only once it is at least three days old.
    await db.insert(schema.user).values({ id, name: `Person ${name} ${RUN}`, email: `suggestcheck-${RUN}-${name}@example.test`, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York", createdAt: new Date(now.getTime() - 30 * DAY), ...extra });
    made.push(id);
    return { id, name: `Person ${name} ${RUN}` };
  }
  /**
   * A host whose page is open and who has open times: free calls and a calendar open all week. `open` says how soon:
   * "week" (the next open time is tomorrow), "later" (in ten days), "now" (also available now), "never" (no calendar at all).
   */
  async function host(name: string, open: "week" | "later" | "now" | "never" = "week", extra: Partial<typeof schema.hostProfiles.$inferInsert> = {}, account: Partial<typeof schema.user.$inferInsert> = {}) {
    const p = await person(name, account);
    const handle = `sg${RUN}${name}`.toLowerCase();
    const displayName = `Host ${name} ${RUN}`;
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle, handleKey: handle, displayName, pricePer15Cents: 0, status: "approved", usConfirmedAt: now, ...extra });
    if (open !== "never") {
      await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "15,30", noticeHours: open === "later" ? 240 : 24, horizonWeeks: 4, breakMinutes: 5 });
      await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: p.id, weekday, startMinute: 0, endMinute: 1440 })));
      if (open === "now") {
        const at = new Date();
        await db.update(schema.hostCalendars).set({ availableUntil: new Date(at.getTime() + 60 * MINUTE), availableSeenAt: at }).where(eq(schema.hostCalendars.userId, p.id));
      }
    }
    return { ...p, handle, displayName };
  }
  /**
   * A new person for whom, today, `first` comes before `second` when the two have equal points. So a check can tell
   * "equal points" (the day's own order decides) from "more points" (the points decide), whatever the day's order is.
   */
  async function personPreferring(name: string, first: { id: string }, second: { id: string }) {
    for (let n = 0; n < 500; n++) if (mix(`sg-${RUN}-${name}${n}`, first.id, day) < mix(`sg-${RUN}-${name}${n}`, second.id, day)) return person(`${name}${n}`);
    throw new Error("no such person found");
  }
  const follow = (followerId: string, hostId: string, ended = false) => db.insert(schema.follows).values({ followerId, hostId, how: "self", unfollowedAt: ended ? now : null });
  const blockRow = (blockerId: string, blockedId: string) => db.insert(schema.blocks).values({ blockerId, blockedId });
  /** What was written for a person today: the day's line, and its hosts in their places. */
  async function written(viewerId: string, onDay = day) {
    const days = await db.select().from(schema.suggestionDays).where(and(eq(schema.suggestionDays.viewerId, viewerId), eq(schema.suggestionDays.day, onDay)));
    const shows = await db.select().from(schema.suggestionShows).where(and(eq(schema.suggestionShows.viewerId, viewerId), eq(schema.suggestionShows.day, onDay))).orderBy(schema.suggestionShows.place);
    return { days, shows, hosts: shows.map((show) => show.hostId) };
  }
  /** Makes the suggestions of a person afresh, among these hosts only. */
  async function suggest(viewerId: string, among: Array<{ id: string }>) {
    await db.delete(schema.suggestionDays).where(eq(schema.suggestionDays.viewerId, viewerId));
    await S.makeSuggestions(viewerId, new Date(), among.map((h) => h.id));
    return written(viewerId);
  }
  /** Another person really saw this host's suggestion, so many days ago. */
  async function sawIt(viewerId: string, hostId: string, daysAgo = 1, place = 1) {
    const at = new Date(now.getTime() - daysAgo * DAY);
    const on = suggestionDay(at);
    await db.insert(schema.suggestionDays).values({ viewerId, day: on, ruleVersion: SUGGEST.ruleVersion, madeAt: at }).onConflictDoNothing();
    await db.insert(schema.suggestionShows).values({ viewerId, day: on, place, hostId, seenAt: at });
  }

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. The example of the plan");
    const viewer = await person("viewer");
    const anna = await host("anna");
    const [ben, carla, dan] = [await person("ben"), await person("carla"), await person("dan")];
    const david = await host("david");
    const emma = await host("emma");
    const frank = await host("frank", "now");
    await follow(viewer.id, anna.id);
    for (const p of [ben, carla, dan]) await follow(p.id, anna.id);
    await follow(ben.id, david.id);
    await follow(carla.id, david.id);
    await follow(ben.id, emma.id);
    const trio = [david, emma, frank];
    {
      const people = await S.peopleBehind(viewer.id, trio.map((h) => h.id), new Date());
      check("two people pointing at a host are counted as two, which is below the bar", people.get(david.id) === 2 && people.get(emma.id) === 1 && !people.has(frank.id), JSON.stringify([...people]));
      // Someone for whom Emma comes before David whenever the two have equal points.
      const tied = await personPreferring("tie", emma, david);
      await follow(tied.id, anna.id);
      let result = await suggest(tied.id, trio);
      check("with two people behind David he gets nothing from them: he and Emma have equal points, so the day's own order decides, and it puts Emma first", result.hosts.join() === [frank.id, emma.id, david.id].join(), result.hosts.join());
      await follow(dan.id, david.id);
      check("a third person brings the number to three", (await S.peopleBehind(viewer.id, trio.map((h) => h.id), new Date())).get(david.id) === 3);
      result = await suggest(tied.id, trio);
      check("now the points decide, for the same person on the same day: David comes before Emma", result.hosts.join() === [frank.id, david.id, emma.id].join(), result.hosts.join());
      result = await suggest(viewer.id, trio);
      check("the order of the example: Frank (free now), David (three people), Emma", result.hosts.join() === [frank.id, david.id, emma.id].join(), result.hosts.join());
      check("one line for the day, with the rule's version, and each host in its place", result.days.length === 1 && result.days[0].ruleVersion === SUGGEST.ruleVersion && result.shows.map((s) => s.place).join() === "1,2,3");
      check("place 3 is a kept place, 1 and 2 are not", result.shows.map((s) => s.kept).join() === "false,false,true");
      check("nothing is marked as seen yet", result.shows.every((s) => s.seenAt === null));
      check("the host the person follows is never suggested to them", !(await suggest(viewer.id, [anna, ...trio])).hosts.includes(anna.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Who counts as a person behind a host");
    {
      const count = async () => (await S.peopleBehind(viewer.id, [david.id], new Date())).get(david.id) ?? 0;
      const zed = await host("zed");
      await follow(viewer.id, zed.id);
      await follow(ben.id, zed.id);
      check("a person who shares two hosts with the viewer still counts once", (await count()) === 3);
      // A host who blocks a follower leaves the follow standing (plans/30), so it has to be left out here.
      await blockRow(anna.id, viewer.id);
      check("a host who has blocked the viewer is no longer one of 'your hosts', though the follow is still there: only Ben, through the other shared host, is left", (await count()) === 1);
      await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, anna.id), eq(schema.blocks.blockedId, viewer.id)));
      check("without the block, all three count again", (await count()) === 3);
      const gone = await person("gone");
      await follow(gone.id, anna.id);
      await follow(gone.id, david.id, true);
      check("an ended follow of the host does not count", (await count()) === 3);
      await db.update(schema.follows).set({ unfollowedAt: null }).where(and(eq(schema.follows.followerId, gone.id), eq(schema.follows.hostId, david.id)));
      check("the same follow, not ended, counts", (await count()) === 4);
      await db.update(schema.follows).set({ unfollowedAt: now }).where(and(eq(schema.follows.followerId, gone.id), eq(schema.follows.hostId, anna.id)));
      check("a person who no longer follows the shared host does not count", (await count()) === 3);
      await db.update(schema.follows).set({ unfollowedAt: null }).where(and(eq(schema.follows.followerId, gone.id), eq(schema.follows.hostId, anna.id)));
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, gone.id));
      check("a person whose account is closed does not count", (await count()) === 3);
      await db.update(schema.user).set({ closedAt: null, pausedAt: now }).where(eq(schema.user.id, gone.id));
      check("nor one whose account is paused", (await count()) === 3);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, gone.id));
      await blockRow(david.id, gone.id);
      check("a follow of a host who has blocked that person does not count", (await count()) === 3);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockedId, gone.id));
      await blockRow(gone.id, anna.id);
      check("nor does a person with a block between them and the shared host", (await count()) === 3);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, gone.id));
      check("with nothing in the way, the person counts again", (await count()) === 4);
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, anna.id));
      check("a followed host whose page is hidden is not one of 'your hosts': only Ben, through the other shared host, is left", (await count()) === 1);
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, anna.id));
      await follow(viewer.id, emma.id);
      check("the viewer themselves is never one of the people behind a host", (await S.peopleBehind(viewer.id, [emma.id], new Date())).get(emma.id) === 1);
      await db.delete(schema.follows).where(and(eq(schema.follows.followerId, viewer.id), eq(schema.follows.hostId, emma.id)));
      // An account made to supply one of the three people oneself counts for nothing at first.
      const fresh = await person("fresh", { createdAt: new Date() });
      await follow(fresh.id, anna.id);
      await follow(fresh.id, david.id);
      const aged = (ms: number) => db.update(schema.user).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.user.id, fresh.id));
      check("a person whose account was made today does not count", (await count()) === 4);
      await aged(SUGGEST.minAccountDays * DAY - 5 * MINUTE);
      check(`nor one whose account is a little under ${SUGGEST.minAccountDays} days old`, (await count()) === 4);
      await aged(SUGGEST.minAccountDays * DAY + 5 * MINUTE);
      check(`from ${SUGGEST.minAccountDays} days on they count like anyone else`, (await count()) === 5);
      // To the moment: asked with a fixed clock, exactly so many days after the account was made, and one millisecond before.
      const madeAt = new Date(Date.now() - 10 * DAY);
      await db.update(schema.user).set({ createdAt: madeAt }).where(eq(schema.user.id, fresh.id));
      const at = async (moment: number) => (await S.peopleBehind(viewer.id, [david.id], new Date(moment))).get(david.id) ?? 0;
      const turns = madeAt.getTime() + SUGGEST.minAccountDays * DAY;
      check(`exactly ${SUGGEST.minAccountDays} days after the account was made it counts, a moment before it does not`, (await at(turns)) === 5 && (await at(turns - 1)) === 4, `${await at(turns - 1)} then ${await at(turns)}`);
      await db.update(schema.follows).set({ unfollowedAt: now }).where(and(eq(schema.follows.followerId, fresh.id), eq(schema.follows.hostId, david.id)));
      const loner = await person("loner");
      check("someone who follows nobody has nobody behind any host", (await S.peopleBehind(loner.id, [david.id, emma.id], new Date())).size === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Who can be suggested at all");
    {
      const seeker = await person("seeker");
      const control = await host("control");
      const cases: Array<[string, { id: string; handle: string }]> = [];
      const add = async (label: string, h: Promise<{ id: string; handle: string }>) => {
        const made = await h;
        cases.push([label, made]);
        return made;
      };
      await add("a host with no open time at all", host("notime", "never"));
      await add("a host whose page is hidden", host("hidden", "week", { hidden: true }));
      await add("a host who is not approved", host("pending", "week", { status: "pending" }));
      await add("a host who is suspended", host("suspended", "week", { status: "suspended" }));
      await add("a host whose account is paused", host("pausedh", "week", {}, { pausedAt: now }));
      await add("a host whose account is closed", host("closedh", "week", {}, { closedAt: now }));
      const blockedThem = await add("a host the person has blocked", host("iblocked"));
      await blockRow(seeker.id, blockedThem.id);
      const blockedMe = await add("a host who has blocked the person", host("blockedme"));
      await blockRow(blockedMe.id, seeker.id);
      const followed = await add("a host the person follows", host("followed"));
      await follow(seeker.id, followed.id);
      const unfollowed = await add("a host the person has unfollowed", host("unfollowed"));
      await follow(seeker.id, unfollowed.id, true);
      const called = await add("a host the person has had a call with", host("called"));
      const guest = await add("a host who was once the person's customer", host("guest"));
      for (const [hostId, customerId] of [
        [called.id, seeker.id],
        [seeker.id, guest.id],
      ]) {
        const startsAt = new Date(Math.floor((now.getTime() - 3 * DAY) / 1000) * 1000);
        const [c] = await db.insert(schema.calls).values({ hostId, customerId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), roomName: `suggest-${randomUUID()}`, closedAt: startsAt }).returning();
        calls.push(c.id);
      }
      const asked = await add("a host the person has sent a request to", host("asked"));
      {
        const startsAt = new Date(Math.floor((now.getTime() + 3 * DAY) / 1000) * 1000);
        await db.insert(schema.bookings).values({ hostId: asked.id, customerId: seeker.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "taken_back", requestKey: randomUUID(), requestedAt: now, endedAt: now });
      }
      const member = await add("a host the person was a member of", host("member"));
      await db.insert(schema.memberships).values({ hostId: member.id, customerId: seeker.id, status: "ended", endedAt: now, endedBy: "host", endedReason: "check" });
      const reportedHost = await add("a host the person has reported", host("reported"));
      await db.insert(schema.reports).values({ reporterId: seeker.id, reportedId: reportedHost.id, context: "profile", contextId: reportedHost.id, reason: "other", text: "check" });
      const hiddenByX = await add("a host the person hid with the X", host("xed"));
      // The X is only for a host who was suggested: so they are suggested once, and then hidden.
      await suggest(seeker.id, [hiddenByX]);
      await S.hideSuggestion(seeker.id, hiddenByX.handle, now);
      const seekerHost = await db.insert(schema.hostProfiles).values({ userId: seeker.id, handle: `sg${RUN}seeker`, handleKey: `sg${RUN}seeker`, displayName: "Seeker as host", pricePer15Cents: 0, status: "approved", usConfirmedAt: now }).returning();
      // With a calendar of their own, so that only the rule about oneself can keep them out.
      await db.insert(schema.hostCalendars).values({ userId: seeker.id, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 4, breakMinutes: 5 });
      await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: seeker.id, weekday, startMinute: 0, endMinute: 1440 })));
      cases.push(["the person themselves", { id: seeker.id, handle: seekerHost[0].handle }]);

      const result = await suggest(seeker.id, [control, ...cases.map(([, h]) => h)]);
      check("a host with an open page and an open time, whom the person does not know, is suggested", result.hosts.includes(control.id));
      for (const [label, h] of cases) check(`never ${label}`, !result.hosts.includes(h.id));
      check("so exactly one host is left", result.hosts.length === 1, result.hosts.join());

      const other = await person("otherseeker");
      const forOther = await suggest(other.id, [control, hiddenByX, followed, blockedThem]);
      check("an X, a follow and a block are the person's own: someone else is still suggested those hosts", [control, hiddenByX, followed, blockedThem].every((h) => forOther.hosts.includes(h.id)), forOther.hosts.join());
      const pausedViewer = await person("pausedviewer", { pausedAt: now });
      const forPaused = await suggest(pausedViewer.id, [control]);
      check("a paused person gets none, and the day is written so it is not worked out again", forPaused.days.length === 1 && forPaused.hosts.length === 0);

      await S.hideSuggestion(seeker.id, "no-such-handle", now);
      await S.hideSuggestion(seeker.id, seekerHost[0].handle, now);
      await S.hideSuggestion(seeker.id, hiddenByX.handle.toUpperCase(), now);
      await S.hideSuggestion(seeker.id, followed.handle, now);
      await S.hideSuggestion(seeker.id, blockedMe.handle, now);
      await S.hideSuggestion(seeker.id, "x".repeat(5000), now);
      const hides = await db.select().from(schema.suggestionHides).where(eq(schema.suggestionHides.viewerId, seeker.id));
      check("the X writes one line per host; an unknown handle, an endless one and one's own page are quietly nothing", hides.length === 1 && hides[0].hostId === hiddenByX.id);
      check("and a host who was never suggested to the person cannot be hidden by them", !hides.some((h) => [followed.id, blockedMe.id].includes(h.hostId)));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. The six places, and the hosts seen the least");
    {
      const chooser = await person("chooser");
      const free: Array<Awaited<ReturnType<typeof host>>> = [];
      for (let i = 0; i < 6; i++) free.push(await host(`free${i}`, "now"));
      const quiet = [await host("quiet0"), await host("quiet1")];
      const far = await host("far", "later");
      const watchers = [await person("w0"), await person("w1"), await person("w2")];
      // Every host who is free now was really seen by two people this week; the two quiet ones by nobody.
      for (const [i, h] of free.entries()) for (const w of watchers.slice(0, 2)) await sawIt(w.id, h.id, 1, i + 1);
      // The host whose open time is far away was seen by more people than anyone, so a kept place never falls to them here.
      for (const w of watchers) await sawIt(w.id, far.id, 4, 1);
      const result = await suggest(chooser.id, [...free, ...quiet, far]);
      check("six hosts at most, in places 1 to 6, none twice", result.shows.map((s) => s.place).join() === "1,2,3,4,5,6" && new Set(result.hosts).size === 6, result.hosts.length.toString());
      check("places 1, 2, 4 and 5 go to the most points (the hosts who are free now)", [0, 1, 3, 4].every((i) => free.some((h) => h.id === result.hosts[i])));
      check("places 3 and 6 are kept for the hosts seen by the fewest people", [2, 5].every((i) => quiet.some((h) => h.id === result.hosts[i])) && result.shows.filter((s) => s.kept).map((s) => s.place).join() === "3,6", result.shows.filter((s) => quiet.some((h) => h.id === s.hostId)).map((s) => s.place).join());
      check("a host whose next open time is more than a week away can be suggested", !result.hosts.includes(far.id) && (await suggest(chooser.id, [far])).hosts.join() === far.id);
      // Someone for whom the far host would come first on equal points: so coming second means fewer points.
      const farFan = await personPreferring("farfan", far, quiet[0]);
      check("but gets no points for it: a host who is free this week comes before them", (await suggest(farFan.id, [far, quiet[0]])).hosts.join() === [quiet[0].id, far.id].join());

      const seen = async (h: { id: string }) => (await S.seenBy([h.id], now)).get(h.id) ?? 0;
      check("'seen' counts different people", (await seen(free[0])) === 2);
      await sawIt(watchers[0].id, free[0].id, 2, 2);
      await sawIt(watchers[0].id, free[0].id, 3, 2);
      check("not looks: the same person on three days is one", (await seen(free[0])) === 2);
      await sawIt(watchers[2].id, free[0].id, SUGGEST.seenDays + 1, 1);
      check(`and only the last ${SUGGEST.seenDays} days`, (await seen(free[0])) === 2);
      await db.insert(schema.suggestionShows).values({ viewerId: watchers[2].id, day: suggestionDay(new Date(now.getTime() - (SUGGEST.seenDays + 1) * DAY)), place: 2, hostId: quiet[0].id });
      check("a card that was suggested but never came into view does not count", (await seen(quiet[0])) === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Once a day");
    {
      const daily = await person("daily");
      const first = await host("first");
      const late = await host("late", "now");
      let result = await suggest(daily.id, [first]);
      check("the day's suggestions are written", result.hosts.join() === first.id);
      await S.makeSuggestions(daily.id, new Date(), [first.id, late.id]);
      result = await written(daily.id);
      check("asking again the same day changes nothing, also when a better host has appeared", result.days.length === 1 && result.hosts.join() === first.id);

      const twice = await person("twice");
      const outcomes = await Promise.allSettled([S.makeSuggestions(twice.id, new Date(), [first.id, late.id]), S.makeSuggestions(twice.id, new Date(), [first.id, late.id]), S.makeSuggestions(twice.id, new Date(), [first.id, late.id])]);
      result = await written(twice.id);
      check("three requests at the same moment make one complete day, and none fails", outcomes.every((o) => o.status === "fulfilled") && result.days.length === 1 && result.hosts.join() === [late.id, first.id].join(), outcomes.map((o) => o.status).join());

      const nobody = await person("nobody");
      result = await suggest(nobody.id, []);
      check("a day with no fitting host is written too", result.days.length === 1 && result.hosts.length === 0);
      await S.makeSuggestions(nobody.id, new Date(), [first.id]);
      check("and is not worked out again that day", (await written(nobody.id)).hosts.length === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. What the page is given, and what changes during the day");
    {
      const reader = await person("reader");
      const hosts = [await host("r0", "now"), await host("r1"), await host("r2"), await host("r3"), await host("r4")];
      check("before anything is made, the page is told so", !(await S.todaysSuggestions(reader.id, new Date())).made);
      const before = await written(reader.id);
      check("and reading for the page writes nothing", before.days.length === 0 && before.shows.length === 0);
      const result = await suggest(reader.id, hosts);
      let shown = await S.todaysSuggestions(reader.id, new Date());
      check("the page gets the day's hosts in their places", shown.made && shown.day === day && shown.hosts.map((h) => h.hostId).join() === result.hosts.join() && shown.hosts.map((h) => h.place).join() === "1,2,3,4,5");
      const top = shown.hosts[0];
      check("each with what a card shows: name, handle, price, languages, rating, and the open time worked out now", top.hostId === hosts[0].id && top.displayName === hosts[0].displayName && top.handle === hosts[0].handle && top.pricePer15Cents === 0 && Array.isArray(top.languages) && top.rating === null && top.open.availableNow && shown.hosts[1].open.nextOpen !== null && !shown.hosts[1].open.availableNow);
      check("and nothing about the people behind a host", !Object.keys(top).some((key) => /people|follow|seenBy|points/i.test(key)), Object.keys(top).join());

      const [a, b, c, d] = result.hosts.slice(1);
      await follow(reader.id, a);
      shown = await S.todaysSuggestions(reader.id, new Date());
      check("a host the person follows during the day is gone from the row", !shown.hosts.some((h) => h.hostId === a) && shown.hosts.length === 4);
      await S.hideSuggestion(reader.id, hosts.find((h) => h.id === b)!.handle, now);
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, c));
      await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, d));
      shown = await S.todaysSuggestions(reader.id, new Date());
      check("so is one they hid, one whose page closed, and one with no open time left", shown.hosts.map((h) => h.hostId).join() === hosts[0].id, shown.hosts.map((h) => h.handle).join());
      check("the places that emptied are not filled again that day, and the lines stay as they were written", (await written(reader.id)).hosts.join() === result.hosts.join());
      await blockRow(hosts[0].id, reader.id);
      check("a host who blocks the person during the day is gone too", (await S.todaysSuggestions(reader.id, new Date())).hosts.length === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n7. Marking a card as seen");
    {
      const mine = await person("mine");
      const theirs = await person("theirs");
      const hosts = [await host("s0", "now"), await host("s1"), await host("s2")];
      await suggest(mine.id, hosts);
      await suggest(theirs.id, hosts);
      await S.markSeen(mine.id, day, [1, 3], now);
      let rows = await written(mine.id);
      check("the cards in the named places are marked, the others are not", rows.shows.map((s) => s.seenAt !== null).join() === "true,false,true");
      check("nobody else's lines are touched", (await written(theirs.id)).shows.every((s) => s.seenAt === null));
      const later = new Date(now.getTime() + 5 * MINUTE);
      await S.markSeen(mine.id, day, [1, 2], later);
      rows = await written(mine.id);
      check("a card is marked once: the first time stands", rows.shows[0].seenAt?.getTime() === now.getTime() && rows.shows[1].seenAt?.getTime() === later.getTime());
      await S.markSeen(theirs.id, "2020-01-01", [1, 2, 3], now);
      await S.markSeen(theirs.id, "not a day", [1], now);
      await S.markSeen(theirs.id, day, [0, 7, 1.5, -1, Number.NaN], now);
      check("another day, something that is not a day, and places that do not exist mark nothing", (await written(theirs.id)).shows.every((s) => s.seenAt === null));
      const shown = await S.todaysSuggestions(mine.id, new Date());
      check("the page knows which cards are already marked", shown.hosts.map((h) => h.seen).join() === "true,true,true");
    }

    // ----------------------------------------------------------------------
    console.log("\n8. What is deleted, and when");
    {
      const keeper = await person("keeper");
      const h = await host("kept");
      const old = suggestionDay(new Date(now.getTime() - (SUGGEST.keepDays + 2) * DAY));
      const recent = suggestionDay(new Date(now.getTime() - (SUGGEST.keepDays - 2) * DAY));
      for (const on of [old, recent]) {
        await db.insert(schema.suggestionDays).values({ viewerId: keeper.id, day: on, ruleVersion: SUGGEST.ruleVersion, madeAt: now });
        await db.insert(schema.suggestionShows).values({ viewerId: keeper.id, day: on, place: 1, hostId: h.id });
      }
      await S.hideSuggestion(keeper.id, h.handle, new Date(now.getTime() - 400 * DAY));
      // Limited to this script's own person: nothing of another session is looked at or deleted.
      const removed = await S.removeOldSuggestions(now, [keeper.id]);
      check(`what was suggested more than ${SUGGEST.keepDays} days ago is deleted, the day and its hosts`, removed === 1 && (await written(keeper.id, old)).days.length === 0 && (await written(keeper.id, old)).shows.length === 0);
      check("what is newer stays", (await written(keeper.id, recent)).shows.length === 1);
      check("an X is kept, however old", (await db.select().from(schema.suggestionHides).where(eq(schema.suggestionHides.viewerId, keeper.id))).length === 1);

      const leaver = await person("leaver");
      await suggest(leaver.id, [h]);
      await S.hideSuggestion(leaver.id, h.handle, now);
      await db.delete(schema.user).where(eq(schema.user.id, leaver.id));
      const left = await db.select().from(schema.suggestionDays).where(eq(schema.suggestionDays.viewerId, leaver.id));
      const leftShows = await db.select().from(schema.suggestionShows).where(eq(schema.suggestionShows.viewerId, leaver.id));
      const leftHides = await db.select().from(schema.suggestionHides).where(eq(schema.suggestionHides.viewerId, leaver.id));
      check("deleting an account deletes its suggestions and its X's with it", left.length === 0 && leftShows.length === 0 && leftHides.length === 0);
    }

    // ----------------------------------------------------------------------
    if (!APP) {
      console.log("\n9. The page itself: skipped (run with --app=http://localhost:3000 and the app running)");
    } else {
      console.log("\n9. The page itself");
      type Jar = Map<string, string>;
      const send = async (path: string, options: { body?: unknown; jar?: Jar } = {}) => {
        const headers: Record<string, string> = { origin: APP };
        if (options.body !== undefined) headers["content-type"] = "application/json";
        if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
        const response = await fetch(path.startsWith("http") ? path : `${APP}${path}`, { method: options.body !== undefined ? "POST" : "GET", headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, redirect: "manual" });
        for (const cookie of response.headers.getSetCookie()) {
          const [pair, ...attributes] = cookie.split(";");
          const at = pair.indexOf("=");
          if (!pair.slice(at + 1) || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) options.jar?.delete(pair.slice(0, at).trim());
          else options.jar?.set(pair.slice(0, at).trim(), pair.slice(at + 1));
        }
        return { status: response.status, text: await response.text() };
      };
      const words = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
      await db.delete(schema.rateLimit);
      const login = { name: `Page Viewer ${RUN}`, email: `suggestcheck-${RUN}-page@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
      await send("/api/auth/sign-up/email", { body: { name: login.name, email: login.email, password: login.password, callbackURL: "/welcome" } });
      let link = "";
      for (let i = 0; i < 25 && !link; i++) {
        const found = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, login.email), like(schema.emailOutbox.subject, "%Confirm your email%"))).orderBy(desc(schema.emailOutbox.createdAt));
        link = found[0]?.body.match(/https?:\/\/\S+/)?.[0] ?? "";
        if (!link) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!link) throw new Error("No confirmation email for the page's viewer");
      await send(link, { jar: login.jar });
      const [row] = await db.select().from(schema.user).where(eq(schema.user.email, login.email));
      made.push(row.id);
      await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
      // The example again, for this person: they follow Anna; Ben, Carla and Dan are behind David.
      await follow(row.id, anna.id);

      let home = await send("/", { jar: login.jar });
      check("the home page loads for someone with no suggestions yet, without the row", home.status === 200 && !home.text.includes("data-suggested="), String(home.status));
      const afterDrawing = await written(row.id);
      check("drawing the page writes nothing", afterDrawing.days.length === 0 && afterDrawing.shows.length === 0);

      await S.makeSuggestions(row.id, new Date(), trio.map((h) => h.id));
      home = await send("/", { jar: login.jar });
      const section = home.text.replace(/<script[\s\S]*?<\/script>/g, " ").match(/<section[^>]*data-suggested=[\s\S]*?<\/section>/)?.[0] ?? "";
      const order = [...section.matchAll(/data-suggested-host="([^"]+)"/g)].map((m) => m[1]);
      // By now four people are behind David (part 2 added one): 12 points, which puts him ahead of the host who is free now, as the plan's example says.
      check("the row shows the day's hosts in their order: with a fourth person behind him, David comes before the host who is free now", order.join() === [david, frank, emma].map((h) => h.handle).join(), order.join());
      const text = words(section);
      check("each with name, 'New on Connect', the price and the open time", [frank, david, emma].every((h) => text.includes(h.displayName)) && text.includes("New on Connect") && text.includes("Free calls") && text.includes("Available now") && text.includes("Next open time:"));
      check("an X for each, and the same explanation for everyone", (section.match(/aria-label="Hide /g) ?? []).length === 3 && text.includes("Why these hosts?") && text.includes("Two places are kept for hosts who have been shown less often."));
      const whole = words(home.text);
      check("the page never names the people behind a suggestion", ![ben, carla, dan].some((p) => home.text.includes(p.name) || home.text.includes(p.id)));
      check("and never says how many they are, or how many followers anyone has", !/\b\d+ (people|followers?)\b/i.test(whole) && !/followers?\b/i.test(text));
      check("drawing the page again still writes nothing new", (await written(row.id)).shows.length === 3 && (await written(row.id)).shows.every((s) => s.seenAt === null));

      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, row.id));
      check("a paused person's home page has no row", !(await send("/", { jar: login.jar })).text.includes("data-suggested="));
      await db.delete(schema.rateLimit);
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
    await db.delete(schema.suggestionHides).where(or(inArray(schema.suggestionHides.viewerId, ids), inArray(schema.suggestionHides.hostId, ids)));
    await db.delete(schema.suggestionDays).where(inArray(schema.suggestionDays.viewerId, ids));
    await db.delete(schema.suggestionShows).where(inArray(schema.suggestionShows.hostId, ids));
    await db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    await db.delete(schema.memberships).where(or(inArray(schema.memberships.hostId, ids), inArray(schema.memberships.customerId, ids)));
    await db.delete(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)));
    await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `suggestcheck-${RUN}-%`));
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
