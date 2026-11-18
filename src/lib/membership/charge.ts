/**
 * The monthly payment (the rulebook's "First a hold, then the money" and "The monthly payment";
 * plans/20 says how).
 *
 * A month has exactly one PaymentIntent at Stripe. First the amount is only held; it is taken at
 * the member's first booking or 72 hours and 3 minutes after the hold. Everything here follows
 * the app's standing rule for money: written down first, never twice, and anything whose outcome
 * is not known is asked of Stripe before anything else happens.
 *
 *   intentFor     the month's one PaymentIntent: found, or made under one claim that is never reset
 *   syncMonth     reads Stripe and records what it shows; every path ends here
 *   tryHold       one try with the saved card
 *   takeMonth     takes the held money (the timed taking, and takeNow for a first booking)
 *   abandonMonth  the month is given up for a reason; letHoldGo then cancels its payment
 */
import type Stripe from "stripe";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth } from "@/db/schema";
import { captureAtStripe } from "@/lib/payments/actions";
import { stripeCustomerFor } from "@/lib/payments/hold";
import { MoneyError, OutcomeUnknownError, runOwnedOperation, type Tx } from "@/lib/payments/operations";
import { DEFAULT_FEE_TERMS } from "@/lib/payments/pricing";
import { holdExpiry } from "@/lib/payments/rules";
import { stripe } from "@/lib/payments/stripe";
import { membershipsOnFor } from "@/lib/safety/switches";
import { cardInUse, takeCardForMembership } from "./cards";
import { queueJoinedEmail, queuePaymentFailedEmail, queueReceiptEmail } from "./emails";
import { isCurrent, lockForMonth, monthOwner, type LockedMonth } from "./locks";
import { openMonth, recordChargeOwedBack, recordOddCharge } from "./months";
import { hostMinutes, keepsPlace, promisedMinutes } from "./room";
import { giveUpAt, holdTiming, monthEnd, monthTotalCents, nextTryAt } from "./rules";
import { settleAfterGivenUp } from "./state";

const months = schema.membershipMonths;

/** Stripe's memory of a request's label lasts at least a day; inside this window the same request can be sent again safely. */
export const LABEL_SAFE_MS = 23 * 3_600_000;
/** A try the bank has not answered yet is looked at again this much later. */
const LOOK_AGAIN_AT_A_TRY_MS = 5 * 60_000;

function log(message: string, error?: unknown) {
  if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[membership] ${message}: ${error.message}`);
  else if (error) console.error(`[membership] ${message}`, error);
  else console.log(`[membership] ${message}`);
}

async function monthById(monthId: string): Promise<MembershipMonth | undefined> {
  const [month] = await db.select().from(months).where(eq(months.id, monthId));
  return month;
}

const IN_THE_BOOKS = ["running", "closed", "finished"];

// ---------------------------------------------------------------------------
// Writing a month down
// ---------------------------------------------------------------------------

/**
 * Writes a month down, before anything is asked of Stripe, and makes it the membership's current
 * month. `originKey` makes it exist once: a second call with the same key returns the first month.
 * The caller holds the host's calendar lock and the membership's lock.
 */
export async function writeDownMonth(
  tx: Tx,
  membership: Membership,
  input: { originKey: string; agreementId: string; pricePer15Cents: number; includedMinutes: number; cardStepExpiresAt?: Date | null; firstFailedAt?: Date | null; tryNow?: boolean },
  now: Date,
): Promise<MembershipMonth> {
  const [existing] = await tx.select().from(months).where(eq(months.originKey, input.originKey));
  if (existing) return existing;
  const [last] = await tx.select({ number: sql<number>`coalesce(max(${months.number}), 0)::int` }).from(months).where(eq(months.membershipId, membership.id));
  const [month] = await tx
    .insert(months)
    .values({
      membershipId: membership.id,
      period: membership.period,
      number: last.number + 1,
      agreementId: input.agreementId,
      originKey: input.originKey,
      pricePer15Cents: input.pricePer15Cents,
      includedMinutes: input.includedMinutes,
      totalCents: monthTotalCents(input.pricePer15Cents, input.includedMinutes),
      feePercentBps: DEFAULT_FEE_TERMS.percentBps,
      feeFixedCents: DEFAULT_FEE_TERMS.fixedCents,
      feeForeignCardBps: DEFAULT_FEE_TERMS.foreignCardBps,
      cardStepExpiresAt: input.cardStepExpiresAt ?? null,
      firstFailedAt: input.firstFailedAt ?? null,
      giveUpAt: input.firstFailedAt ? giveUpAt(input.firstFailedAt) : null,
      // A renewal, and a month that replaces one whose hold was lost, are tried with the saved card at once.
      nextTryAt: input.tryNow ? now : null,
    })
    .returning();
  await tx.update(schema.memberships).set({ currentMonthId: month.id, updatedAt: now }).where(eq(schema.memberships.id, membership.id));
  return month;
}

// ---------------------------------------------------------------------------
// The month's one PaymentIntent
// ---------------------------------------------------------------------------

type IntentRequest = Stripe.PaymentIntentCreateParams;

/**
 * The month's one PaymentIntent, also after an interruption. Exactly one of four things happens:
 *   1. its id is saved: that one is used;
 *   2. nobody has claimed it yet: the claim (the moment and the exact request) is written once, the
 *      request is sent under the label "monthintent:<month>", and the id is saved;
 *   3. a claim without an id, younger than 23 hours: the saved request is sent again under the same
 *      label, and Stripe returns the same PaymentIntent;
 *   4. a claim without an id, older than that: nothing is created. The customer's PaymentIntents
 *      since the claim are listed in full and matched on the month. One: saved. More: a problem for
 *      the founder. None: none was ever made, and the month is given up.
 * Returns null when the month has no PaymentIntent to pay with (given up, abandoned, or a problem).
 */
export async function intentFor(monthId: string, now: Date = new Date()): Promise<{ intentId: string; clientSecret: string | null; keepsCard: boolean; status: Stripe.PaymentIntent.Status } | null> {
  const seen = await monthById(monthId);
  if (!seen) throw new MoneyError("Month not found.");
  if (seen.stripePaymentIntentId) {
    if (seen.status !== "to_pay" || seen.endedHow || seen.problem) return null;
    const intent = await stripe().paymentIntents.retrieve(seen.stripePaymentIntentId);
    // Looked at again after Stripe answered: the secret of a month given up meanwhile goes to nobody.
    const still = await monthById(monthId);
    if (!still || still.status !== "to_pay" || still.endedHow || still.problem || still.stripePaymentIntentId !== intent.id) return null;
    return { intentId: intent.id, clientSecret: intent.client_secret, keepsCard: intent.setup_future_usage === "off_session", status: intent.status };
  }

  // A month set aside for the founder (Stripe had more than one payment for it) is never looked up or asked for again.
  if (seen.problem) return null;

  // 2. The claim, written once.
  let request: IntentRequest;
  let requestedAt: Date;
  if (!seen.intentRequestedAt) {
    if (seen.status !== "to_pay" || seen.endedHow || seen.problem) return null;
    const [who] = await db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.customerId))
      .where(eq(schema.memberships.id, seen.membershipId));
    const customer = await stripeCustomerFor(who);
    const wanted: IntentRequest = {
      amount: seen.totalCents,
      currency: "usd",
      customer,
      capture_method: "manual",
      // The card is kept for the months that follow.
      setup_future_usage: "off_session",
      allowed_payment_method_types: ["card"],
      // The group every transfer and refund of this month's money is found under.
      transfer_group: seen.id,
      description: `Membership month ${seen.id}`,
      metadata: { monthId: seen.id, membershipId: seen.membershipId },
    };
    const claimed = await db.transaction(async (tx) => {
      const { month } = await lockForMonth(tx, monthId);
      if (month.stripePaymentIntentId || month.intentRequestedAt) return month;
      if (month.status !== "to_pay" || month.endedHow || month.problem) return null;
      const [written] = await tx.update(months).set({ intentRequestedAt: new Date(), intentRequest: JSON.stringify(wanted), updatedAt: now }).where(eq(months.id, monthId)).returning();
      return written;
    });
    if (!claimed) return null;
    if (claimed.stripePaymentIntentId) return intentFor(monthId, now);
    request = JSON.parse(claimed.intentRequest!) as IntentRequest;
    requestedAt = claimed.intentRequestedAt!;
  } else {
    request = JSON.parse(seen.intentRequest!) as IntentRequest;
    requestedAt = seen.intentRequestedAt;
  }

  let intent: Stripe.PaymentIntent | null;
  if (Date.now() - requestedAt.getTime() < LABEL_SAFE_MS) {
    // 2 and 3. The same request under the same label always gives the same PaymentIntent.
    intent = await stripe().paymentIntents.create(request, { idempotencyKey: `monthintent:${monthId}` });
  } else {
    // 4. Too old to send again: look for what was made.
    const found: Stripe.PaymentIntent[] = [];
    const since = Math.floor(requestedAt.getTime() / 1000) - 300;
    for await (const candidate of stripe().paymentIntents.list({ customer: request.customer as string, created: { gte: since }, limit: 100 })) {
      if (candidate.metadata?.monthId === monthId) found.push(candidate);
    }
    if (found.length > 1) {
      await db.update(months).set({ problem: `Stripe has ${found.length} payments for this one month. None is used. Please settle it by hand.`, updatedAt: now }).where(eq(months.id, monthId));
      return null;
    }
    intent = found[0] ?? null;
    if (!intent) {
      // None was ever made. The month is given up; nothing was held.
      await db.transaction(async (tx) => {
        const locked = await lockForMonth(tx, monthId);
        if (locked.month.stripePaymentIntentId || locked.month.status !== "to_pay") return;
        await tx.update(months).set({ status: "given_up", endedHow: locked.month.endedHow ?? "cancelled_at_stripe", updatedAt: now }).where(eq(months.id, monthId));
        if (!locked.month.endedHow) await settleAfterGivenUp(tx, locked, "cancelled_at_stripe", now);
      });
      return null;
    }
  }

  // Saving the id always looks again, under the lock.
  const found = intent;
  const saved = await db.transaction(async (tx) => {
    const { month } = await lockForMonth(tx, monthId);
    // Another caller got the same PaymentIntent a moment earlier: nothing to do, whatever the month is by now.
    // (The payment is left alone; but its secret is only given out while the month may still be paid.)
    if (month.stripePaymentIntentId) {
      if (month.stripePaymentIntentId !== found.id) return "other" as const;
      return month.status === "to_pay" && !month.endedHow && !month.problem ? ("known" as const) : ("closed" as const);
    }
    await tx.update(months).set({ stripePaymentIntentId: found.id, updatedAt: now }).where(eq(months.id, monthId));
    return month.status === "to_pay" && !month.endedHow && !month.problem ? ("saved" as const) : ("abandoned" as const);
  });
  if (saved === "abandoned") {
    // The month was given up while Stripe was answering: the letting-go takes care of this payment. Its secret goes to nobody.
    await letHoldGo(monthId, now).catch((error) => log(`could not let go of the payment of abandoned month ${monthId} yet; the helper will retry`, error));
    return null;
  }
  if (saved === "other") return intentFor(monthId, now);
  if (saved === "closed") return null;
  return { intentId: found.id, clientSecret: found.client_secret, keepsCard: found.setup_future_usage === "off_session", status: found.status };
}

// ---------------------------------------------------------------------------
// Reading Stripe: every path ends here
// ---------------------------------------------------------------------------

function chargeOf(intent: Stripe.PaymentIntent): Stripe.Charge | null {
  return typeof intent.latest_charge === "object" ? intent.latest_charge : null;
}

/**
 * Whether a try with the month's current try number has been made and has an answer. With
 * `before`: and had that answer before this moment (so that what was read from Stripe at that
 * moment is known to be newer than the try, and not an answer from before it).
 */
async function tryFinished(reader: Pick<Tx, "select">, month: MembershipMonth, before?: Date): Promise<boolean> {
  const done = await reader
    .select({ finishedAt: schema.moneyOperations.finishedAt })
    .from(schema.moneyOperations)
    .where(and(eq(schema.moneyOperations.monthId, month.id), eq(schema.moneyOperations.kind, "hold"), like(schema.moneyOperations.label, `monthhold:${month.id}:${month.try}:%`), inArray(schema.moneyOperations.status, ["succeeded", "failed"])));
  return done.some((operation) => !before || (operation.finishedAt !== null && operation.finishedAt < before));
}

/**
 * Records money Stripe took for a month, once, whoever learned of it (the direct answer, recovery,
 * a message). A held month that was not given up, and its whole amount: the month opens. The whole
 * amount in any other case (never accepted, or given up in that very moment): all of it is owed
 * back. Any other amount: the founder settles it by hand.
 */
export async function applyTaken(tx: Tx, month: MembershipMonth, taken: { cents: number; chargeId: string | null }, now: Date): Promise<void> {
  if (IN_THE_BOOKS.includes(month.status)) return;
  if (taken.cents !== month.totalCents) await recordOddCharge(tx, month, { cents: taken.cents, chargeId: taken.chargeId, at: now });
  else if (month.status === "held" && !month.endedHow) await openMonth(tx, month, { chargeId: taken.chargeId, at: now });
  else await recordChargeOwedBack(tx, month, { chargeId: taken.chargeId, at: now });
}

const chargeIdOf = (intent: Stripe.PaymentIntent): string | null => (typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null));

/**
 * A try with the saved card failed, or there is no card to try: recorded once. The 7 days count
 * from the first failure; the try's number goes up, so the next try is a new action of its own.
 * The member is told at once and has no member time until a hold is in place.
 */
async function recordFailedTry(tx: Tx, locked: LockedMonth, input: { needsAction: boolean; noCard?: boolean }, now: Date): Promise<void> {
  const { membership, month } = locked;
  const firstFailedAt = month.firstFailedAt ?? now;
  const [failed] = await tx
    .update(months)
    .set({
      try: input.noCard ? month.try : month.try + 1,
      firstFailedAt,
      giveUpAt: giveUpAt(firstFailedAt),
      // The try that just failed is the month's "try"-th. Without a card only the member's own "Pay now" is left.
      nextTryAt: input.noCard ? null : nextTryAt(firstFailedAt, month.try),
      needsAction: input.needsAction,
      updatedAt: now,
    })
    .where(eq(months.id, month.id))
    .returning();
  if (isCurrent(locked) && ["active", "unpaid"].includes(membership.status)) {
    await tx.update(schema.memberships).set({ status: "unpaid", updatedAt: now }).where(eq(schema.memberships.id, membership.id));
    await queuePaymentFailedEmail(tx, membership, failed, { failedTry: month.try, needsAction: input.needsAction, giveUpAt: failed.giveUpAt!, noCard: input.noCard, triedAgain: failed.nextTryAt !== null });
  }
}

/** Why a hold that has arrived cannot be accepted, or null if it can. */
async function whyNotAccept(tx: Tx, locked: LockedMonth, intent: Stripe.PaymentIntent, authorisedAt: Date, now: Date): Promise<"ending" | "card_step" | "no_room" | "switch" | "offer_off" | "given_up" | null> {
  const { membership, month } = locked;
  if (intent.amount !== month.totalCents || intent.metadata?.monthId !== month.id) return "card_step";
  if (!isCurrent(locked) || !["joining", "unpaid", "active"].includes(membership.status)) return "ending";
  if (month.cardStepExpiresAt && authorisedAt > month.cardStepExpiresAt) return "card_step";
  // The 7 days count by the bank's own time too: a hold placed in time counts when it is found late, one placed after them does not.
  if (month.giveUpAt && authorisedAt > month.giveUpAt) return "given_up";
  const kind = month.originKey.split(":")[0];
  // A month that replaces one whose hold the bank let go stands for a month that had already started:
  // months that have started keep working to their end, whatever the switches say, and it keeps that month's place.
  if (kind === "replacement") return null;
  if (!(await membershipsOnFor(membership.hostId, tx))) return "switch";
  // The host's own switch too: a payment that was still open when she switched her membership off is cancelled then; this is the net behind that.
  const [offer] = await tx.select({ on: schema.membershipOffers.on }).from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, membership.hostId));
  if (!offer?.on) return "offer_off";
  if (kind === "renewal") {
    // The same one calculation that allowed the renewal to be written down, so the answer cannot
    // depend on whose renewal came first. (Months of other members that have started go on beside it.)
    if (!(await keepsPlace(tx, membership))) return "no_room";
  } else {
    // Someone new (a joining or a resuming): the host's hours, less everything already promised.
    const room = (await hostMinutes(tx, membership.hostId)) - (await promisedMinutes(tx, membership.hostId, now, membership.id));
    if (room < month.includedMinutes) return "no_room";
  }
  return null;
}

/**
 * Reads the month's PaymentIntent at Stripe and records what it shows. Called by the direct answer
 * of every step, by Stripe's messages and by the helper; never moves a month backwards. It looks
 * first at where OUR month stands, then at Stripe (the tables are in plans/20).
 */
export async function syncMonth(monthId: string, now: Date = new Date()): Promise<MembershipMonth> {
  // Stripe is asked outside the database step. If our month moved on in between (another caller
  // recorded newer news), what we read is old: it is thrown away and Stripe is asked again.
  for (let round = 0; round < 3; round++) {
    const seen = await monthById(monthId);
    if (!seen) throw new MoneyError("Month not found.");
    // A month that is already in the books is never touched again, whatever message arrives.
    if (!seen.stripePaymentIntentId || IN_THE_BOOKS.includes(seen.status)) return seen;
    const readAt = new Date(); // the real clock, taken before Stripe is asked
    const intent = await stripe().paymentIntents.retrieve(seen.stripePaymentIntentId, { expand: ["latest_charge", "payment_method"] });
    if (await recordIntent(seen, intent, now, readAt)) break;
  }
  return (await monthById(monthId))!;
}

/** What must be unchanged between reading Stripe and recording what it showed. */
const standing = (month: MembershipMonth): string => [month.status, month.endedHow, month.problem, month.try, month.stripePaymentIntentId, month.takenAt?.getTime()].join("|");

/**
 * A card that was saved through a booking's card step is that booking's, also while the booking's
 * own step is not finished and our database has not heard of the card yet. Stripe knows: a
 * booking's card comes from a card set-up that carries the booking.
 */
async function isBookingsCard(paymentMethodId: string): Promise<boolean> {
  const setups = await stripe().setupIntents.list({ payment_method: paymentMethodId, limit: 100 }).autoPagingToArray({ limit: 300 });
  return setups.some((setup) => Boolean(setup.metadata?.bookingId));
}

/**
 * Records what Stripe showed for the month as it was `seen`. Returns false, and records nothing,
 * when the month has moved on since. `readAt` is the moment (on the real clock) just before
 * Stripe was asked. (Its own function so that the check script can hand it an answer from Stripe
 * that has gone stale.)
 */
export async function recordIntent(seen: MembershipMonth, intent: Stripe.PaymentIntent, now: Date, readAt: Date = new Date()): Promise<boolean> {
  const monthId = seen.id;
  const charge = chargeOf(intent);
  const method = typeof intent.payment_method === "object" ? intent.payment_method : null;
  const bookingsCard = seen.status === "to_pay" && intent.status === "requires_capture" && method ? await isBookingsCard(method.id) : false;
  let release = false;
  let stale = false;

  await db.transaction(async (tx) => {
    const locked = await lockForMonth(tx, monthId);
    const { membership, month } = locked;
    if (standing(month) !== standing(seen)) {
      stale = true;
      return;
    }
    if (month.stripePaymentIntentId !== intent.id || IN_THE_BOOKS.includes(month.status)) return;
    await tx.update(months).set({ updatedAt: now }).where(eq(months.id, month.id));

    // --- We are letting it go, or already have.
    if (month.endedHow) {
      if (intent.status === "canceled") {
        if (month.status !== "given_up") await tx.update(months).set({ status: "given_up", updatedAt: now }).where(eq(months.id, month.id));
      } else if (intent.status === "succeeded") {
        await applyTaken(tx, month, { cents: intent.amount_received, chargeId: chargeIdOf(intent) }, now);
      } else if (intent.status === "requires_capture") {
        release = true; // never accepted; the letting-go continues, or is written down now
      }
      return;
    }

    // --- Our month is held.
    if (month.status === "held") {
      if (intent.status === "succeeded") {
        await applyTaken(tx, month, { cents: intent.amount_received, chargeId: chargeIdOf(intent) }, now);
      } else if (intent.status === "canceled") {
        // The bank dropped the hold.
        await tx.update(months).set({ status: "given_up", endedHow: "hold_lost", updatedAt: now }).where(eq(months.id, month.id));
        if (!isCurrent(locked) || !["active", "unpaid"].includes(membership.status)) return;
        if (membership.offerId) {
          // The rulebook's exception: with an offer of less time open, the membership is paused and nothing new is tried.
          await settleAfterGivenUp(tx, locked, "hold_lost", now);
        } else {
          // A new month with the same terms, tried as a failed payment. Written in this same step, once.
          const replacement = await writeDownMonth(tx, membership, { originKey: `replacement:${month.id}`, agreementId: month.agreementId, pricePer15Cents: month.pricePer15Cents, includedMinutes: month.includedMinutes, firstFailedAt: now, tryNow: true }, now);
          await tx.update(schema.memberships).set({ status: "unpaid", updatedAt: now }).where(eq(schema.memberships.id, membership.id));
          await queuePaymentFailedEmail(tx, membership, replacement, { failedTry: "lost", needsAction: false, giveUpAt: replacement.giveUpAt! });
        }
      } else if (intent.status !== "requires_capture" && intent.status !== "processing") {
        // Should not happen to a hold we accepted. Nothing new is paid, tried or written down.
        await tx.update(months).set({ problem: `Stripe shows this month's payment as "${intent.status}" although its hold was accepted. Please look at it.`, updatedAt: now }).where(eq(months.id, month.id));
      }
      return;
    }

    // --- Our month is still to be paid.
    if (month.status !== "to_pay" || month.problem) return;
    if (intent.status === "requires_capture") {
      const authorisedAt = charge?.created ? new Date(charge.created * 1000) : now;
      let why = await whyNotAccept(tx, locked, intent, authorisedAt, now);
      let cardId: string | null = null;
      if (!why) {
        // The card of this payment becomes the membership's card in use, if Stripe really kept it for
        // the member (it always does, unless a try in the background and the member's own payment
        // crossed; then the card in use stays as it was, and the next month's try tells the member).
        try {
          if (!method) throw new MoneyError("The payment has no card.");
          if (bookingsCard) throw new MoneyError("This card was saved for a booking, so it cannot be a membership's card.");
          if (method.customer) cardId = (await takeCardForMembership(tx, membership.id, method.id, now)).id;
        } catch (error) {
          if (!(error instanceof MoneyError)) throw error;
          why = "card_step";
        }
      }
      if (why) {
        await tx.update(months).set({ endedHow: why === "switch" || why === "offer_off" ? "no_room" : why, updatedAt: now }).where(eq(months.id, month.id));
        await settleAfterGivenUp(tx, locked, why, now);
        release = true;
        return;
      }
      const captureBefore = charge?.payment_method_details?.card?.capture_before;
      const holdExpiresAt = holdExpiry({ heldAt: authorisedAt, captureBefore: captureBefore ? new Date(captureBefore * 1000) : null });
      const timing = holdTiming({ authorisedAt, holdExpiresAt });
      const [held] = await tx
        .update(months)
        .set({
          status: "held",
          authorisedAt,
          holdExpiresAt,
          startsAt: authorisedAt,
          endsAt: monthEnd(authorisedAt),
          takeAt: timing.takeAt,
          cardId,
          cardCountry: charge?.payment_method_details?.card?.country ?? null,
          stripeChargeId: charge?.id ?? null,
          nextTryAt: null,
          giveUpAt: null,
          needsAction: false,
          updatedAt: now,
        })
        .where(eq(months.id, month.id))
        .returning();
      const [active] = await tx
        .update(schema.memberships)
        .set({ status: "active", since: membership.status === "joining" || !membership.since ? authorisedAt : membership.since, ...(membership.status === "joining" ? { pausedAt: null, pausedReason: null } : {}), updatedAt: now })
        .where(eq(schema.memberships.id, membership.id))
        .returning();
      await queueReceiptEmail(tx, active, held, timing.offeredUntil);
      // The host is told when someone joins or comes back (the member has the receipt).
      if (membership.status === "joining") await queueJoinedEmail(tx, active, held, Boolean(membership.since));
      return;
    }
    if (intent.status === "succeeded") {
      // Cannot come from our code, which only takes a held month. Owed back; the membership is settled as for an abandoned payment.
      await applyTaken(tx, month, { cents: intent.amount_received, chargeId: chargeIdOf(intent) }, now);
      await settleAfterGivenUp(tx, locked, "cancelled_at_stripe", now);
      return;
    }
    if (intent.status === "canceled") {
      await tx.update(months).set({ status: "given_up", endedHow: "cancelled_at_stripe", updatedAt: now }).where(eq(months.id, month.id));
      await settleAfterGivenUp(tx, locked, "cancelled_at_stripe", now);
      return;
    }
    if (intent.status === "processing") return;
    // requires_payment_method, requires_confirmation, requires_action: a failure only if a try was really made and answered.
    // And only from an answer read after that try had its own: an answer from before it would call a try that held a failure.
    if (!(await tryFinished(tx, month, readAt))) return;
    const needsAction = intent.status === "requires_action" || intent.last_payment_error?.code === "authentication_required";
    await recordFailedTry(tx, locked, { needsAction }, now);
  });

  if (stale) return false;
  if (release) await letHoldGo(monthId, now).catch((error) => log(`could not let go of the hold of month ${monthId} yet; the helper will retry`, error));
  return true;
}

// ---------------------------------------------------------------------------
// A try with the saved card
// ---------------------------------------------------------------------------

/** The request of one saved-card try. Recovery sends exactly the same one again under the same label. */
export function confirmSavedCard(params: { intentId: string; paymentMethodId: string }, label: string): Promise<Stripe.PaymentIntent> {
  // Stripe refuses a try in the background while the payment still says "keep this card for later"
  // (that needs the member present). The saved card is already kept, so the mark is taken off for
  // this try; payNow puts it back when the member pays by hand with a card of their choice.
  return stripe().paymentIntents.confirm(params.intentId, { payment_method: params.paymentMethodId, off_session: true, setup_future_usage: "" }, { idempotencyKey: label });
}

/**
 * One try to hold the month's amount on the membership's saved card, in the background. Each try
 * has a name of its own ("monthhold:<month>:<try>"), so one failed try never blocks the next.
 * Whichever way it ends, syncMonth records it.
 */
export async function tryHold(monthId: string, now: Date = new Date()): Promise<MembershipMonth> {
  let seen = await monthById(monthId);
  if (!seen) throw new MoneyError("Month not found.");
  // What an earlier try achieved is recorded before a new one starts, so no try is ever made twice.
  if (seen.stripePaymentIntentId) seen = await syncMonth(monthId, now);
  if (seen.status !== "to_pay" || seen.endedHow || seen.problem || !seen.nextTryAt || seen.nextTryAt > now) return seen;
  if (seen.stripePaymentIntentId && (await tryFinished(db, seen))) {
    // This try has its answer, and Stripe has neither held nor refused yet (the bank is still at it).
    // Nothing new is tried beside it; it is looked at again in a few minutes, not every round.
    await db.update(months).set({ nextTryAt: new Date(now.getTime() + LOOK_AGAIN_AT_A_TRY_MS), updatedAt: now }).where(and(eq(months.id, monthId), eq(months.status, "to_pay"), eq(months.try, seen.try)));
    return (await monthById(monthId))!;
  }
  const tryNumber = seen.try;
  const found = await intentFor(monthId, now);
  if (!found) return (await monthById(monthId))!;
  const card = await cardInUse(db, seen.membershipId);
  if (!card) {
    // No saved card to try: the member is told, and only their own "Pay now" can pay this month.
    await db.transaction(async (tx) => {
      const locked = await lockForMonth(tx, monthId);
      const { month } = locked;
      if (month.status !== "to_pay" || month.endedHow || month.problem || month.try !== tryNumber || !month.nextTryAt) return;
      await recordFailedTry(tx, locked, { needsAction: false, noCard: true }, now);
    });
    return (await monthById(monthId))!;
  }
  try {
    await runOwnedOperation<LockedMonth, { intentId: string; paymentMethodId: string }, null>({
      owner: monthOwner(monthId),
      kind: "hold",
      labelBase: `monthhold:${monthId}:${tryNumber}`,
      prepare: async ({ month }, tx) => {
        if (month.status !== "to_pay" || month.endedHow || month.problem) throw new MoneyError("This month is not waiting for a payment.");
        if (month.stripePaymentIntentId !== found.intentId || month.try !== tryNumber) throw new MoneyError("The payment changed. Nothing was tried.");
        // Another caller made this very try a moment ago and its failure is not recorded yet: syncMonth below records it.
        if (await tryFinished(tx, month)) throw new MoneyError("This try already has its answer.");
        return { intentId: found.intentId, paymentMethodId: card.stripePaymentMethodId };
      },
      execute: async (params, label) => {
        const intent = await confirmSavedCard(params, label);
        return { stripeId: intent.id, result: null };
      },
      // What the try achieved is read from Stripe by syncMonth, the same for every path.
      apply: async () => undefined,
    });
  } catch (error) {
    if (error instanceof OutcomeUnknownError) return (await monthById(monthId))!; // the helper finds out
    if (!(error instanceof MoneyError)) throw error;
  }
  return syncMonth(monthId, now);
}

/** The secret the browser needs to pay this month, for its member only, while it can still be paid. Null otherwise. */
export async function payNow(input: { monthId: string; memberId: string; now?: Date }): Promise<{ clientSecret: string } | null> {
  const [found] = await db
    .select({ customerId: schema.memberships.customerId })
    .from(months)
    .innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId))
    .where(eq(months.id, input.monthId));
  if (!found || found.customerId !== input.memberId) return null;
  // Not after the card step's time or the 7 days have run out, also when the helper has not been by yet: a hold placed now would only be let go again.
  const due = await monthById(input.monthId);
  const at = input.now ?? new Date();
  if (!due || (due.cardStepExpiresAt && due.cardStepExpiresAt <= at) || (due.giveUpAt && due.giveUpAt <= at)) return null;
  const intent = await intentFor(input.monthId, input.now ?? new Date());
  if (!intent?.clientSecret) return null;
  if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(intent.status)) {
    // Stripe already has a payment on it (a hold we have not heard of yet, perhaps): there is nothing left to pay. Record how it stands.
    await syncMonth(input.monthId, input.now ?? new Date());
    return null;
  }
  // The card the member pays with by hand is kept for the months that follow (a try with the saved card took that mark off).
  if (!intent.keepsCard) {
    await stripe().paymentIntents.update(intent.intentId, { setup_future_usage: "off_session" });
    // Looked at once more after Stripe answered: the secret of a month given up meanwhile goes to nobody.
    const still = await monthById(input.monthId);
    if (!still || still.status !== "to_pay" || still.endedHow || still.problem) return null;
  }
  return { clientSecret: intent.clientSecret };
}

// ---------------------------------------------------------------------------
// Taking the money
// ---------------------------------------------------------------------------

/**
 * Takes the held month's whole amount. The timed taking and takeNow (a member's first booking, in
 * part two) are this one action, so the two can never both take. Does nothing unless the month is held.
 */
export async function takeMonth(monthId: string, now: Date = new Date()): Promise<MembershipMonth> {
  const seen = await monthById(monthId);
  if (!seen) throw new MoneyError("Month not found.");
  if (seen.status !== "held" || seen.endedHow || seen.problem) return seen;
  try {
    await runOwnedOperation<LockedMonth, { intentId: string; amountCents: number }, { chargeId: string | null; amountReceived: number }>({
      owner: monthOwner(monthId),
      kind: "capture",
      labelBase: `monthcapture:${monthId}`,
      prepare: async ({ month }) => {
        if (month.status !== "held" || month.endedHow || month.problem || !month.stripePaymentIntentId) throw new MoneyError("This month's money is not on hold.");
        return { intentId: month.stripePaymentIntentId, amountCents: month.totalCents };
      },
      execute: (params, label) => captureAtStripe(params.intentId, params.amountCents, label),
      apply: ({ month }, _params, outcome, tx) => applyTaken(tx, month, { cents: outcome.result.amountReceived, chargeId: outcome.result.chargeId }, now),
    });
  } catch (error) {
    if (error instanceof OutcomeUnknownError) return (await monthById(monthId))!;
    if (!(error instanceof MoneyError)) throw error;
    // Stripe refused: usually the hold is gone. Record how things really stand.
    return syncMonth(monthId, now);
  }
  return (await monthById(monthId))!;
}

export const takeNow = takeMonth;

// ---------------------------------------------------------------------------
// Giving a month up
// ---------------------------------------------------------------------------

/**
 * A month that is not paid for, or only held, is given up for a reason: "cancel_now", "given_up"
 * (7 days without a payment), "card_step", "no_room" or "ending". The reason is saved first, and
 * the membership settled, in one step; only then is the payment cancelled at Stripe. If the
 * payment was taken in that very moment, it is owed back in full.
 */
export async function abandonMonth(monthId: string, how: string, now: Date = new Date(), why?: string): Promise<MembershipMonth> {
  await db.transaction(async (tx) => {
    await giveUpInStep(tx, await lockForMonth(tx, monthId), how, now, why);
  });
  await letHoldGo(monthId, now).catch((error) => log(`could not let go of month ${monthId} yet; the helper will retry`, error));
  return (await monthById(monthId))!;
}

/**
 * The first half of giving a month up, inside a database step the caller owns (with the month
 * locked): the reason is saved and the membership settled. The caller lets the hold go after its
 * step is saved (letHoldGo); if it does not get that far, the helper does. Returns whether this
 * call is the one that gave it up. `why` is what the member is told when it is not the payment.
 */
export async function giveUpInStep(tx: Tx, locked: LockedMonth, how: string, now: Date, why?: string): Promise<boolean> {
  const { month } = locked;
  if ((month.status !== "to_pay" && month.status !== "held") || month.endedHow) return false;
  await tx.update(months).set({ endedHow: how, updatedAt: now }).where(eq(months.id, month.id));
  await settleAfterGivenUp(tx, locked, how, now, why);
  return true;
}

/**
 * Cancels a payment at Stripe. One that is already cancelled, or was taken in this very moment,
 * is an answer and not a failure. Used by the direct path and by recovery alike.
 */
export async function cancelAtStripe(intentId: string, label?: string): Promise<{ stripeId: string; result: { status: string; amountReceived: number; chargeId: string | null } }> {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe().paymentIntents.cancel(intentId, {}, label ? { idempotencyKey: label } : undefined);
  } catch (error) {
    intent = await stripe().paymentIntents.retrieve(intentId);
    if (intent.status !== "canceled" && intent.status !== "succeeded") throw error;
  }
  return { stripeId: intent.id, result: { status: intent.status, amountReceived: intent.amount_received, chargeId: chargeIdOf(intent) } };
}

/** Records how a letting-go ended: taken in that very moment (owed back in full), or the cancellation is finished. */
export async function applyLetGo(tx: Tx, month: MembershipMonth, result: { status: string; amountReceived: number; chargeId: string | null }, now: Date): Promise<void> {
  if (result.status === "succeeded") await applyTaken(tx, month, { cents: result.amountReceived, chargeId: result.chargeId }, now);
  else if (month.status === "to_pay" || month.status === "held") await tx.update(months).set({ status: "given_up", updatedAt: now }).where(eq(months.id, month.id));
}

/**
 * Cancels the payment of a month whose reason for ending is already saved. Safe to run again. A
 * month without a PaymentIntent is simply marked as given up.
 */
export async function letHoldGo(monthId: string, now: Date = new Date()): Promise<void> {
  const seen = await monthById(monthId);
  if (!seen || !seen.endedHow || IN_THE_BOOKS.includes(seen.status)) return;
  if (!seen.stripePaymentIntentId) {
    // A claim for a PaymentIntent may still be on its way: intentFor finishes it and comes back here.
    if (!seen.intentRequestedAt) await db.update(months).set({ status: "given_up", updatedAt: now }).where(and(eq(months.id, monthId), inArray(months.status, ["to_pay", "held"])));
    return;
  }
  try {
    await runOwnedOperation<LockedMonth, { intentId: string }, { status: string; amountReceived: number; chargeId: string | null }>({
      owner: monthOwner(monthId),
      kind: "release",
      labelBase: `monthrelease:${monthId}`,
      prepare: async ({ month }) => {
        if (!month.endedHow || !month.stripePaymentIntentId || IN_THE_BOOKS.includes(month.status)) throw new MoneyError("This month is not being given up.");
        return { intentId: month.stripePaymentIntentId };
      },
      execute: (params, label) => cancelAtStripe(params.intentId, label),
      apply: ({ month }, _params, outcome, tx) => applyLetGo(tx, month, outcome.result, now),
    });
  } catch (error) {
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) log(`letting go of month ${monthId}`, error);
    else throw error;
  }
}
