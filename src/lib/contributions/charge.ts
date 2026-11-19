/**
 * The payment of a contribution (plans/23, "How it works for a contributor" and "The money";
 * plans/25, "charge.ts").
 *
 * A contribution's payment has exactly one PaymentIntent at Stripe. The amount is first only held
 * on the card; it is taken 72 hours and 3 minutes after the hold, and never after its last moment
 * (one hour before the hold ends). Everything here follows the app's standing rule for money:
 * written down first, never twice, and anything whose outcome is not known is asked of Stripe
 * before anything else happens.
 *
 *   writeDownPayment  a payment exists once, before anything is asked of Stripe
 *   intentFor         its one PaymentIntent: found, or made under one claim that is never reset
 *   syncPayment       reads Stripe and records what it shows; every path ends here
 *   tryHold           one try with the saved card (a monthly payment after the first)
 *   takePayment       takes the held money, and writes the host's share in the same step
 *   giveUp, letGo     the payment is ended for a reason; then its hold is cancelled at Stripe
 *
 * It follows the membership's way of working (src/lib/membership/charge.ts) and shares the small
 * parts that fit without change. Where the rules differ it does not: a lost hold is not replaced,
 * money is never taken early or late, and a hold whose end Stripe does not state is let go.
 */
import type Stripe from "stripe";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contribution, ContributionPayment } from "@/db/schema";
import { cancelAtStripe, confirmSavedCard, LABEL_SAFE_MS } from "@/lib/membership/charge";
import { giveUpAt, holdTiming, nextTryAt } from "@/lib/membership/rules";
import { captureAtStripe } from "@/lib/payments/actions";
import { stripeCustomerFor } from "@/lib/payments/hold";
import { addLedgerEntry, MoneyError, OutcomeUnknownError, runOwnedOperation, type Tx } from "@/lib/payments/operations";
import { DEFAULT_FEE_TERMS, splitCharge } from "@/lib/payments/pricing";
import { stripe } from "@/lib/payments/stripe";
import { projectsOnFor } from "@/lib/safety/switches";
import { cardInUse, retireCard, takeCardForContribution } from "./cards";
import { lockForPayment, paymentOwner, type LockedPayment } from "./locks";
import { collectFrom, lastMomentToTake, mayTake, waitFor, type PairPayment } from "./rules";

const pays = schema.contributionPayments;

/** A try the bank has not answered yet is looked at again this much later. */
const LOOK_AGAIN_AT_A_TRY_MS = 5 * 60_000;

/** What a bank says when a card must not be tried again. The monthly contribution ends then. */
const NEVER_AGAIN = new Set(["do_not_try_again", "lost_card", "stolen_card", "pickup_card", "restricted_card", "revocation_of_authorization", "revocation_of_all_authorizations", "stop_payment_order", "security_violation", "fraudulent", "merchant_blacklist"]);

function log(message: string, error?: unknown) {
  if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[contributions] ${message}: ${error.message}`);
  else if (error) console.error(`[contributions] ${message}`, error);
  else console.log(`[contributions] ${message}`);
}

export async function paymentById(paymentId: string): Promise<ContributionPayment | undefined> {
  const [payment] = await db.select().from(pays).where(eq(pays.id, paymentId));
  return payment;
}

/** Still open: to be paid or held, not given up, and not set aside for the founder. */
const open = (payment: ContributionPayment): boolean => (payment.status === "to_pay" || payment.status === "held") && !payment.endedHow && !payment.problem;

// ---------------------------------------------------------------------------
// Writing a payment down
// ---------------------------------------------------------------------------

/**
 * Writes a payment down, before anything is asked of Stripe. `originKey` makes it exist once: a
 * second call with the same key returns the first payment. The caller holds the contribution's lock.
 */
export async function writeDownPayment(
  tx: Tx,
  contribution: Contribution,
  input: { number: number; originKey: string; cardStepExpiresAt?: Date | null; tryNow?: boolean },
  now: Date,
): Promise<ContributionPayment> {
  const [existing] = await tx.select().from(pays).where(eq(pays.originKey, input.originKey));
  if (existing) return existing;
  const [payment] = await tx
    .insert(pays)
    .values({
      contributionId: contribution.id,
      number: input.number,
      originKey: input.originKey,
      amountCents: contribution.amountCents,
      feePercentBps: DEFAULT_FEE_TERMS.percentBps,
      feeFixedCents: DEFAULT_FEE_TERMS.fixedCents,
      feeForeignCardBps: DEFAULT_FEE_TERMS.foreignCardBps,
      cardStepExpiresAt: input.cardStepExpiresAt ?? null,
      // A monthly payment after the first is tried with the saved card at once.
      nextTryAt: input.tryNow ? now : null,
    })
    .returning();
  if (input.number > contribution.lastWrittenMonth) await tx.update(schema.contributions).set({ lastWrittenMonth: input.number, updatedAt: now }).where(eq(schema.contributions.id, contribution.id));
  return payment;
}

// ---------------------------------------------------------------------------
// The payment's one PaymentIntent
// ---------------------------------------------------------------------------

type IntentRequest = Stripe.PaymentIntentCreateParams;

/**
 * The payment's one PaymentIntent, also after an interruption. Exactly one of four things happens,
 * as for a membership's month:
 *   1. its id is saved: that one is used;
 *   2. nobody has claimed it yet: the claim (the moment and the exact request) is written once, the
 *      request is sent under the label "contributionintent:<payment>", and the id is saved;
 *   3. a claim without an id, younger than 23 hours: the saved request is sent again under the same
 *      label, and Stripe returns the same PaymentIntent;
 *   4. a claim without an id, older than that: nothing is created. The customer's PaymentIntents
 *      since the claim are listed and matched on the payment. One: saved. More: a problem for the
 *      founder. None: none was ever made, and the payment is given up.
 * Returns null when the payment has no PaymentIntent to pay with (given up, or a problem).
 */
export async function intentFor(paymentId: string, now: Date = new Date()): Promise<{ intentId: string; clientSecret: string | null; status: Stripe.PaymentIntent.Status } | null> {
  const seen = await paymentById(paymentId);
  if (!seen) throw new MoneyError("Payment not found.");
  if (seen.stripePaymentIntentId) {
    if (seen.status !== "to_pay" || !open(seen)) return null;
    const intent = await stripe().paymentIntents.retrieve(seen.stripePaymentIntentId);
    // Looked at again after Stripe answered: the secret of a payment given up meanwhile goes to nobody.
    const still = await paymentById(paymentId);
    if (!still || still.status !== "to_pay" || !open(still) || still.stripePaymentIntentId !== intent.id) return null;
    return { intentId: intent.id, clientSecret: intent.client_secret, status: intent.status };
  }
  if (seen.problem) return null;

  // 2. The claim, written once.
  let request: IntentRequest;
  let requestedAt: Date;
  if (!seen.intentRequestedAt) {
    if (seen.status !== "to_pay" || !open(seen)) return null;
    const [who] = await db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, kind: schema.contributions.kind, hostId: schema.contributions.hostId })
      .from(schema.contributions)
      .innerJoin(schema.user, eq(schema.user.id, schema.contributions.contributorId))
      .where(eq(schema.contributions.id, seen.contributionId));
    // Nothing new is started while the founder's switch does not cover the host.
    if (!(await projectsOnFor(who.hostId))) return null;
    const customer = await stripeCustomerFor(who);
    const wanted: IntentRequest = {
      amount: seen.amountCents,
      currency: "usd",
      customer,
      // Held first, taken later.
      capture_method: "manual",
      // The first payment of a monthly contribution also keeps the card for the months that follow.
      ...(who.kind === "monthly" && seen.number === 1 ? { setup_future_usage: "off_session" as const } : {}),
      allowed_payment_method_types: ["card"],
      // The group every transfer and refund of this payment's money is found under.
      transfer_group: seen.id,
      description: `Contribution payment ${seen.id}`,
      // A name of its own, so Stripe's messages are never mistaken for a call's or a month's.
      metadata: { contributionPaymentId: seen.id, contributionId: seen.contributionId },
    };
    const claimed = await db.transaction(async (tx) => {
      const { payment } = await lockForPayment(tx, paymentId);
      if (payment.stripePaymentIntentId || payment.intentRequestedAt) return payment;
      if (payment.status !== "to_pay" || !open(payment)) return null;
      const [written] = await tx.update(pays).set({ intentRequestedAt: new Date(), intentRequest: JSON.stringify(wanted), updatedAt: now }).where(eq(pays.id, paymentId)).returning();
      return written;
    });
    if (!claimed) return null;
    if (claimed.stripePaymentIntentId) return intentFor(paymentId, now);
    request = JSON.parse(claimed.intentRequest!) as IntentRequest;
    requestedAt = claimed.intentRequestedAt!;
  } else {
    request = JSON.parse(seen.intentRequest!) as IntentRequest;
    requestedAt = seen.intentRequestedAt;
  }

  let intent: Stripe.PaymentIntent | null;
  if (Date.now() - requestedAt.getTime() < LABEL_SAFE_MS) {
    // 2 and 3. The same request under the same label always gives the same PaymentIntent.
    intent = await stripe().paymentIntents.create(request, { idempotencyKey: `contributionintent:${paymentId}` });
  } else {
    // 4. Too old to send again: look for what was made.
    const found: Stripe.PaymentIntent[] = [];
    const since = Math.floor(requestedAt.getTime() / 1000) - 300;
    for await (const candidate of stripe().paymentIntents.list({ customer: request.customer as string, created: { gte: since }, limit: 100 })) {
      if (candidate.metadata?.contributionPaymentId === paymentId) found.push(candidate);
    }
    if (found.length > 1) {
      await db.update(pays).set({ problem: `Stripe has ${found.length} payments for this one contribution payment. None is used. Please settle it by hand.`, updatedAt: now }).where(eq(pays.id, paymentId));
      return null;
    }
    intent = found[0] ?? null;
    if (!intent) {
      // None was ever made. The payment is given up; nothing was held.
      await db.transaction(async (tx) => {
        const locked = await lockForPayment(tx, paymentId);
        if (locked.payment.stripePaymentIntentId || locked.payment.status !== "to_pay") return;
        if (!locked.payment.endedHow) await giveUpInStep(tx, locked, "cancelled_at_stripe", now);
        await tx.update(pays).set({ status: "given_up", updatedAt: now }).where(eq(pays.id, paymentId));
      });
      return null;
    }
  }

  // Saving the id always looks again, under the lock.
  const found = intent;
  const saved = await db.transaction(async (tx) => {
    const { payment } = await lockForPayment(tx, paymentId);
    if (payment.stripePaymentIntentId) {
      if (payment.stripePaymentIntentId !== found.id) return "other" as const;
      return payment.status === "to_pay" && open(payment) ? ("known" as const) : ("closed" as const);
    }
    await tx.update(pays).set({ stripePaymentIntentId: found.id, updatedAt: now }).where(eq(pays.id, paymentId));
    return payment.status === "to_pay" && open(payment) ? ("saved" as const) : ("abandoned" as const);
  });
  if (saved === "abandoned") {
    // The payment was given up while Stripe was answering: the letting-go takes care of it. Its secret goes to nobody.
    await letGo(paymentId, now).catch((error) => log(`could not let go of the payment of abandoned contribution payment ${paymentId} yet; the helper will retry`, error));
    return null;
  }
  if (saved === "other") return intentFor(paymentId, now);
  if (saved === "closed") return null;
  return { intentId: found.id, clientSecret: found.client_secret, status: found.status };
}

// ---------------------------------------------------------------------------
// The $1,000 rule, applied (plans/25, "The $1,000 rule in the code")
// ---------------------------------------------------------------------------

/**
 * Counts one contributor's payments to one host and writes what the rule asks: the 30-day mark on
 * every hold in place, and the later date on every share that has not been sent, each from its
 * own taking. A date is only ever moved later here. The caller holds the pair's lock, so two
 * payments of the pair arriving at the same moment are counted one after the other.
 */
export async function countPair(tx: Tx, contributorId: string, hostId: string, now: Date): Promise<{ over: boolean; countedCents: number }> {
  const rows = await tx
    .select({ payment: pays, shareStatus: schema.payments.transferStatus })
    .from(pays)
    .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
    .leftJoin(schema.payments, eq(schema.payments.contributionPaymentId, pays.id))
    .where(and(eq(schema.contributions.contributorId, contributorId), eq(schema.contributions.hostId, hostId)));
  const seen: PairPayment[] = rows.map(({ payment, shareStatus }) => ({
    id: payment.id,
    amountCents: payment.amountCents,
    // A hold counts while it is in place, also one that is being let go, until that is certain.
    state: payment.status === "held" ? "held" : payment.status === "taken" ? "taken" : "other",
    takenAt: payment.takenAt,
    sent: shareStatus === "sent",
    released: payment.founderHold === "released",
  }));
  const result = waitFor(seen, now);
  if (result.markHeld.length > 0) await tx.update(pays).set({ thirtyDayMark: true, updatedAt: now }).where(and(inArray(pays.id, result.markHeld), eq(pays.thirtyDayMark, false)));
  for (const id of result.thirtyDays) {
    const takenAt = rows.find((row) => row.payment.id === id)?.payment.takenAt;
    if (!takenAt) continue;
    // Each from its own taking, and never sooner than it already was. A share whose sending is written down
    // keeps its sending as it is, and still gets the later date in case Stripe refuses.
    await tx
      .update(schema.payments)
      .set({ transferDueAt: sql`greatest(${schema.payments.transferDueAt}, ${collectFrom(takenAt, true).toISOString()}::timestamptz)`, updatedAt: now })
      .where(and(eq(schema.payments.contributionPaymentId, id), inArray(schema.payments.transferStatus, ["not_due", "due"])));
  }
  return { over: result.over, countedCents: result.countedCents };
}

// ---------------------------------------------------------------------------
// Reading Stripe: every path ends here
// ---------------------------------------------------------------------------

const chargeOf = (intent: Stripe.PaymentIntent): Stripe.Charge | null => (typeof intent.latest_charge === "object" ? intent.latest_charge : null);
const chargeIdOf = (intent: Stripe.PaymentIntent): string | null => (typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null));

/** Whether a try with the payment's current try number has been made and has an answer (with `before`: had it before that moment). */
async function tryFinished(reader: Pick<Tx, "select">, payment: ContributionPayment, before?: Date): Promise<boolean> {
  const done = await reader
    .select({ finishedAt: schema.moneyOperations.finishedAt })
    .from(schema.moneyOperations)
    .where(and(eq(schema.moneyOperations.contributionPaymentId, payment.id), eq(schema.moneyOperations.kind, "hold"), like(schema.moneyOperations.label, `contributionhold:${payment.id}:${payment.try}:%`), inArray(schema.moneyOperations.status, ["succeeded", "failed"])));
  return done.some((operation) => !before || (operation.finishedAt !== null && operation.finishedAt < before));
}

/**
 * Records money Stripe took for a payment, once, whoever learned of it (the direct answer,
 * recovery, a message). `at` is read after Stripe has answered: it is the moment Connect knows,
 * which is the real moment or later, never earlier, and it is kept.
 *
 *   held, not given up, the whole amount   the payment is taken, and the host's share is written
 *                                          with its wait, in this same step
 *   the whole amount in any other case     (never accepted, or given up in that very moment)
 *                                          taken, and all of it is owed back to the card
 *   any other amount                       taken, nothing written for the host; the founder settles it
 */
export async function applyTaken(tx: Tx, locked: LockedPayment, taken: { cents: number; chargeId: string | null }, at: Date): Promise<void> {
  const { contribution, payment } = locked;
  if (payment.status === "taken") return;
  const chargeId = taken.chargeId ?? payment.stripeChargeId;
  const rightful = payment.status === "held" && !payment.endedHow && taken.cents === payment.amountCents;
  await tx
    .update(pays)
    .set({
      status: "taken",
      takenAt: at,
      takenCents: taken.cents,
      stripeChargeId: chargeId,
      nextTryAt: null,
      ...(taken.cents !== payment.amountCents ? { problem: `Stripe took $${(taken.cents / 100).toFixed(2)} for this payment, not $${(payment.amountCents / 100).toFixed(2)}. Nothing was written for the host. Please settle it by hand.` } : {}),
      updatedAt: at,
    })
    .where(eq(pays.id, payment.id));
  await addLedgerEntry(tx, { contributionPaymentId: payment.id, kind: "customer_charge", amountCents: taken.cents, stripeRef: chargeId, note: rightful ? "contribution" : "contribution, taken although it was not to be" });
  if (taken.cents !== payment.amountCents) return;

  if (!rightful) {
    // Taken although it was given up or never accepted: all of it goes back. The line is what makes it owed.
    await tx
      .insert(schema.contributionRefunds)
      .values({ contributionPaymentId: payment.id, sourceKey: `late:${payment.id}`, amountCents: taken.cents, decidedBy: "app", reason: "This payment went through although it had been cancelled, so all of it is paid back." })
      .onConflictDoNothing();
    return;
  }

  // The host's share, as one line among her earnings, under this payment (plans/25, "What the share's line holds").
  const terms = { percentBps: payment.feePercentBps, fixedCents: payment.feeFixedCents, foreignCardBps: payment.feeForeignCardBps };
  const split = splitCharge(taken.cents, terms, payment.cardCountry !== null && payment.cardCountry !== "US");
  const [share] = await tx
    .insert(schema.payments)
    .values({
      kind: "contribution",
      contributionPaymentId: payment.id,
      // No call and no month. The stretch it stands for is the moment the money was taken.
      coversFrom: at,
      coversUntil: at,
      pricePer15Cents: 0,
      bookedCents: taken.cents,
      feePercentBps: terms.percentBps,
      feeFixedCents: terms.fixedCents,
      feeForeignCardBps: terms.foreignCardBps,
      status: "charged",
      chargedCents: taken.cents,
      chargeReason: "contribution",
      chargedAt: at,
      // The charge a transfer names as its source. The PaymentIntent stays on the contribution's payment alone.
      stripeChargeId: chargeId,
      cardCountry: payment.cardCountry,
      originalFeeCents: split.feeCents,
      originalHostShareCents: split.hostShareCents,
      transferStatus: split.hostShareCents > 0 ? "not_due" : "not_owed",
      // 30 days if the payment carries the mark from when it was held; 7 otherwise. The count below can still make it 30.
      transferDueAt: split.hostShareCents > 0 ? collectFrom(at, payment.thirtyDayMark) : null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.payments.id });
  if (share) {
    // No "charged to the contributor" line here: the contribution's payment has the only one.
    await addLedgerEntry(tx, { paymentId: share.id, kind: "platform_fee", amountCents: split.feeCents, stripeRef: chargeId, note: "contribution" });
    await addLedgerEntry(tx, { paymentId: share.id, kind: "host_share", amountCents: split.hostShareCents, stripeRef: chargeId, note: "contribution" });
  }
  // The second of the rule's three moments: the money is taken.
  await countPair(tx, contribution.contributorId, contribution.hostId, at);
  // A contribution made once has nothing more to come.
  if (contribution.kind === "once" && contribution.status !== "ended") {
    await tx.update(schema.contributions).set({ status: "ended", endedAt: at, endedHow: "paid", updatedAt: at }).where(eq(schema.contributions.id, contribution.id));
  }
}

/** A try with the saved card failed: recorded once. The 7 days count from the first failure; the try's number goes up, so the next try is a new action of its own. */
async function recordFailedTry(tx: Tx, locked: LockedPayment, input: { needsAction: boolean }, now: Date): Promise<void> {
  const { payment } = locked;
  const firstFailedAt = payment.firstFailedAt ?? now;
  await tx
    .update(pays)
    .set({ try: payment.try + 1, firstFailedAt, giveUpAt: giveUpAt(firstFailedAt), nextTryAt: nextTryAt(firstFailedAt, payment.try), needsAction: input.needsAction, updatedAt: now })
    .where(eq(pays.id, payment.id));
}

/** Why a hold that has arrived cannot be accepted, or null if it can. */
async function whyNotAccept(tx: Tx, locked: LockedPayment, intent: Stripe.PaymentIntent, authorisedAt: Date): Promise<string | null> {
  const { contribution, payment } = locked;
  if (intent.amount !== payment.amountCents || intent.metadata?.contributionPaymentId !== payment.id) return "card_step";
  if (contribution.status === "ended") return "ending";
  if (payment.cardStepExpiresAt && authorisedAt > payment.cardStepExpiresAt) return "card_step";
  // The 7 days count by the bank's own time too: a hold placed in time counts when it is found late, one placed after them does not.
  if (payment.giveUpAt && authorisedAt > payment.giveUpAt) return "given_up";
  if (!(await projectsOnFor(contribution.hostId, tx))) return "switch";
  const [project] = await tx.select({ status: schema.projects.status }).from(schema.projects).where(eq(schema.projects.id, contribution.projectId));
  if (project?.status !== "running") return "ending";
  return null;
}

/**
 * Reads the payment's PaymentIntent at Stripe and records what it shows. Called by the direct
 * answer of every step, by Stripe's messages and by the helper; never moves a payment backwards.
 */
export async function syncPayment(paymentId: string, now: Date = new Date()): Promise<ContributionPayment> {
  // Stripe is asked outside the database step. If our payment moved on in between, what we read is old:
  // it is thrown away and Stripe is asked again.
  for (let round = 0; round < 3; round++) {
    const seen = await paymentById(paymentId);
    if (!seen) throw new MoneyError("Payment not found.");
    // A payment that is in the books is never touched again, whatever message arrives.
    if (!seen.stripePaymentIntentId || seen.status === "taken" || seen.status === "given_up") return seen;
    const readAt = new Date(); // the real clock, taken before Stripe is asked
    const intent = await stripe().paymentIntents.retrieve(seen.stripePaymentIntentId, { expand: ["latest_charge", "payment_method"] });
    let holdEndsAt = holdEndOf(chargeOf(intent));
    // When Stripe does not say when a hold ends, it is asked again. No date is ever assumed (plans/25, choice 10).
    if (intent.status === "requires_capture" && !holdEndsAt) {
      const chargeId = chargeIdOf(intent);
      if (chargeId) holdEndsAt = holdEndOf(await stripe().charges.retrieve(chargeId));
    }
    if (await recordIntent(seen, intent, now, { readAt, holdEndsAt })) break;
  }
  return (await paymentById(paymentId))!;
}

/** When a hold ends, by Stripe's own answer for that card, or null when it does not say. */
function holdEndOf(charge: Stripe.Charge | null): Date | null {
  const captureBefore = charge?.payment_method_details?.card?.capture_before;
  return captureBefore ? new Date(captureBefore * 1000) : null;
}

/** What must be unchanged between reading Stripe and recording what it showed. */
const standing = (payment: ContributionPayment): string => [payment.status, payment.endedHow, payment.problem, payment.try, payment.stripePaymentIntentId, payment.takenAt?.getTime()].join("|");

/** A card that was saved through a booking's card step is that booking's, also before our database has heard of it. Stripe knows. */
async function isBookingsCard(paymentMethodId: string): Promise<boolean> {
  const setups = await stripe().setupIntents.list({ payment_method: paymentMethodId, limit: 100 }).autoPagingToArray({ limit: 300 });
  return setups.some((setup) => Boolean(setup.metadata?.bookingId));
}

/**
 * Records what Stripe showed for the payment as it was `seen`. Returns false, and records nothing,
 * when the payment has moved on since. `readAt` is the moment (on the real clock) just before
 * Stripe was asked; `holdEndsAt` is when Stripe says the hold ends, or null when it does not say.
 * (Its own function so that the check script can hand it an answer from Stripe that it has made up.)
 */
export async function recordIntent(seen: ContributionPayment, intent: Stripe.PaymentIntent, now: Date, read: { readAt?: Date; holdEndsAt: Date | null }): Promise<boolean> {
  const paymentId = seen.id;
  const charge = chargeOf(intent);
  const method = typeof intent.payment_method === "object" ? intent.payment_method : null;
  const savesCard = intent.setup_future_usage === "off_session" || Boolean(method?.customer);
  const bookingsCard = seen.status === "to_pay" && intent.status === "requires_capture" && method && savesCard ? await isBookingsCard(method.id) : false;
  let release = false;
  let stale = false;

  await db.transaction(async (tx) => {
    const locked = await lockForPayment(tx, paymentId);
    const { contribution, payment } = locked;
    if (standing(payment) !== standing(seen)) {
      stale = true;
      return;
    }
    if (payment.stripePaymentIntentId !== intent.id || payment.status === "taken" || payment.status === "given_up") return;
    await tx.update(pays).set({ updatedAt: now }).where(eq(pays.id, payment.id));
    // Read after Stripe has answered (plans/25, choice 11). A pretended clock in a check script counts as that moment.
    const taken = () => applyTaken(tx, locked, { cents: intent.amount_received, chargeId: chargeIdOf(intent) }, now);

    // --- We are letting it go, or already have.
    if (payment.endedHow) {
      if (intent.status === "canceled") await tx.update(pays).set({ status: "given_up", updatedAt: now }).where(eq(pays.id, payment.id));
      else if (intent.status === "succeeded") await taken();
      else if (intent.status === "requires_capture") release = true; // never accepted; the letting-go continues, or is written down now
      return;
    }

    // --- Our payment is held.
    if (payment.status === "held") {
      if (intent.status === "succeeded") await taken();
      else if (intent.status === "canceled") {
        // The bank dropped the hold. Nothing is tried again for it; a monthly contribution goes on with its next month.
        await giveUpInStep(tx, locked, "hold_lost", now);
        await tx.update(pays).set({ status: "given_up", updatedAt: now }).where(eq(pays.id, payment.id));
      } else if (intent.status !== "requires_capture" && intent.status !== "processing") {
        await tx.update(pays).set({ problem: `Stripe shows this payment as "${intent.status}" although its hold was accepted. Please look at it.`, updatedAt: now }).where(eq(pays.id, payment.id));
      }
      return;
    }

    // --- Our payment is still to be paid.
    if (payment.status !== "to_pay" || payment.problem) return;
    if (intent.status === "requires_capture") {
      const authorisedAt = charge?.created ? new Date(charge.created * 1000) : now;
      let why = await whyNotAccept(tx, locked, intent, authorisedAt);
      let cardId: string | null = null;
      if (!why && contribution.kind === "monthly") {
        // The card of this payment becomes the contribution's card in use, if Stripe really kept it for the contributor.
        try {
          if (!method) throw new MoneyError("The payment has no card.");
          if (bookingsCard) throw new MoneyError("This card was saved for a booking, so it cannot be a contribution's card.");
          if (method.customer) cardId = (await takeCardForContribution(tx, contribution.id, method.id, now)).id;
        } catch (error) {
          if (!(error instanceof MoneyError)) throw error;
          why = "card_step";
        }
      }
      if (!why && !read.holdEndsAt) {
        // Stripe did not say when this hold ends, also when asked again. No date is assumed: the hold is let go, and the founder is shown it.
        await tx.update(pays).set({ problem: "Stripe did not say when this payment's hold ends, so it was let go and nothing was taken.", updatedAt: now }).where(eq(pays.id, payment.id));
        why = "no_hold_end";
      }
      if (why) {
        await giveUpInStep(tx, locked, why, now);
        release = true;
        return;
      }
      const holdExpiresAt = read.holdEndsAt!;
      const timing = holdTiming({ authorisedAt, holdExpiresAt });
      await tx
        .update(pays)
        .set({
          status: "held",
          authorisedAt,
          holdExpiresAt,
          takeAt: timing.takeAt,
          takeBy: lastMomentToTake(holdExpiresAt),
          cardId,
          cardCountry: charge?.payment_method_details?.card?.country ?? null,
          stripeChargeId: charge?.id ?? null,
          nextTryAt: null,
          giveUpAt: null,
          needsAction: false,
          updatedAt: now,
        })
        .where(eq(pays.id, payment.id));
      await tx
        .update(schema.contributions)
        // The day the first hold succeeded is a monthly contribution's day of the month, for good.
        .set({ status: "running", ...(contribution.kind === "monthly" && !contribution.firstHoldAt ? { firstHoldAt: authorisedAt } : {}), updatedAt: now })
        .where(eq(schema.contributions.id, contribution.id));
      // The first of the rule's three moments: a hold is accepted.
      await countPair(tx, contribution.contributorId, contribution.hostId, now);
      return;
    }
    if (intent.status === "succeeded") {
      // Cannot come from our code, which only takes a held payment. Recorded, and all of it is owed back.
      await giveUpInStep(tx, locked, "cancelled_at_stripe", now);
      const [again] = await tx.select().from(pays).where(eq(pays.id, payment.id));
      await applyTaken(tx, { contribution, payment: again }, { cents: intent.amount_received, chargeId: chargeIdOf(intent) }, now);
      return;
    }
    if (intent.status === "canceled") {
      await giveUpInStep(tx, locked, "cancelled_at_stripe", now);
      await tx.update(pays).set({ status: "given_up", updatedAt: now }).where(eq(pays.id, payment.id));
      return;
    }
    if (intent.status === "processing") return;
    // requires_payment_method, requires_confirmation, requires_action: a failure only if a try was really made and answered,
    // and only from an answer read after that try had its own.
    if (!(await tryFinished(tx, payment, read.readAt ?? new Date()))) return;
    const refusal = intent.last_payment_error;
    if (refusal?.decline_code && NEVER_AGAIN.has(refusal.decline_code)) {
      // The bank said not to try this card again: the monthly contribution ends.
      const { endInStep } = await import("./ending");
      await endInStep(tx, locked.contribution, "never_again", now);
      release = true;
      return;
    }
    // The bank wants the contributor to confirm, in either of the two ways Stripe says so. That is not a hold.
    const needsAction = intent.status === "requires_action" || refusal?.code === "authentication_required";
    await recordFailedTry(tx, locked, { needsAction }, now);
  });

  if (stale) return false;
  if (release) await letGo(paymentId, now).catch((error) => log(`could not let go of the hold of contribution payment ${paymentId} yet; the helper will retry`, error));
  return true;
}

// ---------------------------------------------------------------------------
// A try with the saved card
// ---------------------------------------------------------------------------

/**
 * One try to hold a monthly payment's amount on the contribution's saved card, in the background.
 * Each try has a name of its own ("contributionhold:<payment>:<try>"), so one failed try never
 * blocks the next. Whichever way it ends, syncPayment records it. Nothing is tried while the
 * founder's switch does not cover the host.
 */
export async function tryHold(paymentId: string, now: Date = new Date()): Promise<ContributionPayment> {
  let seen = await paymentById(paymentId);
  if (!seen) throw new MoneyError("Payment not found.");
  // What an earlier try achieved is recorded before a new one starts, so no try is ever made twice.
  if (seen.stripePaymentIntentId) seen = await syncPayment(paymentId, now);
  if (seen.status !== "to_pay" || !open(seen) || !seen.nextTryAt || seen.nextTryAt > now) return seen;
  if (seen.giveUpAt && seen.giveUpAt <= now) return seen;
  const [contribution] = await db.select().from(schema.contributions).where(eq(schema.contributions.id, seen.contributionId));
  if (!contribution || contribution.status === "ended" || !(await projectsOnFor(contribution.hostId))) return seen;
  if (seen.stripePaymentIntentId && (await tryFinished(db, seen))) {
    // This try has its answer, and Stripe has neither held nor refused yet. Nothing new is tried beside it.
    await db.update(pays).set({ nextTryAt: new Date(now.getTime() + LOOK_AGAIN_AT_A_TRY_MS), updatedAt: now }).where(and(eq(pays.id, paymentId), eq(pays.status, "to_pay"), eq(pays.try, seen.try)));
    return (await paymentById(paymentId))!;
  }
  const tryNumber = seen.try;
  const found = await intentFor(paymentId, now);
  if (!found) return (await paymentById(paymentId))!;
  const card = await cardInUse(db, seen.contributionId);
  if (!card) {
    // The saved card is gone: the monthly contribution ends, and this payment with it.
    const { endContribution } = await import("./ending");
    await endContribution(seen.contributionId, "card_gone", now);
    return (await paymentById(paymentId))!;
  }
  try {
    await runOwnedOperation<LockedPayment, { intentId: string; paymentMethodId: string }, null>({
      owner: paymentOwner(paymentId),
      kind: "hold",
      labelBase: `contributionhold:${paymentId}:${tryNumber}`,
      prepare: async ({ contribution: current, payment }, tx) => {
        if (payment.status !== "to_pay" || !open(payment)) throw new MoneyError("This payment is not waiting to be paid.");
        if (payment.stripePaymentIntentId !== found.intentId || payment.try !== tryNumber) throw new MoneyError("The payment changed. Nothing was tried.");
        // Checked here, right before acting: nothing new is started after a stop.
        if (current.status === "ended" || !(await projectsOnFor(current.hostId, tx))) throw new MoneyError("This contribution is not taking payments now.");
        if (await tryFinished(tx, payment)) throw new MoneyError("This try already has its answer.");
        return { intentId: found.intentId, paymentMethodId: card.stripePaymentMethodId };
      },
      execute: async (params, label) => {
        const intent = await confirmSavedCard(params, label);
        return { stripeId: intent.id, result: null };
      },
      // What the try achieved is read from Stripe by syncPayment, the same for every path.
      apply: async () => undefined,
    });
  } catch (error) {
    if (error instanceof OutcomeUnknownError) return (await paymentById(paymentId))!; // the helper finds out
    if (!(error instanceof MoneyError)) throw error;
  }
  return syncPayment(paymentId, now);
}

// ---------------------------------------------------------------------------
// Taking the money
// ---------------------------------------------------------------------------

/**
 * Takes the held money, whole. `mayTake` is asked with the clock read at that moment, right
 * before Stripe is asked, so nothing is taken early, late, or after a stop. A hold whose last
 * moment has passed is given up as "not taken in time" and let go. `now` is only passed by the
 * check scripts, to pretend it is another day.
 */
export async function takePayment(paymentId: string, now?: Date): Promise<ContributionPayment> {
  const clock = () => now ?? new Date();
  const seen = await paymentById(paymentId);
  if (!seen) throw new MoneyError("Payment not found.");
  if (seen.status !== "held" || !open(seen)) return seen;
  if (seen.takeBy && clock() > seen.takeBy) return giveUp(paymentId, "not_taken_in_time", clock());
  try {
    await runOwnedOperation<LockedPayment, { intentId: string; amountCents: number }, { chargeId: string | null; amountReceived: number }>({
      owner: paymentOwner(paymentId),
      kind: "capture",
      labelBase: `contributioncapture:${paymentId}`,
      prepare: async ({ contribution, payment }, tx) => {
        if (!payment.stripePaymentIntentId || !mayTake(payment, clock())) throw new MoneyError("This payment's money may not be taken now.");
        if (!(await projectsOnFor(contribution.hostId, tx))) throw new MoneyError("Contributions to this host are switched off, so nothing is taken.");
        return { intentId: payment.stripePaymentIntentId, amountCents: payment.amountCents };
      },
      execute: (params, label) => captureAtStripe(params.intentId, params.amountCents, label),
      // The clock is read here, after Stripe has answered.
      apply: (locked, _params, outcome, tx) => applyTaken(tx, locked, { cents: outcome.result.amountReceived, chargeId: outcome.result.chargeId }, clock()),
    });
  } catch (error) {
    if (error instanceof OutcomeUnknownError) return (await paymentById(paymentId))!;
    if (!(error instanceof MoneyError)) throw error;
    // Refused, by us or by Stripe (usually the hold is gone). Record how things really stand.
    return syncPayment(paymentId, clock());
  }
  return (await paymentById(paymentId))!;
}

// ---------------------------------------------------------------------------
// Giving a payment up
// ---------------------------------------------------------------------------

/**
 * A payment that is not paid for, or only held, is ended for a reason. The reason is saved first,
 * in one step; from that moment nothing new is asked of Stripe for it except letting it go. If the
 * money turns out to have been taken at that very moment, it is recorded and owed back in full.
 */
export async function giveUp(paymentId: string, how: string, now: Date = new Date()): Promise<ContributionPayment> {
  await db.transaction(async (tx) => {
    await giveUpInStep(tx, await lockForPayment(tx, paymentId), how, now);
  });
  await letGo(paymentId, now).catch((error) => log(`could not let go of contribution payment ${paymentId} yet; the helper will retry`, error));
  return (await paymentById(paymentId))!;
}

/**
 * The first half of giving a payment up, inside a database step the caller owns, with the payment
 * locked: the reason is saved. A contribution whose only payment this is ends with it (one made
 * once; a monthly one that never got its first hold). The caller lets the hold go after its step
 * is saved (letGo); if it does not get that far, the helper does. Returns whether this call is
 * the one that gave it up.
 */
export async function giveUpInStep(tx: Tx, locked: LockedPayment, how: string, now: Date): Promise<boolean> {
  const { contribution, payment } = locked;
  if ((payment.status !== "to_pay" && payment.status !== "held") || payment.endedHow) return false;
  await tx.update(pays).set({ endedHow: how, nextTryAt: null, updatedAt: now }).where(eq(pays.id, payment.id));
  if (contribution.status !== "ended" && (contribution.kind === "once" || contribution.status === "card_step")) {
    await tx.update(schema.contributions).set({ status: "ended", endedAt: now, endedHow: how, updatedAt: now }).where(eq(schema.contributions.id, contribution.id));
    await retireCard(tx, contribution.id, now);
  }
  return true;
}

/** Records how a letting-go ended: taken in that very moment (owed back in full), or the cancellation is finished. */
export async function applyLetGo(tx: Tx, locked: LockedPayment, result: { status: string; amountReceived: number; chargeId: string | null }, at: Date): Promise<void> {
  if (result.status === "succeeded") await applyTaken(tx, locked, { cents: result.amountReceived, chargeId: result.chargeId }, at);
  else if (locked.payment.status === "to_pay" || locked.payment.status === "held") await tx.update(pays).set({ status: "given_up", updatedAt: at }).where(eq(pays.id, locked.payment.id));
}

/**
 * Cancels the payment of a payment whose reason for ending is already saved. Safe to run again. A
 * payment without a PaymentIntent is simply marked as given up.
 */
export async function letGo(paymentId: string, now: Date = new Date()): Promise<void> {
  const seen = await paymentById(paymentId);
  if (!seen || !seen.endedHow || seen.status === "taken" || seen.status === "given_up") return;
  if (!seen.stripePaymentIntentId) {
    // A claim for a PaymentIntent may still be on its way: intentFor finishes it and comes back here.
    if (!seen.intentRequestedAt) await db.update(pays).set({ status: "given_up", updatedAt: now }).where(and(eq(pays.id, paymentId), inArray(pays.status, ["to_pay", "held"])));
    return;
  }
  try {
    await runOwnedOperation<LockedPayment, { intentId: string }, { status: string; amountReceived: number; chargeId: string | null }>({
      owner: paymentOwner(paymentId),
      kind: "release",
      labelBase: `contributionrelease:${paymentId}`,
      prepare: async ({ payment }) => {
        if (!payment.endedHow || !payment.stripePaymentIntentId || payment.status === "taken" || payment.status === "given_up") throw new MoneyError("This payment is not being given up.");
        return { intentId: payment.stripePaymentIntentId };
      },
      execute: (params, label) => cancelAtStripe(params.intentId, label),
      apply: (locked, _params, outcome, tx) => applyLetGo(tx, locked, outcome.result, now),
    });
  } catch (error) {
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) log(`letting go of contribution payment ${paymentId}`, error);
    else throw error;
  }
}
