/**
 * Testing tool: runs real booking journeys against the local database and the
 * Stripe sandbox, and checks every result. No real money moves.
 *
 * It makes its own customers and free hosts, uses host@test.local (whose
 * payout account is ready) as the paid host, and uses a pretend "now" where a
 * journey has to wait days. It removes the bookings it made.
 *
 * Stop the always-on helper first (it would do some of these steps itself).
 *
 * Careful: it replaces the calendar and weekly hours of host@test.local, and it
 * runs the booking jobs with a clock set days ahead. That ends or cancels any
 * other open requests and unpaid bookings in the local database. Only run it
 * on a database whose bookings you do not mind losing.
 * Usage: npx tsx scripts/booking-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";
import { refusalWhileDisputed, whileDisputed } from "./stopped-customer";

const RUN = randomUUID().slice(0, 8);
const HOUR = 3_600_000;
const MINUTE = 60_000;

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
  const { runBookingJobs } = await import("../src/lib/booking/jobs");
  const { queueBookingEmails } = await import("../src/lib/booking/emails");
  const { deliverEmails } = await import("../src/lib/notifications/delivery");
  const { endBookingsOfSuspendedHost } = await import("../src/lib/booking/moderation");
  const { answerDeadline, payCutoff, LIMITS, PASSED_OVER } = await import("../src/lib/booking/rules");
  const { startHold, syncHold } = await import("../src/lib/payments/hold");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { cancelCall } = await import("../src/lib/payments/cancel");
  const { settleCancelledCalls, reconcileOperations } = await import("../src/lib/payments/jobs");
  const { refreshPayoutsReady } = await import("../src/lib/payments/hosts");

  const now = new Date();
  const refused = async (work: Promise<unknown>) => (await work.then(() => null).catch((e) => e)) instanceof BookingError;
  const reload = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];
  const busyOf = async (userId: string) => db.select().from(schema.busyEntries).where(eq(schema.busyEntries.userId, userId));
  const emailsTo = async (email: string, subject: string) =>
    (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, email), like(schema.emailOutbox.subject, `%${subject}%`)))).length;

  /** Whether the email for one event of one booking was written (each is written under its own key). */
  const eventEmail = async (key: string) => (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, key))).length === 1;

  /** A ready-to-use person: confirmed, welcomed. */
  async function person(name: string) {
    const id = `bk-${RUN}-${name}`;
    const email = `bookcheck-${RUN}-${name}@example.test`;
    const stamp = new Date();
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    return { id, name: `Check ${name}`, email };
  }
  /** Gives a person an approved host profile that is free all week. */
  async function makeHost(p: { id: string }, price: number, breakMinutes = 5) {
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `bk${RUN}${p.id.slice(-4).replace(/[^a-z0-9]/g, "")}`.toLowerCase(), handleKey: `bk${RUN}${p.id.slice(-4)}`.toLowerCase(), displayName: `Host ${p.id.slice(-4)}`, pricePer15Cents: price, status: "approved", usConfirmedAt: new Date() }).onConflictDoNothing();
    await db.insert(schema.hostSettings).values({ userId: p.id }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes }).onConflictDoUpdate({ target: schema.hostCalendars.userId, set: { timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes } });
    await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, p.id));
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: p.id, weekday, startMinute: 0, endMinute: 1440 })));
  }
  /** Asks the way the summary page does: saying which price and cancelling rule were on screen. */
  const ask = async (customer: { id: string; name: string; email: string }, hostId: string, startsAt: Date, lengthMinutes = 30, at = now, requestKey = randomUUID()) => {
    const offer = await B.offerOf(hostId);
    const seen = { pricePer15Cents: offer?.pricePer15Cents ?? -1, freeCancelMinutes: offer?.freeCancelMinutes ?? -1 };
    return B.askForCall({ customer, hostId, startsAt, lengthMinutes, note: "check", requestKey, agreedToCardTerms: true, seen, now: at });
  };
  const stripeIntentsOf = async (userId: string) => {
    const [row] = await db.select().from(schema.stripeCustomers).where(eq(schema.stripeCustomers.userId, userId));
    return row ? (await stripe().paymentIntents.list({ customer: row.stripeCustomerId, limit: 10 })).data : [];
  };
  /** Open times for a host, far enough ahead that nothing in this script is "soon". */
  async function times(hostId: string, length = 30, from = 72) {
    const offer = (await B.offerOf(hostId))!;
    return (await B.openTimes(offer, length, now)).filter((t) => t.getTime() > now.getTime() + from * HOUR);
  }

  // --- the paid host: host@test.local, whose payout account is ready
  const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  if (!hana) throw new Error("Run `npm run seed` first.");
  if (!(await refreshPayoutsReady(hana.id))) throw new Error("Set up payouts for host@test.local on the Hosting page first.");
  const [hanaProfileBefore] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hana.id));
  const [hanaSettingsBefore] = await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, hana.id));
  if (!hanaProfileBefore) await db.insert(schema.hostProfiles).values({ userId: hana.id, handle: "hana_host", handleKey: "hanahost", displayName: "Hana Host", pricePer15Cents: 2000, status: "approved", usConfirmedAt: new Date() });
  await db.update(schema.hostProfiles).set({ pricePer15Cents: 2000, status: "approved", hidden: false }).where(eq(schema.hostProfiles.userId, hana.id));
  await db.update(schema.hostSettings).set({ freeCancelMinutes: 1440 }).where(eq(schema.hostSettings.userId, hana.id));
  await makeHost(hana, 2000);

  const made: string[] = [];
  const customer = async (name: string) => {
    const p = await person(name);
    made.push(p.id);
    // Test people have passed the identity check (a first free call needs it since the safety module).
    await db.insert(schema.identityChecks).values({ userId: p.id, stripeSessionId: `vs_bookcheck_${randomUUID()}`, status: "verified", adult: true, verifiedName: p.name, checkedAt: new Date() });
    return p;
  };
  const freeHost = async (name: string, breakMinutes = 5) => {
    const p = await customer(name);
    await makeHost(p, 0, breakMinutes);
    return p;
  };

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. A free request, accepted");
    {
      const host = await freeHost("host1");
      const ann = await customer("ann");
      const [slot] = await times(host.id);
      // Asked by someone whose bank has an open dispute: a free call is no new agreement to pay, so nothing stands in the way.
      const { booking, clientSecret } = await whileDisputed(ann.id, host.id, () => ask(ann, host.id, slot));
      check("a free request goes straight to the host, with no card step (also from someone whose bank has an open dispute)", booking.stage === "waiting" && clientSecret === null);
      check("the answer deadline is 24 hours after asking", booking.respondBy?.getTime() === answerDeadline({ startsAt: slot, paid: false, freeCancelMinutes: 0, requestedAt: now }).getTime());
      check("the customer is now taken for that time; the host is not", (await busyOf(ann.id)).length === 1 && (await busyOf(host.id)).length === 0);
      check("the time is still open on the host's page", (await times(host.id)).some((t) => t.getTime() === slot.getTime()));
      check("the customer gets a \"request sent\" email", (await emailsTo(ann.email, "was sent")) === 1);

      await runBookingJobs(now);
      await runBookingJobs(now);
      check("the host is told once", (await emailsTo(host.email, "new call request")) === 1);

      const { callId } = await B.accept({ bookingId: booking.id, hostId: host.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      check("accepting makes a real call at that time", call.startsAt.getTime() === slot.getTime() && call.hostId === host.id && call.customerId === ann.id);
      check("a free call has no payment", (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId))).length === 0);
      const hostBusy = await busyOf(host.id);
      check("the host is now taken for the call plus the break", hostBusy.length === 1 && hostBusy[0].endsAt.getTime() === slot.getTime() + 35 * MINUTE);
      const open = await times(host.id);
      check("that time is closed, and the time right after the break is offered", !open.some((t) => t.getTime() === slot.getTime()) && open.some((t) => t.getTime() === slot.getTime() + 35 * MINUTE));
      check("both get an \"accepted\" email", (await emailsTo(ann.email, "accepted your request")) === 1 && (await emailsTo(host.email, "You accepted")) === 1);
      check("accepting twice does nothing more", await refused(B.accept({ bookingId: booking.id, hostId: host.id, now })));

      console.log("   …the customer cancels; the time is open again");
      await cancelCall({ call, payment: null, by: "customer", now });
      check("the booking ends and both people are free again", (await reload(booking.id)).stage === "cancelled" && (await busyOf(host.id)).length === 0 && (await busyOf(ann.id)).length === 0);
      check("the time is open again", (await times(host.id)).some((t) => t.getTime() === slot.getTime()));
      check("the host is told", (await emailsTo(host.email, "cancelled their call")) === 1);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Several people ask for the same time; the host chooses");
    {
      const host = await freeHost("host2");
      const [a, b, c, d, e] = await Promise.all(["a2", "b2", "c2", "d2", "e2"].map(customer));
      const open = await times(host.id);
      const slot = open[0];
      const later = open.find((t) => t.getTime() >= slot.getTime() + 35 * MINUTE)!;
      const asked = await Promise.all([a, b, c].map((p) => ask(p, host.id, slot)));
      check("all three requests are waiting", asked.every((r) => r.booking.stage === "waiting"));
      // A 15-minute request (those have their own times) that the 30-minute call, with its break, gets in the way of.
      const fifteen = await times(host.id, 15);
      const clashing = fifteen.find((t) => t.getTime() > slot.getTime() - 20 * MINUTE && t.getTime() < slot.getTime() + 35 * MINUTE)!;
      const overlapping = await ask(d, host.id, clashing, 15);
      const clear = await ask(e, host.id, later);

      const waiting = await B.waitingForHost(host.id);
      check("the host sees them all, the same time together", waiting.length === 5 && waiting.filter((w) => w.booking.startsAt.getTime() === slot.getTime()).length >= 3);

      await B.accept({ bookingId: asked[1].booking.id, hostId: host.id, now });
      const stages = await Promise.all([asked[0], asked[2], overlapping, clear].map((r) => reload(r.booking.id).then((x) => x.stage)));
      check("the other two for that time are told at once that another request was accepted", stages[0] === "passed_over" && stages[1] === "passed_over", stages.join(" "));
      check("so is a request for another length that the call gets in the way of", stages[2] === "passed_over", stages[2]);
      check("a request for a time that is still possible keeps waiting", stages[3] === "waiting", stages[3]);
      check("the people passed over are free again and are told by email", (await busyOf(a.id)).length === 0 && (await emailsTo(a.email, "accepted another request")) === 1);
      check("the one chosen is taken, and so is the host", (await busyOf(b.id)).length === 1 && (await busyOf(host.id)).length === 1);
      check("someone passed over can ask for another time straight away", (await ask(a, host.id, later)).booking.stage === "waiting");

      console.log("   …the host presses accept on two requests that overlap, at the same moment");
      const host2 = await freeHost("host2b");
      const [slot2] = await times(host2.id);
      const [p, q] = await Promise.all(["p2", "q2"].map(customer));
      const two = await Promise.all([ask(p, host2.id, slot2), ask(q, host2.id, slot2)]);
      const results = await Promise.allSettled(two.map((r) => B.accept({ bookingId: r.booking.id, hostId: host2.id, now })));
      const calls = await db.select().from(schema.calls).where(eq(schema.calls.hostId, host2.id));
      check("exactly one becomes a call", results.filter((r) => r.status === "fulfilled").length === 1 && calls.length === 1, `${results.map((r) => r.status).join(" ")} ${calls.length}`);
      const after = await Promise.all(two.map((r) => reload(r.booking.id).then((x) => x.stage)));
      check("the other is passed over, not left hanging", after.sort().join() === "accepted,passed_over", after.join(" "));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. One person cannot be in two places");
    {
      const h1 = await freeHost("host3a");
      const h2 = await freeHost("host3b");
      const h3 = await freeHost("host3c");
      const kim = await customer("kim");
      const [slot] = await times(h1.id);
      const key = randomUUID();
      const first = await ask(kim, h1.id, slot, 30, now, key);
      const again = await ask(kim, h1.id, slot, 30, now, key);
      check("pressing the button twice makes one request", first.booking.id === again.booking.id && (await busyOf(kim.id)).length === 1);
      check("the same person cannot ask the same host for the same time again", await refused(ask(kim, h1.id, slot)));
      check("nor another host for a time that overlaps", await refused(ask(kim, h2.id, slot)));
      check("a person cannot book themselves", await refused(ask(h1, h1.id, slot)));

      // h2 accepts a call at that time, so h2 is taken as a host. h2 then asks h3 for the same time as a customer.
      const lee = await customer("lee");
      const forH2 = await ask(lee, h2.id, slot);
      await B.accept({ bookingId: forH2.booking.id, hostId: h2.id, now });
      check("a host with a call at that time cannot ask someone else for a call then", await refused(ask(h2, h3.id, slot)));
      // And the other way round: h3 has a request of their own waiting elsewhere; h3 then cannot accept a call at that time.
      const mine = await ask(h3, h1.id, slot).catch(() => null);
      const pat = await customer("pat");
      const forH3 = await ask(pat, h3.id, slot).catch(() => null);
      check("a host's own request elsewhere closes that time on their page", mine !== null && forH3 === null);
      check("the admin test page cannot make an overlapping call either", await refused(B.createTestCall({ hostId: h2.id, customerId: pat.id, startsAt: slot, endsAt: new Date(slot.getTime() + 10 * MINUTE), pricePer15Cents: 0, freeCancelMinutes: 0 })));
      const tooShort = await B.createTestCall({ hostId: h2.id, customerId: pat.id, startsAt: new Date(slot.getTime() + 3 * 60 * MINUTE), endsAt: new Date(slot.getTime() + 3 * 60 * MINUTE + 4 * MINUTE), pricePer15Cents: 2000, freeCancelMinutes: 0 }).then(() => null, (e: unknown) => e as Error);
      check("and it cannot make a paid call shorter than 5 minutes", tooShort instanceof BookingError && /5 minutes/.test(tooShort.message), tooShort?.message);
      check("a time that is not one of the open times is refused, whatever the browser sends", await refused(ask(pat, h1.id, new Date(slot.getTime() + 7 * MINUTE))));
    }

    // ----------------------------------------------------------------------
    console.log("\n3b. Two minutes after every call, and a host who is a customer too (plans/42)");
    {
      // A host's open times are laid out from the start of their hours. To ask for one exact minute, a
      // host's hours are made to start at that minute (New York time, like every host here).
      const nyMinute = (date: Date) => {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
        return Number(parts.find((part) => part.type === "hour")!.value) * 60 + Number(parts.find((part) => part.type === "minute")!.value);
      };
      const openFrom = async (hostId: string, minute: number) => {
        await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hostId));
        await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId, weekday, startMinute: minute, endMinute: 1440 })));
      };
      const midDay = (list: Date[]) => list.find((time) => nyMinute(time) >= 120 && nyMinute(time) <= 1200)!;
      const failure = (work: Promise<unknown>) => work.then(() => null, (e: unknown) => e as Error);
      const tooClose = (e: Error | null) => e instanceof BookingError && /within 2 minutes/.test(e.message);

      // --- a person who is only a customer
      const a = await freeHost("gapa");
      const b = await freeHost("gapb");
      const cara = await customer("cara");
      const T = midDay(await times(a.id));
      const m = nyMinute(T);
      const plus = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE);
      await ask(cara, a.id, T);
      const caraBusy = await busyOf(cara.id);
      check("a customer is taken for the call and the 2 minutes after it", caraBusy.length === 1 && caraBusy[0].startsAt.getTime() === T.getTime() && caraBusy[0].endsAt.getTime() === plus(T, 32).getTime());
      const caraAsks = async (offset: number) => {
        await openFrom(b.id, m + offset);
        return failure(ask(cara, b.id, plus(T, offset)));
      };
      const at30 = await caraAsks(30);
      check("she cannot ask another host for the minute her call ends, and is told why", tooClose(at30), at30?.message);
      check("nor for one minute later", tooClose(await caraAsks(31)));
      const at32 = await caraAsks(32);
      check("two minutes after the end she can", at32 === null, at32?.message);
      check("a call that would end one minute before hers is refused", tooClose(await caraAsks(-31)));
      const before = await caraAsks(-32);
      check("one that ends two minutes before hers goes through", before === null, before?.message);

      // --- a host who is a customer too, with a 5-minute break
      const dual = await freeHost("dual");
      const other = await freeHost("gapo");
      const T2 = midDay((await times(other.id)).filter((time) => time.getTime() > T.getTime() + 24 * HOUR));
      const m2 = nyMinute(T2);
      // Three people ask her, before she books anything herself: for the middle of her coming call ("2:45"),
      // for the minute it ends ("3:00"), and for two minutes after it ("3:02").
      const askDual = async (who: { id: string; name: string; email: string }, offset: number) => {
        await openFrom(dual.id, m2 + offset);
        return ask(who, dual.id, plus(T2, offset), 15);
      };
      const [p1, p2, p3, p4] = [await customer("asker1"), await customer("asker2"), await customer("asker3"), await customer("asker4")];
      const inTheCall = await askDual(p1, 15);
      const atTheEnd = await askDual(p2, 30);
      const twoAfter = await askDual(p3, 32);
      // She asks another host for "2:30 to 3:00".
      const own = await ask(dual, other.id, T2);
      const stages = async () => (await Promise.all([inTheCall, atTheEnd, twoAfter].map((r) => reload(r.booking.id)))).map((r) => r.stage).join(" ");
      check("while her own request only waits, the requests to her stay", (await stages()) === "waiting waiting waiting", await stages());
      const cannot = await failure(B.accept({ bookingId: inTheCall.booking.id, hostId: dual.id, now }));
      check("and accepting one that overlaps it is refused, with the reason", cannot instanceof BookingError && /of your own/.test(cannot.message), cannot?.message);
      const inBreak = await failure(askDual(p4, 32));
      check("a new request for two minutes after her own call is refused: for others her 5-minute break counts", inBreak instanceof BookingError && /no longer open/.test(inBreak.message), inBreak?.message);

      // The other host accepts: her own call is fixed.
      await B.accept({ bookingId: own.booking.id, hostId: other.id, now });
      const [r1, r2, r3] = await Promise.all([inTheCall, atTheEnd, twoAfter].map((r) => reload(r.booking.id)));
      check(
        "when her own call is fixed, the requests it makes impossible end at once: the one inside it and the one for the minute it ends",
        r1.stage === "passed_over" && r2.stage === "passed_over" && r1.endedReason === PASSED_OVER.ownCall && r2.endedReason === PASSED_OVER.ownCall,
        `${r1.stage} ${r2.stage} ${r1.endedReason}`,
      );
      check("the one for two minutes after it stays", r3.stage === "waiting", r3.stage);
      check(
        "those customers are free again and are told only that she is no longer free",
        (await busyOf(p1.id)).length === 0 && (await busyOf(p2.id)).length === 0 && (await emailsTo(p1.email, "is no longer free at that time")) === 1 && (await emailsTo(p2.email, "is no longer free at that time")) === 1 && (await emailsTo(p1.email, "accepted another request")) === 0,
      );

      // What her page offers now, with her usual hours.
      await openFrom(dual.id, 0);
      const offered = async () => (await B.openTimes((await B.offerOf(dual.id))!, 15, now)).map((time) => time.getTime());
      const has = (list: number[], offset: number) => list.includes(plus(T2, offset).getTime());
      const five = await offered();
      check("her page offers nothing at the end of her own call or in her break after it, and offers the end of the break", !has(five, 30) && !has(five, 32) && has(five, 35), `${has(five, 30)} ${has(five, 32)} ${has(five, 35)}`);
      // Her break of today counts: she changes it to 15 minutes.
      await db.update(schema.hostCalendars).set({ breakMinutes: 15 }).where(eq(schema.hostCalendars.userId, dual.id));
      const fifteen = await offered();
      check("with a break of 15 minutes her page offers nothing before 15 minutes after her own call", !has(fifteen, 35) && !has(fifteen, 40) && has(fifteen, 45), `${has(fifteen, 35)} ${has(fifteen, 40)} ${has(fifteen, 45)}`);
      // After her own call is over, the break still counts: the stored entry ends 2 minutes after the call, her break 15 minutes after it.
      const during = plus(T2, 33);
      const afterIt = plus(T2, 46);
      const stillTaken = await B.takenAsHost(db, dual.id, during);
      const listed = await B.ownBookingsTakingTime(dual.id, during);
      check(
        "3 minutes after her own call, with the stored 2 minutes over, she still counts as taken until her break ends, and her calendar list still shows it",
        stillTaken.length === 1 && stillTaken[0].end.getTime() === plus(T2, 45).getTime() && listed.length === 1 && listed[0].bookingId === own.booking.id && listed[0].freeAgainAt.getTime() === plus(T2, 45).getTime(),
        `${stillTaken.length} ${listed.length}`,
      );
      check("once the break is over she is free and the list is empty", (await B.takenAsHost(db, dual.id, afterIt)).length === 0 && (await B.ownBookingsTakingTime(dual.id, afterIt)).length === 0);
      const longBreak = await failure(askDual(p4, 35));
      check("and a request for a time inside the longer break is refused", longBreak instanceof BookingError && /no longer open/.test(longBreak.message), longBreak?.message);
      await db.update(schema.hostCalendars).set({ breakMinutes: 5 }).where(eq(schema.hostCalendars.userId, dual.id));

      // What she chooses herself is limited by the 2 minutes only.
      const yes = await failure(B.accept({ bookingId: twoAfter.booking.id, hostId: dual.id, now }));
      check("she may still accept the request for two minutes after her own call", yes === null && (await reload(twoAfter.booking.id)).stage === "accepted", yes?.message);
      // Being passed over is not a decline: the same person can ask her again the same day.
      const again = await failure(askDual(p1, 60));
      check("a customer whose request ended this way can ask her again the same day", again === null, again?.message);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Limits, declining, and running out of time");
    {
      const host = await freeHost("host4");
      const other = await freeHost("host4b");
      const sam = await customer("sam");
      const open = await times(host.id);
      const three = [];
      for (let i = 0; i < LIMITS.waitingPerHost; i++) three.push(await ask(sam, host.id, open[i * 2]));
      check(`at most ${LIMITS.waitingPerHost} waiting requests with one host`, await refused(ask(sam, host.id, open[8])));
      await B.takeBack({ bookingId: three[0].booking.id, customerId: sam.id, now });
      check("a request taken back frees the customer's time", (await busyOf(sam.id)).length === LIMITS.waitingPerHost - 1);
      check("but taking back and asking again does not get round the daily limit", await refused(ask(sam, host.id, open[8])));
      check("taking back twice is refused", await refused(B.takeBack({ bookingId: three[0].booking.id, customerId: sam.id, now })));
      check("someone else cannot take back or accept a request that is not theirs", (await refused(B.takeBack({ bookingId: three[1].booking.id, customerId: host.id, now }))) && (await refused(B.accept({ bookingId: three[1].booking.id, hostId: other.id, now }))));

      const tom = await customer("tom");
      const asked = await ask(tom, host.id, open[10]);
      await B.decline({ bookingId: asked.booking.id, hostId: host.id, now });
      check("a declined customer is told, and is free again", (await emailsTo(tom.email, "could not take your request")) === 1 && (await busyOf(tom.id)).length === 0);
      check(`and cannot ask that host again for ${LIMITS.declineCooldownDays} days`, await refused(ask(tom, host.id, open[12])));
      check("but can ask another host", (await ask(tom, other.id, (await times(other.id))[0])).booking.stage === "waiting");

      const uma = await customer("uma");
      const unanswered = await ask(uma, host.id, open[14]);
      const deadline = unanswered.booking.respondBy!;
      check("the host cannot accept after the deadline", await refused(B.accept({ bookingId: unanswered.booking.id, hostId: host.id, now: new Date(deadline.getTime() + 1) })));
      await runBookingJobs(new Date(deadline.getTime() - MINUTE));
      check("a request is not ended before its deadline", (await reload(unanswered.booking.id)).stage === "waiting");
      await runBookingJobs(new Date(deadline.getTime() + MINUTE));
      check("after the deadline it ends by itself and the customer is told", (await reload(unanswered.booking.id)).stage === "ran_out" && (await emailsTo(uma.email, "not answered in time")) === 1);
      check("running out is not a decline: they can ask again", (await ask(uma, host.id, open[14])).booking.stage === "waiting");

      console.log("   …accepting and running out of time at the same moment");
      const vic = await customer("vic");
      const racing = await ask(vic, host.id, open[16]);
      const edge = racing.booking.respondBy!;
      await Promise.allSettled([B.accept({ bookingId: racing.booking.id, hostId: host.id, now: new Date(edge.getTime() - 1) }), B.endUnanswered(new Date(edge.getTime() + 1))]);
      const end = await reload(racing.booking.id);
      const callsMade = end.callId ? 1 : 0;
      check("exactly one of the two wins, and the records agree", (end.stage === "accepted" && callsMade === 1) || (end.stage === "ran_out" && callsMade === 0), `${end.stage} ${callsMade}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Hidden, suspended, and changed hosts");
    {
      const host = await freeHost("host5");
      const [w, x, y] = await Promise.all(["w5", "x5", "y5"].map(customer));
      const open = await times(host.id);
      const first = await ask(w, host.id, open[0]);
      const second = await ask(x, host.id, open[4]);
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
      check("a hidden host cannot be asked", (await refused(ask(y, host.id, open[8]))) && (await B.offerOf(host.id)) === null);
      const accepted = await B.accept({ bookingId: first.booking.id, hostId: host.id, now }).then(() => true).catch(() => false);
      check("but can still accept what they were already asked", accepted);
      await db.update(schema.hostProfiles).set({ hidden: false, status: "suspended" }).where(eq(schema.hostProfiles.userId, host.id));
      check("a suspended host cannot accept", await refused(B.accept({ bookingId: second.booking.id, hostId: host.id, now })));
      const failed = await endBookingsOfSuspendedHost(host.id, now);
      const [b1, b2] = await Promise.all([reload(first.booking.id), reload(second.booking.id)]);
      check("suspending ends their waiting requests and cancels their future calls", failed === 0 && b1.stage === "cancelled" && b2.stage === "declined", `${b1.stage} ${b2.stage}`);
      check("everyone is free again and told", (await busyOf(w.id)).length === 0 && (await busyOf(x.id)).length === 0 && (await emailsTo(w.email, "cancelled")) === 1 && (await emailsTo(x.email, "could not take")) === 1);
      await db.update(schema.hostProfiles).set({ status: "approved" }).where(eq(schema.hostProfiles.userId, host.id));
      check("that ending is not held against the customer: they can ask again later", (await ask(x, host.id, open[4])).booking.stage === "waiting");
    }

    // ----------------------------------------------------------------------
    console.log("\n6. A paid request: the card is saved, the hold comes later");
    const cardFor = async (bookingId: string, testCard: string) => {
      const b = await reload(bookingId);
      await stripe().setupIntents.confirm(b.stripeSetupIntentId!, { payment_method: testCard, return_url: "https://example.com/return" });
    };
    const paidTimes = async () => (await times(hana.id, 30, 96)).filter((t) => t.getTime() < now.getTime() + 120 * HOUR);
    let usedSlots = 0;
    const nextPaidSlot = async () => (await paidTimes())[usedSlots++ * 3];
    {
      const zoe = await customer("zoe");
      const slot = await nextPaidSlot();
      check("a customer whose bank has an open dispute cannot ask for a paid call, and is told why; nothing is written", /Your bank has an open dispute/.test((await refusalWhileDisputed(zoe.id, hana.id, () => ask(zoe, hana.id, slot))) ?? "") && (await busyOf(zoe.id)).length === 0);
      const { booking, clientSecret } = await ask(zoe, hana.id, slot);
      check("a paid request first needs a card", booking.stage === "card" && Boolean(clientSecret));
      check("until then the host does not see it and nobody's time is taken", !(await B.waitingForHost(hana.id)).some((wf) => wf.booking.id === booking.id) && (await busyOf(zoe.id)).length === 0);
      check("the price and the cancelling rule are fixed on the request", booking.totalCents === 4000 && booking.freeCancelMinutes === 1440 && booking.cardConsentAt !== null);
      check("finishing before the card is saved changes nothing", (await B.finishCardStep({ bookingId: booking.id, customerId: zoe.id, now })).stage === "card");

      await cardFor(booking.id, "pm_card_visa");
      const sent = await B.finishCardStep({ bookingId: booking.id, customerId: zoe.id, now });
      check("once Stripe confirms the card is saved, the request goes to the host", sent.stage === "waiting" && Boolean(sent.stripePaymentMethodId));
      check("the payment cut-off is the end of the host's free-cancelling period", sent.payBy?.getTime() === payCutoff(slot, 1440).getTime());
      check("nothing has been held or charged: Stripe has no payment for this customer", (await stripeIntentsOf(zoe.id)).length === 0);

      const stale = B.askForCall({ customer: zoe, hostId: hana.id, startsAt: (await paidTimes())[40], lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 1500, freeCancelMinutes: 1440 }, now });
      check("a request made from a page showing an old price is not sent", await refused(stale));

      // The host changes their price after the request was made.
      await db.update(schema.hostProfiles).set({ pricePer15Cents: 9000 }).where(eq(schema.hostProfiles.userId, hana.id));
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      await db.update(schema.hostProfiles).set({ pricePer15Cents: 2000 }).where(eq(schema.hostProfiles.userId, hana.id));
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      check("the call keeps the price it was asked for at", call.pricePer15Cents === 2000 && (await payment()).bookedCents === 4000 && (await payment()).status === "awaiting_payment");

      await runBookingJobs(now);
      check("more than 2 days before the call, nothing is held yet", (await payment()).status === "awaiting_payment" && (await reload(booking.id)).holdTriedAt === null);
      const twoDaysBefore = new Date(slot.getTime() - 47 * HOUR);
      await Promise.all([runBookingJobs(twoDaysBefore), runBookingJobs(twoDaysBefore)]); // two helpers at once
      const held = await payment();
      check("2 days before, the full price is held on the saved card, without the customer", held.status === "held" && held.stripePaymentIntentId !== null, held.status);
      const intent = await stripe().paymentIntents.retrieve(held.stripePaymentIntentId!);
      check("Stripe holds exactly the booked price, once", intent.status === "requires_capture" && intent.amount_capturable === 4000);
      const tries = await db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, held.id), eq(schema.moneyOperations.kind, "hold")));
      check("the saved card was tried exactly once", tries.length === 1 && tries[0].status === "succeeded", `${tries.length}`);

      const savedCard = sent.stripePaymentMethodId!;
      await runBookingJobs(twoDaysBefore);
      check("with the money held, the saved card is kept for the call (it can pay for more time during it)", (await reload(booking.id)).stripePaymentMethodId === savedCard && (await stripe().paymentMethods.retrieve(savedCard)).customer !== null);

      console.log("   …the customer cancels late, with the money held");
      const outcome = await cancelCall({ call, payment: held, by: "customer", now: new Date(slot.getTime() - 10 * HOUR) });
      await settleCancelledCalls();
      const charged = await payment();
      check("it is a late cancellation and the booked price is charged, as in the payments module", outcome === "late_charge" && charged.status === "charged" && charged.chargedCents === 4000, `${outcome} ${charged.status}`);
      check("the booking ends and both people are free again", (await reload(booking.id)).stage === "cancelled" && (await busyOf(zoe.id)).length === 0);
      await runBookingJobs(new Date(slot.getTime() - 10 * HOUR));
      const cleaned = await reload(booking.id);
      const card = await stripe().paymentMethods.retrieve(savedCard);
      check("once the call is cancelled, the saved card is removed from Stripe", cleaned.stripePaymentMethodId === null && card.customer === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n7. The saved card does not work when the hold is tried");
    {
      const yan = await customer("yan");
      const slot = await nextPaidSlot();
      const { booking } = await ask(yan, hana.id, slot);
      await cardFor(booking.id, "pm_card_chargeCustomerFail"); // saving works; using it later is refused
      await B.finishCardStep({ bookingId: booking.id, customerId: yan.id, now });
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      const tryAt = new Date(slot.getTime() - 47 * HOUR);
      await runBookingJobs(tryAt);
      const after = await reload(booking.id);
      check("nothing is held, and the customer is emailed to fix it", (await payment()).status === "awaiting_payment" && after.holdFailedAt !== null && (await emailsTo(yan.email, "needs your attention")) === 1);
      const firstIntent = (await payment()).stripePaymentIntentId;
      await runBookingJobs(tryAt);
      await runBookingJobs(new Date(tryAt.getTime() + HOUR));
      const tries = await db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, (await payment()).id), eq(schema.moneyOperations.kind, "hold")));
      check("the card is not tried again, and the customer is not emailed again", tries.length === 1 && (await emailsTo(yan.email, "needs your attention")) === 1, `${tries.length}`);

      console.log("   …the customer fixes it on the call page");
      const fixAt = new Date(tryAt.getTime() + 2 * HOUR);
      const started = await startHold({ payment: await payment(), call, customer: yan, now: fixAt });
      check("they are given the same hold to fix, not a second one", "clientSecret" in started && (await payment()).stripePaymentIntentId === firstIntent);
      await stripe().paymentIntents.confirm(firstIntent!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      await syncHold((await payment()).id, fixAt);
      const fixed = await payment();
      check("the money is now held, on that one hold", fixed.status === "held" && fixed.stripePaymentIntentId === firstIntent);
      await runBookingJobs(new Date(after.payBy!.getTime() - 11 * HOUR));
      check("a customer who fixed the card is not reminded", !(await eventEmail(`card_reminder:${booking.id}:customer`)));
      // A reminder written a moment before they paid (written by hand here) is stopped when its turn to be sent comes.
      await queueBookingEmails(db, await reload(booking.id), "card_reminder");
      // (One second ahead: the email's "send from" time is the database's clock to the microsecond, and a clock read here in
      // whole milliseconds straight after can be the earlier of the two, which leaves the email unclaimed.)
      await deliverEmails(new Date(Date.now() + 1000), async () => ({ ok: true, providerId: "booking-check" }), { toLike: yan.email });
      const [stopped] = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `card_reminder:${booking.id}:customer`));
      check("and a reminder written just before they paid is not sent", stopped?.status === "failed" && Boolean(stopped.lastError?.includes("the money is held")), `${stopped?.status} ${stopped?.lastError}`);
      await runBookingJobs(new Date(after.payBy!.getTime() + MINUTE));
      check("so the booking is not cancelled at the cut-off", (await reload(booking.id)).stage === "accepted");
      await cancelCall({ call, payment: fixed, by: "host", now: fixAt });
      await settleCancelledCalls();
      check("when the host cancels, the hold is let go and nothing is charged", (await payment()).status === "closed_uncharged");
    }

    // ----------------------------------------------------------------------
    console.log("\n8. The card is never fixed: cancelled for free at the cut-off");
    {
      const xia = await customer("xia");
      const slot = await nextPaidSlot();
      // For this request the host lets people cancel for free until 1 hour before: the cut-off is still a day before.
      await db.update(schema.hostSettings).set({ freeCancelMinutes: 60 }).where(eq(schema.hostSettings.userId, hana.id));
      const { booking } = await ask(xia, hana.id, slot);
      await db.update(schema.hostSettings).set({ freeCancelMinutes: 1440 }).where(eq(schema.hostSettings.userId, hana.id));
      await cardFor(booking.id, "pm_card_chargeCustomerFail");
      await B.finishCardStep({ bookingId: booking.id, customerId: xia.id, now });
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      await runBookingJobs(new Date(slot.getTime() - 47 * HOUR));
      const cutoff = (await reload(booking.id)).payBy!;
      check("the cut-off is 24 hours before the call, also for a host whose free cancelling runs until 1 hour before", booking.freeCancelMinutes === 60 && cutoff.getTime() === slot.getTime() - 24 * HOUR);
      await runBookingJobs(new Date(cutoff.getTime() - 12 * HOUR - MINUTE));
      check("more than 12 hours before the cut-off, there is no reminder yet", !(await eventEmail(`card_reminder:${booking.id}:customer`)));
      const remindAt = new Date(cutoff.getTime() - 12 * HOUR + MINUTE);
      await Promise.all([runBookingJobs(remindAt), runBookingJobs(remindAt)]); // two helpers at once
      await runBookingJobs(new Date(cutoff.getTime() - 6 * HOUR));
      const [reminder] = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `card_reminder:${booking.id}:customer`));
      check("12 hours before the cut-off the customer is reminded, once", (await emailsTo(xia.email, "still needs your card")) === 1 && (await emailsTo(xia.email, "needs your attention")) === 1);
      check("the reminder links to the call's page and is not sent after the cut-off", Boolean(reminder?.body.includes(`/calls/${callId}`)) && reminder?.expiresAt?.getTime() === cutoff.getTime());
      await runBookingJobs(new Date(cutoff.getTime() - MINUTE));
      check("before the cut-off the booking stands", (await reload(booking.id)).stage === "accepted");
      await runBookingJobs(new Date(cutoff.getTime() + MINUTE));
      await reconcileOperations(new Date(Date.now() + 5 * MINUTE));
      await settleCancelledCalls();
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const p = await payment();
      check("at the cut-off the call is cancelled, as a free cancellation", call.cancelledAt !== null && call.cancelledLate === false && (await reload(booking.id)).stage === "cancelled");
      check("nothing was charged", p.status === "closed_uncharged" && p.chargedCents === null, p.status);
      await deliverEmails(new Date(Date.now() + 1000), async () => ({ ok: true, providerId: "booking-check" }), { toLike: xia.email });
      const [late] = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `card_reminder:${booking.id}:customer`));
      check("a reminder still waiting when the call is cancelled is not sent", late?.status === "failed" && Boolean(late.lastError?.includes("no longer open")), `${late?.status} ${late?.lastError}`);
      check("both people are told, and the time is open again", (await eventEmail(`cancelled_unpaid:${booking.id}:customer`)) && (await eventEmail(`cancelled_unpaid:${booking.id}:host`)) && (await times(hana.id, 30, 96)).some((t) => t.getTime() === slot.getTime()));
    }

    // ----------------------------------------------------------------------
    console.log("\n9. The helper and the customer's browser reach for the hold at the same moment");
    {
      const wes = await customer("wes");
      const slot = await nextPaidSlot();
      const { booking } = await ask(wes, hana.id, slot);
      await cardFor(booking.id, "pm_card_visa");
      await B.finishCardStep({ bookingId: booking.id, customerId: wes.id, now });
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      const at = new Date(slot.getTime() - 47 * HOUR);
      const [, browser] = await Promise.allSettled([runBookingJobs(at), startHold({ payment: await payment(), call, customer: wes, now: at })]);
      await runBookingJobs(at);
      await reconcileOperations(new Date(Date.now() + 5 * MINUTE));
      const p = await payment();
      check("there is one hold, and the money is held once", p.status === "held" && (await stripe().paymentIntents.retrieve(p.stripePaymentIntentId!)).amount_capturable === 4000, `${p.status} ${browser.status}`);
      const mine = await stripeIntentsOf(wes.id);
      check("Stripe has exactly one hold for this customer", mine.length === 1 && mine[0].id === p.stripePaymentIntentId && mine[0].status === "requires_capture", String(mine.length));
      await cancelCall({ call, payment: p, by: "host", now: at });
      await settleCancelledCalls();
    }

    // ----------------------------------------------------------------------
    console.log("\n10. A card step that is never finished");
    {
      const val = await customer("val");
      const slot = await nextPaidSlot();
      const { booking } = await ask(val, hana.id, slot);
      await runBookingJobs(new Date(now.getTime() + (LIMITS.cardStepMinutes - 1) * MINUTE));
      check("an unfinished card step is kept for a while", (await reload(booking.id)).stage === "card");
      await runBookingJobs(new Date(now.getTime() + (LIMITS.cardStepMinutes + 1) * MINUTE));
      check("then it is dropped, without ever reaching the host", (await reload(booking.id)).stage === "ran_out");
      await cardFor(booking.id, "pm_card_visa").catch(() => undefined);
      const late = await B.finishCardStep({ bookingId: booking.id, customerId: val.id, now });
      check("saving the card too late does not bring the request back", late.stage === "ran_out" && (await busyOf(val.id)).length === 0);
      await runBookingJobs(now);
      check("and the card details are removed", (await reload(booking.id)).stripeSetupIntentId === null);
      check("a paid request without agreeing to the card wording is refused", await refused(B.askForCall({ customer: val, hostId: hana.id, startsAt: slot, lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: false, seen: { pricePer15Cents: 2000, freeCancelMinutes: 1440 }, now })));
    }

    // ----------------------------------------------------------------------
    console.log("\n11. The helper stops in the middle of trying the saved card");
    {
      const una = await customer("una");
      const slot = await nextPaidSlot();
      const { booking } = await ask(una, hana.id, slot);
      await cardFor(booking.id, "pm_card_visa");
      const sent = await B.finishCardStep({ bookingId: booking.id, customerId: una.id, now });
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      const at = new Date(slot.getTime() - 47 * HOUR);
      // The helper made the hold, wrote down "trying the saved card", and then stopped before hearing back.
      await startHold({ payment: await payment(), call, customer: una, now: at });
      const p0 = await payment();
      await db.update(schema.bookings).set({ holdTriedAt: new Date(Date.now() - 10 * MINUTE) }).where(eq(schema.bookings.id, booking.id));
      await db.insert(schema.moneyOperations).values({ paymentId: p0.id, kind: "hold", label: `holdcard:${p0.id}:1`, params: JSON.stringify({ intentId: p0.stripePaymentIntentId, paymentMethodId: sent.stripePaymentMethodId }), createdAt: new Date(Date.now() - 10 * MINUTE) });

      await runBookingJobs(new Date(sent.payBy!.getTime() + MINUTE));
      check("while the outcome is unknown, the booking is not cancelled at the cut-off and no \"card problem\" email goes out", (await reload(booking.id)).stage === "accepted" && (await emailsTo(una.email, "needs your attention")) === 0);
      await reconcileOperations(new Date(Date.now() + 5 * MINUTE));
      await reconcileOperations(new Date(Date.now() + 5 * MINUTE));
      const held = await payment();
      const intents = await stripeIntentsOf(una.id);
      check("the helper finds out by asking Stripe again, and the money is held", held.status === "held", held.status);
      check("exactly once", intents.length === 1 && intents[0].amount_capturable === 4000, String(intents.length));
      await runBookingJobs(at);
      check("the customer is never told their card failed", (await emailsTo(una.email, "needs your attention")) === 0 && (await reload(booking.id)).holdFailedAt === null);
      await cancelCall({ call, payment: held, by: "host", now: at });
      await settleCancelledCalls();
    }

    // ----------------------------------------------------------------------
    console.log("\n11b. A pause lands between the helper's two looks at the call's two people");
    {
      // (plans/45-phone-apps/09a-what-is-built-put-right.md, decision 6.) The helper asks whether the two may still
      // act, claims the one try, and then the hold itself asks again and refuses before anything is asked of Stripe.
      // A pause that lands between the two looks must not use the try up: no card was tried.
      const { tryHoldOnce } = await import("../src/lib/booking/jobs");
      const tia = await customer("tia");
      const slot = await nextPaidSlot();
      const { booking } = await ask(tia, hana.id, slot);
      await cardFor(booking.id, "pm_card_visa");
      await B.finishCardStep({ bookingId: booking.id, customerId: tia.id, now });
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      const holdTries = async () => db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, (await payment()).id), eq(schema.moneyOperations.kind, "hold")));
      const at = new Date(slot.getTime() - 47 * HOUR);

      // The try is held up between its first look and its claim: the booking's row is locked here, and the claim
      // writes that row, so it waits. In that wait the customer's account is paused (written straight into the
      // database: nothing cancels the call); then the row is let go, and the hold's own look finds the pause.
      let rowHeld = () => {};
      let letRowGo = () => {};
      const isHeld = new Promise<void>((done) => (rowHeld = done));
      const untilLetGo = new Promise<void>((done) => (letRowGo = done));
      let holder = 0;
      const holding = db.transaction(async (tx) => {
        await tx.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.id, booking.id)).for("update");
        holder = ((await tx.execute(sql`select pg_backend_pid() as pid`)) as unknown as { pid: number }[])[0].pid;
        rowHeld();
        await untilLetGo;
      });
      await isHeld;
      let seenWaiting = false;
      let outcome = "not tried";
      try {
        const trying = tryHoldOnce({ booking: await reload(booking.id), call, payment: await payment() }, at);
        for (let i = 0; i < 100 && !seenWaiting; i++) {
          const [{ n }] = (await db.execute(sql`select count(*)::int as n from pg_stat_activity a where a.wait_event_type = 'Lock' and ${holder} = any(pg_blocking_pids(a.pid))`)) as unknown as { n: number }[];
          seenWaiting = n > 0;
          if (!seenWaiting) await new Promise((done) => setTimeout(done, 100));
        }
        await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, tia.id));
        letRowGo();
        await holding;
        outcome = await trying;
      } finally {
        letRowGo();
        await holding.catch(() => undefined);
      }
      const afterPause = await reload(booking.id);
      check("(the try was seen waiting behind the booking's row: its first look was over when the pause landed)", seenWaiting);
      check(
        "a pause that lands after the helper's first look: no card is tried, nothing is asked of Stripe, and the one try is not used up",
        outcome === "unknown" && afterPause.holdTriedAt === null && afterPause.holdFailedAt === null && (await holdTries()).length === 0 && (await payment()).stripePaymentIntentId === null && (await payment()).status === "awaiting_payment",
        `${outcome} ${String(afterPause.holdTriedAt)} ${(await holdTries()).length}`,
      );
      // While the pause lasts: later passes try nothing, also two minutes on, when a try without an answer is followed up.
      await runBookingJobs(at);
      await runBookingJobs(new Date(at.getTime() + 3 * MINUTE));
      check("while the pause lasts nothing is tried, and nobody is told that a card failed", (await reload(booking.id)).holdTriedAt === null && (await holdTries()).length === 0 && (await emailsTo(tia.email, "needs your attention")) === 0);
      // The pause is lifted before the call was cancelled.
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, tia.id));
      await runBookingJobs(new Date(at.getTime() + 4 * MINUTE));
      await runBookingJobs(new Date(at.getTime() + 8 * MINUTE));
      const held = await payment();
      const tries = await holdTries();
      check("with the pause lifted, the next pass makes the real try, exactly one, and the money is held", held.status === "held" && tries.length === 1 && tries[0].status === "succeeded" && (await reload(booking.id)).holdTriedAt !== null && (await stripeIntentsOf(tia.id)).length === 1, `${held.status} ${tries.length}`);
      check("and no card email was ever written", (await emailsTo(tia.email, "needs your attention")) === 0 && (await reload(booking.id)).holdFailedAt === null);
      await cancelCall({ call, payment: held, by: "host", now: at });
      await settleCancelledCalls();
    }

    // ----------------------------------------------------------------------
    console.log("\n12. Paying after the cut-off does not count");
    {
      const tess = await customer("tess");
      const slot = await nextPaidSlot();
      const { booking } = await ask(tess, hana.id, slot);
      await cardFor(booking.id, "pm_card_chargeCustomerFail");
      await B.finishCardStep({ bookingId: booking.id, customerId: tess.id, now });
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      const at = new Date(slot.getTime() - 47 * HOUR);
      await runBookingJobs(at);
      // The customer opens the pay form in time, but leaves it open.
      const form = await startHold({ payment: await payment(), call, customer: tess, now: at });
      check("in time, the customer is given the form to fix their card", "clientSecret" in form);
      // The cut-off passes (the booking's cut-off is moved into the past to stand in for that).
      await db.update(schema.bookings).set({ payBy: new Date(Date.now() - MINUTE) }).where(eq(schema.bookings.id, booking.id));
      const late = await startHold({ payment: await payment(), call, customer: tess, now: new Date() }).catch((e) => e);
      check("after the cut-off the pay form is no longer given out", late instanceof MoneyError);
      // They pay anyway, through the form they had left open.
      const intentId = (await payment()).stripePaymentIntentId!;
      await stripe().paymentIntents.confirm(intentId, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      await syncHold((await payment()).id, new Date());
      check("a card authorised after the cut-off is not counted as paid", (await payment()).status === "awaiting_payment");
      await runBookingJobs(new Date());
      await reconcileOperations(new Date(Date.now() + 5 * MINUTE));
      await settleCancelledCalls();
      const p = await payment();
      const intent = await stripe().paymentIntents.retrieve(intentId);
      check("the booking is cancelled for free and that late hold is let go at Stripe", (await reload(booking.id)).stage === "cancelled" && p.status === "closed_uncharged" && intent.status === "canceled", `${p.status} ${intent.status}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n13. A 5-minute call");
    {
      const { saveCalendarChoices } = await import("../src/lib/booking/calendar");
      const host = await freeHost("host13", 2);
      const eve = await customer("eve13");
      // First with 10 minutes offered as well, to have a time that is good for a 10-minute call.
      await saveCalendarChoices(host.id, { timeZone: "America/New_York", lengths: [5, 10, 15], noticeHours: 24, horizonWeeks: 2, breakMinutes: 2 });
      const [goodForTen] = await times(host.id, 10);
      // Then the host ticks 5 and 15 minutes only. (7 is not one of the choices: a made-up value is dropped.)
      await saveCalendarChoices(host.id, { timeZone: "America/New_York", lengths: [5, 7, 15], noticeHours: 24, horizonWeeks: 2, breakMinutes: 2 });
      const offer = (await B.offerOf(host.id))!;
      check("a host can offer 5-minute calls", offer.lengths.join(",") === "5,15", offer.lengths.join(","));
      const five = await times(host.id, 5);
      check("the open times for 5 minutes come one call and one break apart", five.length > 3 && five[1].getTime() - five[0].getTime() === 7 * MINUTE, String(five.length));
      check("a length the host no longer ticks has no open times, and cannot be asked for even at a time that was good for it", Boolean(goodForTen) && (await times(host.id, 10)).length === 0 && (await refused(ask(eve, host.id, goodForTen, 10))));
      const { booking } = await ask(eve, host.id, five[0], 5);
      check("a 5-minute request is for exactly 5 minutes", booking.stage === "waiting" && booking.lengthMinutes === 5 && booking.endsAt.getTime() - booking.startsAt.getTime() === 5 * MINUTE);
      const { callId } = await B.accept({ bookingId: booking.id, hostId: host.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      check("accepting it makes a 5-minute call", call.endsAt.getTime() - call.startsAt.getTime() === 5 * MINUTE);
      check("the next 5-minute time, right after the call and its break, is still open; the taken one is not", (await times(host.id, 5)).some((t) => t.getTime() === five[1].getTime()) && !(await times(host.id, 5)).some((t) => t.getTime() === five[0].getTime()));
      // The shortest break is the 2 minutes that are kept free after every call (plans/42).
      const oneMinute = await saveCalendarChoices(host.id, { timeZone: "America/New_York", lengths: [5, 15], noticeHours: 24, horizonWeeks: 2, breakMinutes: 1 }).then(() => null, (e: unknown) => e as Error);
      check("a break of 1 minute can no longer be chosen", /listed breaks/.test(oneMinute?.message ?? ""), oneMinute?.message);
      // A host whose stored break is 1 minute from before that rule counts as 2 for every new request, without saving anything.
      await db.update(schema.hostCalendars).set({ breakMinutes: 1 }).where(eq(schema.hostCalendars.userId, host.id));
      const old = await ask(await customer("old13"), host.id, (await times(host.id, 5))[3], 5);
      check("a host stored at 1 minute offers, and gives a new request, a break of 2", (await B.offerOf(host.id))!.breakMinutes === 2 && old.booking.breakMinutes === 2, String(old.booking.breakMinutes));
    }

    // ----------------------------------------------------------------------
    console.log("\n14. A host sets a shortest and a longest call; the customer picks a length between them");
    {
      const { saveCalendarChoices, calendarOf } = await import("../src/lib/booking/calendar");
      const { DEFAULT_LENGTHS, lengthRange } = await import("../src/lib/booking/rules");
      const host = await freeHost("host14", 5);
      const fay = await customer("fay14");
      const choices = { timeZone: "America/New_York", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 };
      await saveCalendarChoices(host.id, { ...choices, lengths: lengthRange(10, 120)! });
      const offer = (await B.offerOf(host.id))!;
      check("10 minutes to 2 hours: every step of 5 minutes between them is offered", offer.lengths.length === 23 && offer.lengths[0] === 10 && offer.lengths[22] === 120, offer.lengths.join(","));
      const [first] = await times(host.id, 25);
      const short = await ask(fay, host.id, first, 25);
      check("a 25-minute call can be asked for", short.booking.stage === "waiting" && short.booking.lengthMinutes === 25 && short.booking.endsAt.getTime() - short.booking.startsAt.getTime() === 25 * MINUTE);
      const { callId } = await B.accept({ bookingId: short.booking.id, hostId: host.id, now });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      check("and accepted as a 25-minute call", call.endsAt.getTime() - call.startsAt.getTime() === 25 * MINUTE);
      const [later] = await times(host.id, 90, 120);
      const long = await ask(fay, host.id, later, 90);
      check("so can a call of 1 hour 30 minutes", long.booking.stage === "waiting" && long.booking.lengthMinutes === 90 && long.booking.endsAt.getTime() - long.booking.startsAt.getTime() === 90 * MINUTE);
      const longCall = await B.accept({ bookingId: long.booking.id, hostId: host.id, now });
      const [ninety] = await db.select().from(schema.calls).where(eq(schema.calls.id, longCall.callId));
      check("and it is accepted as a call of 1 hour 30 minutes", ninety.endsAt.getTime() - ninety.startsAt.getTime() === 90 * MINUTE);
      // Refused because the host does not offer the length, not for any other reason (a closed time has its own message).
      const notOffered = async (lengthMinutes: number) => {
        const [free] = await times(host.id, 30, 168);
        const problem = await ask(fay, host.id, free, lengthMinutes).then(() => null, (e: unknown) => e as Error);
        return problem instanceof BookingError && /cannot be booked right now/.test(problem.message);
      };
      check("a 30-minute call at that same time would be fine", (await times(host.id, 30, 168)).length > 0 && offer.lengths.includes(30));
      check("a length outside the host's range is refused, whatever the browser sends", (await notOffered(125)) && (await notOffered(5)));
      check("and so is a length that is not a step of 5 minutes", (await notOffered(12)) && (await notOffered(30.5)));
      check("a calendar that already exists keeps its list when it is opened", (await calendarOf(host.id, "America/New_York")).lengths === lengthRange(10, 120)!.join(","));
      const fresh = await customer("new14");
      check("a new calendar starts with 30 minutes to 2 hours", (await calendarOf(fresh.id, "America/New_York")).lengths === DEFAULT_LENGTHS.join(",") && DEFAULT_LENGTHS[0] === 30 && DEFAULT_LENGTHS[DEFAULT_LENGTHS.length - 1] === 120);

      // A paid host with every length, at $20 per 15 minutes: the price follows the chosen length.
      await db.update(schema.hostCalendars).set({ lengths: lengthRange(5, 360)!.join(",") }).where(eq(schema.hostCalendars.userId, hana.id));
      const ivy = await customer("ivy14");
      const [p25] = await times(hana.id, 25, 96);
      const paid25 = await ask(ivy, hana.id, p25, 25);
      check("at $20 per 15 minutes a 25-minute call is $33.33", paid25.booking.stage === "card" && paid25.booking.lengthMinutes === 25 && paid25.booking.totalCents === 3333, String(paid25.booking.totalCents));
      const [p90] = await times(hana.id, 90, 120);
      const paid90 = await ask(ivy, hana.id, p90, 90);
      check("and a call of 1 hour 30 minutes is $120.00", paid90.booking.stage === "card" && paid90.booking.totalCents === 12_000, String(paid90.booking.totalCents));
      await cardFor(paid90.booking.id, "pm_card_visa");
      await B.finishCardStep({ bookingId: paid90.booking.id, customerId: ivy.id, now });
      const paidCall = await B.accept({ bookingId: paid90.booking.id, hostId: hana.id, now });
      const [paidPayment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, paidCall.callId));
      check("accepted: $120.00 will be held for it", paidPayment.bookedCents === 12_000 && paidPayment.status === "awaiting_payment", `${paidPayment.bookedCents} ${paidPayment.status}`);

      // The longest call at the highest price, through booking itself.
      await db.update(schema.hostProfiles).set({ pricePer15Cents: 100_000 }).where(eq(schema.hostProfiles.userId, hana.id));
      const gus = await customer("gus14");
      const [six] = await times(hana.id, 360, 96);
      const big = await ask(gus, hana.id, six, 360);
      check("a 6-hour call at $1,000 per 15 minutes is asked for: the total is exactly $24,000", big.booking.stage === "card" && big.booking.lengthMinutes === 360 && big.booking.totalCents === 2_400_000, `${big.booking.stage} ${big.booking.totalCents}`);
      await cardFor(big.booking.id, "pm_card_visa");
      await B.finishCardStep({ bookingId: big.booking.id, customerId: gus.id, now });
      const accepted = await B.accept({ bookingId: big.booking.id, hostId: hana.id, now });
      const [bigCall] = await db.select().from(schema.calls).where(eq(schema.calls.id, accepted.callId));
      const [bigPayment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, accepted.callId));
      check("and accepted: a 6-hour call with $24,000 to be held", bigCall.endsAt.getTime() - bigCall.startsAt.getTime() === 360 * MINUTE && bigPayment.bookedCents === 2_400_000, String(bigPayment.bookedCents));
      // The test host goes back to what this script gave them at its start.
      await makeHost(hana, 2000);
      await db.update(schema.hostProfiles).set({ pricePer15Cents: 2000 }).where(eq(schema.hostProfiles.userId, hana.id));
    }
  } finally {
    // Remove the bookings this run made, so the hosts' calendars are clear for the next run.
    // (People, calls and payments are left as test data, like the payments script does.)
    const mine = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, made.length ? made : ["-"]), inArray(schema.bookings.hostId, made.length ? made : ["-"])));
    const ids = mine.map((b) => b.id);
    if (ids.length) {
      for (const id of ids) await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `%:${id}:%`));
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, ids));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, ids));
    }
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `bookcheck-${RUN}-%`));
    if (made.length) await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, made));
    for (const id of made) {
      await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true }).where(eq(schema.hostProfiles.userId, id));
    }
    if (hanaProfileBefore) await db.update(schema.hostProfiles).set({ pricePer15Cents: hanaProfileBefore.pricePer15Cents, status: hanaProfileBefore.status, hidden: hanaProfileBefore.hidden }).where(eq(schema.hostProfiles.userId, hana.id));
    if (hanaSettingsBefore) await db.update(schema.hostSettings).set({ freeCancelMinutes: hanaSettingsBefore.freeCancelMinutes }).where(eq(schema.hostSettings.userId, hana.id));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
