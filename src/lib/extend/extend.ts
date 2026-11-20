/**
 * Adding time during a call: the customer asks, the host answers, and when
 * the host says yes the same call simply runs longer.
 *
 * The order is "money first, then the host". For a paid call the price of the
 * extra minutes is held on the customer's card before the host is asked, as a
 * payment of its own. Accepting is then one step in our own database with
 * nothing left that can fail at the bank.
 *
 * Three rules keep this safe (see plans/09-more-time.md):
 *   - A request changes state only with its call locked. One that has ended
 *     can never become accepted.
 *   - A request that ends without being accepted is first marked as ended, and
 *     only then is its hold let go. Only an accepted request can ever be
 *     charged (checked again at the moment of charging, in capturePayment).
 *   - The database itself refuses a longer call that would overlap anything
 *     else either person is taken for.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, CallExtension, Payment } from "@/db/schema";
import { endRequestsInTheWay, lockCalendars } from "@/lib/booking/bookings";
import { membershipForMoreTime, returnEndedRequestMoney } from "@/lib/membership/calls";
import { cardInUse } from "@/lib/membership/cards";
import { lockMonthsOfCall } from "@/lib/membership/locks";
import { setAside } from "@/lib/membership/months";
import { memberCallCents } from "@/lib/membership/rules";
import { releasePayment } from "@/lib/payments/actions";
import { placeHoldWithSavedCard } from "@/lib/payments/hold";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { ownPaymentOf } from "@/lib/payments/own";
import { DEFAULT_FEE_TERMS } from "@/lib/payments/pricing";
import { holdCoversCall } from "@/lib/payments/rules";
import { stripe, stripeConfigured } from "@/lib/payments/stripe";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { switches } from "@/lib/safety/switches";
import { PASSED_OVER, takenUntil } from "@/lib/booking/rules";
import { askWindow, canStillAccept, extensionPriceCents, MAX_REQUESTS_PER_CALL, minutesProblem, minutesThatFit } from "./rules";

type Reader = Pick<typeof db, "select">;

/** A problem the person can understand. Its message is safe to show them. */
export class ExtendError extends Error {}

const NO_LONGER = "Time can no longer be added to this call.";
const NO_CARD = "Time cannot be added to this call by card, because your membership has no saved card any more. The call ends as booked.";
const ENDED = ["declined", "ran_out", "failed"] as const;

function log(message: string, error?: unknown) {
  // Expected refusals (already done, waiting for Stripe) are not errors.
  if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[more time] ${message}: ${error.message}`);
  else if (error) console.error(`[more time] ${message}`, error);
  else console.log(`[more time] ${message}`);
}

/** True when the database refused a row because the person is already taken at that time. */
function isOverlap(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

/** True when the database refused a second open request for the same call. */
function isSecondOpenRequest(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * What stops time being added to this call right now, whoever asks, or null.
 * Used for asking and for accepting; both check it again with the call locked.
 */
async function whyNot(reader: Reader, call: Call, now: Date): Promise<string | null> {
  if (call.cancelledAt) return "This call was cancelled.";
  if (call.safetyEndedAt || call.closedAt || now >= call.endsAt) return "This call has ended.";
  const [people] = await reader
    .select({ out: sql<number>`count(*) filter (where ${schema.user.pausedAt} is not null or ${schema.user.closedAt} is not null)::int` })
    .from(schema.user)
    .where(inArray(schema.user.id, [call.hostId, call.customerId]));
  if (people.out > 0 || (await isBlockedEitherWay(call.hostId, call.customerId, reader))) return NO_LONGER;
  if ((await switches(reader)).joiningOff) return "Calls are paused across Connect right now, so time cannot be added.";
  return null;
}

/**
 * How many more minutes fit after this call's end: before the host's next
 * thing (leaving the break fixed on this booking) and before the customer's.
 * The host's weekly hours and time off do not limit it: the host is there and
 * says yes themselves. Zero for a call that has no booking behind it.
 */
async function minutesFitting(reader: Reader, call: Call): Promise<number> {
  const [booking] = await reader.select({ id: schema.bookings.id, breakMinutes: schema.bookings.breakMinutes }).from(schema.bookings).where(eq(schema.bookings.callId, call.id));
  if (!booking) return 0;
  // Nobody is ever taken twice at once, so anything else that starts at or after this call's start comes after it.
  const nextFor = async (userId: string): Promise<Date | null> => {
    const [next] = await reader
      .select({ startsAt: schema.busyEntries.startsAt })
      .from(schema.busyEntries)
      .where(and(eq(schema.busyEntries.userId, userId), ne(schema.busyEntries.bookingId, booking.id), gte(schema.busyEntries.startsAt, call.startsAt)))
      .orderBy(asc(schema.busyEntries.startsAt))
      .limit(1);
    return next?.startsAt ?? null;
  };
  return minutesThatFit({ startsAt: call.startsAt, endsAt: call.endsAt, breakMinutes: booking.breakMinutes, hostNextAt: await nextFor(call.hostId), customerNextAt: await nextFor(call.customerId) });
}

export type AddTimeChoices = {
  fits: number;
  pricePer15Cents: number;
  /**
   * Only for a call that was booked with a membership: a request of up to this many minutes is paid
   * from the membership. A longer one is paid by card, all of it, at the price above. (0: every
   * request is paid by card.)
   */
  membershipCovers?: number;
};

/** The customer's choices right now: how many minutes fit, the call's price, and for a member's call how each choice would be paid. */
export async function addTimeChoices(call: Call, now: Date = new Date()): Promise<AddTimeChoices> {
  const choices = { fits: await minutesFitting(db, call), pricePer15Cents: call.pricePer15Cents };
  const member = await membershipForMoreTime(db, call, now);
  return member ? { ...choices, membershipCovers: member.coversMinutes } : choices;
}

/** How a request for more time is paid on a member's call, and what it costs. */
export type Way = { paidFrom: "membership" | "card"; priceCents: number };

/**
 * How a request for these minutes on a member's call would be paid right now: from the membership
 * when it covers the whole request (the member price for those minutes, rounded down, like a
 * booking), otherwise by card, at the call's price for those minutes.
 */
function wayFor(member: NonNullable<Awaited<ReturnType<typeof membershipForMoreTime>>>, call: Call, minutes: number): Way {
  return minutes <= member.coversMinutes
    ? { paidFrom: "membership", priceCents: memberCallCents(member.locked.month.pricePer15Cents, minutes) }
    : { paidFrom: "card", priceCents: extensionPriceCents(call.pricePer15Cents, minutes) };
}

/** Whether that is what the member's screen showed when they pressed: the same way, and for a card the same price. */
const asShown = (way: Way, shown: Way | { paidFrom: "membership" } | undefined): boolean =>
  shown?.paidFrom === way.paidFrom && (way.paidFrom === "membership" || ("priceCents" in shown && shown.priceCents === way.priceCents));

/**
 * On a member's call: how the request would be paid, or its card price, is no longer what the
 * screen showed. Nothing was written, nothing is held and the host was not asked; `way` is how it
 * stands now, for the member to press again.
 */
export class WayChanged extends ExtendError {
  constructor(readonly way: Way) {
    super(
      way.paidFrom === "card"
        ? "Your membership time no longer covers this. It would be paid by card: $" + (way.priceCents / 100).toFixed(2) + ". Nothing was asked yet; press again if you want it."
        : "This can now be paid from your membership instead of your card. Nothing was asked yet; press again if you want it.",
    );
  }
}

// ---------------------------------------------------------------------------
// What both screens are shown
// ---------------------------------------------------------------------------

export type ExtensionView = {
  /** The request that is waiting, if any. `ready` is false while its money is still being held: the host is not asked yet. */
  open: { id: string; minutes: number; priceCents: number; ready: boolean } | null;
  /** The request that was answered or ended most recently, so each screen can say what became of it. */
  last: { id: string; minutes: number; status: string } | null;
};

/** Read from our own record only (no call to Stripe): the call screen asks every couple of seconds. */
export async function extensionView(callId: string): Promise<ExtensionView> {
  const rows = await db
    .select({ extension: schema.callExtensions, paymentStatus: schema.payments.status })
    .from(schema.callExtensions)
    .leftJoin(schema.payments, eq(schema.payments.extensionId, schema.callExtensions.id))
    .where(eq(schema.callExtensions.callId, callId))
    .orderBy(desc(schema.callExtensions.createdAt));
  const open = rows.find((row) => row.extension.status === "open");
  const last = rows.find((row) => row.extension.status !== "open");
  return {
    // A request is ready for the host as soon as its hold is on record, however that record got
    // there (Stripe's answer, Stripe's own message, or the helper's check). A free one is ready at once.
    open: open ? { id: open.extension.id, minutes: open.extension.minutes, priceCents: open.extension.priceCents, ready: open.extension.priceCents === 0 || open.paymentStatus === "held" } : null,
    last: last ? { id: last.extension.id, minutes: last.extension.minutes, status: last.extension.status } : null,
  };
}

// ---------------------------------------------------------------------------
// Ending a request without adding time
// ---------------------------------------------------------------------------

/**
 * Marks an open request as ended, with its call locked, and only then lets its
 * hold go. Returns false if the request was no longer open (nothing is changed
 * then, and in particular an accepted request's hold is never touched).
 */
async function endExtension(extensionId: string, status: (typeof ENDED)[number], reason: string, now: Date): Promise<boolean> {
  const ended = await db.transaction(async (tx) => {
    const [extension] = await tx.select({ callId: schema.callExtensions.callId }).from(schema.callExtensions).where(eq(schema.callExtensions.id, extensionId));
    if (!extension) return false;
    await tx.select({ id: schema.calls.id }).from(schema.calls).where(eq(schema.calls.id, extension.callId)).for("update");
    const marked = await tx
      .update(schema.callExtensions)
      .set({ status, endedReason: reason, decidedAt: now })
      .where(and(eq(schema.callExtensions.id, extensionId), eq(schema.callExtensions.status, "open")))
      .returning({ id: schema.callExtensions.id });
    return marked.length > 0;
  });
  if (ended) await releaseHoldOf(extensionId).catch((error) => log(`could not let go of the hold of request ${extensionId} yet; the helper will retry`, error));
  return ended;
}

/** Lets go of the hold of a request that ended without being accepted. Does nothing for any other request. */
async function releaseHoldOf(extensionId: string): Promise<void> {
  const [found] = await db
    .select({ paymentId: schema.payments.id, kind: schema.payments.kind })
    .from(schema.payments)
    .innerJoin(schema.callExtensions, eq(schema.callExtensions.id, schema.payments.extensionId))
    .where(and(eq(schema.payments.extensionId, extensionId), inArray(schema.payments.status, ["awaiting_payment", "held"]), inArray(schema.callExtensions.status, [...ENDED])));
  if (!found) return;
  // Paid from a membership: there is no hold at Stripe. Its money goes back to where it came from, in a step with the month's locks.
  if (found.kind === "member_call") await returnEndedRequestMoney(extensionId, new Date());
  else await releasePayment({ paymentId: found.paymentId, note: "The request for more time was not accepted, so nothing was charged for it." });
}

// ---------------------------------------------------------------------------
// Asking (the customer)
// ---------------------------------------------------------------------------

/** The saved card that holds the money for this call, if it is still saved with Stripe for this customer. */
async function savedCardOf(own: Payment, customerId: string): Promise<string | null> {
  if (!own.stripePaymentIntentId) return null;
  const [known] = await db.select({ stripeCustomerId: schema.stripeCustomers.stripeCustomerId }).from(schema.stripeCustomers).where(eq(schema.stripeCustomers.userId, customerId));
  if (!known) return null;
  const intent = await stripe().paymentIntents.retrieve(own.stripePaymentIntentId, { expand: ["payment_method"] }, { timeout: 10_000, maxNetworkRetries: 0 });
  const method = intent.payment_method && typeof intent.payment_method === "object" ? intent.payment_method : null;
  const owner = method?.customer ? (typeof method.customer === "string" ? method.customer : method.customer.id) : null;
  // A card typed on the call page was used once and never saved: it has no owner at Stripe and cannot be used again.
  return method && owner === known.stripeCustomerId ? method.id : null;
}

/**
 * The customer asks for more minutes. For a free call the host is asked at
 * once. For a paid call the price is first held on the card that holds the
 * money for the call; the host is asked once that hold is on record.
 *
 * Returns "waiting" (the host has been asked) or "checking" (the bank's answer
 * is not known yet; the call screen follows it). Throws ExtendError, with
 * nothing added and nothing left held, when it cannot be done.
 *
 * On a call that was booked with a membership, the request is paid from the membership when it
 * covers all of it, and otherwise by card (the membership's saved card, as an ordinary card
 * payment). The screen says which, and sends what it showed (`shown`). The server decides again:
 * if the way or the card price is no longer what was shown, nothing is written and nothing is
 * asked of the host, and WayChanged is thrown with the way and the price as they are now, for the
 * member to press again. A request shown as paid from the membership never becomes a card payment
 * by itself, and the other way round.
 */
export async function askForMoreTime(
  input: { callId: string; customerId: string; minutes: number; shown?: Way | { paidFrom: "membership" }; now?: Date },
  /** How the saved card is found. Only the journey script passes its own, to try a card the bank refuses. */
  lookUpCard: typeof savedCardOf = savedCardOf,
): Promise<{ extensionId: string; state: "waiting" | "checking" }> {
  const clock = () => input.now ?? new Date();
  const [seen] = await db.select().from(schema.calls).where(eq(schema.calls.id, input.callId));
  if (!seen || seen.customerId !== input.customerId) throw new ExtendError("Call not found.");

  // A first look without locks, so an obviously impossible request never reaches Stripe.
  const early = (await whyNot(db, seen, clock())) ?? windowProblem(seen, clock());
  if (early) throw new ExtendError(early);

  const paid = seen.pricePer15Cents > 0;
  let cardId: string | null = null;
  let memberCall = false;
  /** On a member's call paid by card: the membership whose card in use is held. */
  let membershipOfCard: string | null = null;
  if (paid) {
    const own = stripeConfigured() ? await ownPaymentOf(seen.id) : null;
    if (!own || own.status !== "held") throw new ExtendError(NO_LONGER);
    if (own.kind === "member_call") {
      // Booked with a membership. How this request is paid is decided first, before any card is looked for.
      memberCall = true;
      if (!Number.isInteger(input.minutes)) throw new ExtendError("Enter a whole number of minutes.");
      const member = await membershipForMoreTime(db, seen, clock());
      if (!member || member.locked.membership.customerId !== input.customerId) throw new ExtendError(NO_LONGER);
      const way = wayFor(member, seen, input.minutes);
      if (!asShown(way, input.shown)) throw new WayChanged(way);
      if (way.paidFrom === "card") {
        // The membership's card in use (this member's own, kept for exactly this), never a card of another booking.
        const card = await cardInUse(db, member.locked.membership.id);
        if (!card) throw new ExtendError(NO_CARD);
        cardId = card.stripePaymentMethodId;
        membershipOfCard = member.locked.membership.id;
      }
    } else {
      cardId = await lookUpCard(own, input.customerId).catch((error) => {
        log(`could not look up the saved card for call ${seen.id}`, error);
        throw new ExtendError("We could not reach the bank just now. Please try again.");
      });
      if (!cardId) throw new ExtendError("Time cannot be added to this call, because the card that paid for it was not saved. The call ends as booked.");
    }
  }

  // The request and (for a paid call) its payment, in one step, with the call locked.
  let made: { extension: CallExtension; payment: Payment | null; call: Call };
  try {
    made = await db.transaction(async (tx) => {
      // A month comes before a call in the order of locks. (Nothing to lock for a call paid by card.)
      if (memberCall) await lockMonthsOfCall(tx, seen.id);
      const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, seen.id)).for("update");
      // The clock is read after the last lock.
      const now = clock();
      const problem = (await whyNot(tx, call, now)) ?? windowProblem(call, now);
      if (problem) throw new ExtendError(problem);

      const earlier = await tx.select({ status: schema.callExtensions.status }).from(schema.callExtensions).where(eq(schema.callExtensions.callId, call.id));
      if (earlier.some((e) => e.status === "open")) throw new ExtendError("You have already asked. Wait for the host's answer.");
      if (earlier.length >= MAX_REQUESTS_PER_CALL) throw new ExtendError("You have asked for more time as often as one call allows.");

      const wrong = minutesProblem(input.minutes, await minutesFitting(tx, call));
      if (wrong) throw new ExtendError(wrong);

      const newEndsAt = new Date(call.endsAt.getTime() + input.minutes * 60_000);
      const priceCents = extensionPriceCents(call.pricePer15Cents, input.minutes);
      let own: Payment | null = null;
      if (paid) {
        // Checked again under the lock: the money for the call itself must be in place, and the host must still be payable.
        own = await ownPaymentOf(call.id, tx);
        const [host] = await tx.select({ payoutsReady: schema.hostSettings.payoutsReady }).from(schema.hostSettings).where(eq(schema.hostSettings.userId, call.hostId));
        if (!own || own.status !== "held" || !host?.payoutsReady) throw new ExtendError(NO_LONGER);
      }

      if (own?.kind === "member_call") {
        // Decided again with the month locked. If it is no longer what the screen showed (or what the card was looked up for), nothing is written.
        const member = await membershipForMoreTime(tx, call, now);
        if (!member) throw new ExtendError(NO_LONGER);
        const way = wayFor(member, call, input.minutes);
        if (!asShown(way, input.shown) || (way.paidFrom === "card") !== (cardId !== null)) throw new WayChanged(way);
        const [extension] = await tx
          .insert(schema.callExtensions)
          .values({ callId: call.id, minutes: input.minutes, oldEndsAt: call.endsAt, newEndsAt, priceCents: way.priceCents, paidFrom: way.paidFrom })
          .returning();
        if (way.paidFrom === "membership") {
          // Set aside in the month in this same step, as a payment of its own for exactly the extra minutes: the host can be asked at once.
          const { month } = member.locked;
          const { hostCausedCents } = await setAside(tx, month, way.priceCents);
          await tx.insert(schema.payments).values({
            kind: "member_call",
            callId: call.id,
            monthId: month.id,
            extensionId: extension.id,
            coversFrom: call.endsAt,
            coversUntil: newEndsAt,
            pricePer15Cents: month.pricePer15Cents,
            bookedCents: way.priceCents,
            hostCausedCents,
            feePercentBps: month.feePercentBps,
            // No extra 30 cents for added time from a membership: the month's fixed part is placed once.
            feeFixedCents: 0,
            feeForeignCardBps: month.feeForeignCardBps,
            status: "held",
            heldAt: now,
            cardCountry: month.cardCountry,
          });
          return { extension, payment: null, call };
        }
        // By card: the membership's card in use is read again now that the membership is locked. If it was retired
        // meanwhile (the membership ended or was paused a moment ago), or is another card, nothing is written.
        const card = await cardInUse(tx, member.locked.membership.id);
        if (!card || card.stripePaymentMethodId !== cardId) throw new ExtendError(NO_CARD);
        // An ordinary card payment of its own (the usual fee, its own hold), not a copy of the call's terms. It is not part of the month's money.
        const [payment] = await tx
          .insert(schema.payments)
          .values({
            callId: call.id,
            extensionId: extension.id,
            coversFrom: call.endsAt,
            coversUntil: newEndsAt,
            currency: own.currency,
            pricePer15Cents: call.pricePer15Cents,
            bookedCents: way.priceCents,
            feePercentBps: DEFAULT_FEE_TERMS.percentBps,
            feeFixedCents: DEFAULT_FEE_TERMS.fixedCents,
            feeForeignCardBps: DEFAULT_FEE_TERMS.foreignCardBps,
          })
          .returning();
        return { extension, payment, call };
      }

      const [extension] = await tx
        .insert(schema.callExtensions)
        .values({ callId: call.id, minutes: input.minutes, oldEndsAt: call.endsAt, newEndsAt, priceCents })
        .returning();
      if (!own) return { extension, payment: null, call };
      // A payment of its own, on the terms fixed for this call, for exactly the extra minutes.
      const [payment] = await tx
        .insert(schema.payments)
        .values({
          callId: call.id,
          extensionId: extension.id,
          coversFrom: call.endsAt,
          coversUntil: newEndsAt,
          currency: own.currency,
          pricePer15Cents: own.pricePer15Cents,
          bookedCents: priceCents,
          feePercentBps: own.feePercentBps,
          feeFixedCents: own.feeFixedCents,
          feeForeignCardBps: own.feeForeignCardBps,
        })
        .returning();
      return { extension, payment, call };
    });
  } catch (error) {
    if (isSecondOpenRequest(error)) throw new ExtendError("You have already asked. Wait for the host's answer.");
    throw error;
  }

  const { extension, payment, call } = made;
  if (!payment) return { extensionId: extension.id, state: "waiting" };

  // The hold, through the same path as the hold for a booked call. One try.
  const cardProblem = "Your card could not be used for the extra time (the bank said no, or wants you to approve it, which cannot be done during a call). Nothing was added and nothing is held.";
  let held = false;
  try {
    const [customer] = await db.select().from(schema.user).where(eq(schema.user.id, input.customerId));
    held = (await placeHoldWithSavedCard({ payment, call, customer, paymentMethodId: cardId!, now: clock(), inCall: true })) === "held";
  } catch (error) {
    // Not known yet whether the hold went through. The request stays open; the helper finds out,
    // and lets the hold go if the request has ended by then.
    if (error instanceof OutcomeUnknownError) {
      log(`the hold for request ${extension.id} is being checked with Stripe`);
      return { extensionId: extension.id, state: "checking" };
    }
    log(`could not place the hold for request ${extension.id}`, error);
    await endExtension(extension.id, "failed", "the hold could not be placed", clock());
    // A refusal by our own rules (the call ended or was stopped meanwhile), or the bank could not be reached.
    throw new ExtendError(error instanceof MoneyError ? NO_LONGER : "We could not reach the bank in time. Nothing was added and nothing is held. You can try again.");
  }
  if (held) {
    // A membership's card can be retired between the locked check and the hold (the membership ended or was paused in
    // that very moment). A retired card keeps no new hold: the request ends, which lets the hold go. (If the host has
    // answered already, the request is no longer open and stands as it is.)
    const retired = membershipOfCard !== null && (await cardInUse(db, membershipOfCard))?.stripePaymentMethodId !== cardId;
    if (retired && (await endExtension(extension.id, "failed", "the membership's card was retired", clock()))) throw new ExtendError(NO_CARD);
    return { extensionId: extension.id, state: "waiting" };
  }
  await endExtension(extension.id, "failed", "the card could not be used", clock());
  throw new ExtendError(cardProblem);
}

function windowProblem(call: Call, now: Date): string | null {
  const window = askWindow({ now, endsAt: call.endsAt });
  if (window === "too_early") return "You can ask for more time in the last minute and a half of the call.";
  if (window === "too_late") return "It is too late to add time. The call ends as booked.";
  return null;
}

// ---------------------------------------------------------------------------
// Answering (the host)
// ---------------------------------------------------------------------------

/**
 * The host says yes or no.
 *
 * Yes is one database step, under both people's calendar locks and with the
 * call locked: the request must still be open, the call's end unchanged since
 * it was made, and (for a paid call) the money for it held. Then the call's
 * end moves, and both people's reserved time with it. The database refuses if
 * that would overlap anything else either of them is taken for.
 */
export async function answerExtension(input: { extensionId: string; hostId: string; accept: boolean; now?: Date }): Promise<"accepted" | "declined"> {
  const clock = () => input.now ?? new Date();
  const [seen] = await db
    .select({ extension: schema.callExtensions, call: schema.calls })
    .from(schema.callExtensions)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.callExtensions.callId))
    .where(eq(schema.callExtensions.id, input.extensionId));
  if (!seen || seen.call.hostId !== input.hostId) throw new ExtendError("Request not found.");
  const gone = "This request is no longer waiting for an answer.";

  if (!input.accept) {
    if (!(await endExtension(seen.extension.id, "declined", "declined by the host", clock()))) throw new ExtendError(gone);
    return "declined";
  }

  try {
    await db.transaction(async (tx) => {
      await lockCalendars(tx, [seen.call.hostId, seen.call.customerId]);
      const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, seen.call.id)).for("update");
      const [extension] = await tx.select().from(schema.callExtensions).where(eq(schema.callExtensions.id, seen.extension.id)).for("update");
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.extensionId, extension.id)).for("update");
      const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.callId, call.id)).for("update");
      // The clock is read only now, with everything this step needs locked: nothing here can make it
      // wait any more, so a yes given in time can never land after the call's end.
      const now = clock();

      if (extension.status !== "open" || extension.oldEndsAt.getTime() !== call.endsAt.getTime()) throw new ExtendError(gone);
      const problem = await whyNot(tx, call, now);
      if (problem) throw new ExtendError(problem);
      if (!canStillAccept({ now, endsAt: call.endsAt })) throw new ExtendError("It is too late to add time. The call ends as booked.");

      if (extension.priceCents > 0) {
        // The money for the extra minutes must be held, last long enough to be charged after the
        // longer call, and not be on its way out.
        // (Money set aside in a membership is in place while it is set aside: there is no hold that could end.)
        const held =
          payment?.kind === "member_call"
            ? payment.status === "held"
            : payment?.status === "held" && payment.holdExpiresAt !== null && holdCoversCall({ now, holdExpiresAt: payment.holdExpiresAt, callEndsAt: extension.newEndsAt });
        if (!payment || !held) throw new ExtendError("The payment for the extra time is not in place, so it cannot be accepted.");
        // Nothing else may be under way on it (a release, say). The one exception is the hold itself:
        // when the bank's answer to it was lost but the hold is on record as held (Stripe told us in
        // its own message), the money is there, and the host must not be kept waiting for the helper's check.
        const [inFlight] = await tx
          .select({ id: schema.moneyOperations.id })
          .from(schema.moneyOperations)
          .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started"), ne(schema.moneyOperations.kind, "hold")))
          .limit(1);
        if (inFlight) throw new ExtendError("The payment for the extra time is still being confirmed. Try again in a moment.");
      }

      if (!booking) throw new ExtendError(NO_LONGER);
      const busyUntil = new Date(extension.newEndsAt.getTime() + booking.breakMinutes * 60_000);

      // Both people are now taken for longer. If either already is, the database refuses.
      await tx.update(schema.busyEntries).set({ endsAt: busyUntil }).where(and(eq(schema.busyEntries.bookingId, booking.id), eq(schema.busyEntries.userId, call.hostId)));
      await tx.update(schema.busyEntries).set({ endsAt: takenUntil(extension.newEndsAt) }).where(and(eq(schema.busyEntries.bookingId, booking.id), eq(schema.busyEntries.userId, call.customerId)));
      await tx.update(schema.calls).set({ endsAt: extension.newEndsAt }).where(eq(schema.calls.id, call.id));
      await tx
        .update(schema.bookings)
        // The new total is the old total plus this request's price, never worked out again from the
        // whole length (the two can differ by a cent).
        .set({ endsAt: extension.newEndsAt, lengthMinutes: booking.lengthMinutes + extension.minutes, totalCents: booking.totalCents + extension.priceCents })
        .where(eq(schema.bookings.id, booking.id));
      await tx.update(schema.callExtensions).set({ status: "accepted", decidedAt: now }).where(eq(schema.callExtensions.id, extension.id));
      // Other people's waiting requests for the time the call now takes can no longer be accepted.
      await endRequestsInTheWay(tx, { hostId: call.hostId, exceptBookingId: booking.id, from: call.startsAt, until: busyUntil, now });
      // The customer may be a host too: requests to her that her own, longer call makes impossible end as well (plans/42).
      await endRequestsInTheWay(tx, { hostId: call.customerId, exceptBookingId: booking.id, from: call.startsAt, until: takenUntil(extension.newEndsAt), now, reason: PASSED_OVER.ownCall });
    });
  } catch (error) {
    if (!isOverlap(error)) throw error;
    // Something else was booked for that time a moment ago. This request can never be accepted now.
    await endExtension(seen.extension.id, "failed", "the time no longer fits", clock());
    throw new ExtendError("That time is no longer free, so it could not be added. The call ends as booked.");
  }
  return "accepted";
}

// ---------------------------------------------------------------------------
// The always-on helper
// ---------------------------------------------------------------------------

/**
 * Closes requests nobody answered before their call ended (or was cancelled or
 * stopped), and lets go of the hold of every request that ended without being
 * accepted. Safe to run again and again, and on two helpers at once.
 */
export async function closeFinishedExtensions(now: Date): Promise<void> {
  const stale = await db
    .select({ id: schema.callExtensions.id })
    .from(schema.callExtensions)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.callExtensions.callId))
    .where(
      and(
        eq(schema.callExtensions.status, "open"),
        // An open request always belongs to the call's current end, so "the call is over" means it can no longer be accepted.
        or(lte(schema.calls.endsAt, now), isNotNull(schema.calls.cancelledAt), isNotNull(schema.calls.safetyEndedAt), isNotNull(schema.calls.closedAt)),
      ),
    );
  for (const { id } of stale) {
    try {
      if (await endExtension(id, "ran_out", "not answered before the call ended", now)) log(`request ${id} ran out`);
    } catch (error) {
      log(`could not close request ${id}; will retry`, error);
    }
  }

  // A hold that could not be let go at once, or that landed after its request had ended.
  const leftovers = await db
    .select({ id: schema.callExtensions.id })
    .from(schema.payments)
    .innerJoin(schema.callExtensions, eq(schema.callExtensions.id, schema.payments.extensionId))
    .where(and(inArray(schema.payments.status, ["awaiting_payment", "held"]), inArray(schema.callExtensions.status, [...ENDED])));
  for (const { id } of leftovers) {
    try {
      await releaseHoldOf(id);
      log(`let go of the hold of request ${id}`);
    } catch (error) {
      log(`could not let go of the hold of request ${id} yet; will retry`, error);
    }
  }
}
