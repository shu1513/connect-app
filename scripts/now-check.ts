/**
 * Testing tool: runs the "available now" journeys against the local database
 * and the Stripe sandbox, and checks every result. No real money moves.
 *
 * It makes its own customers and free hosts, and uses host@test.local (whose
 * payout account is ready) as the paid host. It removes the bookings it made.
 *
 * Stop the always-on helper first (it would do some of these steps itself).
 * Like booking-check.ts, it runs the booking jobs with a clock set minutes
 * ahead, which can end other open requests in the local database.
 * Usage: npx tsx scripts/now-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);
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
  const N = await import("../src/lib/booking/now");
  const { NOW } = await import("../src/lib/booking/now-rules");
  const { runBookingJobs, tryHoldForAcceptedBooking } = await import("../src/lib/booking/jobs");
  const { cancelCall } = await import("../src/lib/payments/cancel");
  const { refreshPayoutsReady } = await import("../src/lib/payments/hosts");
  const { block } = await import("../src/lib/safety/blocks");

  const now = new Date();
  const refusedWith = async (work: Promise<unknown>, words: string) => {
    const error = await work.then(() => null).catch((e) => e);
    return error instanceof BookingError && error.message.includes(words) ? true : (console.log(`       got: ${error?.message ?? "no error"}`), false);
  };
  const reload = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];
  const busyOf = async (userId: string) => db.select().from(schema.busyEntries).where(eq(schema.busyEntries.userId, userId));
  const callOf = async (id: string) => (await db.select().from(schema.calls).where(eq(schema.calls.id, id)))[0];
  const paymentOf = async (callId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
  const emailsTo = async (email: string, subject: string) =>
    db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, email), like(schema.emailOutbox.subject, `%${subject}%`)));

  async function person(name: string) {
    const id = `nw-${RUN}-${name}`;
    const email = `nowcheck-${RUN}-${name}@example.test`;
    const stamp = new Date();
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    await db.insert(schema.identityChecks).values({ userId: id, stripeSessionId: `vs_nowcheck_${randomUUID()}`, status: "verified", adult: true, verifiedName: `Check ${name}`, checkedAt: stamp });
    made.push(id);
    return { id, name: `Check ${name}`, email };
  }
  async function makeHost(p: { id: string }, price: number, breakMinutes = 5) {
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `nw${RUN}${p.id.slice(-4).replace(/[^a-z0-9]/g, "")}`.toLowerCase(), handleKey: `nw${RUN}${p.id.slice(-4)}`.toLowerCase(), displayName: `Host ${p.id.slice(-4)}`, pricePer15Cents: price, status: "approved", usConfirmedAt: new Date() }).onConflictDoNothing();
    await db.insert(schema.hostSettings).values({ userId: p.id }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes }).onConflictDoUpdate({ target: schema.hostCalendars.userId, set: { timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes, availableUntil: null, availableSeenAt: null } });
    await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, p.id));
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: p.id, weekday, startMinute: 0, endMinute: 1440 })));
  }
  const askNow = (customer: { id: string; name: string; email: string }, hostId: string, lengthMinutes: number, at = now, price?: number) =>
    B.askNow({ customer, hostId, lengthMinutes, requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: price ?? 0 }, now: at });
  /** Pretends the host's page kept sending its sign of life up to this moment. */
  const keptOpen = (hostId: string, at: Date) => db.update(schema.hostCalendars).set({ availableSeenAt: at }).where(eq(schema.hostCalendars.userId, hostId));
  const cardFor = async (bookingId: string, testCard: string) => {
    const b = await reload(bookingId);
    await stripe().setupIntents.confirm(b.stripeSetupIntentId!, { payment_method: testCard, return_url: "https://example.com/return" });
  };

  const made: string[] = [];
  const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  if (!hana) throw new Error("Run `npm run seed` first.");
  if (!(await refreshPayoutsReady(hana.id))) throw new Error("Set up payouts for host@test.local on the Hosting page first.");
  const [hanaProfileBefore] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hana.id));
  const [hanaCalendarBefore] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hana.id));
  if (!hanaProfileBefore) await db.insert(schema.hostProfiles).values({ userId: hana.id, handle: "hana_host", handleKey: "hanahost", displayName: "Hana Host", pricePer15Cents: 2000, status: "approved", usConfirmedAt: new Date() });
  await db.update(schema.hostProfiles).set({ pricePer15Cents: 2000, status: "approved", hidden: false }).where(eq(schema.hostProfiles.userId, hana.id));
  await makeHost(hana, 2000);

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Switching \"available now\" on and off");
    {
      const host = await person("host1");
      await makeHost(host, 0);
      check("a host not available shows nothing", (await B.instantOffer(host.id, now)) === null);
      const on = await N.setAvailableNow({ hostId: host.id, minutes: 60, now });
      const open = await B.instantOffer(host.id, now);
      check("switched on for an hour: both lengths are offered", on.on && open?.lengths.join() === "15,30" && open.availableUntil.getTime() === now.getTime() + 60 * MINUTE);
      check("only the offered durations are allowed", await refusedWith(N.setAvailableNow({ hostId: host.id, minutes: 45, now }), "durations"));
      // The page stops saying "still here" (the tab was closed).
      await db.update(schema.hostCalendars).set({ availableSeenAt: new Date(now.getTime() - (NOW.presenceSeconds + 5) * 1000) }).where(eq(schema.hostCalendars.userId, host.id));
      check("without a recent sign of life the host is not available", (await B.instantOffer(host.id, now)) === null);
      await N.stillHere(host.id, now);
      check("a sign of life after a lapse does not bring it back: availability is over until the host switches it on again", !(await N.stillHere(host.id, now)).on && (await B.instantOffer(host.id, now)) === null && (await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, host.id)))[0].availableUntil === null);
      await N.setAvailableNow({ hostId: host.id, minutes: 60, now });
      await db.update(schema.hostCalendars).set({ availableSeenAt: new Date(now.getTime() - 10 * 1000) }).where(eq(schema.hostCalendars.userId, host.id));
      check("a sign of life in time keeps it on", (await N.stillHere(host.id, now)).on && (await B.instantOffer(host.id, now)) !== null);
      check("once the time is up it is over, and a sign of life does not revive it", !(await N.stillHere(host.id, new Date(now.getTime() + 61 * MINUTE))).on && (await B.instantOffer(host.id, new Date(now.getTime() + 61 * MINUTE))) === null);
      await N.setAvailableNow({ hostId: host.id, minutes: 60, now });
      const off = await N.setAvailableNow({ hostId: host.id, minutes: null, now });
      check("switched off by hand", !off.on && (await B.instantOffer(host.id, now)) === null);
      await N.setAvailableNow({ hostId: host.id, minutes: 30, now });
      check("with 30 minutes of availability only a call that is over by then is offered (the 30-minute one is not)", (await B.instantOffer(host.id, now))?.lengths.join() === "15");
      check("with 20 minutes left nothing is offered any more", (await B.instantOffer(host.id, new Date(now.getTime() + 20 * MINUTE))) === null);

      console.log("   …only lengths that fit before the next commitment are offered");
      await N.setAvailableNow({ hostId: host.id, minutes: 120, now });
      const other = await person("other1");
      // A call as a host in 30 minutes: a 15-minute call fits (ends by +24 with the break); a 30-minute one does not.
      const { callId } = await B.createTestCall({ hostId: host.id, customerId: other.id, startsAt: new Date(now.getTime() + 30 * MINUTE), endsAt: new Date(now.getTime() + 60 * MINUTE), pricePer15Cents: 0, freeCancelMinutes: 0 });
      check("with a call in 30 minutes only the 15-minute length is offered", (await B.instantOffer(host.id, now))?.lengths.join() === "15");
      // The host is in a call right now, as the customer of someone else.
      const [testBooking] = await db.select().from(schema.bookings).where(eq(schema.bookings.callId, callId));
      await db.update(schema.busyEntries).set({ startsAt: new Date(now.getTime() - 5 * MINUTE), endsAt: new Date(now.getTime() + 10 * MINUTE) }).where(eq(schema.busyEntries.bookingId, testBooking.id));
      check("a host who is in something right now (in either role) is not available", (await B.instantOffer(host.id, now)) === null);
      await db.delete(schema.busyEntries).where(eq(schema.busyEntries.bookingId, testBooking.id));
      await db.delete(schema.bookings).where(eq(schema.bookings.id, testBooking.id));
      await db.delete(schema.calls).where(eq(schema.calls.id, callId));
      check("a host who cannot be booked at all cannot be available", await refusedWith(N.setAvailableNow({ hostId: other.id, minutes: 30, now }), "approved"));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. A free call now: asked, accepted, started");
    {
      const host = await person("host2");
      await makeHost(host, 0);
      const ann = await person("ann");
      await N.setAvailableNow({ hostId: host.id, minutes: 60, now });
      const { booking, clientSecret } = await askNow(ann, host.id, 30);
      check("a free instant request goes straight to the host", booking.stage === "waiting" && booking.source === "now" && clientSecret === null);
      check("the host has 2 minutes to answer; no payment deadline yet", booking.respondBy?.getTime() === now.getTime() + 2 * MINUTE && booking.payBy === null);
      const annBusy = await busyOf(ann.id);
      check("the customer is taken from now until the call could be over", annBusy.length === 1 && annBusy[0].startsAt.getTime() === now.getTime() && annBusy[0].endsAt.getTime() === now.getTime() + 33 * MINUTE);
      check("the host's live page shows it", (await N.liveForHost(host.id, now)).requests.some((r) => r.id === booking.id && r.customerName === ann.name));
      check("the customer's waiting page sees it waiting", (await N.liveForCustomer(booking.id, ann.id))?.stage === "waiting");
      check("someone else cannot read it", (await N.liveForCustomer(booking.id, host.id)) === null);
      const hostMail = await emailsTo(host.email, "wants a call with you now");
      check("the host gets one short email that expires when their time to answer is up", hostMail.length === 1 && hostMail[0].expiresAt?.getTime() === booking.respondBy!.getTime());
      check("the customer cannot have a second instant request outstanding", await refusedWith(askNow(ann, host.id, 15), "already have a request"));
      check("the customer is free of the 1-an-hour digest: the host was told at once", (await reload(booking.id)).hostNotifiedAt !== null);

      const acceptedAt = new Date(now.getTime() + 40 * 1000);
      await keptOpen(host.id, acceptedAt); // the host's page has been open all along
      const { callId } = await B.accept({ bookingId: booking.id, hostId: host.id, now: acceptedAt });
      const call = await callOf(callId);
      check("accepting times the call 60 seconds from that moment", call.startsAt.getTime() === acceptedAt.getTime() + 60 * 1000 && call.endsAt.getTime() === call.startsAt.getTime() + 30 * MINUTE);
      check("an instant call charges the time together, and can be cancelled free until it starts", call.billing === "together" && call.freeCancelMinutes === 0);
      const after = await reload(booking.id);
      check("the booking carries the real time", after.stage === "accepted" && after.startsAt.getTime() === call.startsAt.getTime() && after.callId === callId);
      const hostBusy = await busyOf(host.id);
      const annAfter = await busyOf(ann.id);
      check("both are taken for the real call (the host with the break)", hostBusy.length === 1 && hostBusy[0].startsAt.getTime() === call.startsAt.getTime() && hostBusy[0].endsAt.getTime() === call.endsAt.getTime() + 5 * MINUTE && annAfter[0].startsAt.getTime() === call.startsAt.getTime() && annAfter[0].endsAt.getTime() === call.endsAt.getTime());
      check("accepting switched availability off", (await B.instantOffer(host.id, acceptedAt)) === null && !(await N.liveForHost(host.id, acceptedAt)).on);
      check("the customer's waiting page sees the call", (await N.liveForCustomer(booking.id, ann.id))?.callId === callId);
      check("the customer gets a \"ready for your call now\" email with the call's link", (await emailsTo(ann.email, "ready for your call now")).some((m) => m.body.includes(`/calls/${callId}`)));
      check("the host is not emailed about accepting (they are on the page)", (await emailsTo(host.email, "You accepted")).length === 0);
      const spare = await person("spare2");
      await makeHost(spare, 0);
      await N.setAvailableNow({ hostId: spare.id, minutes: 60, now: acceptedAt });
      check("a second instant request for the customer, with another available host, is refused while the call is coming", await refusedWith(askNow(ann, spare.id, 15, acceptedAt), "already have a request or a call"));
      await cancelCall({ call, payment: null, by: "customer", now: new Date(call.startsAt.getTime() - 10 * 1000) });
      check("cancelling 10 seconds before the start is free", (await callOf(callId)).cancelledLate === false && (await reload(booking.id)).stage === "cancelled" && (await busyOf(host.id)).length === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Not answered, declined, taken back");
    {
      const host = await person("host3");
      await makeHost(host, 0);
      const bea = await person("bea");
      const cal = await person("cal");
      await N.setAvailableNow({ hostId: host.id, minutes: 120, now });

      const { booking: unanswered } = await askNow(bea, host.id, 15);
      await keptOpen(host.id, new Date(now.getTime() + MINUTE)); // the host's page is open all along; they just do not answer
      await runBookingJobs(new Date(now.getTime() + MINUTE));
      check("still waiting after 1 minute", (await reload(unanswered.id)).stage === "waiting");
      await keptOpen(host.id, new Date(now.getTime() + 2 * MINUTE));
      await runBookingJobs(new Date(now.getTime() + 2 * MINUTE + 1000));
      check("not answered in 2 minutes: it ends by itself and the customer is free", (await reload(unanswered.id)).stage === "ran_out" && (await busyOf(bea.id)).length === 0);
      check("the customer is told", (await emailsTo(bea.email, "could not take your call now")).length === 1);
      check("the host can no longer accept it", await refusedWith(B.accept({ bookingId: unanswered.id, hostId: host.id, now }), "no longer waiting"));

      const later = new Date(now.getTime() + 5 * MINUTE);
      await keptOpen(host.id, later); // the host's page is still open
      const { booking: declined } = await askNow(bea, host.id, 15, later);
      await B.decline({ bookingId: declined.id, hostId: host.id, now: later });
      check("declined: ended, customer free, told once", (await reload(declined.id)).stage === "declined" && (await busyOf(bea.id)).length === 0 && (await emailsTo(bea.email, "could not take your call now")).length === 2);
      check("that customer cannot ask this host for a call now for 15 minutes", await refusedWith(askNow(bea, host.id, 15, later), "not taking calls from you"));
      check("but another customer can", (await askNow(cal, host.id, 15, later)).booking.stage === "waiting");
      await db.update(schema.bookings).set({ endedAt: new Date(later.getTime() - 16 * MINUTE) }).where(eq(schema.bookings.id, declined.id));
      const { booking: again } = await askNow(bea, host.id, 15, later);
      check("after 15 minutes they can ask again", again.stage === "waiting");
      await B.takeBack({ bookingId: again.id, customerId: bea.id, now: later });
      check("taking it back frees the customer and sends no email", (await reload(again.id)).stage === "taken_back" && (await busyOf(bea.id)).length === 0 && (await emailsTo(bea.email, "could not take your call now")).length === 2);

      console.log("   …decline and block; and a host who goes away while someone is waiting");
      {
        const hostB = await person("host3b");
        await makeHost(hostB, 0);
        const eve = await person("blk");
        const fay = await person("wtg");
        await N.setAvailableNow({ hostId: hostB.id, minutes: 120, now });
        const { booking: unwanted } = await askNow(eve, hostB.id, 15);
        // What the "Decline and block" button does: the decline is the answer, the block is silent.
        await B.decline({ bookingId: unwanted.id, hostId: hostB.id, now });
        await block({ blockerId: hostB.id, blockedId: eve.id, now });
        check("declined and blocked: the customer is told only that the host could not take the call", (await reload(unwanted.id)).stage === "declined" && (await emailsTo(eve.email, "could not take your call now")).length === 1);
        const muchLater = new Date(now.getTime() + 20 * MINUTE);
        await keptOpen(hostB.id, muchLater);
        check("after the 15 minutes they still cannot ask: to them the host is simply not available", await refusedWith(askNow(eve, hostB.id, 15, muchLater), "not available right now"));

        await keptOpen(hostB.id, now);
        const { booking: waiting1 } = await askNow(fay, hostB.id, 15);
        // The host closes the page: it says "gone" as it closes, which is the same as switching off.
        await N.setAvailableNow({ hostId: hostB.id, minutes: null, now });
        const ended = await reload(waiting1.id);
        check("the host closes their page: the waiting request ends at once, not after 2 minutes", ended.stage === "ran_out" && ended.endedReason === "the host is no longer available" && (await busyOf(fay.id)).length === 0);
        const told = await emailsTo(fay.email, "could not take your call now");
        check("the customer is told the host is no longer available", told.length === 1 && told[0].body.includes("is no longer available"));
        check("and nobody can ask a host who has gone", (await B.instantOffer(hostB.id, now)) === null);

        // The page vanished without saying so (a crash, a lost connection): the sign of life stops, and the helper ends what was waiting.
        const gus = await person("crs");
        await N.setAvailableNow({ hostId: hostB.id, minutes: 120, now });
        const { booking: waiting2 } = await askNow(gus, hostB.id, 15);
        await runBookingJobs(new Date(now.getTime() + 10 * 1000));
        check("10 seconds without a sign of life: still counted as there", (await reload(waiting2.id)).stage === "waiting");
        await runBookingJobs(new Date(now.getTime() + (NOW.presenceSeconds + 1) * 1000));
        check("after 15 seconds without one the host counts as gone, and the waiting request ends", (await reload(waiting2.id)).stage === "ran_out" && (await reload(waiting2.id)).endedReason === "the host is no longer available");
      }
      // Every try counts toward the daily limit, including ones taken back: bea has made 3; seven more taken back make 10.
      // (At most 3 requests to one host a day, as for booked calls, so these go to other hosts.)
      const otherHost = async (name: string) => {
        const p = await person(name);
        await makeHost(p, 0);
        await N.setAvailableNow({ hostId: p.id, minutes: 60, now: later });
        return p;
      };
      for (let i = 0; i < 7; i++) {
        const h = await otherHost(`lim${i}`);
        const { booking: tried } = await askNow(bea, h.id, 15, later);
        await B.takeBack({ bookingId: tried.id, customerId: bea.id, now: later });
      }
      const eleventh = await otherHost("lim7");
      check("the eleventh try in a day is refused, withdrawn ones included", await refusedWith(askNow(bea, eleventh.id, 15, later), "a lot of calls today"));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. A paid call now: card saved, accepted, money held at once");
    {
      const dan = await person("dan");
      await N.setAvailableNow({ hostId: hana.id, minutes: 120, now });
      const { booking, clientSecret } = await askNow(dan, hana.id, 15, now, 2000);
      check("a paid instant request first needs a card", booking.stage === "card" && Boolean(clientSecret) && booking.totalCents === 2000);
      check("a request from a page showing an old price is refused", await refusedWith(askNow(dan, hana.id, 15, now, 1500), "price changed"));
      await cardFor(booking.id, "pm_card_visa");
      // The customer took 20 minutes over the card: the request still goes, timed from when it is sent.
      const cardDone = new Date(now.getTime() + 20 * MINUTE);
      await keptOpen(hana.id, cardDone);
      const sent = await B.finishCardStep({ bookingId: booking.id, customerId: dan.id, now: cardDone });
      check("once the card is saved the host is asked, with 2 minutes to answer from then", sent.stage === "waiting" && Boolean(sent.stripePaymentMethodId) && sent.respondBy!.getTime() === cardDone.getTime() + 2 * MINUTE);
      const danBusy = await busyOf(dan.id);
      check("the customer is taken from that moment until the call could be over", danBusy.length === 1 && danBusy[0].startsAt.getTime() === cardDone.getTime() && danBusy[0].endsAt.getTime() === cardDone.getTime() + 18 * MINUTE);

      const acceptedAt = new Date(cardDone.getTime() + 30 * 1000);
      await keptOpen(hana.id, acceptedAt); // the host's page has been open all along
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now: acceptedAt });
      const accepted = await reload(booking.id);
      check("accepting sets a 2-minute payment deadline", accepted.payBy?.getTime() === acceptedAt.getTime() + 2 * MINUTE);
      let payment = await paymentOf(callId);
      check("the payment exists and is not held yet", payment.status === "awaiting_payment");
      const hold = await tryHoldForAcceptedBooking(booking.id, acceptedAt);
      payment = await paymentOf(callId);
      check("the saved card is tried at once and the money is held", hold === "held" && payment.status === "held" && Boolean(payment.stripePaymentIntentId));
      check("the one try is not made twice", (await tryHoldForAcceptedBooking(booking.id, acceptedAt)) === "already_tried");
      check("the hold is counted from the real call, 60 seconds after accepting", (await callOf(callId)).startsAt.getTime() === acceptedAt.getTime() + 60 * 1000 && (await callOf(callId)).billing === "together");
      await runBookingJobs(acceptedAt);
      check("the saved card is removed once the money is held", (await reload(booking.id)).stripePaymentMethodId === null && (await reload(booking.id)).stripeSetupIntentId === null);
      check("the customer's email says the money is being held for the time together", (await emailsTo(dan.email, "ready for your call now")).some((m) => m.body.includes("time you were both in it")));

      // The customer cancels before the start: free, and the hold is let go.
      const call = await callOf(callId);
      const outcome = await cancelCall({ call, payment, by: "customer", now: new Date(call.startsAt.getTime() - 5 * 1000) });
      payment = await paymentOf(callId);
      check("cancelling before the start is free and releases the hold", outcome === "free" && payment.status === "closed_uncharged" && payment.chargedCents === null, payment.status);
      const intent = await stripe().paymentIntents.retrieve(payment.stripePaymentIntentId!);
      check("Stripe shows the hold cancelled, nothing captured", intent.status === "canceled" && intent.amount_received === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. A paid call now whose card is refused");
    {
      const eve = await person("eve");
      const at = new Date(now.getTime() + 10 * MINUTE);
      await N.setAvailableNow({ hostId: hana.id, minutes: 60, now: at });
      const { booking } = await askNow(eve, hana.id, 15, at, 2000);
      await cardFor(booking.id, "pm_card_chargeCustomerFail"); // saving works; using it is refused
      await B.finishCardStep({ bookingId: booking.id, customerId: eve.id, now: at });
      const acceptedAt = new Date(at.getTime() + 20 * 1000);
      await keptOpen(hana.id, acceptedAt); // the host's page has been open all along
      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now: acceptedAt });
      const hold = await tryHoldForAcceptedBooking(booking.id, acceptedAt);
      check("the refusal is known at once and the customer is told how to fix it", hold === "not_held" && (await reload(booking.id)).holdFailedAt !== null && (await emailsTo(eve.email, "needs your attention")).some((m) => m.body.includes(`/calls/${callId}`)));
      await runBookingJobs(new Date(acceptedAt.getTime() + 90 * 1000));
      check("before the deadline the call stands", (await callOf(callId)).cancelledAt === null);
      await runBookingJobs(new Date(acceptedAt.getTime() + 2 * MINUTE + 1000));
      const ended = await reload(booking.id);
      check("at the 2-minute deadline the call is cancelled for free; nothing was charged", (await callOf(callId)).cancelledAt !== null && ended.stage === "cancelled" && (await paymentOf(callId)).chargedCents === null);
      check("both are told", (await emailsTo(eve.email, "was cancelled")).length === 1 && (await emailsTo(hana.email, "was cancelled")).some((m) => m.body.includes("could not be held in time")));
      check("that counts as a card failure for the hour", ended.holdFailedAt !== null);
    }
  } finally {
    const people = made.length ? made : ["-"];
    const mine = await db.select({ id: schema.bookings.id, callId: schema.bookings.callId }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, people), inArray(schema.bookings.hostId, people)));
    const ids = mine.map((b) => b.id);
    if (ids.length) {
      for (const id of ids) await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `%:${id}:%`));
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, ids));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, ids));
    }
    // Calls and payments are left as test data, like the other scripts do; the people are kept with them.
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `nowcheck-${RUN}-%`));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, people));
    for (const id of made) await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true }).where(eq(schema.hostProfiles.userId, id));
    await db.update(schema.hostCalendars).set({ availableUntil: null, availableSeenAt: null }).where(inArray(schema.hostCalendars.userId, [...people, hana.id]));
    if (hanaProfileBefore) await db.update(schema.hostProfiles).set({ pricePer15Cents: hanaProfileBefore.pricePer15Cents, status: hanaProfileBefore.status, hidden: hanaProfileBefore.hidden }).where(eq(schema.hostProfiles.userId, hana.id));
    if (hanaCalendarBefore) await db.update(schema.hostCalendars).set({ lengths: hanaCalendarBefore.lengths, noticeHours: hanaCalendarBefore.noticeHours, horizonWeeks: hanaCalendarBefore.horizonWeeks, breakMinutes: hanaCalendarBefore.breakMinutes }).where(eq(schema.hostCalendars.userId, hana.id));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
