/**
 * Testing tool: the ratings, search, contacts and host-notes journeys against
 * the local database. It makes its own people, hosts and calls (with the
 * "connected / disconnected" messages a real call leaves behind), touches no
 * other account, needs neither Stripe nor the app running, and removes what it made.
 *
 * Usage: npx tsx scripts/ratings-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

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
  const R = await import("../src/lib/ratings/ratings");
  const { RatingError } = R;
  const { averageText } = await import("../src/lib/ratings/rules");
  const { searchHosts } = await import("../src/lib/profiles/search");
  const P = await import("../src/lib/people/contacts");
  const { NoteError } = P;

  const now = new Date();
  const made: string[] = [];
  const calls: string[] = [];

  async function person(name: string) {
    const id = `rt-${RUN}-${name}`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email: `ratecheck-${RUN}-${name}@example.test`, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Check ${name}` };
  }
  async function host(name: string, displayName: string, handle: string, extra: Partial<typeof schema.hostProfiles.$inferInsert> = {}) {
    const p = await person(name);
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle, handleKey: handle.replace(/_/g, ""), displayName, pricePer15Cents: 2000, status: "approved", usConfirmedAt: now, ...extra });
    return { ...p, handle, displayName };
  }
  async function social(userId: string, network: string, nameKey: string, confirmed: boolean) {
    await db.insert(schema.socialAccounts).values({ userId, network, nameTyped: nameKey, nameKey, url: `https://example.test/${nameKey}`, code: `connect-${randomUUID().slice(0, 10)}`, codeExpiresAt: new Date(now.getTime() + DAY), claimedAt: now, confirmedAt: confirmed ? now : null });
  }
  /**
   * A call that ended `endedMinutesAgo` ago, with its booking, as the helper leaves it once the room is closed.
   * `host` and `customer` say when each connected and left, in seconds from the start (null: never joined).
   */
  async function call(input: {
    hostId: string;
    customerId: string;
    endedMinutesAgo?: number;
    source?: string;
    host?: [number, number] | null;
    customer?: [number, number] | null;
    cancelled?: boolean;
    safetyEnded?: boolean;
    closed?: boolean;
  }) {
    const endsAt = new Date(Math.floor((now.getTime() - (input.endedMinutesAgo ?? 10) * MINUTE) / 1000) * 1000);
    const startsAt = new Date(endsAt.getTime() - 30 * MINUTE);
    const [c] = await db
      .insert(schema.calls)
      .values({
        hostId: input.hostId,
        customerId: input.customerId,
        startsAt,
        endsAt,
        roomName: `rate-${randomUUID()}`,
        closedAt: input.closed === false ? null : new Date(endsAt.getTime() + MINUTE),
        cancelledAt: input.cancelled ? startsAt : null,
        cancelledBy: input.cancelled ? "host" : null,
        safetyEndedAt: input.safetyEnded ? new Date(startsAt.getTime() + 5 * MINUTE) : null,
      })
      .returning();
    calls.push(c.id);
    await db.insert(schema.bookings).values({ hostId: input.hostId, customerId: input.customerId, startsAt, endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "accepted", source: input.source ?? "customer", requestKey: randomUUID(), requestedAt: input.source === "admin" ? null : startsAt, decidedAt: startsAt, callId: c.id });
    const connections: Array<[string, [number, number] | null | undefined]> = [
      [input.hostId, input.host === undefined ? [0, 600] : input.host],
      [input.customerId, input.customer === undefined ? [0, 600] : input.customer],
    ];
    for (const [who, span] of connections) {
      if (!span) continue;
      const session = `PA_${randomUUID().slice(0, 12)}`;
      for (const [type, at] of [["participant_joined", span[0]], ["participant_left", span[1]]] as const) {
        await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `rate-${randomUUID()}`, callId: c.id, type, participantIdentity: who, participantSessionId: session, providerTime: new Date(startsAt.getTime() + at * 1000), payload: "{}" });
      }
    }
    return c;
  }
  const refused = async (work: Promise<unknown>, words: string) => {
    const error = await work.then(() => null).catch((e) => e);
    return error instanceof RatingError && error.message.includes(words) ? true : (console.log(`       got: ${error?.message ?? "no error"}`), false);
  };
  const hostAverage = async (id: string, at = now) => averageText(await R.averageFor(id, "host", at));
  const customerAverage = async (id: string, at = now) => averageText(await R.averageFor(id, "customer", at));

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Rating a call that happened");
    const hana = await host("hana", "Hana Rate", `rt${RUN}hana`);
    {
      const ann = await person("ann");
      const stranger = await person("stranger");
      const c = await call({ hostId: hana.id, customerId: ann.id });
      check("a call both were in for 10 minutes can be rated", (await R.ratingStateOf(c, now)) === "open");
      check("a stranger cannot rate it, and learns nothing about it", await refused(R.rateCall({ callId: c.id, raterId: stranger.id, stars: 5, now }), "Call not found"));
      check("only whole stars from 1 to 5 are accepted", (await refused(R.rateCall({ callId: c.id, raterId: ann.id, stars: 6, now }), "1 to 5")) && (await refused(R.rateCall({ callId: c.id, raterId: ann.id, stars: 2.5, now }), "1 to 5")));
      await R.rateCall({ callId: c.id, raterId: ann.id, stars: 4, now });
      const [saved] = await db.select().from(schema.ratings).where(eq(schema.ratings.callId, c.id));
      check("the customer's rating is of the host, as a host: taken from the call, not from the browser", saved.raterId === ann.id && saved.ratedId === hana.id && saved.ratedAs === "host" && saved.stars === 4);
      check("the customer sees their own rating, the host sees none of their own yet", (await R.myRating(c.id, ann.id)) === 4 && (await R.myRating(c.id, hana.id)) === null);
      check("a second rating of the same call is refused; the first stands", (await refused(R.rateCall({ callId: c.id, raterId: ann.id, stars: 1, now }), "already rated")) && (await R.myRating(c.id, ann.id)) === 4);
      await R.rateCall({ callId: c.id, raterId: hana.id, stars: 5, now });
      const mine = await db.select().from(schema.ratings).where(eq(schema.ratings.raterId, hana.id));
      check("the host's rating is of the customer, as a customer", mine.length === 1 && mine[0].ratedId === ann.id && mine[0].ratedAs === "customer");
      const both = await Promise.allSettled([1, 2, 3].map(() => R.rateCall({ callId: c.id, raterId: hana.id, stars: 3, now })));
      check("pressing the button again and again changes nothing", both.every((r) => r.status === "rejected") && (await R.myRating(c.id, hana.id)) === 5);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Calls that cannot be rated");
    {
      const bob = await person("bob");
      const state = async (input: Parameters<typeof call>[0], at = now) => R.ratingStateOf(await call(input), at);
      check("a cancelled call: never", (await state({ hostId: hana.id, customerId: bob.id, cancelled: true })) === "never");
      check("a call ended with End call and report: never", (await state({ hostId: hana.id, customerId: bob.id, safetyEnded: true })) === "never");
      check("a call from the admin test page: never", (await state({ hostId: hana.id, customerId: bob.id, source: "admin" })) === "never");
      check("a call only the host joined: never", (await state({ hostId: hana.id, customerId: bob.id, customer: null })) === "never");
      check("a call where the two were never in at the same moment: never", (await state({ hostId: hana.id, customerId: bob.id, host: [0, 300], customer: [400, 900] })) === "never");
      check("a call where they were together under 2 minutes: never", (await state({ hostId: hana.id, customerId: bob.id, host: [0, 600], customer: [500, 900] })) === "never");
      check("a call where someone's connection never closed (the record needs review): never", await (async () => {
        const c = await call({ hostId: hana.id, customerId: bob.id });
        await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `rate-${randomUUID()}`, callId: c.id, type: "participant_joined", participantIdentity: bob.id, participantSessionId: `PA_${randomUUID().slice(0, 12)}`, providerTime: new Date(c.startsAt.getTime() + 700_000), payload: "{}" });
        return (await R.ratingStateOf(c, now)) === "never";
      })());
      check("a call whose room is not confirmed closed yet: not yet", (await state({ hostId: hana.id, customerId: bob.id, closed: false })) === "not_yet");
      check("a call that ended a minute ago (its record is not final yet): not yet", (await state({ hostId: hana.id, customerId: bob.id, endedMinutesAgo: 1 })) === "not_yet");
      const old = await call({ hostId: hana.id, customerId: bob.id });
      const deadline = new Date(old.endsAt.getTime() + 7 * DAY);
      check("a moment before the 7 days are over: still open", (await R.ratingStateOf(old, new Date(deadline.getTime() - 1000))) === "open");
      check("once the 7 days are over: too late, and a rating is refused", (await R.ratingStateOf(old, deadline)) === "too_late" && (await refused(R.rateCall({ callId: old.id, raterId: bob.id, stars: 5, now: deadline }), "are over")));
      check("a rating of a call that is not rateable is refused", await refused(R.rateCall({ callId: (await call({ hostId: hana.id, customerId: bob.id, cancelled: true })).id, raterId: bob.id, stars: 5, now }), "cannot be rated"));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. When a rating counts, and what an average shows");
    {
      // Averages are looked at "next week", when today's calls have had their 7 days.
      const nextWeek = new Date(now.getTime() + 7 * DAY + MINUTE);
      const kai = await host("kai", "Kai Average", `rt${RUN}kai`);
      const fans = await Promise.all(["f1", "f2", "f3", "f4"].map(person));
      check("a host nobody has rated is New", (await hostAverage(kai.id, nextWeek)) === "New");
      // Three calls, one after the other.
      const c1 = await call({ hostId: kai.id, customerId: fans[0].id, endedMinutesAgo: 30 });
      const c2 = await call({ hostId: kai.id, customerId: fans[1].id, endedMinutesAgo: 29 });
      const c3 = await call({ hostId: kai.id, customerId: fans[2].id, endedMinutesAgo: 28 });
      for (const [c, fan] of [[c1, fans[0]], [c2, fans[1]], [c3, fans[2]]] as const) {
        await R.rateCall({ callId: c.id, raterId: fan.id, stars: 5, now });
        await R.rateCall({ callId: c.id, raterId: kai.id, stars: 4, now });
      }
      check("both people have rated all three calls, but nothing counts before the 7 days are over", (await hostAverage(kai.id)) === "New" && (await hostAverage(kai.id, new Date(c1.endsAt.getTime() + 7 * DAY - 1000))) === "New");
      check("when the first two calls' 7 days are over: still New (it takes 3 people)", (await hostAverage(kai.id, new Date(c2.endsAt.getTime() + 7 * DAY))) === "New");
      check("when the third's are over, the average appears", (await hostAverage(kai.id, new Date(c3.endsAt.getTime() + 7 * DAY))) === "5.0 from 3 ratings");
      const unanswered = await call({ hostId: kai.id, customerId: fans[3].id, endedMinutesAgo: 20 });
      await R.rateCall({ callId: unanswered.id, raterId: fans[3].id, stars: 1, now });
      check("a fourth rating, of 1 star, changes nothing that is shown: one rating can never be read off", (await hostAverage(kai.id, nextWeek)) === "5.0 from 3 ratings");
      check("and it makes no difference that the host never rated that call back", (await R.myRating(unanswered.id, kai.id)) === null);
      for (const fan of [fans[0], fans[1]]) {
        const c = await call({ hostId: kai.id, customerId: fan.id, endedMinutesAgo: 15 });
        await R.rateCall({ callId: c.id, raterId: fan.id, stars: 1, now });
      }
      check("two of the first three rate a later call 1 star: nothing moves, each person counts once", (await hostAverage(kai.id, nextWeek)) === "5.0 from 3 ratings", await hostAverage(kai.id, nextWeek));
      for (const fan of await Promise.all(["f5", "f6"].map(person))) {
        const c = await call({ hostId: kai.id, customerId: fan.id, endedMinutesAgo: 9 });
        await R.rateCall({ callId: c.id, raterId: fan.id, stars: 1, now });
      }
      check("with six people the shown average moves, three people at a time", (await hostAverage(kai.id, nextWeek)) === "3.0 from 6 ratings", await hostAverage(kai.id, nextWeek));

      check("each customer has been rated by one host: New to other hosts", (await customerAverage(fans[2].id, nextWeek)) === "New");
      const regular = await person("regular");
      for (const h of [kai, hana, await host("lee", "Lee Third", `rt${RUN}lee`)]) {
        const c = await call({ hostId: h.id, customerId: regular.id, endedMinutesAgo: 5 });
        await R.rateCall({ callId: c.id, raterId: h.id, stars: 4, now });
        await R.rateCall({ callId: c.id, raterId: regular.id, stars: 5, now });
      }
      check("a customer rated by three hosts has a customer average, separate from any host average", (await customerAverage(regular.id, nextWeek)) === "4.0 from 3 ratings" && (await hostAverage(regular.id, nextWeek)) === "New");

      const one = await host("solo", "Solo Friend", `rt${RUN}solo`);
      const friend = await person("friend");
      for (let i = 0; i < 4; i++) {
        const c = await call({ hostId: one.id, customerId: friend.id, endedMinutesAgo: 10 + i * 40 });
        await R.rateCall({ callId: c.id, raterId: friend.id, stars: 5, now });
      }
      check("four 5-star ratings from one friend do not make an average: it takes 3 different people", (await hostAverage(one.id, nextWeek)) === "New");

      const zed = await host("zed", "Zed Closed", `rt${RUN}zed`);
      for (const fan of [fans[0], fans[1], fans[2]]) {
        const c = await call({ hostId: zed.id, customerId: fan.id, endedMinutesAgo: 12 });
        await R.rateCall({ callId: c.id, raterId: fan.id, stars: 5, now });
      }
      check("three people's ratings make an average", (await hostAverage(zed.id, nextWeek)) === "5.0 from 3 ratings");
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, fans[2].id));
      check("ratings given by an account the founder closed stop counting", (await hostAverage(zed.id, nextWeek)) === "New", await hostAverage(zed.id, nextWeek));
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, fans[2].id));
      check("and count again if the account is reopened", (await hostAverage(zed.id, nextWeek)) === "5.0 from 3 ratings");
      const fourth = await call({ hostId: zed.id, customerId: fans[3].id, endedMinutesAgo: 11 });
      await R.rateCall({ callId: fourth.id, raterId: fans[3].id, stars: 1, now });
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, fans[0].id));
      check("closing one of the three does not pull a fourth person's rating into view", (await hostAverage(zed.id, nextWeek)) === "New", await hostAverage(zed.id, nextWeek));
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, fans[0].id));

      // Seven people's ratings of Kai now count (5,5,5,1,1,1 and the regular's 5, whose call ended last): six are shown.
      const many = await R.averagesFor([kai.id, one.id, hana.id], "host", nextWeek);
      check("several people's averages come from one question to the database, each right", averageText(many.get(kai.id) ?? null) === "3.0 from 6 ratings" && many.get(one.id) === null && many.get(hana.id) === null);
      const waiting = await call({ hostId: kai.id, customerId: fans[3].id, endedMinutesAgo: 8 });
      const toRate = await R.callsToRate(fans[3].id, now);
      check("the home page lists a call waiting for this person's rating, and not ones already rated", toRate.length === 1 && toRate[0].callId === waiting.id && toRate[0].otherName === "Kai Average", String(toRate.length));
      // An older call that can be rated, then eleven newer ones the customer never joined.
      const busy = await person("busy");
      const older = await call({ hostId: kai.id, customerId: busy.id, endedMinutesAgo: 600 });
      for (let i = 0; i < 11; i++) await call({ hostId: kai.id, customerId: busy.id, endedMinutesAgo: 20 + i, customer: null });
      const stillListed = await R.callsToRate(busy.id, now);
      check("newer calls that cannot be rated never hide an older one that can", stillListed.length === 1 && stillListed[0].callId === older.id, String(stillListed.length));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Search");
    {
      const tag = `zq${RUN}`;
      const mia = await host("mia", `Mia ${tag} Stone`, `${tag}_mia`);
      await social(mia.id, "instagram", `${tag}.mia_gram`, true);
      await social(mia.id, "tiktok", `${tag}secret`, false);
      const noa = await host("noa", `Noa ${tag}`, `${tag}noa`);
      const hidden = await host("hid", `Hidden ${tag}`, `${tag}hid`, { hidden: true });
      const pending = await host("pen", `Pending ${tag}`, `${tag}pen`, { status: "pending" });
      const paused = await host("pau", `Paused ${tag}`, `${tag}pau`);
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, paused.id));
      const closed = await host("clo", `Closed ${tag}`, `${tag}clo`);
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, closed.id));
      const seeker = await person("seeker");
      const find = async (typed: string, viewer: string | null = null) => (await searchHosts(typed, viewer, now)).map((r) => r.handle);

      const all = await find(tag);
      check("finds visible hosts by a word in their name", all.includes(mia.handle) && all.includes(noa.handle));
      check("never a hidden, unapproved, paused or closed host", ![hidden, pending, paused, closed].some((h) => all.includes(h.handle)), all.join(" "));
      check("by handle, with capitals and a leading @", (await find(`@${mia.handle.toUpperCase()}`))[0] === mia.handle);
      check("by handle without its underscore, or with a space instead", (await find(`${tag}mia`))[0] === mia.handle && (await find(`${tag} mia`)).includes(mia.handle));
      check("by a confirmed social media name, exactly or loosely", (await find(`${tag}.mia_gram`))[0] === mia.handle && (await find(`${tag}.miagram`)).includes(mia.handle));
      check("an unconfirmed social media name finds nobody", (await find(`${tag}secret`)).length === 0);
      const result = (await searchHosts(mia.handle, null, now))[0];
      check("a result carries the name, price, rating and confirmed social names, and nothing private", result.displayName === mia.displayName && result.pricePer15Cents === 2000 && result.rating === null && result.socials.length === 1 && result.socials[0].name === `${tag}.mia_gram` && !("userId" in result) && !("email" in result));
      check("an exact handle comes before names that merely contain the words", (await find(noa.handle))[0] === noa.handle);
      check("too short finds nothing", (await find("z")).length === 0 && (await find(" @ ")).length === 0);
      check("% and _ are plain text, not \"anything\"", (await find("%%")).length === 0 && (await find("__")).length === 0 && (await find(`${tag}%`)).length === 0);
      check("a backslash or a quote in the search does no harm", (await find(`${tag}\\`)).length === 0 && (await find(`${tag}' or 1=1 --`)).length === 0);

      await db.insert(schema.blocks).values({ blockerId: noa.id, blockedId: seeker.id });
      check("someone a host has blocked does not find that host", !(await find(tag, seeker.id)).includes(noa.handle) && (await find(tag, seeker.id)).includes(mia.handle));
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, noa.id));
      await db.insert(schema.blocks).values({ blockerId: seeker.id, blockedId: noa.id });
      check("nor a host they have blocked themselves", !(await find(tag, seeker.id)).includes(noa.handle));
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, seeker.id));

      for (let i = 0; i < 22; i++) await host(`bulk${i}`, `Bulk ${tag} ${String(i).padStart(2, "0")}`, `${tag}bulk${i}`);
      const capped = await find(tag);
      check("at most 20 results, and an exact match is never pushed out by looser ones", capped.length === 20 && (await find(`${tag}bulk21`))[0] === `${tag}bulk21`, String(capped.length));
      // Twenty hosts whose display name is exactly what is typed, and one whose handle is.
      for (let i = 0; i < 20; i++) await host(`same${i}`, `dup${tag}`, `${tag}same${i}`);
      await host("exact", "Zzz Last", `dup${tag}`);
      const crowded = await find(`dup${tag}`);
      check("an exact handle comes first even when 20 display names match exactly too", crowded.length === 20 && crowded[0] === `dup${tag}`, crowded[0]);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. People you have talked to, and a host's private notes");
    {
      const hostA = await host("hosta", "Host Alpha", `rt${RUN}alpha`);
      const hostB = await host("hostb", "Host Beta", `rt${RUN}beta`, { hidden: true });
      const cust = await person("cust");
      const other = await person("other");
      const never = await person("never");
      await call({ hostId: hostA.id, customerId: cust.id, endedMinutesAgo: 200 });
      await call({ hostId: hostA.id, customerId: cust.id, endedMinutesAgo: 20 });
      await call({ hostId: hostB.id, customerId: cust.id, endedMinutesAgo: 100 });
      await call({ hostId: hostA.id, customerId: other.id, cancelled: true });
      await call({ hostId: hostA.id, customerId: never.id, customer: null });
      await call({ hostId: hostA.id, customerId: never.id, source: "admin" });

      const mine = await P.contactsOf(cust.id, now);
      check("a customer sees the hosts they talked to, most recent first, with how many calls", mine.length === 2 && mine[0].name === "Host Alpha" && mine[0].calls === 2 && mine[1].calls === 1, mine.map((c) => `${c.name}:${c.calls}`).join(" "));
      check("a public host is linked; a hidden host's page is not revealed, and they are still shown by their host name, never their account name", mine[0].hostHandle === hostA.handle && mine[1].hostHandle === null && mine[1].name === "Host Beta");
      // A customer who happens to be a public host too: their host never learns that from the contacts page.
      const dual = await host("dual", "Dual Persona", `rt${RUN}dual`);
      await call({ hostId: hostB.id, customerId: dual.id, endedMinutesAgo: 50 });
      const ofBeta = (await P.contactsOf(hostB.id, now)).find((c) => c.userId === dual.id);
      const ofDual = await P.contactsOf(dual.id, now);
      check("a customer who is a host too is shown to their host by their own name, with no link to their page", ofBeta?.name === "Check dual" && ofBeta.hostHandle === null && ofBeta.wasMyCustomer);
      check("and sees that host by their host name", ofDual.length === 1 && ofDual[0].name === "Host Beta" && ofDual[0].hostHandle === null);
      check("a customer cannot keep notes about hosts", mine.every((c) => !c.wasMyCustomer && c.note === null));
      const theirs = await P.contactsOf(hostA.id, now);
      check("a host sees only customers from calls that happened: not a cancelled call, one nobody joined, or a test call", theirs.length === 1 && theirs[0].userId === cust.id && theirs[0].wasMyCustomer, theirs.map((c) => c.name).join(" "));
      check("nothing about a contact gives away their email", !JSON.stringify(theirs).includes("@example.test"));

      const noteRefused = async (work: Promise<unknown>) => (await work.then(() => null).catch((e) => e)) instanceof NoteError;
      await P.saveHostNote({ hostId: hostA.id, customerId: cust.id, text: "  Likes to talk about sailing.\r\nSecond line.\u0000  ", now });
      const note = await P.hostNoteAbout(hostA.id, cust.id);
      check("a host can keep a note about their customer, saved as plain text", note.allowed && note.text === "Likes to talk about sailing.\nSecond line.");
      check("it shows on the host's contacts", (await P.contactsOf(hostA.id, now))[0].note === note.text);
      check("the customer cannot read it, nor another host, and the customer has none about the host", (await P.contactsOf(cust.id, now)).every((c) => c.note === null) && (await P.hostNoteAbout(hostB.id, cust.id)).text === null && !(await P.hostNoteAbout(cust.id, hostA.id)).allowed);
      check("a customer cannot write a note about their host", await noteRefused(P.saveHostNote({ hostId: cust.id, customerId: hostA.id, text: "x", now })));
      const testOnly = await person("testonly");
      await call({ hostId: hostA.id, customerId: testOnly.id, source: "admin" });
      check("nor can a host about someone who never asked them for a call, or whose only call with them was a test call", (await noteRefused(P.saveHostNote({ hostId: hostB.id, customerId: other.id, text: "x", now }))) && (await noteRefused(P.saveHostNote({ hostId: hostA.id, customerId: testOnly.id, text: "x", now }))));
      check("but a host can about someone who asked and then never joined", (await noteRefused(P.saveHostNote({ hostId: hostA.id, customerId: never.id, text: "x", now }))) === false);
      check("a note longer than 1,000 characters is refused", await noteRefused(P.saveHostNote({ hostId: hostA.id, customerId: cust.id, text: "a".repeat(1001), now })));
      await P.saveHostNote({ hostId: hostA.id, customerId: cust.id, text: "Changed.", now });
      check("a note can be changed; there is one per customer", (await P.hostNoteAbout(hostA.id, cust.id)).text === "Changed." && (await db.select().from(schema.hostNotes).where(eq(schema.hostNotes.hostId, hostA.id))).length === 2);

      await db.insert(schema.blocks).values({ blockerId: cust.id, blockedId: hostA.id });
      check("after a block either way, the contact disappears on both sides", (await P.contactsOf(hostA.id, now)).length === 0 && !(await P.contactsOf(cust.id, now)).some((c) => c.name === "Host Alpha"));
      check("and the note is kept but can be neither read nor changed", !(await P.hostNoteAbout(hostA.id, cust.id)).allowed && (await noteRefused(P.saveHostNote({ hostId: hostA.id, customerId: cust.id, text: "y", now }))) && (await db.select().from(schema.hostNotes).where(eq(schema.hostNotes.customerId, cust.id))).length === 1);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, cust.id));
      check("unblocked, it is back as it was", (await P.hostNoteAbout(hostA.id, cust.id)).text === "Changed.");
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, cust.id));
      check("a closed account is not listed, and its note cannot be read", (await P.contactsOf(hostA.id, now)).length === 0 && !(await P.hostNoteAbout(hostA.id, cust.id)).allowed);
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, cust.id));
      await P.saveHostNote({ hostId: hostA.id, customerId: cust.id, text: "   ", now });
      check("saving an empty note removes it", (await P.hostNoteAbout(hostA.id, cust.id)).text === null && (await db.select().from(schema.hostNotes).where(eq(schema.hostNotes.customerId, cust.id))).length === 0);
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
    await db.delete(schema.ratings).where(inArray(schema.ratings.callId, callIds));
    await db.delete(schema.hostNotes).where(or(inArray(schema.hostNotes.hostId, ids), inArray(schema.hostNotes.customerId, ids)));
    await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, callIds));
    await db.delete(schema.bookings).where(inArray(schema.bookings.callId, callIds));
    await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.socialAccounts).where(inArray(schema.socialAccounts.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
