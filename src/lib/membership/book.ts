/**
 * Booking as a member (the rulebook's "Booking as a member"): one step of its own, not "ask"
 * followed by "accept". The call is booked at once, from the month's free money.
 *
 * In that one step, with both calendars, the membership and the month locked: the booking, both
 * people's time, the call, its payment (a `member_call` payment: money set aside in the month,
 * never a card payment) and the move from free to set aside. Other people's waiting requests for
 * that time end, as they do when a host accepts.
 *
 * The first booking of a month whose money is still only held takes the money first (charge.ts,
 * `takeNow`) and books only once Stripe has confirmed it. In between the request waits at a
 * stage of its own, `paying`, with nothing reserved for either person; the same press continues
 * it, and a small job ends one that is not finished.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Membership, MembershipMonth } from "@/db/schema";
import { BookingError, busyOf, endRequestsInTheWay, isOverlap, lockCalendars, offerOf, slotInput, type Offer } from "@/lib/booking/bookings";
import { queueBookingEmails } from "@/lib/booking/emails";
import { LIMITS } from "@/lib/booking/rules";
import { isOpenStart, openStarts } from "@/lib/booking/slots";
import type { Tx } from "@/lib/payments/operations";
import { MIN_CHARGE_CENTS } from "@/lib/payments/pricing";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";
import { switches } from "@/lib/safety/switches";
import { hostForMember } from "./access";
import { takeNow } from "./charge";
import { lockMembership, lockMonth } from "./locks";
import { setAside } from "./months";
import { isFrozen, memberCallCents } from "./rules";

export { memberCallCents };

type Person = { id: string; name: string; email: string };
type Reader = Pick<typeof db, "select">;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A booking that is waiting for its month's payment is ended after this long. */
export const PAYING_MS = 30 * MINUTE;
const OUT_OF_DATE = "This form is out of date. Please reload the page.";
const NOT_OPEN = "That time is no longer open. Please choose another.";
const NO_MEMBERSHIP = "You have no membership time with this host to book from right now.";
/** What the member is told when the month's money was taken and the time was lost in that very moment. */
export const PAID_BUT_TIME_GONE = "Your month's payment went through, but that time is no longer open. Please choose another.";

/** The member's month that can be booked from, with its membership: active, the current month, running or still only held, not disputed, not over. */
async function bookableMonth(reader: Reader, customerId: string, hostId: string, now: Date): Promise<{ membership: Membership; month: MembershipMonth } | null> {
  const [row] = await reader
    .select({ membership: schema.memberships, month: schema.membershipMonths })
    .from(schema.memberships)
    .innerJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.memberships.currentMonthId))
    .where(and(eq(schema.memberships.hostId, hostId), eq(schema.memberships.customerId, customerId), eq(schema.memberships.status, "active")));
  if (!row) return null;
  const { membership, month } = row;
  const usable = (month.status === "running" || month.status === "held") && month.period === membership.period && !month.endedHow && !month.problem && !isFrozen(month) && Boolean(month.endsAt && month.endsAt > now);
  return usable ? row : null;
}

export type MemberBookingView = {
  membership: Membership;
  month: MembershipMonth;
  offer: Offer;
  /** What can still be booked from this month. (A month that is only held shows all of its time: the first booking takes the money.) */
  freeCents: number;
  minutesLeft: number;
  /** The host's lengths whose price still fits in the time left. */
  lengths: number[];
  monthEndsAt: Date;
};

/**
 * What a member sees on the host's page: their time left and the lengths they can still book. Null
 * for anyone who is not a member with a month to book from, and for a host who cannot be booked
 * (asked through access.ts first, which is also how a member reaches a host whose page is hidden).
 */
export async function memberBookingView(viewerId: string, hostId: string, now: Date): Promise<MemberBookingView | null> {
  const host = await hostForMember(viewerId, hostId, now);
  if (!host?.canBook) return null;
  const found = await bookableMonth(db, viewerId, hostId, now);
  if (!found) return null;
  const offer = await offerOf(hostId, db, { forMember: true });
  if (!offer || !offer.canTakePaid) return null;
  const { membership, month } = found;
  const freeCents = month.status === "held" ? month.totalCents : month.freeCents;
  const fits = (minutes: number) => {
    const cents = memberCallCents(month.pricePer15Cents, minutes);
    return cents >= MIN_CHARGE_CENTS && cents <= freeCents;
  };
  return { membership, month, offer, freeCents, minutesLeft: Math.floor((freeCents * 15) / month.pricePer15Cents), lengths: offer.lengths.filter(fits), monthEndsAt: month.endsAt! };
}

/**
 * The start times a member can book, for one length: general and member-only hours, the host's
 * notice alone as the earliest start, and only calls that end before the month ends. Each says
 * whether it is a time for members only (one the host's general hours do not offer).
 */
export async function memberOpenTimes(view: MemberBookingView, lengthMinutes: number, now: Date): Promise<Array<{ startsAt: Date; membersOnly: boolean }>> {
  if (!view.lengths.includes(lengthMinutes)) return [];
  const busy = await busyOf(db, view.offer.hostId, now);
  const starts = openStarts(slotInput(view.offer, busy, lengthMinutes, now, "member"));
  const general = new Set(openStarts(slotInput({ ...view.offer, weekly: view.offer.weekly.filter((stretch) => !stretch.membersOnly) }, busy, lengthMinutes, now, "member")).map((start) => start.getTime()));
  return starts.filter((start) => start.getTime() + lengthMinutes * MINUTE <= view.monthEndsAt.getTime()).map((startsAt) => ({ startsAt, membersOnly: !general.has(startsAt.getTime()) }));
}

/**
 * Everything a member's booking needs, checked with the locks held. What is kept from asking and
 * from accepting, and what is the booking's own, is the rulebook's list. Returns what the host
 * offers and what the call sets aside.
 */
async function mustBeBookable(
  tx: Tx,
  input: { customer: Person; hostId: string; membership: Membership; month: MembershipMonth; startsAt: Date; lengthMinutes: number; seen: { pricePer15Cents: number; freeCancelMinutes: number }; now: Date; moneyStillHeld: boolean; exceptBookingId?: string },
): Promise<{ offer: Offer; cents: number }> {
  const { customer, hostId, membership, month, startsAt, lengthMinutes, now } = input;
  const [me] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, customer.id));
  if (!me || me.closedAt || me.pausedAt) throw new BookingError("Your account cannot make bookings at the moment.");
  if ((await switches(tx)).requestsOff) throw new BookingError("Connect is not taking new requests right now. Please try again later.");
  // A block either way looks, from here, exactly like a time that is no longer open.
  if (await isBlockedEitherWay(customer.id, hostId, tx)) throw new BookingError(NOT_OPEN);
  // The host approved, her account active, her payout account ready: read inside the step. A hidden page does not stand in a member's way.
  const offer = await offerOf(hostId, tx, { forMember: true });
  if (!offer || !offer.canTakePaid || !offer.lengths.includes(lengthMinutes)) throw new BookingError("This host cannot be booked right now.");
  if (offer.verifiedOnly && !(await identityState(customer.id, tx)).passed) {
    throw new BookingError("This host only takes calls from people who have confirmed their ID. Please confirm who you are on your account page.");
  }
  // The membership and its month, as they stand now.
  const usable =
    membership.status === "active" && membership.currentMonthId === month.id && membership.period === month.period && !month.endedHow && !month.problem && !isFrozen(month) && (month.status === "running" || (input.moneyStillHeld && month.status === "held"));
  if (!usable || !month.endsAt) throw new BookingError(NO_MEMBERSHIP);
  // The price and cancelling rule the member saw must still be the ones in force.
  if (input.seen.pricePer15Cents !== month.pricePer15Cents || input.seen.freeCancelMinutes !== offer.freeCancelMinutes) {
    throw new BookingError("The price or the cancelling rule changed while you were looking. Please check the details again.");
  }
  const endsAt = new Date(startsAt.getTime() + lengthMinutes * MINUTE);
  if (endsAt > month.endsAt) throw new BookingError("A call booked with your membership must end before your paid month ends.");
  const cents = memberCallCents(month.pricePer15Cents, lengthMinutes);
  if (cents < MIN_CHARGE_CENTS) throw new BookingError("This call is too short to be booked.");
  if (cents > (month.status === "held" ? month.totalCents : month.freeCents)) throw new BookingError("You do not have enough membership time left for this call. You can still ask for it the ordinary way.");
  // The daily limit on requests, as for any customer. (This booking itself, if it was already written down while its month's money was taken, is not counted against itself.)
  const sentSince = and(gt(schema.bookings.requestedAt, new Date(now.getTime() - DAY)), input.exceptBookingId ? ne(schema.bookings.id, input.exceptBookingId) : undefined);
  const count = async (...conditions: Parameters<typeof and>) => (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(and(eq(schema.bookings.customerId, customer.id), sentSince, ...conditions)))[0].n;
  if ((await count(eq(schema.bookings.hostId, hostId))) >= LIMITS.sentPerHostPerDay || (await count()) >= LIMITS.sentPerDay) {
    throw new BookingError("You have made a lot of requests today. Please try again tomorrow.");
  }
  // The time must be open for a member: general or member-only hours, the host's notice, how far ahead, time off, and nothing in the way.
  if (!isOpenStart(startsAt, slotInput(offer, await busyOf(tx, hostId, now), lengthMinutes, now, "member"))) throw new BookingError(NOT_OPEN);
  return { offer, cents };
}

type Input = { customer: Person; hostId: string; startsAt: Date; lengthMinutes: number; requestKey: string; seen: { pricePer15Cents: number; freeCancelMinutes: number }; now: Date };
export type MemberBookingResult = { booking: Booking; outcome: "booked" | "paying" | "not_booked"; message?: string };

/** The step that writes a member's request down while its month's money is still to be taken: nothing is reserved for either person. */
async function saveAsPaying(input: Input, found: { membership: Membership; month: MembershipMonth }): Promise<Booking> {
  const { customer, hostId } = input;
  return db.transaction(async (tx) => {
    await lockCalendars(tx, [hostId, customer.id]);
    const membership = await lockMembership(tx, found.membership.id);
    const month = await lockMonth(tx, found.month.id);
    const [again] = await tx.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
    if (again) {
      if (again.customerId !== customer.id) throw new BookingError(OUT_OF_DATE);
      return again;
    }
    // Everything about the booking is checked first; the money is only taken for a booking that could be made.
    const { offer, cents } = await mustBeBookable(tx, { ...input, membership, month, moneyStillHeld: true });
    const [saved] = await tx
      .insert(schema.bookings)
      .values({
        hostId,
        customerId: customer.id,
        startsAt: input.startsAt,
        endsAt: new Date(input.startsAt.getTime() + input.lengthMinutes * MINUTE),
        lengthMinutes: input.lengthMinutes,
        breakMinutes: offer.breakMinutes,
        pricePer15Cents: month.pricePer15Cents,
        totalCents: cents,
        freeCancelMinutes: offer.freeCancelMinutes,
        stage: "paying",
        source: "member",
        requestedAt: input.now,
        requestKey: input.requestKey,
        monthId: month.id,
      })
      .returning();
    return saved;
  });
}

/** Ends a booking that was waiting for its month's payment, once, and tells the member in words of its own. An ended request is never brought back. */
async function endPaying(bookingId: string, reason: string, now: Date): Promise<Booking | null> {
  return db.transaction(async (tx) => {
    const [ended] = await tx.update(schema.bookings).set({ stage: "ran_out", endedReason: reason, endedAt: now }).where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.stage, "paying"))).returning();
    if (!ended) return null;
    await queueBookingEmails(tx, ended, "member_not_booked");
    return ended;
  });
}

/** The booking step: everything checked again under the locks, and everything written in one go. */
async function bookInOneStep(input: Input, found: { membership: Membership; month: MembershipMonth }): Promise<Booking> {
  const { customer, hostId, now } = input;
  return db.transaction(async (tx) => {
    await lockCalendars(tx, [hostId, customer.id]);
    const membership = await lockMembership(tx, found.membership.id);
    const month = await lockMonth(tx, found.month.id);
    const [again] = await tx.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey)).for("update");
    if (again) {
      if (again.customerId !== customer.id) throw new BookingError(OUT_OF_DATE);
      // A second press with the same key gets the booking the first one made, and sets nothing aside again.
      if (again.stage !== "paying") return again;
    }
    const { offer, cents } = await mustBeBookable(tx, { ...input, membership, month, moneyStillHeld: false, exceptBookingId: again?.id });
    const endsAt = new Date(input.startsAt.getTime() + input.lengthMinutes * MINUTE);
    const busyUntil = new Date(endsAt.getTime() + offer.breakMinutes * MINUTE);

    const [call] = await tx
      .insert(schema.calls)
      // A member's call counts like a booked call: the host's time in the room is what counts.
      .values({ hostId, customerId: customer.id, startsAt: input.startsAt, endsAt, roomName: `call-${randomUUID()}`, pricePer15Cents: month.pricePer15Cents, freeCancelMinutes: offer.freeCancelMinutes, billing: "host" })
      .returning();
    const terms = {
      hostId,
      customerId: customer.id,
      startsAt: input.startsAt,
      endsAt,
      lengthMinutes: input.lengthMinutes,
      breakMinutes: offer.breakMinutes,
      pricePer15Cents: month.pricePer15Cents,
      totalCents: cents,
      freeCancelMinutes: offer.freeCancelMinutes,
      stage: "accepted",
      source: "member",
      monthId: month.id,
      callId: call.id,
      // A member's booking records the moment it was made: the host's notes and the booking's page rely on it.
      requestedAt: now,
      decidedAt: now,
    };
    const [booking] = again
      ? await tx.update(schema.bookings).set(terms).where(eq(schema.bookings.id, again.id)).returning()
      : await tx.insert(schema.bookings).values({ ...terms, requestKey: input.requestKey }).returning();

    // Both people are now taken (the host for the call and the break after it). If either already is, the database refuses.
    await tx.insert(schema.busyEntries).values([
      { bookingId: booking.id, userId: customer.id, startsAt: input.startsAt, endsAt },
      { bookingId: booking.id, userId: hostId, startsAt: input.startsAt, endsAt: busyUntil },
    ]);

    // The money: free becomes set aside, and the call's payment remembers how much of it was host-caused money.
    const { hostCausedCents } = await setAside(tx, month, cents);
    await tx.insert(schema.payments).values({
      kind: "member_call",
      callId: call.id,
      monthId: month.id,
      coversFrom: input.startsAt,
      coversUntil: endsAt,
      pricePer15Cents: month.pricePer15Cents,
      bookedCents: cents,
      hostCausedCents,
      // The month's percentages. Its fixed 30 cents is placed on the first amount of the month that is used or expires, not here.
      feePercentBps: month.feePercentBps,
      feeFixedCents: 0,
      feeForeignCardBps: month.feeForeignCardBps,
      // Set aside in the month counts as paid: the call can be joined. There is no hold at Stripe, and so no end of one.
      status: "held",
      heldAt: now,
      // Carried onto the payment, because the fee for a card from abroad is read from the payment.
      cardCountry: month.cardCountry,
    });

    // Other people's waiting requests for that time end, as when a host accepts.
    await endRequestsInTheWay(tx, { hostId, exceptBookingId: booking.id, from: input.startsAt, until: busyUntil, now });
    await queueBookingEmails(tx, booking, "member_booked");
    return booking;
  });
}

/**
 * A member books a time. `requestKey` is made when the form is shown, so pressing twice makes one
 * booking. When the month's money is still only held it is taken first, and the same press (or a
 * later one with the same key) continues from wherever it stopped.
 */
export async function bookAsMember(input: Input): Promise<MemberBookingResult> {
  const { customer, now } = input;
  if (!/^[0-9a-f-]{36}$/i.test(input.requestKey)) throw new BookingError(OUT_OF_DATE);
  if (customer.id === input.hostId) throw new BookingError("You cannot book a call with yourself.");

  let [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
  if (booking && booking.customerId !== customer.id) throw new BookingError(OUT_OF_DATE);
  if (booking?.stage === "accepted" || booking?.stage === "cancelled") return { booking, outcome: "booked" };
  if (booking && booking.stage !== "paying") return { booking, outcome: "not_booked", message: "This booking could not be made. Please choose a time again." };

  const found = await bookableMonth(db, customer.id, input.hostId, now);
  if (!found) {
    if (booking) await endPaying(booking.id, "Your membership could no longer be booked from.", now);
    throw new BookingError(NO_MEMBERSHIP);
  }

  let paidJustNow = false;
  if (found.month.status === "held") {
    // The first booking of the month: the request is written down, and then the month's money is taken.
    booking ??= await saveAsPaying(input, found);
    if (booking.stage !== "paying") return { booking, outcome: booking.stage === "accepted" ? "booked" : "not_booked" };
    const notYet: MemberBookingResult = { booking, outcome: "paying", message: "We could not take this month's payment yet. Please try again in a moment." };
    const taken = await takeNow(found.month.id, now).catch((error) => {
      console.error(`[membership] could not take the money of month ${found.month.id} for a first booking; the same press continues it`, error);
      return null;
    });
    // Stripe refused, or its answer has not arrived: nothing is booked from an answer we do not have.
    if (taken?.status !== "running") return notYet;
    paidJustNow = true;
    found.month = taken;
  }

  try {
    return { booking: await bookInOneStep(input, found), outcome: "booked" };
  } catch (error) {
    const lost = isOverlap(error) ? NOT_OPEN : error instanceof BookingError ? error.message : null;
    if (lost === null) throw error;
    if (!booking) throw new BookingError(lost);
    // The request was already written down (its month's money was being taken): it ends, with the plain reason.
    const reason = paidJustNow || booking.stage === "paying" ? (lost === NOT_OPEN ? PAID_BUT_TIME_GONE : lost) : lost;
    const ended = await endPaying(booking.id, reason, now);
    return { booking: ended ?? booking, outcome: "not_booked", message: reason };
  }
}

/**
 * For the helper: a booking that waits for its month's payment ends after 30 minutes, or at once
 * when its month or its membership can no longer be booked from. (A month whose money has been
 * taken meanwhile is left: the member's next press with the same key books.)
 */
export async function runPayingBookings(now: Date): Promise<void> {
  const waiting = await db
    .select({ booking: schema.bookings, monthStatus: schema.membershipMonths.status, endedHow: schema.membershipMonths.endedHow, membershipStatus: schema.memberships.status })
    .from(schema.bookings)
    .leftJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.bookings.monthId))
    .leftJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .where(eq(schema.bookings.stage, "paying"))
    .limit(100);
  for (const row of waiting) {
    const gone = row.membershipStatus !== "active" || Boolean(row.endedHow) || !inMonth(row.monthStatus);
    const late = row.booking.createdAt.getTime() <= now.getTime() - PAYING_MS;
    if (!gone && !late) continue;
    await endPaying(row.booking.id, gone ? "Your membership could no longer be booked from." : "This month's payment was not finished in time.", now).catch((error) =>
      console.error(`[membership] could not end unfinished member booking ${row.booking.id}; will retry`, error),
    );
  }
}

const inMonth = (status: string | null) => status === "held" || status === "running";
