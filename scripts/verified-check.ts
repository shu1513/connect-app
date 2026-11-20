/**
 * Testing tool: runs the "only people who have confirmed their ID" journeys
 * against the local database and the Stripe sandbox, and checks every result.
 * No real money moves.
 *
 * It makes its own customers and free hosts, and uses host@test.local (whose
 * payout account is ready) as the paid host. It removes the bookings it made
 * and puts that host's settings, calendar and weekly hours back. It refuses to
 * start while that host has requests waiting, because it would end them.
 *
 * Stop the always-on helper first (it would do some of these steps itself).
 * Usage: npx tsx scripts/verified-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq, inArray, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const B = await import("../src/lib/booking/bookings");
  const { BookingError } = B;
  const N = await import("../src/lib/booking/now");
  const { runBookingJobs } = await import("../src/lib/booking/jobs");
  const { refreshPayoutsReady } = await import("../src/lib/payments/hosts");
  const { block } = await import("../src/lib/safety/blocks");
  const { identityState, verifiedAmong } = await import("../src/lib/safety/identity");

  const now = new Date();
  const ID_WORDS = "confirmed their ID";
  const refusedWith = async (work: Promise<unknown>, words: string) => {
    const error = await work.then(() => null).catch((e) => e);
    return error instanceof BookingError && error.message.includes(words) ? true : (console.log(`       got: ${error?.message ?? "no error"}`), false);
  };
  const reload = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];

  type Check = "passed" | "none" | "under 18" | "still checking";
  const made: string[] = [];
  async function person(name: string, id: Check = "none") {
    const userId = `vf-${RUN}-${name}`;
    const email = `verifiedcheck-${RUN}-${name}@example.test`;
    const stamp = new Date();
    await db.insert(schema.user).values({ id: userId, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    if (id !== "none") {
      await db.insert(schema.identityChecks).values({
        userId,
        stripeSessionId: `vs_verifiedcheck_${randomUUID()}`,
        status: id === "still checking" ? "processing" : "verified",
        adult: id === "passed" ? true : id === "under 18" ? false : null,
        // Not the name the person shows: a host must never be sent it.
        verifiedName: id === "passed" ? `Legal ${name}` : null,
        checkedAt: stamp,
      });
    }
    made.push(userId);
    return { id: userId, name: `Check ${name}`, email };
  }
  type Person = Awaited<ReturnType<typeof person>>;
  async function makeHost(p: { id: string }, price: number, withSettings = true) {
    const tail = p.id.slice(-4).replace(/[^a-z0-9]/g, "");
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `vf${RUN}${tail}`, handleKey: `vf${RUN}${tail}`, displayName: `Host ${tail}`, pricePer15Cents: price, status: "approved", usConfirmedAt: new Date() }).onConflictDoNothing();
    if (withSettings) await db.insert(schema.hostSettings).values({ userId: p.id }).onConflictDoNothing();
    const calendar = { timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5, availableUntil: null, availableSeenAt: null };
    await db.insert(schema.hostCalendars).values({ userId: p.id, ...calendar }).onConflictDoUpdate({ target: schema.hostCalendars.userId, set: calendar });
    await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, p.id));
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: p.id, weekday, startMinute: 0, endMinute: 1440 })));
  }

  const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  if (!hana) throw new Error("Run `npm run seed` first.");
  if (!(await refreshPayoutsReady(hana.id))) throw new Error("Set up payouts for host@test.local on the Hosting page first.");
  const [profileBefore] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hana.id));
  const [calendarBefore] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hana.id));
  const [settingsBefore] = await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, hana.id));
  const hoursBefore = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hana.id));
  // Switching this host's availability off (journey 3) ends every instant request waiting for them.
  if ((await B.waitingForHost(hana.id)).length > 0) throw new Error("host@test.local has requests waiting. Answer or take them back first: this script would end them.");
  const freeCancelMinutes = settingsBefore?.freeCancelMinutes ?? 0;

  // Each request gets a time of its own, so they never get in each other's way.
  let nextTime = 30;
  const paidTime = async () => (await B.openTimes((await B.offerOf(hana.id))!, 30, now))[nextTime++];
  const askHana = async (customer: Person) =>
    B.askForCall({ customer, hostId: hana.id, startsAt: await paidTime(), lengthMinutes: 30, note: "check", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 2000, freeCancelMinutes }, now });
  const askFree = async (customer: Person, hostId: string) => {
    const [startsAt] = await B.openTimes((await B.offerOf(hostId))!, 30, now);
    return B.askForCall({ customer, hostId, startsAt, lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: false, seen: { pricePer15Cents: 0, freeCancelMinutes: 0 }, now });
  };
  const askNow = (customer: Person, hostId: string, price: number) =>
    B.askNow({ customer, hostId, lengthMinutes: 15, requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: price }, now });
  /** The customer types a card, and the page then finishes the card step. */
  const enterCard = async (bookingId: string, customerId: string) => {
    const b = await reload(bookingId);
    await stripe().setupIntents.confirm(b.stripeSetupIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    return B.finishCardStep({ bookingId, customerId, now });
  };

  try {
    if (!profileBefore) await db.insert(schema.hostProfiles).values({ userId: hana.id, handle: "hana_host", handleKey: "hanahost", displayName: "Hana Host", pricePer15Cents: 2000, status: "approved", usConfirmedAt: new Date() });
    await db.update(schema.hostProfiles).set({ pricePer15Cents: 2000, status: "approved", hidden: false }).where(eq(schema.hostProfiles.userId, hana.id));
    await makeHost(hana, 2000);

    // ----------------------------------------------------------------------
    console.log("\n1. The switch");
    {
      const host = await person("bare", "passed");
      await makeHost(host, 0, false);
      check("a host with no settings saved yet counts as off", (await B.offerOf(host.id))?.verifiedOnly === false);
      await B.setVerifiedOnly(host.id, true);
      check("switching it on works for such a host too", (await B.offerOf(host.id))?.verifiedOnly === true);
      await B.setVerifiedOnly(hana.id, true);
      check("on for the paid host", (await B.offerOf(hana.id))?.verifiedOnly === true);
      await B.setVerifiedOnly(hana.id, false);
      check("and off again; nothing else in their settings moved", (await B.offerOf(hana.id))?.verifiedOnly === false && (await B.offerOf(hana.id))?.freeCancelMinutes === freeCancelMinutes && (await B.offerOf(hana.id))?.canTakePaid === true);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Switch on: who can ask the paid host for a booked call");
    await B.setVerifiedOnly(hana.id, true);
    const ann = await person("ann", "passed");
    const bob = await person("bob");
    {
      check("a customer who has not confirmed their ID is refused, and told why", await refusedWith(askHana(bob), ID_WORDS));
      check("nothing was saved for them", (await db.select().from(schema.bookings).where(eq(schema.bookings.customerId, bob.id))).length === 0);
      check("a check passed by someone under 18 does not count", await refusedWith(askHana(await person("kid", "under 18")), ID_WORDS));
      check("a check Stripe is still looking at does not count yet", await refusedWith(askHana(await person("soon", "still checking")), ID_WORDS));
      const blocked = await person("blocked");
      await block({ blockerId: hana.id, blockedId: blocked.id, now });
      check("a blocked customer still hears only that the time is no longer open", await refusedWith(askHana(blocked), "no longer open"));
      const { booking } = await askHana(ann);
      check("a customer who has confirmed their ID gets to the card step", booking.stage === "card");
      const sent = await enterCard(booking.id, ann.id);
      check("and their request reaches the host", sent.stage === "waiting");
      const waiting = await B.waitingForHost(hana.id);
      const marks = await verifiedAmong(waiting.map((row) => row.booking.customerId));
      check("the host's list can show them as confirmed", waiting.some((row) => row.booking.id === booking.id) && marks.has(ann.id));
      await B.takeBack({ bookingId: booking.id, customerId: ann.id, now });
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Switch on: a call right now");
    {
      await N.setAvailableNow({ hostId: hana.id, minutes: 120, now });
      check("a customer who has not confirmed their ID is refused, and told why", await refusedWith(askNow(bob, hana.id, 2000), ID_WORDS));
      const { booking } = await askNow(ann, hana.id, 2000);
      const sent = await enterCard(booking.id, ann.id);
      const live = await N.liveForHost(hana.id, now);
      const shown = live.requests.find((request) => request.id === booking.id);
      check("a confirmed customer's request reaches the host's live page with the mark", sent.stage === "waiting" && shown?.idConfirmed === true);
      check(
        "the live page is sent a yes or no and nothing else about the ID",
        shown !== undefined && Object.keys(shown).sort().join() === "about,customerName,customerRating,id,idConfirmed,lengthMinutes,respondBy,totalCents" && !JSON.stringify(live).includes("Legal"),
      );
      await B.takeBack({ bookingId: booking.id, customerId: ann.id, now });
      await N.setAvailableNow({ hostId: hana.id, minutes: null, now });
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Switch off: a paying customer needs no ID, as before");
    await B.setVerifiedOnly(hana.id, false);
    const cat = await person("cat");
    const dee = await person("dee");
    let catBooking: string;
    let deeBooking: string;
    {
      const first = await askHana(cat);
      check("a customer who has not confirmed their ID gets to the card step", first.booking.stage === "card");
      catBooking = first.booking.id;
      const sent = await enterCard(catBooking, cat.id);
      check("and their request reaches the host", sent.stage === "waiting");
      const marks = await verifiedAmong([cat.id, ann.id]);
      check("the host sees no mark for them, and still sees one for a confirmed customer", !marks.has(cat.id) && marks.has(ann.id));
      deeBooking = (await askHana(dee)).booking.id;
      check("a second customer is at the card step", (await reload(deeBooking)).stage === "card");
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The host switches it on while requests are on their way");
    {
      await B.setVerifiedOnly(hana.id, true);
      check("a request already waiting stays", (await reload(catBooking)).stage === "waiting");
      const ended = await enterCard(deeBooking, dee.id);
      check("a request still at the card step ends there, with the reason, and never reaches the host", ended.stage === "ran_out" && (ended.endedReason ?? "").includes(ID_WORDS) && ended.requestedAt === null);
      check("the card's reference is kept so the helper can remove it", ended.stripePaymentMethodId !== null);
      await runBookingJobs(now);
      const card = await stripe().paymentMethods.retrieve(ended.stripePaymentMethodId!);
      check("the helper removes that card at Stripe", card.customer === null && (await reload(deeBooking)).stripeSetupIntentId === null);
      const { callId } = await B.accept({ bookingId: catBooking, hostId: hana.id, now });
      check("the waiting request can still be accepted", Boolean(callId) && (await reload(catBooking)).stage === "accepted");
      check("but the same customer cannot send a new one", await refusedWith(askHana(cat), ID_WORDS));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. A free host: unchanged, switch off or on");
    {
      const host = await person("free", "passed");
      await makeHost(host, 0);
      const eve = await person("eve");
      check("switch off: a customer who has not confirmed their ID is refused with the free-call words", await refusedWith(askFree(eve, host.id), "Before your first free call, please confirm who you are"));
      await B.setVerifiedOnly(host.id, true);
      check("switch on: the same words", await refusedWith(askFree(eve, host.id), "Before your first free call, please confirm who you are"));
      const { booking } = await askFree(ann, host.id);
      check("a confirmed customer's request goes straight to the host", booking.stage === "waiting");
    }

    // ----------------------------------------------------------------------
    console.log("\n7. Passing the check later");
    {
      await db.insert(schema.identityChecks).values({ userId: bob.id, stripeSessionId: `vs_verifiedcheck_${randomUUID()}`, status: "verified", adult: true, verifiedName: "Check bob", checkedAt: new Date() });
      check("the customer now counts as confirmed", (await identityState(bob.id)).passed);
      check("and can ask the host who refused them before", (await askHana(bob)).booking.stage === "card");
    }
  } finally {
    const people = made.length ? made : ["-"];
    const mine = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, people), inArray(schema.bookings.hostId, people)));
    const ids = mine.map((b) => b.id);
    if (ids.length) {
      for (const id of ids) await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `%:${id}:%`));
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, ids));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, ids));
    }
    // Calls and payments are left as test data, like the other scripts do; the people are kept with them.
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `verifiedcheck-${RUN}-%`));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, people));
    await db.delete(schema.blocks).where(inArray(schema.blocks.blockedId, people));
    for (const id of made) await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true }).where(eq(schema.hostProfiles.userId, id));
    // The test host is put back as it was.
    await db.update(schema.hostSettings).set({ verifiedOnly: settingsBefore?.verifiedOnly ?? false }).where(eq(schema.hostSettings.userId, hana.id));
    if (profileBefore) await db.update(schema.hostProfiles).set({ pricePer15Cents: profileBefore.pricePer15Cents, status: profileBefore.status, hidden: profileBefore.hidden }).where(eq(schema.hostProfiles.userId, hana.id));
    if (calendarBefore) {
      const { timeZone, lengths, noticeHours, horizonWeeks, breakMinutes, availableUntil, availableSeenAt } = calendarBefore;
      await db.update(schema.hostCalendars).set({ timeZone, lengths, noticeHours, horizonWeeks, breakMinutes, availableUntil, availableSeenAt }).where(eq(schema.hostCalendars.userId, hana.id));
    } else await db.update(schema.hostCalendars).set({ availableUntil: null, availableSeenAt: null }).where(eq(schema.hostCalendars.userId, hana.id));
    await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hana.id));
    if (hoursBefore.length) await db.insert(schema.weeklyHours).values(hoursBefore);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
