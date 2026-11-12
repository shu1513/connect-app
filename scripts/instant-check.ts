/**
 * Testing tool: the "available now" and "more time" journeys against the local
 * database and the Stripe sandbox, checking every result. No real money moves.
 *
 * It makes its own customers and free hosts, and uses host@test.local (whose
 * payout account is ready) as the paid host. Stop the always-on helper first
 * (it would cancel unpaid calls itself). Like booking-check.ts, it replaces the
 * calendar and weekly hours of host@test.local. It removes the bookings it made.
 * Usage: npx tsx scripts/instant-check.ts
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
  const { BookingError, createTestCall } = await import("../src/lib/booking/bookings");
  const I = await import("../src/lib/booking/instant");
  const { INSTANT_LEAD_MS } = await import("../src/lib/booking/instant-rules");
  const { runBookingJobs } = await import("../src/lib/booking/jobs");
  const { roomState } = await import("../src/lib/calls");
  const { startHold, syncHold } = await import("../src/lib/payments/hold");
  const { paymentBlocksJoin } = await import("../src/lib/payments/rules");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { cancelCall } = await import("../src/lib/payments/cancel");
  const { settleCancelledCalls } = await import("../src/lib/payments/jobs");
  const { refreshPayoutsReady } = await import("../src/lib/payments/hosts");
  const { endCallForSafety } = await import("../src/lib/safety/calls");
  const { writeCallReminders } = await import("../src/lib/notifications/reminders");
  const { setSwitches } = await import("../src/lib/safety/switches");

  const now = new Date();
  const refused = async (work: Promise<unknown>) => (await work.then(() => null).catch((e) => e)) instanceof BookingError;
  const callOf = async (id: string) => (await db.select().from(schema.calls).where(eq(schema.calls.id, id)))[0];
  const bookingOf = async (callId: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.callId, callId)))[0];
  const paymentOf = async (callId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
  const busyOf = async (userId: string) => db.select().from(schema.busyEntries).where(eq(schema.busyEntries.userId, userId)).orderBy(schema.busyEntries.startsAt);
  const emailsTo = async (email: string, subject: string) =>
    (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, email), like(schema.emailOutbox.subject, `%${subject}%`)))).length;

  const made: string[] = [];
  const calls: string[] = [];
  async function person(name: string) {
    const id = `in-${RUN}-${name}`;
    const email = `instantcheck-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Check ${name}`, email };
  }
  async function customer(name: string, identity = true) {
    const p = await person(name);
    if (identity) await db.insert(schema.identityChecks).values({ userId: p.id, stripeSessionId: `vs_instantcheck_${randomUUID()}`, status: "verified", adult: true, verifiedName: p.name, checkedAt: now });
    return p;
  }
  async function makeHost(p: { id: string }, price: number, breakMinutes = 5) {
    const key = p.id.slice(-4).replace(/[^a-z0-9]/g, "");
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `in${RUN}${key}`.toLowerCase(), handleKey: `in${RUN}${key}`.toLowerCase(), displayName: `Host ${key}`, pricePer15Cents: price, status: "approved", usConfirmedAt: now }).onConflictDoNothing();
    await db.insert(schema.hostSettings).values({ userId: p.id }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "15,30,45,60", noticeHours: 24, horizonWeeks: 2, breakMinutes }).onConflictDoUpdate({ target: schema.hostCalendars.userId, set: { lengths: "15,30,45,60", breakMinutes } });
  }
  const freeHost = async (name: string) => {
    const p = await customer(name);
    await makeHost(p, 0);
    return p;
  };
  const start = async (c: { id: string; name: string; email: string }, hostId: string, lengthMinutes = 30, at = now, requestKey = randomUUID()) => {
    const { callId } = await I.startInstantCall({ customer: c, hostId, lengthMinutes, requestKey, now: at });
    calls.push(callId);
    return callOf(callId);
  };

  // --- the paid host: host@test.local, whose payout account is ready
  const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  if (!hana) throw new Error("Run `npm run seed` first.");
  if (!(await refreshPayoutsReady(hana.id))) throw new Error("Set up payouts for host@test.local on the Hosting page first.");
  const [hanaBefore] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hana.id));
  if (!hanaBefore) await db.insert(schema.hostProfiles).values({ userId: hana.id, handle: "hana_host", handleKey: "hanahost", displayName: "Hana Host", pricePer15Cents: 2000, status: "approved", usConfirmedAt: now });
  await db.update(schema.hostProfiles).set({ pricePer15Cents: 2000, status: "approved", hidden: false }).where(eq(schema.hostProfiles.userId, hana.id));
  await makeHost(hana, 2000);

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. The available-now switch");
    {
      const host = await freeHost("host1");
      const ann = await customer("ann");
      check("not available until switched on", (await I.instantOfferOf(host.id, now, ann.id)) === null);
      await I.setAvailableNow(host.id, 60, now);
      const offer = await I.instantOfferOf(host.id, now, ann.id);
      check("switched on: every length fits, the call would start in 5 minutes", offer !== null && offer.lengths.join() === "15,30,45,60" && offer.startsAt.getTime() === Math.floor((now.getTime() + INSTANT_LEAD_MS) / 1000) * 1000);
      check("it switches itself off when the time is up", (await I.instantOfferOf(host.id, new Date(now.getTime() + 56 * MINUTE), ann.id)) === null);
      check("a call that would start inside the window is still fine near the end", (await I.instantOfferOf(host.id, new Date(now.getTime() + 54 * MINUTE), ann.id)) !== null);
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
      check("a hidden host is not available", (await I.instantOfferOf(host.id, now, ann.id)) === null);
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));
      await I.setAvailableNow(host.id, null, now);
      check("switched off by the host", (await I.instantOfferOf(host.id, now, ann.id)) === null);
      const pending = await customer("pend1");
      await makeHost(pending, 0);
      await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, pending.id));
      check("a host who is not approved cannot switch it on", await refused(I.setAvailableNow(pending.id, 30, now)));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. A free call that starts now");
    {
      const host = await freeHost("host2");
      const ann = await customer("ann2");
      await I.setAvailableNow(host.id, 60, now);
      const key = randomUUID();
      const call = await start(ann, host.id, 30, now, key);
      const booking = await bookingOf(call.id);
      check("the call exists at once, starts in 5 minutes, is free to cancel until then", call.startsAt.getTime() - now.getTime() > INSTANT_LEAD_MS - 1000 && call.freeCancelMinutes === 0 && call.continuesCallId === null);
      check("its booking is already accepted, marked as started now, and counts as asked for now", booking.stage === "accepted" && booking.source === "instant" && booking.requestedAt?.getTime() === now.getTime() && booking.payBy === null && booking.freeCancelMinutes === 0);
      const hostBusy = await busyOf(host.id);
      const annBusy = await busyOf(ann.id);
      check("the host is taken for the call plus the break, the customer for the call", hostBusy.length === 1 && hostBusy[0].endsAt.getTime() === call.endsAt.getTime() + 5 * MINUTE && annBusy.length === 1 && annBusy[0].endsAt.getTime() === call.endsAt.getTime());
      check("the room is open right away", roomState(call, now) === "open");
      check("the host is told by email, with the link", (await emailsTo(host.email, "is calling you now")) === 1);
      check("pressing the button twice makes one call", (await start(ann, host.id, 30, now, key)).id === call.id && calls.length === 2);
      calls.pop();
      check("no reminders are written for a call that starts now", (await writeCallReminders(now)) >= 0 && (await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `reminder:${call.id}:%`))).length === 0);
      const again = await I.instantOfferOf(host.id, now, (await customer("bob2")).id);
      check("the host now shows as in a call: nothing fits", again !== null && again.inCall && again.lengths.length === 0);
      const other = await freeHost("host2b");
      await I.setAvailableNow(other.id, 60, now);
      check("the customer, taken for this call, cannot start another one meanwhile", await refused(start(ann, other.id)));

      console.log("   …two customers press the button on the same host at the same moment");
      const host3 = await freeHost("host2c");
      await I.setAvailableNow(host3.id, 60, now);
      const [p, q] = await Promise.all([customer("p2"), customer("q2")]);
      const results = await Promise.allSettled([start(p, host3.id), start(q, host3.id)]);
      const made3 = await db.select().from(schema.calls).where(eq(schema.calls.hostId, host3.id));
      check("exactly one call is made; the other is refused in plain words", results.filter((r) => r.status === "fulfilled").length === 1 && made3.length === 1 && results.some((r) => r.status === "rejected" && r.reason instanceof BookingError), results.map((r) => r.status).join(" "));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Calls already booked come first; the gates; the daily limit");
    {
      const host = await freeHost("host3");
      const kim = await customer("kim");
      await I.setAvailableNow(host.id, 120, now);
      // A booked call 45 minutes from now: 15 and 30 minutes fit before it (with the break); 45 and 60 do not.
      const soon = new Date(Math.ceil((now.getTime() + 45 * MINUTE) / 1000) * 1000);
      const { callId: booked } = await createTestCall({ hostId: host.id, customerId: (await customer("lee")).id, startsAt: soon, endsAt: new Date(soon.getTime() + 30 * MINUTE), pricePer15Cents: 0, freeCancelMinutes: 0 });
      calls.push(booked);
      const offer = await I.instantOfferOf(host.id, now, kim.id);
      check("only the lengths that fit before the booked call are offered", offer?.lengths.join() === "15,30", offer?.lengths.join());
      check("asking for a length that does not fit is refused", await refused(start(kim, host.id, 45)));

      const stranger = await customer("nobody", false);
      check("a first free call needs the identity check", await refused(start(stranger, host.id, 15)));
      await db.insert(schema.blocks).values({ blockerId: host.id, blockedId: kim.id });
      check("a block either way: the host is simply not available", (await I.instantOfferOf(host.id, now, kim.id)) !== null && (await refused(start(kim, host.id, 15))));
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, host.id));
      await setSwitches({ requestsOff: false, joiningOff: true });
      check("while joining is switched off, no call can be started", await refused(start(kim, host.id, 15)));
      await setSwitches({ requestsOff: false, joiningOff: false });
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, kim.id));
      check("a paused customer cannot start a call", await refused(start(kim, host.id, 15)));
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, kim.id));

      console.log("   …three starts with one host in a day, cancelled or not");
      for (let i = 0; i < 3; i++) {
        const c = await start(kim, host.id, 15);
        await cancelCall({ call: c, payment: null, by: "customer", now });
      }
      check("the fourth is refused, even though the others were cancelled", await refused(start(kim, host.id, 15)));
      check("cancelling freed the customer's and the host's time each time", (await busyOf(kim.id)).length === 0 && (await busyOf(host.id)).length === 1);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. A paid call that starts now");
    await I.setAvailableNow(hana.id, 120, now);
    let heldCall: typeof schema.calls.$inferSelect;
    {
      const zoe = await customer("zoe");
      const call = await start(zoe, hana.id, 30);
      heldCall = call;
      const booking = await bookingOf(call.id);
      const payment = await paymentOf(call.id);
      check("the call, its payment and the pay-by time (the start) exist", payment.status === "awaiting_payment" && payment.bookedCents === 4000 && booking.payBy?.getTime() === call.startsAt.getTime());
      check("nobody can join until the money is held", paymentBlocksJoin({ payment, callEndsAt: call.endsAt, now }) === "not_paid");
      const started = await startHold({ payment, call, customer: zoe, now });
      check("the customer is given the usual card form", "clientSecret" in started);
      await stripe().paymentIntents.confirm((await paymentOf(call.id)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      const held = await syncHold(payment.id, now);
      check("once confirmed, the money is held and the call can be joined", held.status === "held" && paymentBlocksJoin({ payment: held, callEndsAt: call.endsAt, now }) === null);
      check("the host's email says the room lets them in once the money is held", (await emailsTo(hana.email, "is calling you now")) >= 1);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. A paid call that is never paid for");
    {
      const yan = await customer("yan");
      // Later on, once the host's call from journey 4 (and its break) is over.
      const later = new Date(now.getTime() + 40 * MINUTE);
      const call = await start(yan, hana.id, 15, later);
      await runBookingJobs(later);
      check("before the start, the call stands", (await callOf(call.id)).cancelledAt === null);
      // The helper was late: it only gets to it 2 minutes after the start. Nobody could have been inside.
      const late = new Date(call.startsAt.getTime() + 2 * MINUTE);
      await runBookingJobs(late);
      await settleCancelledCalls(late);
      const after = await callOf(call.id);
      const payment = await paymentOf(call.id);
      check("it is cancelled anyway, for free, and the payment is closed", after.cancelledAt !== null && after.cancelledLate === false && payment.status === "closed_uncharged", payment.status);
      check("both people are told, and both are free again", (await emailsTo(yan.email, "was cancelled")) === 1 && (await emailsTo(hana.email, "was cancelled")) >= 1 && (await busyOf(yan.id)).length === 0);
      const tooLate = await startHold({ payment, call: after, customer: yan, now: late }).catch((e) => e);
      check("paying after that is refused", tooLate instanceof MoneyError);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. More time during a free call");
    {
      const host = await freeHost("host6");
      const ann = await customer("ann6");
      await I.setAvailableNow(host.id, 60, now);
      const part1 = await start(ann, host.id, 30);
      check("not by the customer", await refused(I.offerMoreTime({ call: part1, hostId: ann.id, lengthMinutes: 15, now })));
      check("not with less than 5 minutes left", await refused(I.offerMoreTime({ call: part1, hostId: host.id, lengthMinutes: 15, now: new Date(part1.endsAt.getTime() - 4 * MINUTE) })));
      const { callId } = await I.offerMoreTime({ call: part1, hostId: host.id, lengthMinutes: 15, now });
      calls.push(callId);
      const part2 = await callOf(callId);
      const booking2 = await bookingOf(callId);
      check("part 2 starts exactly when part 1 ends, points back to it, and is free to cancel until it starts", part2.startsAt.getTime() === part1.endsAt.getTime() && part2.continuesCallId === part1.id && part2.freeCancelMinutes === 0 && booking2.source === "extension" && booking2.requestedAt === null);
      const hostBusy = await busyOf(host.id);
      check("the host's reservation for part 2 begins where part 1's break ends; no gap, nothing shortened", hostBusy.length === 2 && hostBusy[0].endsAt.getTime() === hostBusy[1].startsAt.getTime() && hostBusy[1].endsAt.getTime() === part2.endsAt.getTime() + 5 * MINUTE);
      check("the customer is taken for part 2 right after part 1", (await busyOf(ann.id)).map((b) => b.startsAt.getTime()).join() === [part1.startsAt.getTime(), part2.startsAt.getTime()].join());
      check("a free part 2 is ready at once", (await I.nextPartOf(part1.id))?.status === "ready");
      check("part 2's room does not open early", roomState(part2, new Date(part2.startsAt.getTime() - MINUTE)) === "not_open_yet" && roomState(part2, part2.startsAt) === "open");
      check("a second offer while one is pending is refused", await refused(I.offerMoreTime({ call: part1, hostId: host.id, lengthMinutes: 15, now })));
      await cancelCall({ call: part2, payment: null, by: "customer", now });
      check("the customer declines: part 2 is gone, part 1 and its break are untouched", (await I.nextPartOf(part1.id)) === null && (await busyOf(host.id)).length === 1 && (await busyOf(host.id))[0].endsAt.getTime() === part1.endsAt.getTime() + 5 * MINUTE);
      const second = await I.offerMoreTime({ call: part1, hostId: host.id, lengthMinutes: 30, now });
      calls.push(second.callId);
      check("after a decline, more time can be offered again", (await I.nextPartOf(part1.id))?.lengthMinutes === 30);
      const third = await I.offerMoreTime({ call: await callOf(second.callId), hostId: host.id, lengthMinutes: 15, now: new Date(part1.endsAt.getTime() + 10 * MINUTE) });
      calls.push(third.callId);
      check("a part 2 can itself be extended", (await callOf(third.callId)).continuesCallId === second.callId);

      console.log("   …\"End call and report\" on part 1");
      await endCallForSafety({ call: part1, by: ann.id, now });
      check("ends the pending part 2 too, for free", (await callOf(second.callId)).cancelledAt !== null && (await callOf(second.callId)).cancelledLate === false && (await I.nextPartOf(part1.id)) === null);
      {
        // The stop comes in part 1's last minute, when part 2 has already started: part 2 is stopped too, not left running.
        const hostL = await freeHost("host6l");
        const custL = await customer("cust6l");
        await I.setAvailableNow(hostL.id, 60, now);
        const l1 = await start(custL, hostL.id, 15);
        const { callId: l2 } = await I.offerMoreTime({ call: l1, hostId: hostL.id, lengthMinutes: 15, now });
        calls.push(l2);
        await endCallForSafety({ call: l1, by: custL.id, now: new Date(l1.endsAt.getTime() + 30_000) });
        check("a part 2 that has already started is stopped the same way", (await callOf(l2)).safetyEndedAt !== null);
      }
      check("and nothing more can be offered on it",await refused(I.offerMoreTime({ call: await callOf(part1.id), hostId: host.id, lengthMinutes: 15, now })));

      console.log("   …a booked call right after part 1");
      const host7 = await freeHost("host6b");
      const dan = await customer("dan6");
      await I.setAvailableNow(host7.id, 60, now);
      const p1 = await start(dan, host7.id, 15);
      const next = new Date(p1.endsAt.getTime() + 5 * MINUTE);
      const { callId: booked } = await createTestCall({ hostId: host7.id, customerId: (await customer("eve6")).id, startsAt: next, endsAt: new Date(next.getTime() + 15 * MINUTE), pricePer15Cents: 0, freeCancelMinutes: 0 });
      calls.push(booked);
      check("more time cannot run into the host's next call", await refused(I.offerMoreTime({ call: p1, hostId: host7.id, lengthMinutes: 15, now })));
    }

    // ----------------------------------------------------------------------
    console.log("\n7. More time during a paid call");
    {
      const zoe = (await db.select().from(schema.user).where(eq(schema.user.id, heldCall.customerId)))[0];
      const { callId } = await I.offerMoreTime({ call: heldCall, hostId: hana.id, lengthMinutes: 15, now });
      calls.push(callId);
      const part2 = await callOf(callId);
      const payment2 = await paymentOf(callId);
      const booking2 = await bookingOf(callId);
      check("part 2 has its own payment at the same price, to be paid before it starts", payment2.status === "awaiting_payment" && payment2.bookedCents === 2000 && part2.pricePer15Cents === 2000 && booking2.payBy?.getTime() === part2.startsAt.getTime());
      check("until then it is not ready", (await I.nextPartOf(heldCall.id))?.status === "unpaid");
      const form = await startHold({ payment: payment2, call: part2, customer: zoe, now });
      check("the customer is given a card form for part 2 on its own", "clientSecret" in form);
      await stripe().paymentIntents.confirm((await paymentOf(callId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      const held2 = await syncHold(payment2.id, now);
      check("once held, part 2 is ready; part 1's hold is untouched", held2.status === "held" && (await I.nextPartOf(heldCall.id))?.status === "ready" && (await paymentOf(heldCall.id)).status === "held");
      await cancelCall({ call: part2, payment: held2, by: "host", now });
      await settleCancelledCalls(now);
      check("the host withdraws it: free, the hold is let go", (await paymentOf(callId)).status === "closed_uncharged" && (await I.nextPartOf(heldCall.id)) === null);

      console.log("   …a paid part 2 that is never paid for");
      const { callId: unpaidId } = await I.offerMoreTime({ call: heldCall, hostId: hana.id, lengthMinutes: 15, now });
      calls.push(unpaidId);
      const unpaid = await callOf(unpaidId);
      await runBookingJobs(new Date(unpaid.startsAt.getTime() + MINUTE));
      await settleCancelledCalls(new Date(unpaid.startsAt.getTime() + MINUTE));
      check("at its start it is cancelled for free; part 1 stands", (await callOf(unpaidId)).cancelledAt !== null && (await paymentOf(unpaidId)).status === "closed_uncharged" && (await callOf(heldCall.id)).cancelledAt === null);
      check("the host's reservation for part 1, break included, is intact", (await busyOf(hana.id)).some((b) => b.startsAt.getTime() === heldCall.startsAt.getTime() && b.endsAt.getTime() === heldCall.endsAt.getTime() + 5 * MINUTE));
    }
  } finally {
    // Clear away what this run made: calls still open are cancelled (free), then the bookings and busy entries go.
    for (const id of calls.reverse()) {
      const call = await callOf(id);
      if (call && !call.cancelledAt && call.startsAt > new Date()) {
        const payment = await paymentOf(id);
        await cancelCall({ call, payment: payment ?? null, by: "admin", now: new Date() }).catch(() => undefined);
      }
    }
    await settleCancelledCalls(new Date()).catch(() => undefined);
    const ids = made.length ? made : ["-"];
    const mine = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, ids), inArray(schema.bookings.hostId, ids), inArray(schema.bookings.callId, calls.length ? calls : [randomUUID()])));
    const bookingIds = mine.map((b) => b.id);
    if (bookingIds.length) {
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookingIds));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
    }
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `instantcheck-${RUN}-%`));
    if (made.length) {
      await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, made));
      await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, made), inArray(schema.blocks.blockedId, made)));
      await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true, availableUntil: null }).where(inArray(schema.hostProfiles.userId, made));
    }
    await db.update(schema.hostProfiles).set({ availableUntil: null, ...(hanaBefore ? { pricePer15Cents: hanaBefore.pricePer15Cents, status: hanaBefore.status, hidden: hanaBefore.hidden } : {}) }).where(eq(schema.hostProfiles.userId, hana.id));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
