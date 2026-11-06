/**
 * Asking for a call, and answering: everything that creates or changes a
 * booking goes through here, so the rules are in one place.
 *
 * Several customers may ask for the same time; the host chooses. A waiting
 * request reserves nothing on the host's side. What can never happen is one
 * person in two overlapping calls: the database refuses that itself (the
 * "busy entries" rule), whatever this code does.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking } from "@/db/schema";
import { createPaymentForCall, stripeCustomerFor } from "@/lib/payments/hold";
import { bookedTotalCents, MIN_CHARGE_CENTS } from "@/lib/payments/pricing";
import { stripe, stripeConfigured } from "@/lib/payments/stripe";
import { queueBookingEmails } from "./emails";
import { answerDeadline, CARD_CONSENT_VERSION, earliestStartFor, LIMITS, payCutoff, readLengths } from "./rules";
import { isOpenStart, openStarts, type Interval } from "./slots";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A problem the person can understand. Its message is safe to show them. */
export class BookingError extends Error {}

const DAY = 24 * 3_600_000;
const DECLINED_BY_HOST = "declined by the host";

/** True when the database refused a row because the person is already taken at that time. */
function isOverlap(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

/**
 * Takes each person's calendar lock, always in the same order, so two steps
 * that involve the same people wait for each other instead of getting stuck.
 */
export async function lockCalendars(tx: Tx, userIds: string[]): Promise<void> {
  for (const id of [...new Set(userIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`calendar:${id}`}))`);
  }
}

// ---------------------------------------------------------------------------
// What a host offers
// ---------------------------------------------------------------------------

export type Offer = {
  hostId: string;
  handle: string;
  displayName: string;
  timeZone: string;
  lengths: number[];
  pricePer15Cents: number;
  freeCancelMinutes: number;
  breakMinutes: number;
  noticeHours: number;
  horizonWeeks: number;
  /** False when the host charges but cannot be paid yet (or payments are switched off). */
  canTakePaid: boolean;
  weekly: Array<{ weekday: number; startMinute: number; endMinute: number }>;
  timeOff: Interval[];
};

/**
 * What a host offers for booking, or null if they cannot be booked at all:
 * not approved, hidden, account closed, or no calendar set up. From outside
 * these all look the same.
 */
export async function offerOf(hostId: string, reader: Pick<typeof db, "select"> = db): Promise<Offer | null> {
  const [row] = await reader
    .select({ profile: schema.hostProfiles, calendar: schema.hostCalendars, settings: schema.hostSettings, closedAt: schema.user.closedAt })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .innerJoin(schema.hostCalendars, eq(schema.hostCalendars.userId, schema.hostProfiles.userId))
    .leftJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.hostProfiles.userId))
    .where(eq(schema.hostProfiles.userId, hostId));
  if (!row || row.profile.status !== "approved" || row.profile.hidden || row.closedAt) return null;
  const lengths = readLengths(row.calendar.lengths);
  const weekly = await reader.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hostId));
  if (lengths.length === 0 || weekly.length === 0) return null;
  const timeOff = await reader
    .select()
    .from(schema.timeOff)
    .where(and(eq(schema.timeOff.hostId, hostId), gt(schema.timeOff.endsAt, new Date())));
  const paid = row.profile.pricePer15Cents > 0;
  return {
    hostId,
    handle: row.profile.handle,
    displayName: row.profile.displayName,
    timeZone: row.calendar.timeZone,
    lengths,
    pricePer15Cents: row.profile.pricePer15Cents,
    freeCancelMinutes: row.settings?.freeCancelMinutes ?? 0,
    breakMinutes: row.calendar.breakMinutes,
    noticeHours: row.calendar.noticeHours,
    horizonWeeks: row.calendar.horizonWeeks,
    canTakePaid: !paid || (stripeConfigured() && Boolean(row.settings?.payoutsReady)),
    weekly: weekly.map((w) => ({ weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute })),
    timeOff: timeOff.map((t) => ({ start: t.startsAt, end: t.endsAt })),
  };
}

async function busyOf(reader: Pick<typeof db, "select">, userId: string, from: Date): Promise<Interval[]> {
  const rows = await reader
    .select({ start: schema.busyEntries.startsAt, end: schema.busyEntries.endsAt })
    .from(schema.busyEntries)
    .where(and(eq(schema.busyEntries.userId, userId), gt(schema.busyEntries.endsAt, from)));
  return rows;
}

function slotInput(offer: Offer, busy: Interval[], lengthMinutes: number, now: Date) {
  const paid = offer.pricePer15Cents > 0;
  return {
    timeZone: offer.timeZone,
    weekly: offer.weekly,
    timeOff: offer.timeOff,
    busy,
    lengthMinutes,
    breakMinutes: offer.breakMinutes,
    now,
    earliestStart: earliestStartFor({ now, paid, freeCancelMinutes: offer.freeCancelMinutes, noticeHours: offer.noticeHours }),
    horizonWeeks: offer.horizonWeeks,
  };
}

/** The start times a customer can ask this host for, for one call length. Worked out fresh each time. */
export async function openTimes(offer: Offer, lengthMinutes: number, now: Date): Promise<Date[]> {
  if (!offer.lengths.includes(lengthMinutes) || !offer.canTakePaid) return [];
  const [{ waiting }] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.hostId, offer.hostId), eq(schema.bookings.stage, "waiting")));
  if (waiting >= LIMITS.perHost) return [];
  // Everything the host is taken for: calls they accepted (with the break), and their own requests elsewhere.
  return openStarts(slotInput(offer, await busyOf(db, offer.hostId, now), lengthMinutes, now));
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

type Person = { id: string; name: string; email: string };

/** Checks, with both calendars locked, that this request may be sent right now. Throws BookingError if not. */
async function checkMayAsk(tx: Tx, offer: Offer, booking: { customerId: string; startsAt: Date; lengthMinutes: number; totalCents: number }, now: Date) {
  if (!isOpenStart(booking.startsAt, slotInput(offer, await busyOf(tx, offer.hostId, now), booking.lengthMinutes, now))) {
    throw new BookingError("That time is no longer open. Please choose another.");
  }
  const count = async (...conditions: Parameters<typeof and>) =>
    (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(and(...conditions)))[0].n;
  const mine = eq(schema.bookings.customerId, booking.customerId);
  const thisHost = eq(schema.bookings.hostId, offer.hostId);
  const waiting = eq(schema.bookings.stage, "waiting");
  const sentSince = gt(schema.bookings.requestedAt, new Date(now.getTime() - DAY));

  if ((await count(mine, thisHost, waiting)) >= LIMITS.waitingPerHost) {
    throw new BookingError(`You already have ${LIMITS.waitingPerHost} requests waiting with this host. Wait for an answer, or take one back.`);
  }
  if ((await count(mine, waiting)) >= LIMITS.waitingTotal) {
    throw new BookingError(`You already have ${LIMITS.waitingTotal} requests waiting. Wait for an answer, or take one back.`);
  }
  if ((await count(mine, thisHost, sentSince)) >= LIMITS.sentPerHostPerDay || (await count(mine, sentSince)) >= LIMITS.sentPerDay) {
    throw new BookingError("You have sent a lot of requests today. Please try again tomorrow.");
  }
  if (booking.totalCents === 0) {
    const upcomingFree = await count(mine, inArray(schema.bookings.stage, ["waiting", "accepted"]), eq(schema.bookings.totalCents, 0), gt(schema.bookings.startsAt, now));
    if (upcomingFree >= LIMITS.upcomingFree) throw new BookingError(`You can have at most ${LIMITS.upcomingFree} free calls coming up at a time.`);
  }
  const declinedLately = await count(
    mine,
    thisHost,
    eq(schema.bookings.stage, "declined"),
    eq(schema.bookings.endedReason, DECLINED_BY_HOST),
    gt(schema.bookings.endedAt, new Date(now.getTime() - LIMITS.declineCooldownDays * DAY)),
  );
  if (declinedLately > 0) throw new BookingError("This host is not taking requests from you at the moment.");
  if ((await count(thisHost, waiting, eq(schema.bookings.startsAt, booking.startsAt))) >= LIMITS.perStart || (await count(thisHost, waiting)) >= LIMITS.perHost) {
    throw new BookingError("This host is not taking more requests for now. Please try again later.");
  }
}

/** Moves a request into "waiting": the customer is now taken for that time, and the host's clock starts. */
async function sendToHost(tx: Tx, booking: Booking, now: Date, paymentMethodId: string | null): Promise<Booking> {
  const paid = booking.totalCents > 0;
  const terms = { startsAt: booking.startsAt, paid, freeCancelMinutes: booking.freeCancelMinutes };
  await tx.insert(schema.busyEntries).values({ bookingId: booking.id, userId: booking.customerId, startsAt: booking.startsAt, endsAt: booking.endsAt });
  const [sent] = await tx
    .update(schema.bookings)
    .set({
      stage: "waiting",
      requestedAt: now,
      respondBy: answerDeadline({ ...terms, requestedAt: now }),
      payBy: paid ? payCutoff(booking.startsAt, booking.freeCancelMinutes) : null,
      stripePaymentMethodId: paymentMethodId,
    })
    .where(eq(schema.bookings.id, booking.id))
    .returning();
  await queueBookingEmails(tx, sent, "sent");
  return sent;
}

/**
 * A customer asks a host for a time. A free request goes to the host at once.
 * A paid one first needs a card: the result then carries what the browser
 * needs to show Stripe's form, and finishCardStep() sends it on.
 *
 * `requestKey` is made when the form is shown, so pressing the button twice
 * makes one request.
 */
export async function askForCall(input: {
  customer: Person;
  hostId: string;
  startsAt: Date;
  lengthMinutes: number;
  note: string;
  requestKey: string;
  agreedToCardTerms: boolean;
  /** The price and cancelling rule the customer was shown and agreed to. If the host has changed them since, nothing is sent. */
  seen: { pricePer15Cents: number; freeCancelMinutes: number };
  now: Date;
}): Promise<{ booking: Booking; clientSecret: string | null }> {
  const { customer, now } = input;
  if (!/^[0-9a-f-]{36}$/i.test(input.requestKey)) throw new BookingError("This form is out of date. Please reload the page.");
  if (customer.id === input.hostId) throw new BookingError("You cannot book a call with yourself.");
  const note = input.note.replace(/\s+/g, " ").trim();
  if (note.length > LIMITS.noteMax) throw new BookingError(`The note can be at most ${LIMITS.noteMax} characters.`);
  const offer = await offerOf(input.hostId);
  if (!offer || !offer.lengths.includes(input.lengthMinutes) || !offer.canTakePaid) throw new BookingError("This host cannot be booked right now.");
  const totalCents = bookedTotalCents(offer.pricePer15Cents, input.lengthMinutes * 60);
  const paid = totalCents > 0;
  if (paid && totalCents < MIN_CHARGE_CENTS) throw new BookingError("This call is too short to be charged for.");
  if (paid && !input.agreedToCardTerms) throw new BookingError("Please tick the box about your card to continue.");

  let booking: Booking;
  try {
    booking = await db.transaction(async (tx) => {
      await lockCalendars(tx, [input.hostId, customer.id]);
      const [again] = await tx.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
      if (again) {
        if (again.customerId !== customer.id) throw new BookingError("This form is out of date. Please reload the page.");
        return again;
      }
      // Read what the host offers again now that the calendars are locked.
      const current = await offerOf(input.hostId, tx);
      if (!current || !current.canTakePaid) throw new BookingError("This host cannot be booked right now.");
      if (current.pricePer15Cents !== input.seen.pricePer15Cents || current.freeCancelMinutes !== input.seen.freeCancelMinutes || current.pricePer15Cents !== offer.pricePer15Cents) {
        throw new BookingError("This host's price or cancelling rule changed while you were looking. Please check the details again.");
      }
      await checkMayAsk(tx, current, { customerId: customer.id, startsAt: input.startsAt, lengthMinutes: input.lengthMinutes, totalCents }, now);
      // Say so now, before a card is entered, if the customer is already taken at that time.
      // (The database still has the last word when the request is finally sent.)
      const endsAt = new Date(input.startsAt.getTime() + input.lengthMinutes * 60_000);
      const taken = (await busyOf(tx, customer.id, input.startsAt)).some((b) => b.start < endsAt && b.end > input.startsAt);
      if (taken) throw new BookingError("You already have a request or a call at that time.");
      const [draft] = await tx
        .insert(schema.bookings)
        .values({
          hostId: input.hostId,
          customerId: customer.id,
          startsAt: input.startsAt,
          endsAt: new Date(input.startsAt.getTime() + input.lengthMinutes * 60_000),
          lengthMinutes: input.lengthMinutes,
          breakMinutes: current.breakMinutes,
          pricePer15Cents: current.pricePer15Cents,
          totalCents,
          freeCancelMinutes: current.freeCancelMinutes,
          note,
          stage: "card",
          requestKey: input.requestKey,
          cardConsentVersion: paid ? CARD_CONSENT_VERSION : null,
          cardConsentAt: paid ? now : null,
        })
        .returning();
      return paid ? draft : sendToHost(tx, draft, now, null);
    });
  } catch (error) {
    if (isOverlap(error)) throw new BookingError("You already have a request or a call at that time.");
    throw error;
  }
  if (booking.stage !== "card") return { booking, clientSecret: null };

  // Paid: Stripe keeps the card. Nothing is held or charged by this.
  const setup = booking.stripeSetupIntentId
    ? await stripe().setupIntents.retrieve(booking.stripeSetupIntentId)
    : await stripe().setupIntents.create(
        {
          customer: await stripeCustomerFor(customer),
          usage: "off_session",
          allowed_payment_method_types: ["card"],
          metadata: { bookingId: booking.id },
        },
        { idempotencyKey: `setup:${booking.id}` },
      );
  if (!booking.stripeSetupIntentId) {
    await db.update(schema.bookings).set({ stripeSetupIntentId: setup.id }).where(eq(schema.bookings.id, booking.id));
    booking = { ...booking, stripeSetupIntentId: setup.id };
  }
  if (!setup.client_secret) throw new BookingError("Stripe did not return a way to save your card. Please try again.");
  return { booking, clientSecret: setup.client_secret };
}

/**
 * The customer has entered their card. We ask Stripe ourselves whether it was
 * really saved, check everything again, and only then send the request to the
 * host. Safe to call again, and safe to call late: an unfinished request that
 * has ended is never brought back.
 */
export async function finishCardStep(input: { bookingId: string; customerId: string; now: Date }): Promise<Booking> {
  const [before] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, input.bookingId));
  if (!before || before.customerId !== input.customerId) throw new BookingError("Request not found.");
  if (before.stage !== "card" || !before.stripeSetupIntentId) return before;
  const setup = await stripe().setupIntents.retrieve(before.stripeSetupIntentId);
  if (setup.status !== "succeeded" || setup.metadata?.bookingId !== before.id) return before;
  const paymentMethodId = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method?.id;
  if (!paymentMethodId) return before;

  try {
    return await db.transaction(async (tx) => {
      await lockCalendars(tx, [before.hostId, before.customerId]);
      const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, before.id)).for("update");
      if (booking.stage !== "card") return booking;
      const end = (reason: string) =>
        tx
          .update(schema.bookings)
          // The card is kept on the row so the helper can remove it from Stripe.
          .set({ stage: "ran_out", endedReason: reason, endedAt: input.now, stripePaymentMethodId: paymentMethodId })
          .where(eq(schema.bookings.id, booking.id))
          .returning()
          .then((rows) => rows[0]);
      const offer = await offerOf(booking.hostId, tx);
      if (!offer || !offer.canTakePaid) return end("the host can no longer be booked");
      // The deadlines come from the terms fixed on this request, so the time is checked against those
      // same terms, not against whatever the host's settings are now.
      const asAsked = { ...offer, pricePer15Cents: booking.pricePer15Cents, freeCancelMinutes: booking.freeCancelMinutes, breakMinutes: booking.breakMinutes };
      try {
        await checkMayAsk(tx, asAsked, booking, input.now);
      } catch (error) {
        if (error instanceof BookingError) return end(error.message);
        throw error;
      }
      return sendToHost(tx, booking, input.now, paymentMethodId);
    });
  } catch (error) {
    if (!isOverlap(error)) throw error;
    // The customer took another request or call at that time while entering the card.
    const [ended] = await db
      .update(schema.bookings)
      .set({ stage: "ran_out", endedReason: "you already have a request or a call at that time", endedAt: input.now, stripePaymentMethodId: paymentMethodId })
      .where(and(eq(schema.bookings.id, before.id), eq(schema.bookings.stage, "card")))
      .returning();
    return ended ?? before;
  }
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/** Ends a waiting request without a call, frees the customer's time, and tells them. */
async function endWaiting(
  tx: Tx,
  where: ReturnType<typeof and>,
  stage: "declined" | "passed_over" | "ran_out" | "taken_back",
  reason: string,
  now: Date,
): Promise<Booking[]> {
  const ended = await tx
    .update(schema.bookings)
    .set({ stage, endedReason: reason, endedAt: now })
    .where(and(eq(schema.bookings.stage, "waiting"), where))
    .returning();
  if (ended.length === 0) return ended;
  await tx.delete(schema.busyEntries).where(
    inArray(
      schema.busyEntries.bookingId,
      ended.map((b) => b.id),
    ),
  );
  if (stage !== "taken_back") for (const booking of ended) await queueBookingEmails(tx, booking, stage);
  return ended;
}

/** The customer takes a request back before it is answered. Always free. */
export async function takeBack(input: { bookingId: string; customerId: string; now: Date }): Promise<void> {
  const ended = await db.transaction((tx) =>
    endWaiting(tx, and(eq(schema.bookings.id, input.bookingId), eq(schema.bookings.customerId, input.customerId)), "taken_back", "taken back by the customer", input.now),
  );
  if (ended.length === 0) throw new BookingError("This request can no longer be taken back.");
}

/** The host says no. That customer cannot ask this host again for a while. */
export async function decline(input: { bookingId: string; hostId: string; now: Date }): Promise<void> {
  const ended = await db.transaction((tx) =>
    endWaiting(tx, and(eq(schema.bookings.id, input.bookingId), eq(schema.bookings.hostId, input.hostId)), "declined", DECLINED_BY_HOST, input.now),
  );
  if (ended.length === 0) throw new BookingError("This request is no longer waiting for an answer.");
}

/**
 * The host says yes. In one step: the request becomes a call (with its
 * payment, for a paid call), the host is now taken for that time, and every
 * other waiting request that the call or its break gets in the way of ends
 * with "the host accepted another request".
 */
export async function accept(input: { bookingId: string; hostId: string; now: Date }): Promise<{ callId: string }> {
  const [seen] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, input.bookingId));
  if (!seen || seen.hostId !== input.hostId) throw new BookingError("Request not found.");
  try {
    return await db.transaction(async (tx) => {
      await lockCalendars(tx, [seen.hostId, seen.customerId]);
      const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, seen.id)).for("update");
      if (booking.stage !== "waiting") throw new BookingError("This request is no longer waiting for an answer.");
      if (!booking.respondBy || booking.respondBy <= input.now) throw new BookingError("The time to answer this request has passed.");

      // Both people must still be able to take part. (A hidden profile can still accept what it was asked.)
      const [parties] = await tx
        .select({ hostClosed: schema.user.closedAt, status: schema.hostProfiles.status, payoutsReady: schema.hostSettings.payoutsReady })
        .from(schema.user)
        .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
        .leftJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.user.id))
        .where(eq(schema.user.id, booking.hostId));
      const [customer] = await tx.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, booking.customerId));
      if (!parties || parties.hostClosed || parties.status !== "approved") throw new BookingError("Your host profile is not active, so you cannot accept requests.");
      if (!customer || customer.closedAt) throw new BookingError("This customer's account is no longer active.");
      const paid = booking.totalCents > 0;
      if (paid && !(stripeConfigured() && parties.payoutsReady)) {
        throw new BookingError("Your payout account is not ready, so you cannot accept paid requests yet. Finish the payout setup first.");
      }

      // The host is now taken for the call and the break after it. If they already are, the database refuses.
      const busyUntil = new Date(booking.endsAt.getTime() + booking.breakMinutes * 60_000);
      await tx.insert(schema.busyEntries).values({ bookingId: booking.id, userId: booking.hostId, startsAt: booking.startsAt, endsAt: busyUntil });

      const [call] = await tx
        .insert(schema.calls)
        .values({
          hostId: booking.hostId,
          customerId: booking.customerId,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          roomName: `call-${randomUUID()}`,
          pricePer15Cents: booking.pricePer15Cents,
          freeCancelMinutes: booking.freeCancelMinutes,
        })
        .returning();
      if (paid) await createPaymentForCall(tx, call);
      const [accepted] = await tx
        .update(schema.bookings)
        .set({ stage: "accepted", callId: call.id, decidedAt: input.now })
        .where(eq(schema.bookings.id, booking.id))
        .returning();
      await queueBookingEmails(tx, accepted, "accepted");

      // Every other waiting request this call (with its break) gets in the way of, or that would
      // run into this call with its own break, can no longer be accepted. End them now.
      await endWaiting(
        tx,
        and(
          eq(schema.bookings.hostId, booking.hostId),
          ne(schema.bookings.id, booking.id),
          sql`tstzrange(${schema.bookings.startsAt}, ${schema.bookings.endsAt} + make_interval(mins => ${schema.bookings.breakMinutes}), '[)') && tstzrange(${booking.startsAt.toISOString()}::timestamptz, ${busyUntil.toISOString()}::timestamptz, '[)')`,
        ),
        "passed_over",
        "the host accepted another request",
        input.now,
      );
      return { callId: call.id };
    });
  } catch (error) {
    if (isOverlap(error)) throw new BookingError("You already have a call or a request of your own at that time, so this one cannot be accepted.");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Other ways in and out
// ---------------------------------------------------------------------------

/**
 * For the admin test page only: a call between any two people, created as an
 * already-accepted booking so it obeys the same "never two calls at once" rule.
 */
export async function createTestCall(input: {
  hostId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  pricePer15Cents: number;
  freeCancelMinutes: number;
}): Promise<{ callId: string }> {
  const lengthMinutes = Math.max(1, Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000));
  try {
    return await db.transaction(async (tx) => {
      await lockCalendars(tx, [input.hostId, input.customerId]);
      const [call] = await tx
        .insert(schema.calls)
        .values({ ...input, roomName: `call-${randomUUID()}` })
        .returning();
      if (input.pricePer15Cents > 0) await createPaymentForCall(tx, call);
      const [booking] = await tx
        .insert(schema.bookings)
        .values({
          hostId: input.hostId,
          customerId: input.customerId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          lengthMinutes,
          breakMinutes: 1,
          pricePer15Cents: input.pricePer15Cents,
          totalCents: bookedTotalCents(input.pricePer15Cents, Math.floor((input.endsAt.getTime() - input.startsAt.getTime()) / 1000)),
          freeCancelMinutes: input.freeCancelMinutes,
          stage: "accepted",
          source: "admin",
          requestKey: randomUUID(),
          callId: call.id,
          decidedAt: new Date(),
        })
        .returning();
      await tx.insert(schema.busyEntries).values([
        { bookingId: booking.id, userId: input.hostId, startsAt: input.startsAt, endsAt: new Date(input.endsAt.getTime() + 60_000) },
        { bookingId: booking.id, userId: input.customerId, startsAt: input.startsAt, endsAt: input.endsAt },
      ]);
      return { callId: call.id };
    });
  } catch (error) {
    if (isOverlap(error)) throw new BookingError("One of those two people already has a call or a request at that time.");
    throw error;
  }
}

/**
 * Ends everything a person has waiting: used when the founder suspends a host
 * (their requests as a host) or closes an account (as host and as customer).
 * Calls that were already accepted are cancelled by the caller.
 */
export async function endWaitingRequestsOf(userId: string, roles: { asHost: boolean; asCustomer: boolean }, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    if (roles.asHost) await endWaiting(tx, eq(schema.bookings.hostId, userId), "declined", "the host is no longer available", now);
    if (roles.asCustomer) await endWaiting(tx, eq(schema.bookings.customerId, userId), "taken_back", "the customer's account was closed", now);
  });
}

/** Requests the host did not answer in time end by themselves. */
export async function endUnanswered(now: Date): Promise<number> {
  const overdue = sql`${schema.bookings.respondBy} <= ${now.toISOString()}::timestamptz`;
  const hosts = await db.selectDistinct({ hostId: schema.bookings.hostId }).from(schema.bookings).where(and(eq(schema.bookings.stage, "waiting"), overdue));
  let ended = 0;
  // One host at a time, holding that host's calendar lock, so this never crosses paths with the host accepting.
  for (const { hostId } of hosts) {
    ended += await db.transaction(async (tx) => {
      await lockCalendars(tx, [hostId]);
      return (await endWaiting(tx, and(eq(schema.bookings.hostId, hostId), overdue), "ran_out", "not answered in time", now)).length;
    });
  }
  return ended;
}

/** A paid request whose card was never entered is dropped. It never reached the host. */
export async function endUnfinishedCardSteps(now: Date): Promise<number> {
  const ended = await db
    .update(schema.bookings)
    .set({ stage: "ran_out", endedReason: "the card was not entered in time", endedAt: now })
    .where(and(eq(schema.bookings.stage, "card"), sql`${schema.bookings.createdAt} <= ${new Date(now.getTime() - LIMITS.cardStepMinutes * 60_000).toISOString()}::timestamptz`))
    .returning({ id: schema.bookings.id });
  return ended.length;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A booking, for one of its two people (or null). */
export async function bookingFor(bookingId: string, userId: string): Promise<{ booking: Booking; role: "host" | "customer" } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!booking) return null;
  if (booking.hostId === userId) return { booking, role: "host" };
  if (booking.customerId === userId) return { booking, role: "customer" };
  return null;
}

/** The requests a host has to answer, soonest call first, so requests for the same time sit together. */
export async function waitingForHost(hostId: string) {
  return db
    .select({ booking: schema.bookings, customerName: schema.user.name })
    .from(schema.bookings)
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.customerId))
    .where(and(eq(schema.bookings.hostId, hostId), eq(schema.bookings.stage, "waiting")))
    .orderBy(asc(schema.bookings.startsAt), asc(schema.bookings.requestedAt));
}

/** A customer's requests that are still open or ended lately. */
export async function requestsOfCustomer(customerId: string, now: Date) {
  return db
    .select({ booking: schema.bookings, hostName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle })
    .from(schema.bookings)
    .innerJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.bookings.hostId))
    .where(
      and(
        eq(schema.bookings.customerId, customerId),
        eq(schema.bookings.source, "customer"),
        or(
          inArray(schema.bookings.stage, ["card", "waiting"]),
          and(isNull(schema.bookings.callId), gt(schema.bookings.endedAt, new Date(now.getTime() - 7 * DAY))),
        ),
      ),
    )
    .orderBy(asc(schema.bookings.startsAt));
}
