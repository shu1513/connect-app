/**
 * Calls that start now. Two ways in: a customer starts a call with a host who
 * is "available now", and a host offers more time during a call (a "part 2":
 * a call of its own that starts when the current one ends). Both make a call
 * that is already accepted, through one function, in one database step under
 * both calendar locks, so "never two calls at once" holds exactly as it does
 * for a booking: the database has the last word.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Call } from "@/db/schema";
import { createPaymentForCall } from "@/lib/payments/hold";
import { refreshPayoutsReady } from "@/lib/payments/hosts";
import { bookedTotalCents, MIN_CHARGE_CENTS } from "@/lib/payments/pricing";
import { stripeConfigured } from "@/lib/payments/stripe";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";
import { switches } from "@/lib/safety/switches";
import { BookingError, busyOf, DECLINED_BY_HOST, isOverlap, lockCalendars } from "./bookings";
import { queueBookingEmails } from "./emails";
import { AVAILABLE_CHOICES_MINUTES, instantStartAt, lengthsThatFit, mayOfferMoreTime, reservationFor, startsWhileAvailable } from "./instant-rules";
import { LIMITS, readLengths } from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;
type Person = { id: string; name: string; email: string };

const DAY = 24 * 3_600_000;
const MINUTE = 60_000;

/** True when the database refused a second pending part 2 for the same call. */
function isSecondPart(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// ---------------------------------------------------------------------------
// "Available now"
// ---------------------------------------------------------------------------

export type InstantOffer = {
  hostId: string;
  handle: string;
  displayName: string;
  pricePer15Cents: number;
  breakMinutes: number;
  availableUntil: Date;
  /** When a call started right now would begin. */
  startsAt: Date;
  /** The lengths the host offers that fit around what both people are already taken for. */
  lengths: number[];
  /** True while the host is in a call (or about to be): nothing fits right now. */
  inCall: boolean;
};

/**
 * What a host offers for a call right now, or null when they cannot be called:
 * not approved, hidden, closed, paused, not available now, or charging without
 * being able to be paid. From outside these all look the same.
 */
export async function instantOfferOf(hostId: string, now: Date, viewerId: string | null, reader: Reader = db): Promise<InstantOffer | null> {
  const [row] = await reader
    .select({ profile: schema.hostProfiles, calendar: schema.hostCalendars, settings: schema.hostSettings, closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .leftJoin(schema.hostCalendars, eq(schema.hostCalendars.userId, schema.hostProfiles.userId))
    .leftJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.hostProfiles.userId))
    .where(eq(schema.hostProfiles.userId, hostId));
  if (!row || row.profile.status !== "approved" || row.profile.hidden || row.closedAt || row.pausedAt) return null;
  const startsAt = instantStartAt(now);
  if (!startsWhileAvailable(startsAt, row.profile.availableUntil)) return null;
  if (row.profile.pricePer15Cents > 0 && !(stripeConfigured() && row.settings?.payoutsReady)) return null;
  // The host's lengths and break come from their calendar, as for bookings; their weekly hours do not matter: they are free now.
  const lengths = readLengths(row.calendar?.lengths ?? "30");
  const breakMinutes = row.calendar?.breakMinutes ?? 5;
  const hostBusy = await busyOf(reader, hostId, now);
  const customerBusy = viewerId ? await busyOf(reader, viewerId, now) : [];
  return {
    hostId,
    handle: row.profile.handle,
    displayName: row.profile.displayName,
    pricePer15Cents: row.profile.pricePer15Cents,
    breakMinutes,
    availableUntil: row.profile.availableUntil!,
    startsAt,
    lengths: lengthsThatFit({ lengths, startsAt, breakMinutes, hostBusy, customerBusy }),
    inCall: hostBusy.some((b) => b.start <= startsAt && b.end > now),
  };
}

/** The host switches "available now" on for a while, or off. */
export async function setAvailableNow(hostId: string, minutes: number | null, now: Date): Promise<void> {
  const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
  if (!profile) throw new BookingError("Set up your host profile first.");
  if (minutes !== null) {
    if (!(AVAILABLE_CHOICES_MINUTES as readonly number[]).includes(minutes)) throw new BookingError("Choose one of the listed times.");
    if (profile.status !== "approved" || profile.hidden) throw new BookingError("Your profile must be approved, and not hidden, before people can call you.");
    if (profile.pricePer15Cents > 0 && !(stripeConfigured() && (await refreshPayoutsReady(hostId).catch(() => false)))) {
      throw new BookingError("Your payout account is not ready, so you cannot take paid calls yet. Finish the payout setup first.");
    }
  }
  await db
    .update(schema.hostProfiles)
    .set({ availableUntil: minutes === null ? null : new Date(now.getTime() + minutes * MINUTE) })
    .where(eq(schema.hostProfiles.userId, hostId));
}

// ---------------------------------------------------------------------------
// Making the call
// ---------------------------------------------------------------------------

type NewPart = {
  hostId: string;
  customerId: string;
  startsAt: Date;
  lengthMinutes: number;
  pricePer15Cents: number;
  breakMinutes: number;
  source: "instant" | "extension";
  continuesCallId: string | null;
  /** Where the host's reservation begins: for a part 2, where part 1's reservation (break included) ends. */
  hostFrom?: Date;
  requestKey: string;
  /** When the customer asked. Empty for a part 2, which the host offered: it does not count against the customer's daily limits. */
  requestedAt: Date | null;
  now: Date;
};

/**
 * Makes an already-accepted call: the call, its payment (when paid), the booking
 * and both busy entries. Runs under both calendar locks; the database refuses it
 * if either person is already taken. A paid part must be paid before it starts.
 */
async function createPartNow(tx: Tx, input: NewPart): Promise<{ call: Call; booking: Booking }> {
  const taken = reservationFor(input);
  const totalCents = bookedTotalCents(input.pricePer15Cents, input.lengthMinutes * 60);
  const paid = totalCents > 0;
  const [call] = await tx
    .insert(schema.calls)
    .values({
      hostId: input.hostId,
      customerId: input.customerId,
      startsAt: input.startsAt,
      endsAt: taken.customer.end,
      roomName: `call-${randomUUID()}`,
      pricePer15Cents: input.pricePer15Cents,
      // Free to cancel until it starts: the host's cancelling rule was made for calls booked days ahead.
      freeCancelMinutes: 0,
      continuesCallId: input.continuesCallId,
    })
    .returning();
  if (paid) await createPaymentForCall(tx, call);
  const [booking] = await tx
    .insert(schema.bookings)
    .values({
      hostId: input.hostId,
      customerId: input.customerId,
      startsAt: input.startsAt,
      endsAt: taken.customer.end,
      lengthMinutes: input.lengthMinutes,
      breakMinutes: input.breakMinutes,
      pricePer15Cents: input.pricePer15Cents,
      totalCents,
      freeCancelMinutes: 0,
      stage: "accepted",
      source: input.source,
      requestKey: input.requestKey,
      requestedAt: input.requestedAt,
      decidedAt: input.now,
      // Nobody can be inside an unpaid call, so a helper that is late may still cancel it after this moment.
      payBy: paid ? input.startsAt : null,
      callId: call.id,
    })
    .returning();
  await tx.insert(schema.busyEntries).values([
    { bookingId: booking.id, userId: input.hostId, startsAt: taken.host.start, endsAt: taken.host.end },
    { bookingId: booking.id, userId: input.customerId, startsAt: taken.customer.start, endsAt: taken.customer.end },
  ]);
  return { call, booking };
}

/** The gates for starting a call with an available host, checked under both calendar locks. Throws BookingError. */
async function checkMayStartNow(tx: Tx, offer: InstantOffer, customer: Person, lengthMinutes: number, now: Date): Promise<void> {
  const [me] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, customer.id));
  if (!me || me.closedAt || me.pausedAt) throw new BookingError("Your account cannot start calls at the moment.");
  const stop = await switches();
  if (stop.requestsOff || stop.joiningOff) throw new BookingError("Connect is not taking new calls right now. Please try again later.");
  // A block either way looks, from here, like a host who is no longer available.
  if (await isBlockedEitherWay(customer.id, offer.hostId, tx)) throw new BookingError("This host is not available right now.");
  if (!offer.lengths.includes(lengthMinutes)) throw new BookingError("That length is not available right now. Please choose another.");
  const totalCents = bookedTotalCents(offer.pricePer15Cents, lengthMinutes * 60);
  if (totalCents > 0 && totalCents < MIN_CHARGE_CENTS) throw new BookingError("This call is too short to be charged for.");
  // Before a first free call, the customer confirms who they are (a paid call has a card behind it).
  if (totalCents === 0 && !(await identityState(customer.id)).passed) {
    throw new BookingError("Before your first free call, please confirm who you are on your account page.");
  }
  const count = async (...conditions: Parameters<typeof and>) =>
    (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(and(...conditions)))[0].n;
  const mine = eq(schema.bookings.customerId, customer.id);
  const thisHost = eq(schema.bookings.hostId, offer.hostId);
  const instant = eq(schema.bookings.source, "instant");
  const today = gt(schema.bookings.requestedAt, new Date(now.getTime() - DAY));
  // Cancelled and unpaid starts count too, so a host cannot be tied up by someone who starts calls and never pays.
  if ((await count(mine, thisHost, instant, today)) >= LIMITS.sentPerHostPerDay || (await count(mine, instant, today)) >= LIMITS.sentPerDay) {
    throw new BookingError("You have started a lot of calls today. Please try again tomorrow.");
  }
  if (totalCents === 0) {
    const upcomingFree = await count(mine, inArray(schema.bookings.stage, ["waiting", "accepted"]), eq(schema.bookings.totalCents, 0), gt(schema.bookings.startsAt, now));
    if (upcomingFree >= LIMITS.upcomingFree) throw new BookingError(`You can have at most ${LIMITS.upcomingFree} free calls coming up at a time.`);
  }
  const declinedLately = await count(mine, thisHost, eq(schema.bookings.stage, "declined"), eq(schema.bookings.endedReason, DECLINED_BY_HOST), gt(schema.bookings.endedAt, new Date(now.getTime() - LIMITS.declineCooldownDays * DAY)));
  if (declinedLately > 0) throw new BookingError("This host is not taking calls from you at the moment.");
}

/**
 * A customer starts a call with a host who is available now. The call exists
 * at once, already accepted; a paid one must be paid on its page before it
 * starts. `requestKey` is made when the summary is shown, so pressing the
 * button twice makes one call.
 */
export async function startInstantCall(input: { customer: Person; hostId: string; lengthMinutes: number; requestKey: string; now: Date }): Promise<{ callId: string }> {
  const { customer, hostId, now } = input;
  if (!/^[0-9a-f-]{36}$/i.test(input.requestKey)) throw new BookingError("This form is out of date. Please reload the page.");
  if (customer.id === hostId) throw new BookingError("You cannot call yourself.");
  const seen = await instantOfferOf(hostId, now, customer.id);
  if (!seen) throw new BookingError("This host is not available right now.");
  // For a paid call, Stripe confirms right now that the host can be paid (asked outside the locks: it is a round trip).
  if (seen.pricePer15Cents > 0 && !(await refreshPayoutsReady(hostId).catch(() => false))) throw new BookingError("This host cannot take paid calls right now.");
  try {
    return await db.transaction(async (tx) => {
      await lockCalendars(tx, [hostId, customer.id]);
      const [again] = await tx.select({ customerId: schema.bookings.customerId, callId: schema.bookings.callId }).from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
      if (again) {
        if (again.customerId !== customer.id || !again.callId) throw new BookingError("This form is out of date. Please reload the page.");
        return { callId: again.callId };
      }
      // Read what the host offers again now that the calendars are locked.
      const offer = await instantOfferOf(hostId, now, customer.id, tx);
      if (!offer) throw new BookingError("This host is not available right now.");
      await checkMayStartNow(tx, offer, customer, input.lengthMinutes, now);
      const { call, booking } = await createPartNow(tx, {
        hostId,
        customerId: customer.id,
        startsAt: offer.startsAt,
        lengthMinutes: input.lengthMinutes,
        pricePer15Cents: offer.pricePer15Cents,
        breakMinutes: offer.breakMinutes,
        source: "instant",
        continuesCallId: null,
        requestKey: input.requestKey,
        requestedAt: now,
        now,
      });
      await queueBookingEmails(tx, booking, "instant_started");
      return { callId: call.id };
    });
  } catch (error) {
    if (isOverlap(error)) throw new BookingError("That time was taken a moment ago. Please try again.");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// More time during a call: a part 2
// ---------------------------------------------------------------------------

export type NextPart = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  lengthMinutes: number;
  /** Zero for a free part. */
  bookedCents: number;
  /** "unpaid" until the money is held; "ready" once it is (or for a free part). */
  status: "unpaid" | "ready";
};

/** The part 2 of a call that is not cancelled, or null. */
export async function nextPartOf(callId: string, reader: Reader = db): Promise<NextPart | null> {
  const [row] = await reader
    .select({ call: schema.calls, payment: schema.payments })
    .from(schema.calls)
    .leftJoin(schema.payments, eq(schema.payments.callId, schema.calls.id))
    .where(and(eq(schema.calls.continuesCallId, callId), isNull(schema.calls.cancelledAt)));
  if (!row) return null;
  return {
    id: row.call.id,
    startsAt: row.call.startsAt,
    endsAt: row.call.endsAt,
    lengthMinutes: Math.round((row.call.endsAt.getTime() - row.call.startsAt.getTime()) / MINUTE),
    bookedCents: row.payment?.bookedCents ?? 0,
    status: row.payment?.status === "awaiting_payment" ? "unpaid" : "ready",
  };
}

/**
 * The host offers more time on a running call: a part 2 that starts when this
 * one ends, at the same price, with the break fixed on this call. One pending
 * part 2 per call; the database guarantees it.
 */
export async function offerMoreTime(input: { call: Call; hostId: string; lengthMinutes: number; now: Date }): Promise<{ callId: string }> {
  const { call, now } = input;
  if (call.hostId !== input.hostId) throw new BookingError("Only the host can offer more time.");
  if (!mayOfferMoreTime(call, now)) throw new BookingError("More time can be offered while the call is running and at least 5 minutes remain.");
  const paid = call.pricePer15Cents > 0;
  if (paid && !(stripeConfigured() && (await refreshPayoutsReady(call.hostId).catch(() => false)))) {
    throw new BookingError("Your payout account is not ready, so you cannot offer paid time.");
  }
  try {
    return await db.transaction(async (tx) => {
      await lockCalendars(tx, [call.hostId, call.customerId]);
      // Read the call again under its lock: it may have been stopped or cancelled a moment ago.
      const [fresh] = await tx.select().from(schema.calls).where(eq(schema.calls.id, call.id)).for("update");
      if (!fresh || !mayOfferMoreTime(fresh, now)) throw new BookingError("More time can be offered while the call is running and at least 5 minutes remain.");
      if (await nextPartOf(call.id, tx)) throw new BookingError("More time has already been offered on this call.");
      const stop = await switches();
      if (stop.requestsOff || stop.joiningOff) throw new BookingError("Connect is not taking new calls right now.");
      const [people] = await tx
        .select({ paused: sql<number>`count(*) filter (where ${schema.user.pausedAt} is not null or ${schema.user.closedAt} is not null)::int` })
        .from(schema.user)
        .where(inArray(schema.user.id, [call.hostId, call.customerId]));
      if (people.paused > 0 || (await isBlockedEitherWay(call.hostId, call.customerId, tx))) throw new BookingError("This call cannot be extended.");
      const [calendar] = await tx.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, call.hostId));
      if (!readLengths(calendar?.lengths ?? "30").includes(input.lengthMinutes)) throw new BookingError("Choose one of the lengths you offer.");
      if (paid && bookedTotalCents(call.pricePer15Cents, input.lengthMinutes * 60) < MIN_CHARGE_CENTS) throw new BookingError("That is too short to be charged for.");
      // The break fixed on this call, and where the host's reservation for it (break included) ends: the part 2 begins there.
      const [parent] = await tx.select().from(schema.bookings).where(eq(schema.bookings.callId, call.id));
      const breakMinutes = parent?.breakMinutes ?? calendar?.breakMinutes ?? 5;
      const [hostTaken] = parent
        ? await tx.select({ endsAt: schema.busyEntries.endsAt }).from(schema.busyEntries).where(and(eq(schema.busyEntries.bookingId, parent.id), eq(schema.busyEntries.userId, call.hostId)))
        : [];
      const { call: part } = await createPartNow(tx, {
        hostId: call.hostId,
        customerId: call.customerId,
        startsAt: call.endsAt,
        lengthMinutes: input.lengthMinutes,
        pricePer15Cents: call.pricePer15Cents,
        breakMinutes,
        source: "extension",
        continuesCallId: call.id,
        hostFrom: hostTaken?.endsAt ?? call.endsAt,
        requestKey: randomUUID(),
        requestedAt: null,
        now,
      });
      return { callId: part.id };
    });
  } catch (error) {
    if (isOverlap(error)) throw new BookingError("One of you already has a call or a request right after this one, so it cannot be extended.");
    if (isSecondPart(error)) throw new BookingError("More time has already been offered on this call.");
    throw error;
  }
}
