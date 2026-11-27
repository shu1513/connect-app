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
import { whyNoNewPayment } from "@/lib/disputes/paying";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking } from "@/db/schema";
import { bookingCardSeen } from "@/lib/membership/cards";
import { createPaymentForCall, stripeCustomerFor } from "@/lib/payments/hold";
import { bookedTotalCents, MIN_CHARGE_CENTS } from "@/lib/payments/pricing";
import { stripe, stripeConfigured } from "@/lib/payments/stripe";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";
import { switches } from "@/lib/safety/switches";
import { queueBookingEmails } from "./emails";
import { fittingLengths, instantAnswerBy, instantPayBy, instantStart, isAvailableNow, latestInstantStart, NOW } from "./now-rules";
import { AFTER_CALL_MINUTES, answerDeadline, CARD_CONSENT_VERSION, cardStepOpen, earliestStartFor, isUuid, LIMITS, PASSED_OVER, payCutoff, readLengths, REQUEST_KEY_LIFE_MS, requestKeyLives, requestKeyMadeAt, takenUntil } from "./rules";
import { stretchesFor, isOpenStart, openStarts, withOwnBreak, type Interval } from "./slots";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A problem the person can understand. Its message is safe to show them. */
export class BookingError extends Error {}

const DAY = 24 * 3_600_000;
const DECLINED_BY_HOST = "declined by the host";
/** Said to a customer who is already taken at the time they ask for, the time kept free after each call included. */
export const TAKEN_THEN = `You already have a request or a call at that time, or within ${AFTER_CALL_MINUTES} minutes of it.`;
const TAKEN_NOW = `You already have a request or a call at this time, or within ${AFTER_CALL_MINUTES} minutes of it.`;

/** True when the database refused a row because the person is already taken at that time. */
export function isOverlap(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

/**
 * Takes each person's calendar lock, always in the same order, so two steps
 * that involve the same people wait for each other instead of getting stuck.
 */
/** Said to a sending whose once-only key was already answered "no request was made": it makes nothing, however late it arrives. */
export const KEY_SPENT = "This request can no longer be sent as it is. Please go back and start again.";

/** Said to a sending from the app whose key is too old (or is not one the server made for the app). */
export const KEY_TOO_OLD = "This page has been open for a long time. Please check the details and send again.";

/** How long a sending from the app waits for another one with the same key. */
const KEY_WAIT = "8s";
/**
 * The queue for once-only keys has a number space of its own (the database's two-number kind of lock). The
 * calendars use the one-number kind, so a key and a calendar can never turn out to be the same lock.
 */
const KEY_SPACE = 4506;

/**
 * Takes this customer's place in the queue for one once-only key, for the rest of this step of the
 * database: no other step holds the same place meanwhile. The key is the customer's own: nobody
 * else's sending waits on it.
 *
 * `bounded` (the phone app): waits a few seconds at most for a step that holds the place; if that is
 * still not through, this one fails (the database's "lock not available") and nothing is decided. The
 * app is then told "it cannot be told", keeps what it sent, and sends the same again. Not bounded (the
 * website's form): waits until the other is through and then finds what it made, as it always did; a
 * form has no way to be told "it cannot be told" and keep its key.
 *
 * (Exported for the check script, which holds a place to see both.)
 */
export async function queueForKey(tx: Tx, customerId: string, requestKey: string, options: { bounded: boolean }): Promise<void> {
  const place = sql`select pg_advisory_xact_lock(${KEY_SPACE}::int, hashtext(${`request-key:${customerId}:${requestKey}`}))`;
  if (!options.bounded) {
    await tx.execute(place);
    return;
  }
  // The limit is for this one wait. What was in force before is remembered and put back, so what follows in this
  // step waits exactly as it would have.
  await tx.execute(sql`select set_config('connect.wait_before', current_setting('lock_timeout'), true)`);
  await tx.execute(sql`select set_config('lock_timeout', ${KEY_WAIT}, true)`);
  await tx.execute(place);
  await tx.execute(sql`select set_config('lock_timeout', current_setting('connect.wait_before'), true)`);
}

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
  /** The host's switch: only people who have passed the identity check can send a new request. */
  verifiedOnly: boolean;
  /** Every stretch of weekly hours. `membersOnly` ones are open to the host's members alone (see slotInput). */
  weekly: Array<{ weekday: number; startMinute: number; endMinute: number; membersOnly: boolean }>;
  timeOff: Interval[];
  /** "Available now", as the host set it. Whether it counts right now is isAvailableNow()'s call. */
  availableUntil: Date | null;
  availableSeenAt: Date | null;
};

/**
 * What a host offers for booking, or null if they cannot be booked at all:
 * not approved, hidden, account closed, or no calendar set up. From outside
 * these all look the same.
 */
export async function offerOf(hostId: string, reader: Pick<typeof db, "select"> = db, opts: { forMember?: boolean } = {}): Promise<Offer | null> {
  const [row] = await reader
    .select({ profile: schema.hostProfiles, calendar: schema.hostCalendars, settings: schema.hostSettings, closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .innerJoin(schema.hostCalendars, eq(schema.hostCalendars.userId, schema.hostProfiles.userId))
    .leftJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.hostProfiles.userId))
    .where(eq(schema.hostProfiles.userId, hostId));
  // Asked "for a member" (only after membership/access.ts has said this person is a member of this host),
  // a hidden page does not stand in the way: a host who hides her page from the public keeps her members.
  // Everything else is refused exactly as for anyone.
  if (!row || row.profile.status !== "approved" || (row.profile.hidden && !opts.forMember) || row.closedAt || row.pausedAt) return null;
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
    // Never less than the time kept free after every call, also for a host whose stored break is older than that rule.
    breakMinutes: Math.max(row.calendar.breakMinutes, AFTER_CALL_MINUTES),
    noticeHours: row.calendar.noticeHours,
    horizonWeeks: row.calendar.horizonWeeks,
    canTakePaid: !paid || (stripeConfigured() && Boolean(row.settings?.payoutsReady)),
    verifiedOnly: row.settings?.verifiedOnly ?? false,
    weekly: weekly.map((w) => ({ weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute, membersOnly: w.membersOnly })),
    timeOff: timeOff.map((t) => ({ start: t.startsAt, end: t.endsAt })),
    availableUntil: row.calendar.availableUntil,
    availableSeenAt: row.calendar.availableSeenAt,
  };
}

/** Whether this person has an approved host profile, hidden or not: the sentences "you are a host too" are for them (plans/42). */
export async function isHostToo(userId: string): Promise<boolean> {
  const [row] = await db.select({ status: schema.hostProfiles.status }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId));
  return row?.status === "approved";
}

export type OwnBooking = { bookingId: string; hostName: string; startsAt: Date; endsAt: Date; waiting: boolean; freeAgainAt: Date };

/**
 * For a host's calendar page: the calls and waiting requests she has as a customer that still
 * close her own page (plans/42). Coming ones, one that is under way, and one that is over while
 * her break after it still runs. `freeAgainAt` is the moment she can be booked again: the same
 * arithmetic as takenAsHost, which is what her customers are held to.
 */
export async function ownBookingsTakingTime(userId: string, now: Date): Promise<OwnBooking[]> {
  const [calendar] = await db.select({ breakMinutes: schema.hostCalendars.breakMinutes }).from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, userId));
  const breakMs = (calendar ? Math.max(calendar.breakMinutes, AFTER_CALL_MINUTES) : 0) * 60_000;
  const rows = await db
    .select({
      bookingId: schema.bookings.id,
      stage: schema.bookings.stage,
      startsAt: schema.bookings.startsAt,
      endsAt: schema.bookings.endsAt,
      takenUntil: schema.busyEntries.endsAt,
      displayName: schema.hostProfiles.displayName,
      name: schema.user.name,
    })
    .from(schema.busyEntries)
    .innerJoin(schema.bookings, eq(schema.bookings.id, schema.busyEntries.bookingId))
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.hostId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.bookings.hostId))
    .where(and(eq(schema.busyEntries.userId, userId), eq(schema.bookings.customerId, userId), gt(schema.busyEntries.endsAt, new Date(now.getTime() - breakMs))))
    .orderBy(asc(schema.busyEntries.startsAt));
  return rows
    .map((row) => ({
      bookingId: row.bookingId,
      hostName: row.displayName ?? row.name,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      waiting: row.stage === "waiting",
      freeAgainAt: new Date(Math.max(row.takenUntil.getTime(), row.endsAt.getTime() + breakMs)),
    }))
    .filter((row) => row.freeAgainAt > now);
}

/**
 * The host's "only people who have confirmed their ID" switch. Saved while holding the host's
 * calendar lock, the lock every request takes before it reads what the host offers: a request
 * can never read "off" and still arrive after the host has saved "on".
 */
export async function setVerifiedOnly(hostId: string, on: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await lockCalendars(tx, [hostId]);
    await tx
      .insert(schema.hostSettings)
      .values({ userId: hostId, verifiedOnly: on })
      .onConflictDoUpdate({ target: schema.hostSettings.userId, set: { verifiedOnly: on, updatedAt: new Date() } });
  });
}

/**
 * What a host offers for a call right now, or null: they must be bookable at
 * all, have said they are available, still be on their page, have room for
 * more instant requests, and have a length that fits before whatever they are
 * taken for next (as host or as customer).
 */
export async function instantOffer(hostId: string, now: Date, reader: Pick<typeof db, "select"> = db): Promise<{ offer: Offer; lengths: number[]; availableUntil: Date } | null> {
  const offer = await offerOf(hostId, reader);
  if (!offer || !offer.canTakePaid || !isAvailableNow(offer, now)) return null;
  const [{ waiting }] = await reader
    .select({ waiting: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.hostId, hostId), eq(schema.bookings.source, "now"), eq(schema.bookings.stage, "waiting")));
  if (waiting >= NOW.waitingPerHost) return null;
  const lengths = fittingLengths({ lengths: offer.lengths, breakMinutes: offer.breakMinutes, busy: await takenAsHost(reader, hostId, now), now, availableUntil: offer.availableUntil! });
  if (lengths.length === 0) return null;
  return { offer, lengths, availableUntil: offer.availableUntil! };
}

export async function busyOf(reader: Pick<typeof db, "select">, userId: string, from: Date): Promise<Interval[]> {
  const rows = await reader
    .select({ start: schema.busyEntries.startsAt, end: schema.busyEntries.endsAt })
    .from(schema.busyEntries)
    .where(and(eq(schema.busyEntries.userId, userId), gt(schema.busyEntries.endsAt, from)));
  return rows;
}

/**
 * What a host is taken for, as the people who want to book her must see it: everything on her list
 * of taken times, and after a call she booked herself (as a customer) her break of today as well,
 * where it reaches past the time kept free after every call (plans/42). Her break is read here, from
 * her calendar as it is now, and never from an offer that is handed around: at the card step that
 * offer carries the break saved on one request. A person without a calendar has no break.
 *
 * Only for what others may ask of her. What she does herself is checked against busyOf.
 */
export async function takenAsHost(reader: Pick<typeof db, "select">, hostId: string, from: Date): Promise<Interval[]> {
  const [calendar] = await reader.select({ breakMinutes: schema.hostCalendars.breakMinutes }).from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hostId));
  // As in offerOf: never less than the time kept free after every call, also for a break stored before that rule.
  const breakMinutes = calendar ? Math.max(calendar.breakMinutes, AFTER_CALL_MINUTES) : 0;
  const rows = await reader
    .select({ start: schema.busyEntries.startsAt, end: schema.busyEntries.endsAt, customerId: schema.bookings.customerId, callEnd: schema.bookings.endsAt })
    .from(schema.busyEntries)
    .innerJoin(schema.bookings, eq(schema.bookings.id, schema.busyEntries.bookingId))
    // An entry that is over can still count: her break after it may not be.
    .where(and(eq(schema.busyEntries.userId, hostId), gt(schema.busyEntries.endsAt, new Date(from.getTime() - breakMinutes * 60_000))));
  return withOwnBreak(
    rows.map((row) => ({ start: row.start, end: row.end, ownCallEnd: row.customerId === hostId ? row.callEnd : null })),
    breakMinutes,
  ).filter((taken) => taken.end > from);
}

/**
 * What the rule for open times is given. This is the one place where member-only hours are told
 * apart: everyone who is not booking as a member gets the general stretches only, before they are
 * joined together. A member gets every stretch, and the host's notice alone as the earliest start
 * (no card hold has to be placed in time: the month's money is already there).
 */
export function slotInput(offer: Offer, busy: Interval[], lengthMinutes: number, now: Date, as: "anyone" | "member" = "anyone") {
  const paid = offer.pricePer15Cents > 0;
  return {
    timeZone: offer.timeZone,
    weekly: stretchesFor(offer.weekly, as),
    timeOff: offer.timeOff,
    busy,
    lengthMinutes,
    breakMinutes: offer.breakMinutes,
    now,
    earliestStart: earliestStartFor({ now, paid: paid && as !== "member", freeCancelMinutes: offer.freeCancelMinutes, noticeHours: offer.noticeHours }),
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
  return openStarts(slotInput(offer, await takenAsHost(db, offer.hostId, now), lengthMinutes, now));
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

type Person = { id: string; name: string; email: string };

/** Checks, with both calendars locked, that this request may be sent right now. Throws BookingError if not. */
async function checkMayAsk(tx: Tx, offer: Offer, booking: { id?: string; customerId: string; startsAt: Date; lengthMinutes: number; totalCents: number; source?: string }, now: Date) {
  const instant = booking.source === "now";
  const [me] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, booking.customerId));
  if (!me || me.closedAt || me.pausedAt) throw new BookingError("Your account cannot make requests at the moment.");
  if ((await switches(tx)).requestsOff) throw new BookingError("Connect is not taking new requests right now. Please try again later.");
  // A block either way looks, from here, exactly like a time that is no longer open.
  if (await isBlockedEitherWay(booking.customerId, offer.hostId, tx)) throw new BookingError(instant ? "This host is not available right now." : "That time is no longer open. Please choose another.");
  if (instant) await checkMayAskNow(tx, offer, booking, now);
  else if (!isOpenStart(booking.startsAt, slotInput(offer, await takenAsHost(tx, offer.hostId, now), booking.lengthMinutes, now))) {
    throw new BookingError("That time is no longer open. Please choose another.");
  }
  // Before a first free call, the customer confirms who they are (a paid call has a card behind it).
  // A host can ask the same of everyone. Only the customer's own passed check counts.
  const free = booking.totalCents === 0;
  if ((free || offer.verifiedOnly) && !(await identityState(booking.customerId, tx)).passed) {
    throw new BookingError(
      free
        ? "Before your first free call, please confirm who you are on your account page."
        : "This host only takes calls from people who have confirmed their ID. Please confirm who you are on your account page.",
    );
  }
  const count = async (...conditions: Parameters<typeof and>) =>
    (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(and(...conditions)))[0].n;
  const mine = eq(schema.bookings.customerId, booking.customerId);
  const thisHost = eq(schema.bookings.hostId, offer.hostId);
  const waiting = eq(schema.bookings.stage, "waiting");
  // Requests sent in the last 24 hours. A booking made with a membership is not a request (it needs no answer and is
  // paid for already), so it is not counted here: booking as a member never uses up someone's ordinary requests.
  const sentSince = and(gt(schema.bookings.requestedAt, new Date(now.getTime() - DAY)), ne(schema.bookings.source, "member"));

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
  // (Declining a call *now* is not a rejection of the person: that has its own 15-minute rule, in checkMayAskNow.)
  const declinedLately = await count(
    mine,
    thisHost,
    ne(schema.bookings.source, "now"),
    eq(schema.bookings.stage, "declined"),
    eq(schema.bookings.endedReason, DECLINED_BY_HOST),
    gt(schema.bookings.endedAt, new Date(now.getTime() - LIMITS.declineCooldownDays * DAY)),
  );
  if (declinedLately > 0) throw new BookingError("This host is not taking requests from you at the moment.");
  if ((await count(thisHost, waiting, eq(schema.bookings.startsAt, booking.startsAt))) >= LIMITS.perStart || (await count(thisHost, waiting)) >= LIMITS.perHost) {
    throw new BookingError("This host is not taking more requests for now. Please try again later.");
  }
}

/** The extra rules for an instant request: the host is really available, the length still fits, and the instant limits. */
async function checkMayAskNow(tx: Tx, offer: Offer, booking: { id?: string; customerId: string; lengthMinutes: number }, now: Date) {
  const open = await instantOffer(offer.hostId, now, tx);
  if (!open || !open.lengths.includes(booking.lengthMinutes)) throw new BookingError("This host is not available right now.");
  const count = async (...conditions: Parameters<typeof and>) =>
    (await tx.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(and(...conditions)))[0].n;
  const mine = eq(schema.bookings.customerId, booking.customerId);
  const instant = eq(schema.bookings.source, "now");
  const notThis = booking.id ? ne(schema.bookings.id, booking.id) : undefined;
  if ((await count(mine, instant, inArray(schema.bookings.stage, ["card", "waiting"]), notThis)) >= NOW.outstandingPerCustomer) {
    throw new BookingError("You already have a request for a call now. Wait for the answer, or take it back.");
  }
  // Every try counts, including ones that never reached the host.
  if ((await count(mine, instant, gt(schema.bookings.createdAt, new Date(now.getTime() - DAY)), notThis)) >= LIMITS.sentPerDay) {
    throw new BookingError("You have asked for a lot of calls today. Please try again tomorrow.");
  }
  const declined = await count(
    mine,
    instant,
    eq(schema.bookings.hostId, offer.hostId),
    eq(schema.bookings.stage, "declined"),
    eq(schema.bookings.endedReason, DECLINED_BY_HOST),
    gt(schema.bookings.endedAt, new Date(now.getTime() - NOW.cooldownMinutes * 60_000)),
  );
  if (declined > 0) throw new BookingError(`This host is not taking calls from you right now. You can ask again ${NOW.cooldownMinutes} minutes after they declined.`);
  // "In a row" means the last few calls that were accepted, whatever became of them: one that went
  // ahead in between breaks the run.
  const lastTries = await tx
    .select({ stage: schema.bookings.stage, holdFailedAt: schema.bookings.holdFailedAt })
    .from(schema.bookings)
    .where(and(mine, instant, inArray(schema.bookings.stage, ["accepted", "cancelled"]), notThis))
    .orderBy(desc(schema.bookings.createdAt))
    .limit(NOW.cardFailuresBeforePause);
  const pauseSince = new Date(now.getTime() - NOW.cardFailurePauseMinutes * 60_000);
  if (lastTries.length === NOW.cardFailuresBeforePause && lastTries.every((t) => t.stage === "cancelled" && t.holdFailedAt && t.holdFailedAt > pauseSince)) {
    throw new BookingError("Your card could not be used for your last few calls. Please check it, and try again in an hour.");
  }
}

/** Moves a request into "waiting": the customer is now taken for that time, and the host's clock starts. */
async function sendToHost(tx: Tx, booking: Booking, now: Date, paymentMethodId: string | null): Promise<Booking> {
  const paid = booking.totalCents > 0;
  const instant = booking.source === "now";
  const terms = { startsAt: booking.startsAt, paid, freeCancelMinutes: booking.freeCancelMinutes };
  // An instant request takes the customer from now until the call could be over (the card step may have
  // taken a while, so the nominal time is worked out again here); the exact time is set when the host accepts.
  const nominalStart = instant ? latestInstantStart(now) : booking.startsAt;
  const nominalEnd = instant ? new Date(nominalStart.getTime() + booking.lengthMinutes * 60_000) : booking.endsAt;
  await tx.insert(schema.busyEntries).values({ bookingId: booking.id, userId: booking.customerId, startsAt: instant ? now : booking.startsAt, endsAt: takenUntil(nominalEnd) });
  const [sent] = await tx
    .update(schema.bookings)
    .set({
      startsAt: nominalStart,
      endsAt: nominalEnd,
      stage: "waiting",
      requestedAt: now,
      respondBy: instant ? instantAnswerBy(now) : answerDeadline({ ...terms, requestedAt: now }),
      // An instant call's payment deadline is set when it is accepted.
      payBy: paid && !instant ? payCutoff(booking.startsAt, booking.freeCancelMinutes) : null,
      stripePaymentMethodId: paymentMethodId,
      // The host hears about an instant request at once (and sees it on their page), never in the hourly digest.
      hostNotifiedAt: instant ? now : null,
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
  /**
   * The price and cancelling rule the customer was shown and agreed to. If the host has changed them since, nothing
   * is sent. `cardTermsVersion`: the version of the words beside the card box that the customer was shown and
   * ticked; if those words have been changed since, nothing is sent either (the tick was for the old ones). A
   * form hands in what it was sent, or null when it was sent none: null is no version, and is refused for a paid
   * request. Only code that leaves the field out altogether (the check scripts) is not asked.
   */
  seen: { pricePer15Cents: number; freeCancelMinutes: number; cardTermsVersion?: string | null };
  /**
   * A sending from the phone app. Two things are then different from the website's form: the wait for another
   * sending with the same key has a limit (see `queueForKey`), and the key itself must be one the server made
   * for the app not too long ago (`requestKeyLives`): an older one makes nothing.
   */
  fromApp?: boolean;
  now: Date;
}): Promise<{ booking: Booking; clientSecret: string | null }> {
  const { customer, now } = input;
  // The same test as where a request is looked up by its key (requestWithKey): a key that can make a request can find it again.
  if (!isUuid(input.requestKey)) throw new BookingError("This form is out of date. Please reload the page.");
  if (customer.id === input.hostId) throw new BookingError("You cannot book a call with yourself.");
  const note = input.note.replace(/\s+/g, " ").trim();
  if (note.length > LIMITS.noteMax) throw new BookingError(`The note can be at most ${LIMITS.noteMax} characters.`);
  let booking: Booking;
  try {
    booking = await db.transaction(async (tx) => {
      // Before anything is looked at as it stands now: one sending at a time for one key. A form sent twice, or sent
      // again because the first answer was lost on the way, waits here until the first is through, and then finds
      // what it made. So the second can never be refused (the host has changed something meanwhile, say) while the
      // first goes on to be made.
      await queueForKey(tx, customer.id, input.requestKey, { bounded: input.fromApp === true });
      const [again] = await tx.select().from(schema.bookings).where(eq(schema.bookings.requestKey, input.requestKey));
      if (again) {
        if (again.customerId !== customer.id) throw new BookingError("This form is out of date. Please reload the page.");
        return again;
      }
      // A key the app was already told "no request was made" for makes nothing now, even if everything else would
      // be in order: this sending may be an early one that was held up on its way, arriving after a later try with
      // the same key was refused for good.
      const [spent] = await tx
        .select({ at: schema.spentRequestKeys.at })
        .from(schema.spentRequestKeys)
        .where(and(eq(schema.spentRequestKeys.customerId, customer.id), eq(schema.spentRequestKeys.requestKey, input.requestKey)));
      if (spent) throw new BookingError(KEY_SPENT);
      // The website's form never makes a request with a key of the app's kind (its own keys are of another kind):
      // an app's key that has grown too old must not find a way in through the form.
      if (!input.fromApp && requestKeyMadeAt(input.requestKey) !== null) throw new BookingError("This form is out of date. Please reload the page.");
      await lockCalendars(tx, [input.hostId, customer.id]);
      // What the host offers, read with the calendars locked: nothing about it can change under this request now.
      const current = await offerOf(input.hostId, tx);
      if (!current || !current.lengths.includes(input.lengthMinutes) || !current.canTakePaid) throw new BookingError("This host cannot be booked right now.");
      const totalCents = bookedTotalCents(current.pricePer15Cents, input.lengthMinutes * 60);
      const paid = totalCents > 0;
      if (paid && totalCents < MIN_CHARGE_CENTS) throw new BookingError("This call is too short to be charged for.");
      if (paid && !input.agreedToCardTerms) throw new BookingError("Please tick the box about your card to continue.");
      if (current.pricePer15Cents !== input.seen.pricePer15Cents || current.freeCancelMinutes !== input.seen.freeCancelMinutes) {
        throw new BookingError("This host's price or cancelling rule changed while you were looking. Please check the details again.");
      }
      await checkMayAsk(tx, current, { customerId: customer.id, startsAt: input.startsAt, lengthMinutes: input.lengthMinutes, totalCents }, now);
      // A customer with a chargeback cannot make a new agreement to pay (plans/47, decision 9). Asked here, where the new
      // request is written, and not in the shared check above, which the card step of a request already made uses too.
      const stopped = totalCents > 0 ? await whyNoNewPayment(tx, customer.id) : null;
      if (stopped) throw new BookingError(stopped);
      // Say so now, before a card is entered, if the customer is already taken at that time.
      // (The database still has the last word when the request is finally sent.)
      const endsAt = new Date(input.startsAt.getTime() + input.lengthMinutes * 60_000);
      const taken = (await busyOf(tx, customer.id, input.startsAt)).some((b) => b.start < takenUntil(endsAt) && b.end > input.startsAt);
      if (taken) throw new BookingError(TAKEN_THEN);
      if (paid) {
        // The tick is recorded with the version of the words in force. A tick given for other words is not one for these.
        if (input.seen.cardTermsVersion !== undefined && input.seen.cardTermsVersion !== CARD_CONSENT_VERSION) {
          throw new BookingError("The words about your card have changed since you opened this page. Please read them again.");
        }
        // A paid request stands at the card step until its card is saved: it takes nobody's time and is not a sent
        // request, so none of the limits above counts it. These two do, whether or not a card is ever saved.
        const drafts = and(eq(schema.bookings.customerId, customer.id), eq(schema.bookings.source, "customer"), gt(schema.bookings.totalCents, 0));
        // Standing at the card step: only those whose time is not up (one past it is over, also before the helper has
        // ended it), judged by the real clock now that the calendars are locked (a request is always made at a real moment).
        const at = Date.now();
        const [{ open }] = await tx
          .select({ open: sql<number>`count(*)::int` })
          .from(schema.bookings)
          .where(and(drafts, eq(schema.bookings.stage, "card"), gt(schema.bookings.createdAt, new Date(at - LIMITS.cardStepMinutes * 60_000))));
        if (open >= LIMITS.cardStepsOpen) throw new BookingError("You have several requests waiting for their card. Finish one of them first, or wait until they have ended.");
        const [{ today }] = await tx.select({ today: sql<number>`count(*)::int` }).from(schema.bookings).where(and(drafts, gt(schema.bookings.createdAt, new Date(now.getTime() - DAY))));
        if (today >= LIMITS.cardStepsPerDay) throw new BookingError("You have started a lot of requests today. Please try again tomorrow.");
      }
      // The last thing before a request is made: the app's key must still be alive. (A key that was answered "no
      // request was made" is remembered for longer than a key lives, so one that has been forgotten is too old to
      // make anything: together the two close every way back for a sending that was held up.)
      if (input.fromApp && !requestKeyLives(input.requestKey, new Date())) throw new BookingError(KEY_TOO_OLD);
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
    if (isOverlap(error)) throw new BookingError(TAKEN_THEN);
    throw error;
  }
  return cardStepFor(booking, customer);
}

/**
 * A customer asks a host who is available now for a call right away. The
 * same path as a booked request (a card is saved first, then the host is
 * asked), with the instant rules and the instant deadlines.
 */
export async function askNow(input: {
  customer: Person;
  hostId: string;
  lengthMinutes: number;
  requestKey: string;
  agreedToCardTerms: boolean;
  /** The price the customer was shown and agreed to. */
  seen: { pricePer15Cents: number };
  now: Date;
}): Promise<{ booking: Booking; clientSecret: string | null }> {
  const { customer, now } = input;
  if (!/^[0-9a-f-]{36}$/i.test(input.requestKey)) throw new BookingError("This form is out of date. Please reload the page.");
  if (customer.id === input.hostId) throw new BookingError("You cannot book a call with yourself.");
  const open = await instantOffer(input.hostId, now);
  if (!open || !open.lengths.includes(input.lengthMinutes)) throw new BookingError("This host is not available right now.");
  const totalCents = bookedTotalCents(open.offer.pricePer15Cents, input.lengthMinutes * 60);
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
      // Asking again replaces an instant request of theirs that never got past the card step (the form
      // was abandoned, or could not be shown): it never reached a host, and without this the person
      // would be told they "already have a request" until it timed out. It still counts as a try today.
      await tx
        .update(schema.bookings)
        .set({ stage: "ran_out", endedReason: "replaced by a newer request", endedAt: now })
        .where(and(eq(schema.bookings.customerId, customer.id), eq(schema.bookings.source, "now"), eq(schema.bookings.stage, "card")));
      const current = await offerOf(input.hostId, tx);
      if (!current || !current.canTakePaid) throw new BookingError("This host is not available right now.");
      if (current.pricePer15Cents !== input.seen.pricePer15Cents || current.pricePer15Cents !== open.offer.pricePer15Cents) {
        throw new BookingError("This host's price changed while you were looking. Please check the details again.");
      }
      // The nominal time: as late as the call could start if the host takes their full time to answer.
      // The real time is set when the host accepts.
      const startsAt = latestInstantStart(now);
      const endsAt = new Date(startsAt.getTime() + input.lengthMinutes * 60_000);
      await checkMayAsk(tx, current, { customerId: customer.id, startsAt, lengthMinutes: input.lengthMinutes, totalCents, source: "now" }, now);
      // (As for a booked request: plans/47, decision 9.)
      const stopped = totalCents > 0 ? await whyNoNewPayment(tx, customer.id) : null;
      if (stopped) throw new BookingError(stopped);
      const taken = (await busyOf(tx, customer.id, now)).some((b) => b.start < takenUntil(endsAt) && b.end > now);
      if (taken) throw new BookingError(TAKEN_NOW);
      const [draft] = await tx
        .insert(schema.bookings)
        .values({
          hostId: input.hostId,
          customerId: customer.id,
          startsAt,
          endsAt,
          lengthMinutes: input.lengthMinutes,
          breakMinutes: current.breakMinutes,
          pricePer15Cents: current.pricePer15Cents,
          totalCents,
          // An instant call can be cancelled for free until it starts. Never a late-cancellation charge.
          freeCancelMinutes: 0,
          note: "",
          stage: "card",
          source: "now",
          requestKey: input.requestKey,
          cardConsentVersion: paid ? CARD_CONSENT_VERSION : null,
          cardConsentAt: paid ? now : null,
        })
        .returning();
      return paid ? draft : sendToHost(tx, draft, now, null);
    });
  } catch (error) {
    if (isOverlap(error)) throw new BookingError(TAKEN_NOW);
    throw error;
  }
  return cardStepFor(booking, customer);
}

/** For a paid request still at the card step: Stripe keeps the card. Nothing is held or charged by this. */
async function cardStepFor(found: Booking, customer: Person): Promise<{ booking: Booking; clientSecret: string | null }> {
  let booking = found;
  if (booking.stage !== "card") return { booking, clientSecret: null };

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
 * The card step of a paid request that is still at it, for the customer who made it: what
 * Stripe's form needs. If the step could not be made when the request was (Stripe did not
 * answer then), it is made now. Null for anything that is not this person's own request at its
 * card step. Nothing is held or charged by this, and nothing about the request changes.
 */
export async function cardStepOf(input: { bookingId: string; customer: Person; now: Date }): Promise<{ booking: Booking; clientSecret: string } | null> {
  const found = await bookingFor(input.bookingId, input.customer.id);
  if (!found || found.role !== "customer" || found.booking.stage !== "card") return null;
  // Past its time the request is over, also in the moments before the helper has written that down.
  if (!cardStepOpen(found.booking.createdAt, input.now)) return null;
  const step = await cardStepFor(found.booking, input.customer);
  return step.clientSecret ? { booking: step.booking, clientSecret: step.clientSecret } : null;
}

/**
 * The customer has entered their card. We ask Stripe ourselves whether it was
 * really saved, check everything again, and only then send the request to the
 * host. Safe to call again, and safe to call late: an unfinished request that
 * has ended is never brought back.
 *
 * `live` is set by the two addresses that people's browsers and phones call. Asking Stripe and
 * waiting for the locks take time, so for them everything is judged and dated by the clock at the
 * moment of deciding, with every lock held, not by `now` from when the question came in. A check
 * script that works with a clock of its own leaves `live` out, and is judged by the `now` it
 * hands in. One thing is measured by the real clock for everyone: whether the card step's time is
 * up, since the moment the request was made is always a real one.
 */
export async function finishCardStep(input: { bookingId: string; customerId: string; now: Date; live?: boolean }): Promise<Booking> {
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
      // A card belongs to a booking or to a membership, never both. From here on it is remembered as a booking's.
      const mine = await bookingCardSeen(tx, booking.id, paymentMethodId);
      // The moment of deciding: Stripe has been asked and every lock is held (the calendars', and the card's just
      // above). Whether the host is still there for a call asked for "now", and from when her time to answer runs,
      // are judged and dated by it.
      const real = new Date();
      const at = input.live ? real : input.now;
      const end = (reason: string) =>
        tx
          .update(schema.bookings)
          // The card is kept on the row so the helper can remove it from Stripe (never a membership's card).
          .set({ stage: "ran_out", endedReason: reason, endedAt: at, stripePaymentMethodId: mine ? paymentMethodId : null })
          .where(eq(schema.bookings.id, booking.id))
          .returning()
          .then((rows) => rows[0]);
      if (!mine) return end("that card is saved for a membership, so it cannot be used for a booking; please ask again with another card");
      // The card step lasts as long as the customer was told, and no longer: past it the request ends here, in the
      // helper's own words, whether or not the helper has been by. (The card is kept on the row so the helper removes it.)
      if (!cardStepOpen(booking.createdAt, real)) return end("the card was not entered in time");
      const offer = await offerOf(booking.hostId, tx);
      if (!offer || !offer.canTakePaid) return end("the host can no longer be booked");
      // The deadlines come from the terms fixed on this request, so the time is checked against those
      // same terms, not against whatever the host's settings are now.
      const asAsked = { ...offer, pricePer15Cents: booking.pricePer15Cents, freeCancelMinutes: booking.freeCancelMinutes, breakMinutes: booking.breakMinutes };
      try {
        await checkMayAsk(tx, asAsked, booking, at);
      } catch (error) {
        if (error instanceof BookingError) return end(error.message);
        throw error;
      }
      return sendToHost(tx, booking, at, paymentMethodId);
    });
  } catch (error) {
    if (!isOverlap(error)) throw error;
    // The customer took another request or call at that time while entering the card.
    const ended = await db.transaction(async (tx) => {
      // The booking first, then the card: the same order as above, so the two can never wait for each other.
      const [still] = await tx.select({ stage: schema.bookings.stage }).from(schema.bookings).where(eq(schema.bookings.id, before.id)).for("update");
      if (still?.stage !== "card") return undefined;
      const mine = await bookingCardSeen(tx, before.id, paymentMethodId);
      const [row] = await tx
        .update(schema.bookings)
        .set({ stage: "ran_out", endedReason: `you already have a request or a call at that time, or within ${AFTER_CALL_MINUTES} minutes of it`, endedAt: input.live ? new Date() : input.now, stripePaymentMethodId: mine ? paymentMethodId : null })
        .where(and(eq(schema.bookings.id, before.id), eq(schema.bookings.stage, "card")))
        .returning();
      return row;
    });
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

/**
 * Every other waiting request for this host that a call taking this time (its break included)
 * gets in the way of, or that would run into it with its own break, can no longer be accepted.
 * They end with "the host accepted another request". Used when a host accepts a request, and
 * when a host adds time to a call that is under way.
 *
 * With the reason PASSED_OVER.ownCall it is used for the *customer* of a call that was just fixed:
 * if that person is a host too, the requests to her that her own call (and the time kept free
 * after it) makes impossible end at once, and their customers are told only that she is no longer
 * free (plans/42). For a person nobody has asked for a call it finds nothing.
 */
export async function endRequestsInTheWay(
  tx: Tx,
  input: { hostId: string; exceptBookingId: string; from: Date; until: Date; now: Date; reason?: (typeof PASSED_OVER)[keyof typeof PASSED_OVER] },
): Promise<void> {
  await endWaiting(
    tx,
    and(
      eq(schema.bookings.hostId, input.hostId),
      ne(schema.bookings.id, input.exceptBookingId),
      sql`tstzrange(${schema.bookings.startsAt}, ${schema.bookings.endsAt} + make_interval(mins => ${schema.bookings.breakMinutes}), '[)') && tstzrange(${input.from.toISOString()}::timestamptz, ${input.until.toISOString()}::timestamptz, '[)')`,
    ),
    "passed_over",
    input.reason ?? PASSED_OVER.anotherRequest,
    input.now,
  );
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
 *
 * `live` is set by the addresses that people's browsers and phones call: see `finishCardStep`.
 */
export async function accept(input: { bookingId: string; hostId: string; now: Date; live?: boolean }): Promise<{ callId: string }> {
  const [seen] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, input.bookingId));
  if (!seen || seen.hostId !== input.hostId) throw new BookingError("Request not found.");
  try {
    return await db.transaction(async (tx) => {
      await lockCalendars(tx, [seen.hostId, seen.customerId]);
      const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, seen.id)).for("update");
      // The moment of deciding. For the addresses people call (`live`), the clock is read here, with the calendars
      // locked and the request in hand: getting this far can take a while, and the time to answer may have run out
      // meanwhile. A check script that works with a clock of its own is judged by the `now` it hands in.
      const at = input.live ? new Date() : input.now;
      if (booking.stage !== "waiting") throw new BookingError("This request is no longer waiting for an answer.");
      if (!booking.respondBy || booking.respondBy <= at) throw new BookingError("The time to answer this request has passed.");

      // Both people must still be able to take part. (A hidden profile can still accept what it was asked.)
      const [parties] = await tx
        .select({ hostClosed: schema.user.closedAt, status: schema.hostProfiles.status, payoutsReady: schema.hostSettings.payoutsReady })
        .from(schema.user)
        .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
        .leftJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.user.id))
        .where(eq(schema.user.id, booking.hostId));
      const [customer] = await tx.select({ closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt }).from(schema.user).where(eq(schema.user.id, booking.customerId));
      const [me] = await tx.select({ pausedAt: schema.user.pausedAt }).from(schema.user).where(eq(schema.user.id, booking.hostId));
      if (!parties || parties.hostClosed || parties.status !== "approved" || me?.pausedAt) throw new BookingError("Your host profile is not active, so you cannot accept requests.");
      if (!customer || customer.closedAt || customer.pausedAt) throw new BookingError("This customer's account is no longer active.");
      if (await isBlockedEitherWay(booking.hostId, booking.customerId, tx)) throw new BookingError("This request can no longer be accepted.");
      const paid = booking.totalCents > 0;
      if (paid && !(stripeConfigured() && parties.payoutsReady)) {
        throw new BookingError("Your payout account is not ready, so you cannot accept paid requests yet. Finish the payout setup first.");
      }

      const instant = booking.source === "now";
      let { startsAt, endsAt } = booking;
      if (instant) {
        // The host must still be available (on their page), and the call is timed from this moment.
        const offer = await offerOf(booking.hostId, tx);
        if (!offer || !isAvailableNow(offer, at)) throw new BookingError("You are no longer available, so this request cannot be accepted.");
        startsAt = instantStart(at);
        endsAt = new Date(startsAt.getTime() + booking.lengthMinutes * 60_000);
        await tx.update(schema.busyEntries).set({ startsAt, endsAt: takenUntil(endsAt) }).where(and(eq(schema.busyEntries.bookingId, booking.id), eq(schema.busyEntries.userId, booking.customerId)));
        // One instant call at a time: being available ends with accepting. (And with it an announcement to followers that was still waiting, plans/31.)
        await tx.update(schema.hostCalendars).set({ availableUntil: null, availableSeenAt: null, announceAt: null, updatedAt: at }).where(eq(schema.hostCalendars.userId, booking.hostId));
      }

      // The host is now taken for the call and the break after it. If they already are, the database refuses.
      const busyUntil = new Date(endsAt.getTime() + booking.breakMinutes * 60_000);
      await tx.insert(schema.busyEntries).values({ bookingId: booking.id, userId: booking.hostId, startsAt, endsAt: busyUntil });

      const [call] = await tx
        .insert(schema.calls)
        .values({
          hostId: booking.hostId,
          customerId: booking.customerId,
          startsAt,
          endsAt,
          roomName: `call-${randomUUID()}`,
          pricePer15Cents: booking.pricePer15Cents,
          freeCancelMinutes: booking.freeCancelMinutes,
          // An instant call charges the time both people were in; a booked call the host's time.
          billing: instant ? "together" : "host",
        })
        .returning();
      if (paid) await createPaymentForCall(tx, call);
      const [accepted] = await tx
        .update(schema.bookings)
        .set({ stage: "accepted", callId: call.id, decidedAt: at, startsAt, endsAt, payBy: instant && paid ? instantPayBy(at) : booking.payBy })
        .where(eq(schema.bookings.id, booking.id))
        .returning();
      await queueBookingEmails(tx, accepted, "accepted");

      await endRequestsInTheWay(tx, { hostId: booking.hostId, exceptBookingId: booking.id, from: startsAt, until: busyUntil, now: at });
      // The customer may be a host too: requests to her that this call of her own makes impossible end as well.
      await endRequestsInTheWay(tx, { hostId: booking.customerId, exceptBookingId: booking.id, from: startsAt, until: takenUntil(endsAt), now: at, reason: PASSED_OVER.ownCall });
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
 * For the check scripts only (no page uses it): a call between any two people, created as an
 * already-accepted booking so it obeys the same "never two calls at once" rule. It is marked
 * source "admin", which keeps it out of ratings, contacts and reminders.
 */
export async function createTestCall(input: {
  hostId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  pricePer15Cents: number;
  freeCancelMinutes: number;
}): Promise<{ callId: string }> {
  // A host can collect 24 hours after a call's end, and the customer can ask for a refund until 24 hours and
  // 3 minutes after its start (payments/rules.ts). A paid call shorter than that grace would turn the order round.
  if (input.pricePer15Cents > 0 && input.endsAt.getTime() - input.startsAt.getTime() < 5 * 60_000) {
    throw new BookingError("A paid call lasts at least 5 minutes.");
  }
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
          breakMinutes: AFTER_CALL_MINUTES,
          pricePer15Cents: input.pricePer15Cents,
          totalCents: bookedTotalCents(input.pricePer15Cents, Math.floor((input.endsAt.getTime() - input.startsAt.getTime()) / 1000)),
          freeCancelMinutes: input.freeCancelMinutes,
          stage: "accepted",
          source: "admin",
          // As a paid booking made today would carry it: the words that say what "End call now" costs (rules.ts, WHOLE_BOOKING_SAID).
          cardConsentVersion: input.pricePer15Cents > 0 ? CARD_CONSENT_VERSION : null,
          requestKey: randomUUID(),
          callId: call.id,
          decidedAt: new Date(),
        })
        .returning();
      await tx.insert(schema.busyEntries).values([
        { bookingId: booking.id, userId: input.hostId, startsAt: input.startsAt, endsAt: takenUntil(input.endsAt) },
        { bookingId: booking.id, userId: input.customerId, startsAt: input.startsAt, endsAt: takenUntil(input.endsAt) },
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
 * (their requests as a host) or closes or pauses an account (as host and as customer).
 * Calls that were already accepted are cancelled by the caller.
 */
export async function endWaitingRequestsOf(userId: string, roles: { asHost: boolean; asCustomer: boolean }, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    if (roles.asHost) await endWaiting(tx, eq(schema.bookings.hostId, userId), "declined", "the host is no longer available", now);
    if (roles.asCustomer) await endWaiting(tx, eq(schema.bookings.customerId, userId), "taken_back", "the customer's account was closed or paused", now);
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

/**
 * Instant requests still waiting for a host who is no longer available (they
 * closed their page, switched off, accepted another call, or their connection
 * dropped) end at once, so no customer waits out the clock for someone who
 * has gone. Pass a host to do it for that host only.
 */
export async function endInstantRequestsOfAbsentHosts(now: Date, onlyHostId?: string): Promise<number> {
  const waitingNow = and(eq(schema.bookings.stage, "waiting"), eq(schema.bookings.source, "now"));
  const hosts = await db
    .selectDistinct({ hostId: schema.bookings.hostId, availableUntil: schema.hostCalendars.availableUntil, availableSeenAt: schema.hostCalendars.availableSeenAt })
    .from(schema.bookings)
    .leftJoin(schema.hostCalendars, eq(schema.hostCalendars.userId, schema.bookings.hostId))
    .where(and(waitingNow, onlyHostId ? eq(schema.bookings.hostId, onlyHostId) : undefined));
  let ended = 0;
  for (const host of hosts) {
    if (isAvailableNow(host, now)) continue;
    ended += await db.transaction(async (tx) => {
      // Under the host's calendar lock, like every other answer, and looked at again there:
      // the host may have come back, or accepted, a moment ago.
      await lockCalendars(tx, [host.hostId]);
      const [calendar] = await tx.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, host.hostId));
      if (calendar && isAvailableNow(calendar, now)) return 0;
      return (await endWaiting(tx, and(eq(schema.bookings.hostId, host.hostId), eq(schema.bookings.source, "now")), "ran_out", "the host is no longer available", now)).length;
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
  // Only an id as the database makes them is ever asked for: anything else is nobody's booking.
  if (!isUuid(bookingId)) return null;
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!booking) return null;
  if (booking.hostId === userId) return { booking, role: "host" };
  if (booking.customerId === userId) return { booking, role: "customer" };
  return null;
}

/**
 * The request this customer made with this once-only key, if there is one: so that a request whose
 * answer was lost on the way is found again as it was made, whatever has changed since.
 */
export async function requestWithKey(customerId: string, requestKey: string): Promise<Booking | null> {
  if (!isUuid(requestKey)) return null;
  const [booking] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.requestKey, requestKey), eq(schema.bookings.customerId, customerId)));
  return booking ?? null;
}

/**
 * The same question, asked once every sending with this key is through: it takes the key's place
 * in the queue first (see `askForCall`), so a sending that is being written down at this very
 * moment is waited for (a few seconds at most) and then seen. This is what is asked before a
 * customer is told "nothing was sent". One short step on one connection.
 */
/**
 * A used-up key is remembered for a day: twice as long as a key for the app can make a request at all
 * (`REQUEST_KEY_LIFE_MS`). So when it is forgotten, the key is too old to make anything.
 */
const SPENT_KEYS_KEPT_MS = DAY;
if (SPENT_KEYS_KEPT_MS < 2 * REQUEST_KEY_LIFE_MS) throw new Error("A used-up request key must be remembered for longer than a key lives.");
/** How many used-up keys one person can have at a time. Nobody refused in good faith comes near it. */
export const SPENT_KEYS_MAX = 200;

/**
 * Writes down that this key is used up, with the key's place in the queue held. This person's old ones are tidied
 * away first, so the list cannot grow without end. If it is full all the same (somebody sending refusals by the
 * hundred), this throws: the caller then cannot say "no request was made" for good, and says "it cannot be told".
 */
async function spendKey(tx: Tx, customerId: string, requestKey: string): Promise<void> {
  const mine = eq(schema.spentRequestKeys.customerId, customerId);
  // One of this person's refusals at a time (taken after the key's own place, never before it): two that come
  // together must not both find one row's room and both take it.
  await tx.execute(sql`select pg_advisory_xact_lock(${KEY_SPACE}::int, hashtext(${`used-up-keys:${customerId}`}))`);
  const [known] = await tx.select({ at: schema.spentRequestKeys.at }).from(schema.spentRequestKeys).where(and(mine, eq(schema.spentRequestKeys.requestKey, requestKey)));
  if (known) return;
  // Forgotten: what was written down more than a day ago by the database's own clock (the clock that dated it),
  // unless the key could still make a request, now or later (a key that names a moment still to come is kept
  // until that moment is long past).
  const old = await tx
    .select({ requestKey: schema.spentRequestKeys.requestKey })
    .from(schema.spentRequestKeys)
    .where(and(mine, lt(schema.spentRequestKeys.at, sql`now() - make_interval(secs => ${SPENT_KEYS_KEPT_MS / 1000})`)));
  const dead = old.map((row) => row.requestKey).filter((key) => (requestKeyMadeAt(key)?.getTime() ?? 0) + REQUEST_KEY_LIFE_MS < Date.now());
  if (dead.length > 0) await tx.delete(schema.spentRequestKeys).where(and(mine, inArray(schema.spentRequestKeys.requestKey, dead)));
  const [{ kept }] = await tx.select({ kept: sql<number>`count(*)::int` }).from(schema.spentRequestKeys).where(mine);
  if (kept >= SPENT_KEYS_MAX) throw new Error(`too many used-up request keys for one person (${kept}): this refusal cannot be written down`);
  await tx.insert(schema.spentRequestKeys).values({ customerId, requestKey }).onConflictDoNothing();
}

export async function requestWithKeySettled(customerId: string, requestKey: string, options: { spend?: boolean } = {}): Promise<Booking | null> {
  if (!isUuid(requestKey)) return null;
  return db.transaction(async (tx) => {
    await queueForKey(tx, customerId, requestKey, { bounded: true });
    const [booking] = await tx.select().from(schema.bookings).where(and(eq(schema.bookings.requestKey, requestKey), eq(schema.bookings.customerId, customerId)));
    // `spend`: the caller is about to say "no request was made" for good. That is written down here, in the key's
    // own place in the queue, so that no sending with this key can make one afterwards (see `askForCall`).
    if (!booking && options.spend) await spendKey(tx, customerId, requestKey);
    return booking ?? null;
  });
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
        inArray(schema.bookings.source, ["customer", "now", "member"]),
        or(
          inArray(schema.bookings.stage, ["card", "waiting", "paying"]),
          and(isNull(schema.bookings.callId), gt(schema.bookings.endedAt, new Date(now.getTime() - 7 * DAY))),
        ),
      ),
    )
    .orderBy(asc(schema.bookings.startsAt));
}
