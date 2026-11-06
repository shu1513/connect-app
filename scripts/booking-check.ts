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
import { and, eq, inArray, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

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
  const { endBookingsOfSuspendedHost } = await import("../src/lib/booking/moderation");
  const { answerDeadline, payCutoff, LIMITS } = await import("../src/lib/booking/rules");
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
      const { booking, clientSecret } = await ask(ann, host.id, slot);
      check("a free request goes straight to the host, with no card step", booking.stage === "waiting" && clientSecret === null);
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
      check("a time that is not one of the open times is refused, whatever the browser sends", await refused(ask(pat, h1.id, new Date(slot.getTime() + 7 * MINUTE))));
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
      const cleaned = await reload(booking.id);
      const card = await stripe().paymentMethods.retrieve(savedCard);
      check("once the money is held, the saved card is removed from Stripe", cleaned.stripePaymentMethodId === null && card.customer === null);

      console.log("   …the customer cancels late, with the money held");
      const outcome = await cancelCall({ call, payment: held, by: "customer", now: new Date(slot.getTime() - 10 * HOUR) });
      await settleCancelledCalls();
      const charged = await payment();
      check("it is a late cancellation and the booked price is charged, as in the payments module", outcome === "late_charge" && charged.status === "charged" && charged.chargedCents === 4000, `${outcome} ${charged.status}`);
      check("the booking ends and both people are free again", (await reload(booking.id)).stage === "cancelled" && (await busyOf(zoe.id)).length === 0);
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
      const { booking } = await ask(xia, hana.id, slot);
      await cardFor(booking.id, "pm_card_chargeCustomerFail");
      await B.finishCardStep({ bookingId: booking.id, customerId: xia.id, now });
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now });
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      await runBookingJobs(new Date(slot.getTime() - 47 * HOUR));
      const cutoff = (await reload(booking.id)).payBy!;
      await runBookingJobs(new Date(cutoff.getTime() - MINUTE));
      check("before the cut-off the booking stands", (await reload(booking.id)).stage === "accepted");
      await runBookingJobs(new Date(cutoff.getTime() + MINUTE));
      await reconcileOperations(new Date(Date.now() + 5 * MINUTE));
      await settleCancelledCalls();
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const p = await payment();
      check("at the cut-off the call is cancelled, as a free cancellation", call.cancelledAt !== null && call.cancelledLate === false && (await reload(booking.id)).stage === "cancelled");
      check("nothing was charged", p.status === "closed_uncharged" && p.chargedCents === null, p.status);
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
