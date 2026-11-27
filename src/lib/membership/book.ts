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
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, Membership, MembershipMonth } from "@/db/schema";
import { BookingError, busyOf, endRequestsInTheWay, isOverlap, lockCalendars, offerOf, slotInput, takenAsHost, TAKEN_THEN, type Offer } from "@/lib/booking/bookings";
import { queueBookingEmails } from "@/lib/booking/emails";
import { CARD_CONSENT_VERSION, firstLength, PASSED_OVER, takenUntil } from "@/lib/booking/rules";
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
import { afterTheWait, isFrozen, memberCallCents, minutesCovered, UNDONE_BOOKINGS_PER_DAY } from "./rules";

export { memberCallCents };

type Person = { id: string; name: string; email: string };
type Reader = Pick<typeof db, "select">;

const MINUTE = 60_000;
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
  return { membership, month, offer, freeCents, minutesLeft: minutesCovered(freeCents, month.pricePer15Cents), lengths: offer.lengths.filter(fits), monthEndsAt: month.endsAt! };
}

/**
 * The start times a member can book, for one length: general and member-only hours, the host's
 * notice alone as the earliest start, and only calls that end before the month ends. Each says
 * whether it is a time for members only (one the host's general hours do not offer).
 */
export async function memberOpenTimes(view: MemberBookingView, lengthMinutes: number, now: Date): Promise<Array<{ startsAt: Date; membersOnly: boolean }>> {
  if (!view.lengths.includes(lengthMinutes)) return [];
  const busy = await takenAsHost(db, view.offer.hostId, now);
  const starts = openStarts(slotInput(view.offer, busy, lengthMinutes, now, "member"));
  const general = new Set(openStarts(slotInput({ ...view.offer, weekly: view.offer.weekly.filter((stretch) => !stretch.membersOnly) }, busy, lengthMinutes, now, "member")).map((start) => start.getTime()));
  return starts.filter((start) => start.getTime() + lengthMinutes * MINUTE <= view.monthEndsAt.getTime()).map((startsAt) => ({ startsAt, membersOnly: !general.has(startsAt.getTime()) }));
}

/**
 * The host's next open times as a member would find them, for an invited person who is not a
 * member yet: general hours and hours for members only, with the host's notice alone as the
 * earliest start. Only a preview for the invitation page; booking checks everything again.
 */
export async function openTimesForInvited(hostId: string, now: Date, count = 8): Promise<Date[]> {
  const offer = await offerOf(hostId, db, { forMember: true });
  const length = offer ? firstLength(offer.lengths) : null;
  if (!offer || !length) return [];
  return openStarts(slotInput(offer, await takenAsHost(db, hostId, now), length, now, "member")).slice(0, count);
}

/**
 * Everything a member's booking needs, checked with the locks held. What is kept from asking and
 * from accepting, and what is the booking's own, is the rulebook's list. Returns what the host
 * offers and what the call sets aside.
 */
async function mustBeBookable(
  tx: Tx,
  input: { customer: Person; hostId: string; membership: Membership; month: MembershipMonth; startsAt: Date; lengthMinutes: number; seen: { pricePer15Cents: number; freeCancelMinutes: number }; now: Date; moneyStillHeld: boolean },
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
  // No daily limit on requests applies to a member's booking (the founder's decision): those limits are there to keep
  // one person from flooding a host with requests she has to answer. A member's booking needs no answer, the host
  // invited this person, and the time they paid for is the limit.
  // One thing those limits also stopped is kept, narrowly: booking a time and cancelling it again, over and over (each
  // booking ends other people's waiting requests for that time and writes to the host). Only bookings the member undid
  // themselves count; ones that are kept, or that the host or Connect cancelled, never do. A first booking that was
  // not finished never counts either: it held no time, wrote to nobody, and can end through no fault of the member
  // (the month was paid but the time was taken meanwhile).
  const [undone] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.customerId, customer.id),
        eq(schema.bookings.source, "member"),
        gt(schema.bookings.endedAt, new Date(now.getTime() - 24 * 60 * MINUTE)),
        eq(schema.bookings.stage, "cancelled"),
        eq(schema.bookings.endedReason, "cancelled by the customer"),
      ),
    );
  if (undone.n >= UNDONE_BOOKINGS_PER_DAY) throw new BookingError("You have cancelled several bookings today. Please try again tomorrow.");
  // The time must be open for a member: general or member-only hours, the host's notice, how far ahead, time off, and nothing in the way.
  if (!isOpenStart(startsAt, slotInput(offer, await takenAsHost(tx, hostId, now), lengthMinutes, now, "member"))) throw new BookingError(NOT_OPEN);
  // And the member must be free then. Said now, before a month's money is taken for a booking that could never be made.
  // (The database still has the last word when the booking is written.)
  if ((await busyOf(tx, customer.id, startsAt)).some((taken) => taken.start < takenUntil(endsAt) && taken.end > startsAt)) throw new BookingError(TAKEN_THEN);
  return { offer, cents };
}

/**
 * `seen.wordsVersion`: the version of the words about the call's charge that the booking page showed (booking/rules.ts,
 * WHOLE_BOOKING_SAID). A new booking must come with the version in force, and records it; one that comes without
 * it, or with another one, is refused, so nobody gets a booking under the earlier words by leaving the field out.
 * Left out only when a saved request is continued: that one keeps what it recorded when it was first written down.
 */
type Input = { customer: Person; hostId: string; startsAt: Date; lengthMinutes: number; requestKey: string; seen: { pricePer15Cents: number; freeCancelMinutes: number; wordsVersion?: string }; now: Date };

const WORDS_CHANGED = "The words about this booking have changed since you opened this page. Please read them again.";
/** The version a new booking records: the one its page showed, which must be the one in force. */
function wordsShown(input: Input): string {
  if (input.seen.wordsVersion !== CARD_CONSENT_VERSION) throw new BookingError(WORDS_CHANGED);
  return CARD_CONSENT_VERSION;
}
export type MemberBookingResult = { booking: Booking; outcome: "booked" | "paying" | "not_booked"; message?: string };

/** What a booking's own stage says became of it. Never "booked" for a request that ended without a call. */
function resultOf(booking: Booking): MemberBookingResult {
  if (booking.stage === "accepted") return { booking, outcome: "booked" };
  if (booking.stage === "paying") return { booking, outcome: "paying" };
  if (booking.stage === "cancelled") return { booking, outcome: "not_booked", message: "This call was booked, and has since been cancelled." };
  return { booking, outcome: "not_booked", message: booking.endedReason ?? "This booking could not be made. Please choose a time again." };
}

const NOT_IN_TIME = "This booking was not finished in time. Please choose a time again.";
const WRONG_MONTH = "The month this booking was made from can no longer be booked from. Please choose a time again.";

/**
 * A request that was written down is only ever continued as it was written down: for the same
 * host, time and length (anything else is a form that is out of date), and from the month it was
 * written down for (if the member has another month by now, money of that month is never taken
 * for the old request). Checked wherever a written-down request is found, also under the locks.
 */
function mustBeSameRequest(saved: Booking, input: Input, monthId: string): void {
  mustBeSameTerms(saved, input);
  if (saved.monthId !== monthId) throw new BookingError(WRONG_MONTH);
}

/** The first half of that, which needs nothing looked up: a press that names another host, time or length is refused, and the saved request is left as it is. */
function mustBeSameTerms(saved: Booking, input: Input): void {
  if (saved.customerId !== input.customer.id || saved.hostId !== input.hostId || saved.startsAt.getTime() !== input.startsAt.getTime() || saved.lengthMinutes !== input.lengthMinutes) throw new BookingError(OUT_OF_DATE);
}

/**
 * The step before a month's money is taken for a first booking: everything about the booking is
 * checked, and the request is written down with nothing reserved for either person. For a request
 * that was already written down (the same press again), everything is checked again, so the money
 * is never taken for a booking that can no longer be made.
 */
async function saveAsPaying(asked: Input, found: { membership: Membership; month: MembershipMonth }): Promise<Booking> {
  const { customer, hostId } = asked;
  return db.transaction(async (tx) => {
    await lockCalendars(tx, [hostId, customer.id]);
    const membership = await lockMembership(tx, found.membership.id);
    const month = await lockMonth(tx, found.month.id);
    // The clock is read again now that the locks are held: the host's notice and every other deadline are judged by when the step happens.
    const input: Input = { ...asked, now: afterTheWait(asked.now) };
    const [again] = await tx.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey)).for("update");
    if (again) {
      if (again.customerId !== customer.id) throw new BookingError(OUT_OF_DATE);
      if (again.stage !== "paying") return again;
      mustBeSameRequest(again, input, month.id);
      // A request in its last minute is ended here instead of being continued: the job that ends it after 30 minutes
      // must never end it while the month's money is being taken for it.
      if (again.createdAt.getTime() <= input.now.getTime() - (PAYING_MS - MINUTE)) throw new BookingError(NOT_IN_TIME);
      await mustBeBookable(tx, { ...input, membership, month, moneyStillHeld: true });
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
        // The version of the words this booking's page showed about the call's charge (booking/rules.ts, WHOLE_BOOKING_SAID).
        cardConsentVersion: wordsShown(input),
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
async function bookInOneStep(asked: Input, found: { membership: Membership; month: MembershipMonth }): Promise<Booking> {
  const { customer, hostId } = asked;
  return db.transaction(async (tx) => {
    await lockCalendars(tx, [hostId, customer.id]);
    const membership = await lockMembership(tx, found.membership.id);
    const month = await lockMonth(tx, found.month.id);
    // The clock is read again now that the locks are held (and, at a first booking, after the month's money was taken):
    // a press just before the host's notice begins that only gets here after it is refused.
    const input: Input = { ...asked, now: afterTheWait(asked.now) };
    const { now } = input;
    const [again] = await tx.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey)).for("update");
    if (again) {
      if (again.customerId !== customer.id) throw new BookingError(OUT_OF_DATE);
      // A second press with the same key gets the booking the first one made, and sets nothing aside again.
      if (again.stage !== "paying") return again;
      mustBeSameRequest(again, input, month.id);
    }
    const { offer, cents } = await mustBeBookable(tx, { ...input, membership, month, moneyStillHeld: false });
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
      // The version of the words this booking's page showed about the call's charge (booking/rules.ts, WHOLE_BOOKING_SAID).
      // A request that was written down earlier keeps what it recorded then, whatever the words are today.
      cardConsentVersion: again ? again.cardConsentVersion : wordsShown(input),
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
      { bookingId: booking.id, userId: customer.id, startsAt: input.startsAt, endsAt: takenUntil(endsAt) },
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
    // The member may be a host too: requests to her that this call of her own makes impossible end as well (plans/42).
    await endRequestsInTheWay(tx, { hostId: customer.id, exceptBookingId: booking.id, from: input.startsAt, until: takenUntil(endsAt), now, reason: PASSED_OVER.ownCall });
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

  const savedNow = async () => (await db.select().from(schema.bookings).where(and(eq(schema.bookings.requestKey, input.requestKey), eq(schema.bookings.customerId, customer.id))))[0] as Booking | undefined;
  /** Ends a written-down request for a plain reason, and reports what its row says now (another step may have got there first). */
  const endAs = async (saved: Booking, reason: string) => resultOf((await endPaying(saved.id, reason, now)) ?? (await savedNow()) ?? saved);

  let [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
  if (booking && booking.customerId !== customer.id) throw new BookingError(OUT_OF_DATE);
  if (booking && booking.stage !== "paying") return resultOf(booking);
  // Before anything is looked up for the host this press names: it must be the request that was written down.
  if (booking) mustBeSameTerms(booking, input);

  const found = await bookableMonth(db, customer.id, input.hostId, now);
  if (!found) {
    if (booking) return endAs(booking, "Your membership could no longer be booked from.");
    throw new BookingError(NO_MEMBERSHIP);
  }
  // A request that was written down is continued only as it was written down (see mustBeSameRequest; the steps below check it again under the locks).
  if (booking) {
    try {
      mustBeSameRequest(booking, input, found.month.id);
    } catch (error) {
      if (error instanceof BookingError && error.message === WRONG_MONTH) return endAs(booking, WRONG_MONTH);
      throw error;
    }
  }

  if (found.month.status === "held") {
    // The first booking of the month: everything is checked and the request written down, and then the month's money is taken.
    try {
      booking = await saveAsPaying(input, found);
    } catch (error) {
      // A request that was written down earlier and can no longer be booked ends here, before any money is taken.
      if (booking && error instanceof BookingError && error.message !== OUT_OF_DATE) return endAs(booking, error.message);
      throw error;
    }
    if (booking.stage !== "paying") return resultOf(booking);
    const taken = await takeNow(found.month.id, now).catch((error) => {
      console.error(`[membership] could not take the money of month ${found.month.id} for a first booking; the same press continues it`, error);
      return null;
    });
    // Stripe refused, or its answer has not arrived: nothing is booked from an answer we do not have.
    if (taken?.status !== "running") {
      const current = (await savedNow()) ?? booking;
      return current.stage === "paying" ? { booking: current, outcome: "paying", message: "We could not take this month's payment yet. Please try again in a moment." } : resultOf(current);
    }
    found.month = taken;
  }

  try {
    // (The booking step gives back a request that ended meanwhile as it is: its own stage says what became of it.)
    return resultOf(await bookInOneStep(input, found));
  } catch (error) {
    const lost = isOverlap(error) ? NOT_OPEN : error instanceof BookingError ? error.message : null;
    if (lost === null) {
      // Something else went wrong while the call was being written (the database, say). If a request was written down,
      // its month is paid by now: the member is sent to it and told so, and "Finish booking" tries the same request again.
      const waiting = await savedNow().catch(() => undefined);
      if (waiting?.stage !== "paying") throw error;
      console.error(`[membership] could not write the call of member booking ${waiting.id} after its month was paid; the same press continues it`, error);
      return { booking: waiting, outcome: "paying", message: "Your month's payment went through, but the call is not booked yet. Press \"Finish booking\" to try again." };
    }
    // Was a request written down (by this press or an earlier one, while the month's money was being taken)? Read it as it is now.
    const saved = await savedNow();
    // None, or a form that does not match it: only this press is refused.
    if (!saved || lost === OUT_OF_DATE) throw new BookingError(lost);
    if (saved.stage !== "paying") return resultOf(saved);
    // It ends, with the plain reason. Its month's money has been taken by now (the booking step only runs for a month that is paid).
    return endAs(saved, lost === NOT_OPEN ? PAID_BUT_TIME_GONE : lost);
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
    // While the month's money is being taken for it (the taking is written down and has no answer yet), a request
    // is not ended for being late: its press is still at work, and tells the member what became of it.
    if (!gone && row.booking.monthId) {
      const [taking] = await db.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.monthId, row.booking.monthId), eq(schema.moneyOperations.kind, "capture"), eq(schema.moneyOperations.status, "started"))).limit(1);
      if (taking) continue;
    }
    // Said as it is: if the month's money was taken meanwhile, the payment did go through, and only the booking was not finished.
    const reason = gone ? "Your membership could no longer be booked from." : row.monthStatus === "running" ? "This booking was not finished in time. Your month's payment went through; please choose a time again." : "This month's payment was not finished in time.";
    await endPaying(row.booking.id, reason, now).catch((error) =>
      console.error(`[membership] could not end unfinished member booking ${row.booking.id}; will retry`, error),
    );
  }
}

const inMonth = (status: string | null) => status === "held" || status === "running";
