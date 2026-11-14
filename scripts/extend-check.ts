/**
 * Testing tool: runs the "adding time during a call" journeys against the
 * local database and the Stripe sandbox, and checks every result. No real
 * money moves.
 *
 * It makes its own customers and a free host, and uses host@test.local (whose
 * payout account is ready) as the paid host. It removes the bookings it made.
 *
 * Stop the always-on helper first (it would do some of these steps itself).
 * Like the other journey scripts, it runs the helper's jobs with a clock set
 * hours ahead, which can end other open requests in the local database.
 * Usage: npx tsx scripts/extend-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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
  const N = await import("../src/lib/booking/now");
  const { runBookingJobs, tryHoldForAcceptedBooking } = await import("../src/lib/booking/jobs");
  const { runPaymentJobs, settleFinishedCalls, runPayday } = await import("../src/lib/payments/jobs");
  const { capturePayment, refundPayment, releasePayment } = await import("../src/lib/payments/actions");
  const { startHold, syncHold } = await import("../src/lib/payments/hold");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { paymentToRefund } = await import("../src/lib/payments/access");
  const { ownPaymentOf, paymentsOfCall } = await import("../src/lib/payments/own");
  const { reviewChargeLimitCents } = await import("../src/lib/payments/pricing");
  const { paymentBlocksJoin } = await import("../src/lib/payments/rules");
  const { refreshPayoutsReady } = await import("../src/lib/payments/hosts");
  const { loadAttendance } = await import("../src/lib/attendance/load");
  const { endCallForSafety } = await import("../src/lib/safety/calls");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { closeCallIfDue } = await import("../src/lib/video/closing");
  const X = await import("../src/lib/extend/extend");
  const { ExtendError } = X;

  // Each journey gets its own two hours, starting a few hours from now, so calls never get in each other's way.
  const T0 = Math.ceil(Date.now() / 1000) * 1000 + 3 * HOUR;
  const slot = (k: number) => new Date(T0 + k * 2 * HOUR);

  type Person = { id: string; name: string; email: string };
  const refusedWith = async (work: Promise<unknown>, words: string) => {
    const error = await work.then(() => null).catch((e) => e);
    return error instanceof ExtendError && error.message.includes(words) ? true : (console.log(`       got: ${error?.message ?? "no error"}`), false);
  };
  const callOf = async (id: string) => (await db.select().from(schema.calls).where(eq(schema.calls.id, id)))[0];
  const bookingOf = async (callId: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.callId, callId)))[0];
  const busyOf = async (callId: string, userId: string) => {
    const booking = await bookingOf(callId);
    return (await db.select().from(schema.busyEntries).where(and(eq(schema.busyEntries.bookingId, booking.id), eq(schema.busyEntries.userId, userId))))[0];
  };
  const extensionsOf = async (callId: string) => db.select().from(schema.callExtensions).where(eq(schema.callExtensions.callId, callId)).orderBy(schema.callExtensions.createdAt);
  const extensionOf = async (id: string) => (await db.select().from(schema.callExtensions).where(eq(schema.callExtensions.id, id)))[0];
  const paymentOfExtension = async (id: string) => (await db.select().from(schema.payments).where(eq(schema.payments.extensionId, id)))[0];
  const intentOf = async (payment: { stripePaymentIntentId: string | null }) => stripe().paymentIntents.retrieve(payment.stripePaymentIntentId!);
  /** A moment this many seconds before the call's end, as it stands now. */
  const beforeEnd = async (callId: string, seconds: number) => new Date((await callOf(callId)).endsAt.getTime() - seconds * 1000);
  const ask = async (callId: string, customer: Person, minutes: number, secondsLeft: number) => X.askForMoreTime({ callId, customerId: customer.id, minutes, now: await beforeEnd(callId, secondsLeft) });
  const answer = async (extensionId: string, callId: string, host: Person, accept: boolean, secondsLeft: number) => X.answerExtension({ extensionId, hostId: host.id, accept, now: await beforeEnd(callId, secondsLeft) });
  /** Everything the always-on helper does in one pass (except closing rooms), at the given moment. */
  const allJobs = async (at: Date) => {
    await runPaymentJobs(at);
    await X.closeFinishedExtensions(at);
    await runBookingJobs(at);
  };

  const made: string[] = [];
  async function person(name: string): Promise<Person> {
    const id = `ex-${RUN}-${name}`;
    const email = `extendcheck-${RUN}-${name}@example.test`;
    const stamp = new Date();
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    await db.insert(schema.identityChecks).values({ userId: id, stripeSessionId: `vs_extendcheck_${randomUUID()}`, status: "verified", adult: true, verifiedName: `Check ${name}`, checkedAt: stamp });
    made.push(id);
    return { id, name: `Check ${name}`, email };
  }
  async function makeHost(p: { id: string }, price: number, breakMinutes = 5) {
    const tag = `${RUN}${p.id.slice(-5).replace(/[^a-z0-9]/gi, "")}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `ex${tag}`, handleKey: `ex${tag}`, displayName: `Host ${p.id.slice(-5)}`, pricePer15Cents: price, status: "approved", usConfirmedAt: new Date() }).onConflictDoNothing();
    await db.insert(schema.hostSettings).values({ userId: p.id }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes }).onConflictDoUpdate({ target: schema.hostCalendars.userId, set: { timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes, availableUntil: null, availableSeenAt: null } });
    await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, p.id));
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: p.id, weekday, startMinute: 0, endMinute: 1440 })));
  }
  /** A free 15-minute call made the way the admin test page makes one (the host's break is 1 minute). */
  const freeCall = async (host: Person, customer: Person, startsAt: Date, minutes = 15) =>
    (await B.createTestCall({ hostId: host.id, customerId: customer.id, startsAt, endsAt: new Date(startsAt.getTime() + minutes * MINUTE), pricePer15Cents: 0, freeCancelMinutes: 0 })).callId;
  /** An instant call asked for at this moment and accepted 20 seconds later: it starts a minute after that and lasts 15 minutes. */
  async function instantCall(host: Person, customer: Person, at: Date, price: number, card = "pm_card_visa") {
    await N.setAvailableNow({ hostId: host.id, minutes: 60, now: at });
    const { booking } = await B.askNow({ customer, hostId: host.id, lengthMinutes: 15, requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: price }, now: at });
    if (price > 0) {
      const [fresh] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
      await stripe().setupIntents.confirm(fresh.stripeSetupIntentId!, { payment_method: card, return_url: "https://example.com/return" });
      await B.finishCardStep({ bookingId: booking.id, customerId: customer.id, now: at });
    }
    const acceptedAt = new Date(at.getTime() + 20 * 1000);
    await db.update(schema.hostCalendars).set({ availableSeenAt: acceptedAt }).where(eq(schema.hostCalendars.userId, host.id));
    const { callId } = await B.accept({ bookingId: booking.id, hostId: host.id, now: acceptedAt });
    const hold = price > 0 ? await tryHoldForAcceptedBooking(booking.id, acceptedAt) : "nothing_to_hold";
    return { callId, bookingId: booking.id, acceptedAt, hold };
  }
  /** Adds attendance messages as if the video service had sent them, and marks the room closed at the call's end. Offsets are seconds from the call's start. */
  async function attend(callId: string, visits: Array<["host" | "customer", number, number]>) {
    const call = await callOf(callId);
    for (const [who, from, to] of visits) {
      const identity = who === "host" ? call.hostId : call.customerId;
      const session = `PA_${who}_${randomUUID().slice(0, 6)}`;
      const row = (type: string, offset: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId, type, roomSessionId: "RM_extendcheck", participantIdentity: identity, participantSessionId: session, providerTime: new Date(call.startsAt.getTime() + offset * 1000), payload: "{}" });
      await db.insert(schema.attendanceEvents).values([row("participant_joined", from), row("participant_left", to)]);
    }
    await db.update(schema.calls).set({ closedAt: call.safetyEndedAt ?? call.endsAt }).where(eq(schema.calls.id, callId));
  }

  const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  if (!hana) throw new Error("Run `npm run seed` first.");
  if (!(await refreshPayoutsReady(hana.id))) throw new Error("Set up payouts for host@test.local on the Hosting page first.");
  const [hanaProfileBefore] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hana.id));
  const [hanaCalendarBefore] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hana.id));
  const hanaHoursBefore = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hana.id));
  if (!hanaProfileBefore) await db.insert(schema.hostProfiles).values({ userId: hana.id, handle: "hana_host", handleKey: "hanahost", displayName: "Hana Host", pricePer15Cents: 2000, status: "approved", usConfirmedAt: new Date() });
  await db.update(schema.hostProfiles).set({ pricePer15Cents: 2000, status: "approved", hidden: false }).where(eq(schema.hostProfiles.userId, hana.id));
  await makeHost(hana, 2000);
  const switchesBefore = await switches();

  try {
    const fred = await person("freehost");
    await makeHost(fred, 0, 5);

    // ----------------------------------------------------------------------
    console.log("\n1. A free call is made longer, twice");
    {
      const cust = await person("c1");
      const stranger = await person("stranger");
      const callId = await freeCall(fred, cust, slot(1));
      const booked = await callOf(callId);
      check("asking with more than 1 minute 30 left is refused", await refusedWith(ask(callId, cust, 10, 91), "last minute and a half"));
      check("someone who is not on the call cannot ask", await refusedWith(ask(callId, stranger, 10, 80), "Call not found"));
      check("the host cannot ask (the customer asks, the host answers)", await refusedWith(ask(callId, fred, 10, 80), "Call not found"));
      check("fewer than 5 minutes is refused", await refusedWith(ask(callId, cust, 4, 80), "least you can add is 5"));
      check("a part of a minute is refused", await refusedWith(ask(callId, cust, 7.5, 80), "whole number"));
      check("more than 60 minutes in one request is refused", await refusedWith(ask(callId, cust, 61, 80), "up to 60"));
      check("none of those left a request behind", (await extensionsOf(callId)).length === 0);

      const asked = await ask(callId, cust, 10, 80);
      const view = await X.extensionView(callId);
      check("with 1 minute 20 left the customer asks for 10 minutes; the host is asked at once", asked.state === "waiting" && view.open?.id === asked.extensionId && view.open.ready && view.open.minutes === 10 && view.open.priceCents === 0);
      check("a second request while one is waiting is refused", await refusedWith(ask(callId, cust, 5, 70), "already asked"));
      check("a stranger cannot answer", await refusedWith(answer(asked.extensionId, callId, stranger, true, 60), "Request not found"));
      check("the customer cannot answer their own request", await refusedWith(answer(asked.extensionId, callId, cust, true, 60), "Request not found"));
      check("nothing has moved yet", (await callOf(callId)).endsAt.getTime() === booked.endsAt.getTime());

      check("the host accepts with 30 seconds left", (await answer(asked.extensionId, callId, fred, true, 30)) === "accepted");
      const longer = await callOf(callId);
      const booking = await bookingOf(callId);
      check("the same call now ends 10 minutes later", longer.endsAt.getTime() === booked.endsAt.getTime() + 10 * MINUTE && longer.roomName === booked.roomName && longer.startsAt.getTime() === booked.startsAt.getTime());
      check("the booking's end and length moved with it", booking.endsAt.getTime() === longer.endsAt.getTime() && booking.lengthMinutes === 25 && booking.totalCents === 0);
      check("the host is taken until the new end plus their break; the customer until the new end", (await busyOf(callId, fred.id)).endsAt.getTime() === longer.endsAt.getTime() + booking.breakMinutes * MINUTE && (await busyOf(callId, cust.id)).endsAt.getTime() === longer.endsAt.getTime());
      check("the request is on record as accepted, and a free call has no payment", (await extensionOf(asked.extensionId)).status === "accepted" && (await paymentsOfCall(callId)).length === 0);
      check("at the old end, the helper does not close the room: the call was made longer", (await closeCallIfDue(callId, new Date(booked.endsAt.getTime() + 1000))) === "not over");
      check("answering again changes nothing", await refusedWith(X.answerExtension({ extensionId: asked.extensionId, hostId: fred.id, accept: false, now: new Date(booked.endsAt.getTime() - 20_000) }), "no longer waiting"));
      check("the customer cannot ask again until the last minute and a half of the longer call", await refusedWith(ask(callId, cust, 5, 300), "last minute and a half"));

      const again = await ask(callId, cust, 5, 60);
      await answer(again.extensionId, callId, fred, true, 20);
      check("near the new end the call is made longer again, by 5 minutes", (await callOf(callId)).endsAt.getTime() === booked.endsAt.getTime() + 15 * MINUTE && (await bookingOf(callId)).lengthMinutes === 30);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Declined, not answered, too late, and how often one can ask");
    let finishedCallId: string;
    {
      const cust = await person("c2");
      const callId = await freeCall(fred, cust, slot(2));
      finishedCallId = callId;
      const booked = await callOf(callId);
      const first = await ask(callId, cust, 5, 80);
      check("the host declines", (await answer(first.extensionId, callId, fred, false, 70)) === "declined");
      const view = await X.extensionView(callId);
      check("the request is on record as declined and the call ends as booked", view.open === null && view.last?.status === "declined" && (await callOf(callId)).endsAt.getTime() === booked.endsAt.getTime());
      check("a declined request can never be accepted afterwards", await refusedWith(answer(first.extensionId, callId, fred, true, 65), "no longer waiting"));

      const second = await ask(callId, cust, 5, 60);
      check("after a no, the customer may ask again", second.state === "waiting");
      check("with 5 seconds left it is too late for the host to accept", await refusedWith(answer(second.extensionId, callId, fred, true, 5), "too late"));
      await X.closeFinishedExtensions(new Date(booked.endsAt.getTime() + 1000));
      check("a request nobody answered ends with the call", (await extensionOf(second.extensionId)).status === "ran_out" && (await callOf(callId)).endsAt.getTime() === booked.endsAt.getTime());
      check("one that ran out can never be accepted, even by a clock that says there is time", await refusedWith(answer(second.extensionId, callId, fred, true, 30), "no longer waiting"));

      const cust3 = await person("c3");
      const other = await freeCall(fred, cust3, slot(3));
      check("with 15 seconds left it is too late to ask", await refusedWith(ask(other, cust3, 5, 15), "too late"));
      check("after the end nothing can be asked", await refusedWith(ask(other, cust3, 5, -5), "ended"));
      const race = await Promise.allSettled([ask(other, cust3, 5, 80), ask(other, cust3, 10, 80)]);
      const open = (await extensionsOf(other)).filter((e) => e.status === "open");
      check("two requests at the same moment: one is taken, the other refused", race.filter((r) => r.status === "fulfilled").length === 1 && open.length === 1);
      await answer(open[0].id, other, fred, false, 78);
      for (let n = 2; n <= 5; n++) {
        const next = await ask(other, cust3, 5, 78 - n);
        await answer(next.extensionId, other, fred, false, 78 - n);
      }
      check("a call can have 5 requests, and the sixth is refused", (await extensionsOf(other)).length === 5 && (await refusedWith(ask(other, cust3, 5, 60), "as often as one call allows")));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Only as much as fits before the next thing either person has");
    {
      const cust = await person("c4");
      const otherCust = await person("c5");
      const { callId } = await instantCall(fred, cust, slot(4), 0);
      const call = await callOf(callId);
      check("the break fixed on the booking is the host's 5 minutes", (await bookingOf(callId)).breakMinutes === 5);
      check("with nothing coming up, 60 minutes fit", (await X.addTimeChoices(call)).fits === 60);
      // The host has another call 12 minutes after this one ends.
      await freeCall(fred, otherCust, new Date(call.endsAt.getTime() + 12 * MINUTE));
      check("the host's next call is 12 minutes later: 7 minutes fit, leaving the 5-minute break", (await X.addTimeChoices(call)).fits === 7);
      check("asking for 10 is refused", await refusedWith(ask(callId, cust, 10, 80), "up to 7"));
      // The customer has a call with someone else 6 minutes after this one ends.
      const otherHost = await person("h2");
      await freeCall(otherHost, cust, new Date(call.endsAt.getTime() + 6 * MINUTE));
      check("the customer's own next call is 6 minutes later: 6 minutes fit", (await X.addTimeChoices(call)).fits === 6);
      check("asking for 7 is refused", await refusedWith(ask(callId, cust, 7, 80), "up to 6"));
      const asked = await ask(callId, cust, 6, 80);
      await answer(asked.extensionId, callId, fred, true, 40);
      check("exactly what fits can be added, right up to the customer's next call", (await callOf(callId)).endsAt.getTime() === call.endsAt.getTime() + 6 * MINUTE);
      check("now nothing more fits, and asking says so", (await X.addTimeChoices(await callOf(callId))).fits === 0 && (await refusedWith(ask(callId, cust, 5, 60), "no room")));

      // The time is free when the customer asks, and taken by another call at the moment the host accepts.
      const cust6 = await person("c6");
      const cust7 = await person("c7");
      const second = await freeCall(fred, cust6, slot(5));
      const secondCall = await callOf(second);
      const waiting = await ask(second, cust6, 10, 80);
      const both = await Promise.allSettled([answer(waiting.extensionId, second, fred, true, 40), freeCall(fred, cust7, new Date(secondCall.endsAt.getTime() + 5 * MINUTE))]);
      const accepted = both[0].status === "fulfilled";
      const extension = await extensionOf(waiting.extensionId);
      const end = (await callOf(second)).endsAt.getTime();
      check(
        "more time and another call for the same minutes at the same moment: exactly one of the two goes through",
        (both[0].status === "fulfilled") !== (both[1].status === "fulfilled") &&
          (accepted ? extension.status === "accepted" && end === secondCall.endsAt.getTime() + 10 * MINUTE : extension.status === "failed" && end === secondCall.endsAt.getTime()),
        `${both[0].status} ${both[1].status} ${extension.status}`,
      );

      // Somebody else's waiting request for the host, in the minutes the longer call will take.
      const cust8 = await person("c8");
      const cust9 = await person("c9");
      const third = await freeCall(fred, cust8, slot(6));
      const thirdCall = await callOf(third);
      const [inTheWay] = await db
        .insert(schema.bookings)
        .values({ hostId: fred.id, customerId: cust9.id, startsAt: new Date(thirdCall.endsAt.getTime() + 3 * MINUTE), endsAt: new Date(thirdCall.endsAt.getTime() + 18 * MINUTE), lengthMinutes: 15, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "waiting", requestKey: randomUUID(), requestedAt: new Date(), respondBy: thirdCall.endsAt })
        .returning();
      await db.insert(schema.busyEntries).values({ bookingId: inTheWay.id, userId: cust9.id, startsAt: inTheWay.startsAt, endsAt: inTheWay.endsAt });
      const more = await ask(third, cust8, 10, 80);
      await answer(more.extensionId, third, fred, true, 40);
      const [passed] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, inTheWay.id));
      check("a waiting request of someone else for those minutes ends, as when the host accepts any call", passed.stage === "passed_over" && (await db.select().from(schema.busyEntries).where(eq(schema.busyEntries.bookingId, inTheWay.id))).length === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. When time cannot be added at all");
    {
      const cust = await person("c10");
      const callId = await freeCall(fred, cust, slot(7));
      await setSwitches({ ...switchesBefore, joiningOff: true });
      check("while the founder has switched joining off, nobody can ask", await refusedWith(ask(callId, cust, 5, 80), "paused across Connect"));
      await setSwitches(switchesBefore);
      await db.insert(schema.blocks).values({ blockerId: cust.id, blockedId: fred.id });
      check("after either person blocks the other, nobody can ask", await refusedWith(ask(callId, cust, 5, 80), "can no longer be added"));
      await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, cust.id), eq(schema.blocks.blockedId, fred.id)));
      const asked = await ask(callId, cust, 5, 80);
      await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, cust.id));
      check("a request of a customer who was paused meanwhile cannot be accepted", await refusedWith(answer(asked.extensionId, callId, fred, true, 60), "can no longer be added"));
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));

      const stoppedAt = await beforeEnd(callId, 50);
      await endCallForSafety({ call: await callOf(callId), by: cust.id, now: stoppedAt });
      check("the call is stopped with \"End call and report\" while the request waits", (await callOf(callId)).safetyEndedAt !== null);
      check("the request can no longer be accepted", await refusedWith(answer(asked.extensionId, callId, fred, true, 40), "ended"));
      await X.closeFinishedExtensions(stoppedAt);
      check("and it is closed by the helper", (await extensionOf(asked.extensionId)).status === "ran_out");
      check("nothing more can be asked on a stopped call", await refusedWith(ask(callId, cust, 5, 45), "ended"));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The room closes at the booked end");
    {
      const call = await callOf(finishedCallId);
      check("a second before the end the helper leaves the room alone", (await closeCallIfDue(call.id, new Date(call.endsAt.getTime() - 1000))) === "not over");
      const closed = await closeCallIfDue(call.id, call.endsAt).catch((error) => `error: ${error?.message}`);
      check("at the booked end, not a minute later, the helper closes it", closed === "closed" && (await callOf(call.id)).closedAt !== null, String(closed));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. A paid call is made longer: two holds, two charges, each for its own minutes");
    {
      const cust = await person("p1");
      const { callId, bookingId, acceptedAt, hold } = await instantCall(hana, cust, slot(8), 2000);
      const booked = await callOf(callId);
      const own = async () => (await ownPaymentOf(callId))!;
      check("the call's own payment is held on the saved card: $20.00 for 15 minutes", hold === "held" && (await own()).status === "held" && (await own()).bookedCents === 2000);
      check("it pays for the booked time and nothing else", (await own()).coversFrom.getTime() === booked.startsAt.getTime() && (await own()).coversUntil.getTime() === booked.endsAt.getTime() && (await own()).extensionId === null);
      await runBookingJobs(acceptedAt);
      const savedCard = (await bookingOf(callId)).stripePaymentMethodId;
      check("the saved card is kept while the call is still to come", savedCard !== null);

      const asked = await ask(callId, cust, 10, 80);
      const extra = async () => paymentOfExtension(asked.extensionId);
      check("the customer asks for 10 more minutes: $13.33 is held before the host is asked", asked.state === "waiting" && (await extra()).status === "held" && (await extra()).bookedCents === 1333 && (await X.extensionView(callId)).open?.ready === true);
      check("it is a payment of its own, for exactly the extra minutes, on the call's own terms", (await extra()).callId === callId && (await extra()).coversFrom.getTime() === booked.endsAt.getTime() && (await extra()).coversUntil.getTime() === booked.endsAt.getTime() + 10 * MINUTE && (await extra()).pricePer15Cents === 2000 && (await extra()).feeFixedCents === 30 && (await extra()).feePercentBps === 490);
      const [ownIntent, extraIntent] = [await intentOf(await own()), await intentOf(await extra())];
      check("Stripe holds $20.00 and, separately, $13.33, on the same card", ownIntent.status === "requires_capture" && ownIntent.amount_capturable === 2000 && extraIntent.status === "requires_capture" && extraIntent.amount_capturable === 1333 && extraIntent.payment_method === ownIntent.payment_method && extraIntent.payment_method === savedCard);
      check("the call still has exactly one payment of its own", (await paymentsOfCall(callId)).filter((p) => p.extensionId === null).length === 1 && (await paymentsOfCall(callId)).length === 2);
      const second = await db.transaction((tx) => tx.insert(schema.payments).values({ callId, coversFrom: booked.startsAt, coversUntil: booked.endsAt, pricePer15Cents: 2000, bookedCents: 2000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150 })).then(() => "allowed", () => "refused");
      check("the database refuses a second own payment for a call", second === "refused");

      // The dangerous moment: the extra hold is still on its way (our record says "not paid yet"), the
      // booking's own pay-by time is long past, and every helper job runs.
      const during = await beforeEnd(callId, 70);
      await db.update(schema.payments).set({ status: "awaiting_payment", heldAt: null, holdExpiresAt: null }).where(eq(schema.payments.id, (await extra()).id));
      check("until the extra hold is on record, the host is not asked and cannot accept", (await X.extensionView(callId)).open?.ready === false && (await refusedWith(answer(asked.extensionId, callId, hana, true, 60), "not in place")));
      await allJobs(during);
      await allJobs(during);
      check("with the extra money still being held, the helper's jobs leave the call alone", (await callOf(callId)).cancelledAt === null && (await bookingOf(callId)).stage === "accepted" && (await own()).status === "held" && (await extensionOf(asked.extensionId)).status === "open" && (await extra()).status === "awaiting_payment");
      await syncHold((await extra()).id, during);
      check("the hold is put on record by a check with Stripe, and the host can be asked", (await extra()).status === "held" && (await X.extensionView(callId)).open?.ready === true);
      await allJobs(during);
      check("with the request waiting for the host, the jobs leave everything alone", (await callOf(callId)).cancelledAt === null && (await own()).status === "held" && (await extra()).status === "held" && (await extensionOf(asked.extensionId)).status === "open");

      // The bank's answer to the hold was lost (its action is still written down as "started"), but the
      // hold is on record as held. The host must be able to accept. Anything else under way must stop them.
      const [letGo] = await db.insert(schema.moneyOperations).values({ paymentId: (await extra()).id, kind: "release", label: `release:${(await extra()).id}:check`, params: "{}" }).returning();
      check("while a release is under way on the extra hold, the host cannot accept", await refusedWith(answer(asked.extensionId, callId, hana, true, 45), "still being confirmed"));
      await db.delete(schema.moneyOperations).where(eq(schema.moneyOperations.id, letGo.id));
      await db.insert(schema.moneyOperations).values({ paymentId: (await extra()).id, kind: "hold", label: `holdcard:${(await extra()).id}:lost`, params: JSON.stringify({ intentId: (await extra()).stripePaymentIntentId, paymentMethodId: savedCard }) });
      check("the host accepts, even though the bank's answer to the hold was lost: the hold itself is on record", (await answer(asked.extensionId, callId, hana, true, 40)) === "accepted");
      const longer = await callOf(callId);
      const booking = await bookingOf(callId);
      check("the call ends 10 minutes later and the booking's total is the two prices added up", longer.endsAt.getTime() === booked.endsAt.getTime() + 10 * MINUTE && booking.lengthMinutes === 25 && booking.totalCents === 3333);
      await allJobs(new Date(longer.endsAt.getTime() - 5 * MINUTE));
      check("during the added time the jobs leave the call, both holds and the saved card alone", (await callOf(callId)).cancelledAt === null && (await own()).status === "held" && (await extra()).status === "held" && (await bookingOf(callId)).stripePaymentMethodId === savedCard);
      check("someone who drops out can get back in: the call's own hold is checked against its own minutes", paymentBlocksJoin({ payment: await own(), callEndsAt: (await own()).coversUntil, now: new Date(longer.endsAt.getTime() - 5 * MINUTE) }) === null);

      // Both were there for the booked 15 minutes; the host left 2 minutes before the new end.
      const total = (longer.endsAt.getTime() - longer.startsAt.getTime()) / 1000;
      await attend(callId, [["host", 0, total - 120], ["customer", 0, total]]);
      await settleFinishedCalls(new Date(longer.endsAt.getTime() + 5 * MINUTE));
      const [chargedOwn, chargedExtra] = [await own(), await extra()];
      check("the call's own payment is charged in full for its 15 minutes: $20.00", chargedOwn.status === "charged" && chargedOwn.chargedCents === 2000 && chargedOwn.frozenTogetherSeconds === 900, `${chargedOwn.status} ${chargedOwn.chargedCents}`);
      check("the extra payment is charged for the 8 of its 10 minutes both were there: $10.67", chargedExtra.status === "charged" && chargedExtra.chargedCents === 1067 && chargedExtra.frozenTogetherSeconds === 480, `${chargedExtra.status} ${chargedExtra.chargedCents}`);
      check("Stripe charged exactly those two amounts", (await intentOf(chargedOwn)).amount_received === 2000 && (await intentOf(chargedExtra)).amount_received === 1067);
      check("the usual fee applies to each: $1.28 and 82 cents", chargedOwn.originalFeeCents === 128 && chargedExtra.originalFeeCents === 82 && chargedExtra.originalHostShareCents === 985, `${chargedOwn.originalFeeCents} ${chargedExtra.originalFeeCents}`);
      await runBookingJobs(new Date(longer.endsAt.getTime() + 3 * MINUTE));
      const card = await stripe().paymentMethods.retrieve(savedCard!);
      check("once the call is over, the saved card is removed from Stripe", (await bookingOf(callId)).stripePaymentMethodId === null && card.customer === null);
      void bookingId;

      // Refunds name their payment.
      const otherHostCall = await freeCall(fred, await person("p1x"), slot(9));
      const allowed = await paymentToRefund({ callId, paymentId: chargedExtra.id, userId: hana.id, adminLogin: false });
      check("the host may refund the extra payment of their own call", typeof allowed === "object" && allowed.decidedAs === "host" && allowed.payment.id === chargedExtra.id);
      check("another host cannot refund it by naming it with a call of their own", (await paymentToRefund({ callId: otherHostCall, paymentId: chargedExtra.id, userId: fred.id, adminLogin: false })) === "not_found");
      check("nor by naming the real call", (await paymentToRefund({ callId, paymentId: chargedExtra.id, userId: fred.id, adminLogin: false })) === "not_allowed");
      check("the customer cannot refund themselves", (await paymentToRefund({ callId, paymentId: chargedExtra.id, userId: cust.id, adminLogin: false })) === "not_allowed");
      const asAdmin = await paymentToRefund({ callId, paymentId: chargedOwn.id, userId: fred.id, adminLogin: true });
      check("the founder may refund any payment of a call", typeof asAdmin === "object" && asAdmin.decidedAs === "admin");
      await refundPayment({ paymentId: chargedExtra.id, amountCents: 500, decidedBy: hana.id, decidedAs: "host", reason: "check" });
      check("a refund of the extra payment leaves the call's own payment untouched", (await extra()).refundedCents === 500 && (await own()).refundedCents === 0);

      const payday = (await own()).transferDueAt!;
      check("both are due on the same weekly payday", (await extra()).transferDueAt?.getTime() === payday.getTime());
      await runPayday(payday);
      const [paidOwn, paidExtra] = [await own(), await extra()];
      const transfers = (await stripe().transfers.list({ transfer_group: callId, limit: 10 })).data;
      check("on payday the host is sent a share for each, one transfer each", paidOwn.transferStatus === "sent" && paidExtra.transferStatus === "sent" && transfers.length === 2, `${paidOwn.transferStatus} ${paidExtra.transferStatus} ${transfers.length}`);
      // The extra payment: $10.67 less the $5.00 refund = $5.67 paid; the host's share shrinks in proportion (985 × 567 / 1067 = 523).
      check("each share is what that payment earned, less any payout charge it carried", (paidOwn.transferCents ?? 0) + (paidOwn.payoutFeeCents ?? 0) === 1872 && (paidExtra.transferCents ?? 0) + (paidExtra.payoutFeeCents ?? 0) === 523, `${paidOwn.transferCents}+${paidOwn.payoutFeeCents} ${paidExtra.transferCents}+${paidExtra.payoutFeeCents}`);
      check("the 25-cent payout charge is not taken twice for the two", (paidOwn.payoutFeeCents ?? 0) + (paidExtra.payoutFeeCents ?? 0) <= 25);
    }

    // ----------------------------------------------------------------------
    console.log("\n7. A request that was declined and one that was accepted, for the same minutes");
    {
      const cust = await person("p2");
      const { callId } = await instantCall(hana, cust, slot(10), 2000);
      const first = await ask(callId, cust, 5, 85);
      const firstPayment = async () => paymentOfExtension(first.extensionId);
      check("$6.67 is held for 5 more minutes", (await firstPayment()).status === "held" && (await firstPayment()).bookedCents === 667);
      // The host says no, and the hold is slow to let go: marked declined, still held.
      await db.update(schema.callExtensions).set({ status: "declined", endedReason: "declined by the host", decidedAt: new Date() }).where(eq(schema.callExtensions.id, first.extensionId));
      const refused = await capturePayment({ paymentId: (await firstPayment()).id, amountCents: 667, reason: "attendance", frozen: null, callEndsAt: (await callOf(callId)).endsAt }).catch((e) => e);
      check("a declined request cannot be charged, even while its hold is still there", refused instanceof MoneyError && refused.message.includes("not accepted") && (await firstPayment()).status === "held", refused?.message);

      const second = await ask(callId, cust, 5, 70);
      await answer(second.extensionId, callId, hana, true, 50);
      const call = await callOf(callId);
      const total = (call.endsAt.getTime() - call.startsAt.getTime()) / 1000;
      await attend(callId, [["host", 0, total], ["customer", 0, total]]);
      // The charge after the call runs before anything has let the declined hold go.
      await settleFinishedCalls(new Date(call.endsAt.getTime() + 5 * MINUTE));
      const accepted = await paymentOfExtension(second.extensionId);
      check("after the call, only the accepted request is charged for those minutes", accepted.status === "charged" && accepted.chargedCents === 667 && (await firstPayment()).status === "held" && (await firstPayment()).chargedCents === null, `${accepted.status} ${(await firstPayment()).status}`);
      await X.closeFinishedExtensions(new Date(call.endsAt.getTime() + 5 * MINUTE));
      check("and the helper lets the declined one's hold go", (await firstPayment()).status === "closed_uncharged" && (await intentOf(await firstPayment())).status === "canceled");
      const all = await paymentsOfCall(callId);
      check("in all the customer paid the booked price plus one extension: $26.67", all.reduce((sum, p) => sum + (p.chargedCents ?? 0), 0) === 2667);
    }

    // ----------------------------------------------------------------------
    console.log("\n8. No, a refused card, a late hold, and a race with the end");
    {
      const cust = await person("p3");
      const { callId } = await instantCall(hana, cust, slot(12), 2000);
      const booked = await callOf(callId);
      const own = async () => (await ownPaymentOf(callId))!;

      const first = await ask(callId, cust, 5, 85);
      await answer(first.extensionId, callId, hana, false, 80);
      const declined = await paymentOfExtension(first.extensionId);
      check("the host declines: the extra hold is cancelled at Stripe and nothing is charged", declined.status === "closed_uncharged" && (await intentOf(declined)).status === "canceled");
      check("the call's own hold is untouched", (await own()).status === "held" && (await intentOf(await own())).amount_capturable === 2000 && (await callOf(callId)).endsAt.getTime() === booked.endsAt.getTime());

      // A card the bank refuses when it is used (saving it works).
      const [known] = await db.select().from(schema.stripeCustomers).where(eq(schema.stripeCustomers.userId, cust.id));
      const badCard = await stripe().paymentMethods.attach("pm_card_chargeCustomerFail", { customer: known.stripeCustomerId });
      const refusedCard = await X.askForMoreTime({ callId, customerId: cust.id, minutes: 5, now: await beforeEnd(callId, 75) }, async () => badCard.id).then(() => null, (e) => e);
      const failed = (await extensionsOf(callId))[1];
      const failedPayment = await paymentOfExtension(failed.id);
      check("the bank refuses the card: the customer is told, and the request ends at once", refusedCard instanceof ExtendError && refusedCard.message.includes("could not be used") && failed.status === "failed", refusedCard?.message);
      check("nothing is left held for it, and the call ends as booked", failedPayment.status === "closed_uncharged" && (await intentOf(failedPayment)).status === "canceled" && (await callOf(callId)).endsAt.getTime() === booked.endsAt.getTime());
      await stripe().paymentMethods.detach(badCard.id);

      // A hold that lands after its request has ended.
      const third = await ask(callId, cust, 5, 70);
      const late = async () => paymentOfExtension(third.extensionId);
      await db.update(schema.payments).set({ status: "awaiting_payment", heldAt: null, holdExpiresAt: null }).where(eq(schema.payments.id, (await late()).id));
      await db.update(schema.callExtensions).set({ status: "ran_out", decidedAt: new Date() }).where(eq(schema.callExtensions.id, third.extensionId));
      await syncHold((await late()).id, await beforeEnd(callId, 60));
      check("a hold that lands after its request ended does not count", (await late()).status === "awaiting_payment" && (await intentOf(await late())).status === "requires_capture");
      await X.closeFinishedExtensions(await beforeEnd(callId, 60));
      check("and the helper lets it go", (await late()).status === "closed_uncharged" && (await intentOf(await late())).status === "canceled");

      // The host accepts at the very moment the helper finds the call over.
      const fourth = await ask(callId, cust, 5, 50);
      const race = await Promise.allSettled([answer(fourth.extensionId, callId, hana, true, 10), X.closeFinishedExtensions(new Date(booked.endsAt.getTime() + 1000))]);
      await X.closeFinishedExtensions(await beforeEnd(callId, 10));
      const ended = await extensionOf(fourth.extensionId);
      const racePayment = await paymentOfExtension(fourth.extensionId);
      const end = (await callOf(callId)).endsAt.getTime();
      check(
        "accepting at the same moment the request runs out: either it is accepted and its hold kept, or it ran out and its hold was let go",
        (ended.status === "accepted" && race[0].status === "fulfilled" && end === booked.endsAt.getTime() + 5 * MINUTE && racePayment.status === "held") ||
          (ended.status === "ran_out" && race[0].status === "rejected" && end === booked.endsAt.getTime() && racePayment.status === "closed_uncharged"),
        `${ended.status} ${race[0].status} ${racePayment.status}`,
      );
      await releasePayment({ paymentId: (await own()).id, note: "Released by the check." });
      if (racePayment.status === "held") await db.update(schema.callExtensions).set({ status: "ran_out" }).where(eq(schema.callExtensions.id, fourth.extensionId));
      await X.closeFinishedExtensions(new Date(end + 1000));
    }

    // ----------------------------------------------------------------------
    console.log("\n9. A paid call whose card was not saved");
    {
      // The customer typed a card on the call page: it was used once and never saved.
      const cust = await person("p4");
      const startsAt = slot(14);
      const { callId } = await B.createTestCall({ hostId: hana.id, customerId: cust.id, startsAt, endsAt: new Date(startsAt.getTime() + 15 * MINUTE), pricePer15Cents: 2000, freeCancelMinutes: 0 });
      const own = async () => (await ownPaymentOf(callId))!;
      await startHold({ payment: await own(), call: await callOf(callId), customer: cust, now: new Date() });
      await stripe().paymentIntents.confirm((await own()).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      await syncHold((await own()).id, new Date());
      check("the money for the call is held on a card that was typed in", (await own()).status === "held");
      check("more time cannot be added, and the customer is told why", await refusedWith(ask(callId, cust, 5, 80), "was not saved"));
      check("no request and no second payment were made", (await extensionsOf(callId)).length === 0 && (await paymentsOfCall(callId)).length === 1);
      await releasePayment({ paymentId: (await own()).id, note: "Released by the check." });

      // A booking made under the earlier wording ("for this booking only"): its card goes as soon as the money is held.
      const old = await person("p5");
      const made5 = await instantCall(hana, old, slot(16), 2000);
      await db.update(schema.bookings).set({ cardConsentVersion: "2026-11-a" }).where(eq(schema.bookings.id, made5.bookingId));
      await runBookingJobs(made5.acceptedAt);
      check("a booking made under the earlier wording loses its saved card once the money is held, as its customer was told", (await bookingOf(made5.callId)).stripePaymentMethodId === null);
      check("so more time cannot be added to that call", await refusedWith(ask(made5.callId, old, 5, 80), "was not saved"));
      await releasePayment({ paymentId: (await ownPaymentOf(made5.callId))!.id, note: "Released by the check." });
    }

    // ----------------------------------------------------------------------
    console.log("\n10. \"End call and report\" on a paid call with more time");
    {
      const cust = await person("p6");
      const { callId } = await instantCall(hana, cust, slot(18), 2000);
      const asked = await ask(callId, cust, 10, 80);
      const stoppedAt = await beforeEnd(callId, 60);
      await endCallForSafety({ call: await callOf(callId), by: cust.id, now: stoppedAt });
      const own = async () => (await ownPaymentOf(callId))!;
      check("stopped while a request waits: every payment of the call goes to review", (await own()).needsReview && (await paymentOfExtension(asked.extensionId)).needsReview);
      await allJobs(stoppedAt);
      const waiting = await paymentOfExtension(asked.extensionId);
      check("the request that was never accepted is closed and its hold let go", (await extensionOf(asked.extensionId)).status === "ran_out" && waiting.status === "closed_uncharged" && (await intentOf(waiting)).status === "canceled");
      check("the call's own payment stays held for the founder to decide", (await own()).status === "held" && (await own()).needsReview);
      await releasePayment({ paymentId: (await own()).id, note: "Released by the check." });

      const cust2 = await person("p7");
      const second = await instantCall(hana, cust2, slot(20), 2000);
      const more = await ask(second.callId, cust2, 10, 80);
      await answer(more.extensionId, second.callId, hana, true, 40);
      const longer = await callOf(second.callId);
      // Stopped 6 minutes into the 10 added minutes.
      const stop = new Date(longer.endsAt.getTime() - 4 * MINUTE);
      await endCallForSafety({ call: longer, by: hana.id, now: stop });
      const stopped = await callOf(second.callId);
      const ownTwo = async () => (await ownPaymentOf(second.callId))!;
      const extraTwo = async () => paymentOfExtension(more.extensionId);
      const upToStop = (stop.getTime() - stopped.startsAt.getTime()) / 1000;
      await attend(second.callId, [["host", 0, upToStop], ["customer", 0, upToStop]]);
      await settleFinishedCalls(new Date(longer.endsAt.getTime() + 5 * MINUTE));
      check("stopped during the added time: neither payment is charged automatically", (await ownTwo()).status === "held" && (await ownTwo()).needsReview && (await extraTwo()).status === "held" && (await extraTwo()).needsReview);
      const counted = await loadAttendance(stopped, new Date(longer.endsAt.getTime() + 5 * MINUTE), { from: (await extraTwo()).coversFrom, until: (await extraTwo()).coversUntil });
      check("only the 6 minutes of added time before the stop count for the extra payment", counted.bookedSeconds === 360 && counted.result.totals?.togetherSeconds === 360, `${counted.bookedSeconds}`);
      const limit = reviewChargeLimitCents({ pricePer15Cents: 2000, coversFrom: (await extraTwo()).coversFrom, coversUntil: (await extraTwo()).coversUntil, callEndsAt: stopped.endsAt, safetyEndedAt: stopped.safetyEndedAt });
      const decideAt = new Date(longer.endsAt.getTime() + 10 * MINUTE);
      const tooMuch = await capturePayment({ paymentId: (await extraTwo()).id, amountCents: limit + 1, reason: "admin", frozen: null, callEndsAt: stopped.endsAt, maxCents: limit, now: decideAt }).catch((e) => e);
      check("the founder can charge the extra payment for at most those 6 minutes: $8.00", limit === 800 && tooMuch instanceof MoneyError, `${limit}`);
      await capturePayment({ paymentId: (await extraTwo()).id, amountCents: limit, reason: "admin", frozen: null, callEndsAt: stopped.endsAt, maxCents: limit, now: decideAt });
      check("and exactly that goes through", (await extraTwo()).status === "charged" && (await extraTwo()).chargedCents === 800);
      await releasePayment({ paymentId: (await ownTwo()).id, note: "Released by the check." });
    }
  } finally {
    await setSwitches(switchesBefore).catch(() => undefined);
    const people = made.length ? made : ["-"];
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, people), inArray(schema.blocks.blockedId, people)));
    const mine = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, people), inArray(schema.bookings.hostId, people)));
    const ids = mine.map((b) => b.id);
    if (ids.length) {
      for (const id of ids) await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `%:${id}:%`));
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, ids));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, ids));
    }
    // Calls, requests for more time and payments are left as test data, like the other scripts do; the people are kept with them.
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `extendcheck-${RUN}-%`));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, people));
    for (const id of made) await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true }).where(eq(schema.hostProfiles.userId, id));
    await db.update(schema.hostCalendars).set({ availableUntil: null, availableSeenAt: null }).where(inArray(schema.hostCalendars.userId, [...people, hana.id]));
    if (hanaProfileBefore) await db.update(schema.hostProfiles).set({ pricePer15Cents: hanaProfileBefore.pricePer15Cents, status: hanaProfileBefore.status, hidden: hanaProfileBefore.hidden }).where(eq(schema.hostProfiles.userId, hana.id));
    // The test host gets their own calendar back: its settings, its time zone and its weekly hours.
    if (hanaCalendarBefore) await db.update(schema.hostCalendars).set({ timeZone: hanaCalendarBefore.timeZone, lengths: hanaCalendarBefore.lengths, noticeHours: hanaCalendarBefore.noticeHours, horizonWeeks: hanaCalendarBefore.horizonWeeks, breakMinutes: hanaCalendarBefore.breakMinutes }).where(eq(schema.hostCalendars.userId, hana.id));
    await db.delete(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hana.id));
    if (hanaHoursBefore.length) await db.insert(schema.weeklyHours).values(hanaHoursBefore);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
