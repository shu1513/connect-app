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
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contribution, ContributionPayment } from "@/db/schema";
import { cancelAtStripe, confirmSavedCard, LABEL_SAFE_MS } from "@/lib/membership/charge";
import { giveUpAt, holdTiming, nextTryAt } from "@/lib/membership/rules";
import { captureAtStripe } from "@/lib/payments/actions";
import { stripeCustomerFor } from "@/lib/payments/hold";
import { addLedgerEntry, MoneyError, NotSentError, OutcomeUnknownError, runOwnedOperation, type Tx } from "@/lib/payments/operations";
import { DEFAULT_FEE_TERMS, splitCharge, type FeeTerms } from "@/lib/payments/pricing";
import { stripe } from "@/lib/payments/stripe";
import { takingOnFor } from "@/lib/safety/switches";
import { cardInUse, retireCard, savedForSomething, takeCardForContribution } from "./cards";
import { queueAgreementEmail, queueHoldEmail, queueNewContributorEmail, queueNothingChargedEmail, queuePaymentFailedEmail, tellFounderOfLargeTotal } from "./emails";
import { lockForPayment, paymentOwner, type LockedPayment } from "./locks";
import { collectFrom, CONTRIBUTION, lastMomentToTake, mayTake, monthMissed, waitFor, type PairPayment } from "./rules";
import { addSkipped } from "./skipped";

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

/**
 * The clock for anything that decides about money, or writes down when money was taken: the moment
 * that was handed in, or the real clock if that is later. The helper hands in the start of its
 * round, which can be minutes old by the time a payment's turn comes; a check script hands in a
 * pretended day that lies ahead. Read at the moment it is needed, never earlier.
 */
export const freshNow = (given?: Date): Date => new Date(Math.max(given?.getTime() ?? 0, Date.now()));

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
 * `terms` are the fee terms the payment is written with; without them it gets the usual ones.
 */
export async function writeDownPayment(
  tx: Tx,
  contribution: Contribution,
  input: { number: number; originKey: string; cardStepExpiresAt?: Date | null; tryNow?: boolean; terms?: FeeTerms },
  now: Date,
): Promise<ContributionPayment> {
  const [existing] = await tx.select().from(pays).where(eq(pays.originKey, input.originKey));
  if (existing) return existing;
  // The usual fee, unless the caller gives terms of its own (a tip's: plans/44, decision 6). They stay with the payment.
  const terms = input.terms ?? DEFAULT_FEE_TERMS;
  const [payment] = await tx
    .insert(pays)
    .values({
      contributionId: contribution.id,
      number: input.number,
      originKey: input.originKey,
      amountCents: contribution.amountCents,
      feePercentBps: terms.percentBps,
      feeFixedCents: terms.fixedCents,
      feeForeignCardBps: terms.foreignCardBps,
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
 * How long after a PaymentIntent was last asked for Stripe's list is not believed when it shows none.
 * Stripe's library gives a request up after 80 seconds and sends it again up to twice, so one can be on its
 * way for about four minutes. Well beyond that, and below the ten minutes after which the watch speaks up
 * (health.ts).
 */
export const CLAIM_ON_ITS_WAY_MS = 8 * 60_000;

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
export async function intentFor(paymentId: string, now: Date = new Date()): Promise<{ intentId: string; clientSecret: string | null; status: Stripe.PaymentIntent.Status; keepsCard: boolean } | null> {
  const seen = await paymentById(paymentId);
  if (!seen) throw new MoneyError("Payment not found.");
  if (seen.stripePaymentIntentId) {
    if (seen.status !== "to_pay" || !open(seen)) return null;
    const intent = await stripe().paymentIntents.retrieve(seen.stripePaymentIntentId);
    // Looked at again after Stripe answered: the secret of a payment given up meanwhile goes to nobody.
    const still = await paymentById(paymentId);
    if (!still || still.status !== "to_pay" || !open(still) || still.stripePaymentIntentId !== intent.id) return null;
    return { intentId: intent.id, clientSecret: intent.client_secret, status: intent.status, keepsCard: intent.setup_future_usage === "off_session" };
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
    // Nothing new is started while the founder's switch does not cover it (the projects switch for the host, or the tips switch).
    if (!(await takingOnFor(who))) return null;
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
      description: `${who.kind === "tip" ? "Tip" : "Contribution"} payment ${seen.id}`,
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
  // After a stop (the payment was given up, or the founder's switch no longer covers the host) the request is
  // not sent again: Stripe is only asked what was made, so that it can be let go.
  const [owner] = await db.select({ kind: schema.contributions.kind, hostId: schema.contributions.hostId }).from(schema.contributions).where(eq(schema.contributions.id, seen.contributionId));
  const current = (await paymentById(paymentId)) ?? seen;
  const stopped = current.status !== "to_pay" || !open(current) || !owner || !(await takingOnFor(owner));

  let intent: Stripe.PaymentIntent | null;
  let mayAsk = !stopped && Date.now() - requestedAt.getTime() < LABEL_SAFE_MS;
  if (mayAsk) {
    // The moment of every asking, the first and each one after it, is written first, with the payment locked. So
    // a look at Stripe's list that finds none knows how lately the request may have gone out, and a payment that
    // was given up in between is not asked for.
    mayAsk = await db.transaction(async (tx) => {
      const { payment } = await lockForPayment(tx, paymentId);
      if (payment.stripePaymentIntentId || payment.status !== "to_pay" || !open(payment)) return false;
      await tx.update(pays).set({ intentAskedAt: new Date() }).where(eq(pays.id, paymentId));
      return true;
    });
  }
  if (mayAsk) {
    // 2 and 3. The same request under the same label always gives the same PaymentIntent.
    intent = await stripe().paymentIntents.create(request, { idempotencyKey: `contributionintent:${paymentId}` });
  } else {
    // 4. Too old to send again, or stopped: look for what was made.
    const listedAt = Date.now();
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
      await db.transaction(async (tx) => {
        const locked = await lockForPayment(tx, paymentId);
        if (locked.payment.stripePaymentIntentId || locked.payment.status !== "to_pay") return;
        // The one that was asked for may still be on its way to Stripe, or not on Stripe's list yet. While that
        // can be, nothing is concluded: the helper asks again on its next round, and finds it then. Counted from
        // the last asking, read here under the lock every asking takes, to the moment the list was read.
        const lastAsked = locked.payment.intentAskedAt ?? locked.payment.intentRequestedAt ?? requestedAt;
        if (listedAt - lastAsked.getTime() < CLAIM_ON_ITS_WAY_MS) return;
        // None was ever made. The payment is given up; nothing was held.
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
    // A payment that had already been written off as given up, with no PaymentIntent known, before this one arrived
    // late: in the same step as its id is saved, the payment is "being given up" again (its reason stays). So the
    // letting-go, which is written down first and repeated by the helper until Stripe has answered, cancels this
    // PaymentIntent too, also if this process stops right here.
    const lateForWrittenOff = payment.status === "given_up";
    await tx.update(pays).set({ stripePaymentIntentId: found.id, ...(lateForWrittenOff ? { status: "to_pay" as const } : {}), updatedAt: now }).where(eq(pays.id, paymentId));
    return payment.status === "to_pay" && open(payment) ? ("saved" as const) : ("abandoned" as const);
  });
  if (saved === "abandoned") {
    // The payment was given up while Stripe was answering: the letting-go takes care of it. Its secret goes to nobody.
    await letGo(paymentId, now).catch((error) => log(`could not let go of the payment of abandoned contribution payment ${paymentId} yet; the helper will retry`, error));
    return null;
  }
  if (saved === "other") return intentFor(paymentId, now);
  if (saved === "closed") return null;
  return { intentId: found.id, clientSecret: found.client_secret, status: found.status, keepsCard: found.setup_future_usage === "off_session" };
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
export async function countPair(tx: Tx, contributorId: string, hostId: string, now: Date, entering?: string): Promise<{ over: boolean; countedCents: number }> {
  const rows = await tx
    .select({ payment: pays, shareStatus: schema.payments.transferStatus })
    .from(pays)
    .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
    .leftJoin(schema.payments, eq(schema.payments.contributionPaymentId, pays.id))
    .where(and(eq(schema.contributions.contributorId, contributorId), eq(schema.contributions.hostId, hostId)));
  const seen: PairPayment[] = rows.map(({ payment, shareStatus }) => ({
    id: payment.id,
    // What the contributor really paid: for money that was taken, the amount Stripe took.
    amountCents: payment.status === "taken" ? (payment.takenCents ?? payment.amountCents) : payment.amountCents,
    // A hold counts while it is in place, also one that is being let go, until that is certain.
    state: payment.status === "held" ? "held" : payment.status === "taken" ? "taken" : "other",
    takenAt: payment.takenAt,
    sent: shareStatus === "sent",
    released: payment.founderHold === "released",
  }));
  const result = waitFor(seen, now);
  // The founder is told when the pair crosses the line (plans/25, choice 8). The count only ever goes up when a
  // payment enters it (`entering`: a hold that was just accepted, or money taken that was never held), so that is
  // the one moment a crossing can happen: over the line with this payment, and not over it without. Every crossing
  // is told, once, whatever marks earlier payments carry.
  const entered = entering ? seen.find((payment) => payment.id === entering) : undefined;
  if (result.over && entered && result.countedCents - entered.amountCents <= CONTRIBUTION.lineCents) {
    await tellFounderOfLargeTotal(tx, { contributorId, hostId, countedCents: result.countedCents, paymentId: entered.id });
  }
  if (result.markHeld.length > 0) await tx.update(pays).set({ thirtyDayMark: true, updatedAt: now }).where(and(inArray(pays.id, result.markHeld), eq(pays.thirtyDayMark, false)));
  // A payment that was taken before the line was crossed, and whose share now waits 30 days, carries the mark too:
  // the founder's list shows every payment the rule touches.
  if (result.thirtyDays.length > 0) await tx.update(pays).set({ thirtyDayMark: true }).where(and(inArray(pays.id, result.thirtyDays), eq(pays.thirtyDayMark, false)));
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

/**
 * Whether a try to hold this payment's amount on the saved card was ever started, whatever became
 * of it: one that is still on its way to Stripe counts. A payment like that is never treated as
 * "nobody has tried yet".
 */
export async function everTried(reader: Pick<Tx, "select">, paymentId: string): Promise<boolean> {
  const [started] = await reader.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.contributionPaymentId, paymentId), eq(schema.moneyOperations.kind, "hold"))).limit(1);
  return Boolean(started);
}

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
  const shareWritten = await writeWhatFollows();
  // The second of the rule's three moments: the money is taken. Whatever becomes of it (the host's share, or all
  // of it owed back), it is money this person paid, and it counts for the pair from this moment. (Money that was
  // held was counted already; money taken without a hold of ours enters the count here.)
  await countPair(tx, contribution.contributorId, contribution.hostId, at, payment.status === "held" ? undefined : payment.id);
  // A contribution made once, and a tip, have nothing more to come.
  if (shareWritten && contribution.kind !== "monthly" && contribution.status !== "ended") {
    await tx.update(schema.contributions).set({ status: "ended", endedAt: at, endedHow: "paid", updatedAt: at }).where(eq(schema.contributions.id, contribution.id));
  }

  /** The host's share, or what stands in its place. Returns whether the share was written. */
  async function writeWhatFollows(): Promise<boolean> {
    if (taken.cents !== payment.amountCents) return false;
    if (rightful && !chargeId) {
      // A share's line must name the charge its transfer comes from. Without one nothing is written for the host, and the founder is shown it.
      await tx.update(pays).set({ problem: "Stripe did not name the charge of this payment, so nothing was written for the host. Please settle it by hand.", updatedAt: at }).where(eq(pays.id, payment.id));
      return false;
    }

    if (!rightful) {
      // Taken although it was given up or never accepted: all of it goes back. The line is what makes it owed.
      await tx
        .insert(schema.contributionRefunds)
        .values({ contributionPaymentId: payment.id, sourceKey: `late:${payment.id}`, amountCents: taken.cents, decidedBy: "app", reason: "This payment went through although it had been cancelled, so all of it is paid back." })
        .onConflictDoNothing();
      return false;
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
        // A payment the founder released while it was still held keeps to that: it waits the usual 7 days.
        transferDueAt: split.hostShareCents > 0 ? collectFrom(at, payment.thirtyDayMark && payment.founderHold !== "released") : null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.payments.id });
    if (share) {
      // No "charged to the contributor" line here: the contribution's payment has the only one.
      await addLedgerEntry(tx, { paymentId: share.id, kind: "platform_fee", amountCents: split.feeCents, stripeRef: chargeId, note: "contribution" });
      await addLedgerEntry(tx, { paymentId: share.id, kind: "host_share", amountCents: split.hostShareCents, stripeRef: chargeId, note: "contribution" });
    }
    return true;
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
  // The contributor is told, with the link to pay: once for each try that failed.
  await queuePaymentFailedEmail(tx, locked.contribution, payment, { failedTry: payment.try, needsAction: input.needsAction, giveUpAt: giveUpAt(firstFailedAt) });
}

/**
 * A payment whose hold is certainly gone, or that never had one, becomes "given up" for good, with
 * the payment locked. Only here is "nothing was charged" said to its contributor (plans/25,
 * "Nothing is claimed before it is known").
 */
async function markGivenUp(tx: Tx, payment: ContributionPayment, at: Date): Promise<void> {
  await tx.update(pays).set({ status: "given_up", updatedAt: at }).where(eq(pays.id, payment.id));
  const [contribution] = await tx.select().from(schema.contributions).where(eq(schema.contributions.id, payment.contributionId));
  const [now] = await tx.select().from(pays).where(eq(pays.id, payment.id));
  if (contribution && now) await queueNothingChargedEmail(tx, contribution, now);
}

/** Why a hold that has arrived cannot be accepted, or null if it can. */
async function whyNotAccept(tx: Tx, locked: LockedPayment, intent: Stripe.PaymentIntent, authorisedAt: Date): Promise<string | null> {
  const { contribution, payment } = locked;
  if (intent.amount !== payment.amountCents || intent.metadata?.contributionPaymentId !== payment.id) return "card_step";
  if (contribution.status === "ended") return "ending";
  if (payment.cardStepExpiresAt && authorisedAt > payment.cardStepExpiresAt) return "card_step";
  // The 7 days count by the bank's own time too: a hold placed in time counts when it is found late, one placed after them does not.
  if (payment.giveUpAt && authorisedAt > payment.giveUpAt) return "given_up";
  // A month nobody had tried to pay, paid by hand more than 7 days after its day: it was missed (rules.ts, monthMissed).
  if (monthMissed(contribution, payment, authorisedAt) && !(await everTried(tx, payment.id))) return "missed";
  if (!(await takingOnFor(contribution, tx))) return "switch";
  // A tip has no project. A contribution's project must still be running.
  if (contribution.projectId) {
    const [project] = await tx.select({ status: schema.projects.status }).from(schema.projects).where(eq(schema.projects.id, contribution.projectId));
    if (project?.status !== "running") return "ending";
  }
  return null;
}

/**
 * Reads the payment's PaymentIntent at Stripe and records what it shows. Called by the direct
 * answer of every step, by Stripe's messages and by the helper; never moves a payment backwards.
 */
export async function syncPayment(paymentId: string, now: Date = new Date()): Promise<ContributionPayment> {
  return (await lookAndRecord(paymentId, now)).payment;
}

/**
 * The same look, also giving back what Stripe showed in the answer that was recorded. For a caller
 * that has to decide something from that very answer: asking Stripe a second time would be
 * deciding from an answer that was never recorded.
 *
 *   a status       Stripe's answer, and it was recorded
 *   "unrecorded"   Stripe was asked, and no answer could be recorded (the payment kept changing
 *                  underneath the look): nothing is known, and nothing must be decided from this
 *   null           there is no answer of Stripe to decide from, and the payment given back says
 *                  why: nothing at Stripe to ask about, already in the books for good (also
 *                  when another step got it there between two looks), or Stripe does not know
 *                  the payment, which is written on it as a problem
 */
export async function lookAndRecord(paymentId: string, now: Date): Promise<{ payment: ContributionPayment; shown: Stripe.PaymentIntent.Status | "unrecorded" | null }> {
  let shown: Stripe.PaymentIntent.Status | "unrecorded" | null = null;
  // Stripe is asked outside the database step. If our payment moved on in between, what we read is old:
  // it is thrown away and Stripe is asked again.
  for (let round = 0; round < 3; round++) {
    const seen = await paymentById(paymentId);
    if (!seen) throw new MoneyError("Payment not found.");
    // A payment that is in the books is never touched again, whatever message arrives.
    if (!seen.stripePaymentIntentId || seen.status === "taken" || seen.status === "given_up") return { payment: seen, shown: null };
    const readAt = new Date(); // the real clock, taken before Stripe is asked
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe().paymentIntents.retrieve(seen.stripePaymentIntentId, { expand: ["latest_charge", "payment_method"] });
    } catch (error) {
      // Any other failure is passed on, and whoever asked tries again later. But when Stripe is certain that it has
      // no such payment, asking again never helps: the payment is set aside for the founder, who is shown it, so it
      // does not stay "to be paid" for ever (and keep that person's shares from being collected).
      if ((error as { code?: string } | null)?.code !== "resource_missing") throw error;
      await db
        .update(pays)
        .set({ problem: "Stripe does not know this payment (its PaymentIntent is missing there). Nothing can be held or taken through it. Please look at it.", updatedAt: now })
        .where(and(eq(pays.id, paymentId), isNull(pays.problem), inArray(pays.status, ["to_pay", "held"])));
      return { payment: (await paymentById(paymentId))!, shown: null };
    }
    shown = "unrecorded";
    let holdEndsAt = holdEndOf(chargeOf(intent));
    // When Stripe does not say when a hold ends, it is asked again. No date is ever assumed (plans/25, choice 10).
    if (intent.status === "requires_capture" && !holdEndsAt) {
      const chargeId = chargeIdOf(intent);
      if (chargeId) holdEndsAt = holdEndOf(await stripe().charges.retrieve(chargeId));
    }
    if (await recordIntent(seen, intent, now, { readAt, holdEndsAt })) {
      // Only an answer that was recorded is given back: one that was thrown away as stale says nothing.
      shown = intent.status;
      break;
    }
  }
  return { payment: (await paymentById(paymentId))!, shown };
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
    // The moment of a taking is read here, after Stripe has answered (plans/25, choice 11), never the moment this look began.
    const taken = () => applyTaken(tx, locked, { cents: intent.amount_received, chargeId: chargeIdOf(intent) }, freshNow(now));

    // --- We are letting it go, or already have.
    if (payment.endedHow) {
      // A hold that is seen here for the first time (it arrived after the payment was given up) is kept as a hold
      // that was there, so that its contributor is told when it is gone.
      const bankTime = charge?.created ? new Date(charge.created * 1000) : null;
      const heldAt = intent.status === "requires_capture" ? (bankTime ?? now) : intent.status === "canceled" && charge?.status === "succeeded" ? bankTime : null;
      if (!payment.authorisedAt && heldAt) await tx.update(pays).set({ authorisedAt: heldAt }).where(eq(pays.id, payment.id));
      // A payment can be given up while its monthly contribution goes on (the founder's switch, a paused account:
      // plans/54). If the bank's answer to this very payment was "never try this card again", that still counts:
      // the contribution ends, as it would have, so that no later month tries the same card.
      const lastRefusal = intent.last_payment_error;
      if (locked.contribution.kind === "monthly" && locked.contribution.status === "running" && lastRefusal?.decline_code && NEVER_AGAIN.has(lastRefusal.decline_code)) {
        const { endInStep } = await import("./ending");
        await endInStep(tx, locked.contribution, "never_again", now);
      }
      if (intent.status === "canceled") await markGivenUp(tx, payment, now);
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
        await markGivenUp(tx, payment, now);
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
      if (!why && !read.holdEndsAt) {
        // Stripe did not say when this hold ends, also when asked again. No date is assumed: the hold is let go, and the founder is shown it.
        // (Looked at before the card: a hold that is not accepted never changes the contribution's card.)
        await tx.update(pays).set({ problem: "Stripe did not say when this payment's hold ends, so it was let go and nothing was taken.", updatedAt: now }).where(eq(pays.id, payment.id));
        why = "no_hold_end";
      }
      // A tip is paid with a card that was typed for it (plans/44, decision 7). A card that is saved for a booking, a
      // membership or a contribution is that one's alone: a hold placed on it for a tip is not accepted, and is let go
      // below. Asked of Stripe (a booking's card we have not heard of yet) and of our own lines by the card's id, which
      // also know a card that was removed at Stripe in this very moment. It has a reason of its own, so that the person
      // is not told that they were late.
      if (!why && contribution.kind === "tip" && method && (bookingsCard || (await savedForSomething(tx, method.id)))) why = "saved_card";
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
      if (why) {
        // Not accepted, and let go below. That a hold was there is kept all the same (the bank's own time for
        // it): its contributor is told when it is gone, and nobody is told that nothing was ever held.
        await tx.update(pays).set({ authorisedAt, updatedAt: now }).where(eq(pays.id, payment.id));
        await giveUpInStep(tx, locked, why, now);
        if (why === "missed") {
          // The month is skipped, and the contribution goes on.
          const [after] = await tx.select().from(schema.contributions).where(eq(schema.contributions.id, contribution.id));
          if (after.status !== "ended") await addSkipped(tx, after, [payment.number], now);
        }
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
      // The first of the rule's three moments: a hold is accepted. Counted at this moment, not at the one this look
      // began: a taking that has left the 30 days meanwhile no longer counts.
      await countPair(tx, contribution.contributorId, contribution.hostId, freshNow(now), payment.id);
      // The one email for this payment: the amount, the moment the money is taken, and how to cancel before then.
      await queueHoldEmail(tx, contribution, { id: payment.id, amountCents: payment.amountCents, takeAt: timing.takeAt });
      if (payment.number === 1) {
        // With its first hold a contribution has begun: the host is told once, and a monthly contributor gets what they agreed to.
        await queueNewContributorEmail(tx, contribution);
        await queueAgreementEmail(tx, contribution);
      }
      return;
    }
    if (intent.status === "succeeded") {
      // Cannot come from our code, which only takes a held payment. Recorded, and all of it is owed back.
      await giveUpInStep(tx, locked, "cancelled_at_stripe", now);
      const [again] = await tx.select().from(pays).where(eq(pays.id, payment.id));
      await applyTaken(tx, { contribution, payment: again }, { cents: intent.amount_received, chargeId: chargeIdOf(intent) }, freshNow(now));
      return;
    }
    if (intent.status === "canceled") {
      // Cancelled at Stripe, not by us. If the cancelled payment shows that a hold was in place before (one we had
      // not heard of yet), that is kept as a hold that was there, as everywhere else: its contributor is told that
      // nothing was charged, and is not counted as someone who never contributed.
      const heldAt = charge?.status === "succeeded" && charge.created ? new Date(charge.created * 1000) : null;
      if (heldAt) await tx.update(pays).set({ authorisedAt: heldAt }).where(eq(pays.id, payment.id));
      await giveUpInStep(tx, locked, "cancelled_at_stripe", now);
      await markGivenUp(tx, payment, now);
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
  if (!contribution || contribution.status === "ended" || !(await takingOnFor(contribution))) return seen;
  // A month that was written down and never tried (the helper stopped in between) is not tried once its day lies
  // more than 7 days back: it is missed, like a month that was never written down (rules.ts, dueMonths). It is
  // skipped, and the contribution goes on. A month that was tried and failed has its own 7 days, from that failure.
  // (A try that was started, also one still on its way to Stripe, is a try: its outcome is found out as usual.)
  if (monthMissed(contribution, seen, freshNow(now)) && !(await everTried(db, paymentId))) {
    // Past its 7 days nothing is tried any more. It is given up a little later (rules.ts, missedGraceMs), once a
    // hold that the contributor placed by hand inside the 7 days has certainly been seen; until then it waits.
    if (!monthMissed(contribution, seen, new Date(freshNow(now).getTime() - CONTRIBUTION.missedGraceMs))) return seen;
    return missMonth(paymentId, now);
  }
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
        // Checked here, right before acting: nothing new is started after a stop, or between two people who
        // may no longer deal with each other (the steps that cause that end the contribution themselves).
        const { whyMustEnd } = await import("./ending");
        if (current.status === "ended" || !(await takingOnFor(current, tx)) || (await whyMustEnd(tx, current))) throw new MoneyError("This contribution is not taking payments now.");
        if (await tryFinished(tx, payment)) throw new MoneyError("This try already has its answer.");
        // The 7 days for a month nobody has tried yet are looked at again here, by the real clock, where the try is
        // written down: a round that began in time and got here late does not start one.
        if (monthMissed(current, payment, freshNow(now)) && !(await everTried(tx, payment.id))) throw new MoneyError("This month's day lies more than 7 days back. Nothing was tried.");
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

/**
 * A month's payment that the helper came too late for: given up as missed, with nothing ever asked
 * of the card for it, and recorded as skipped. The contribution goes on with its next month.
 */
async function missMonth(paymentId: string, now: Date): Promise<ContributionPayment> {
  // Stripe is asked once more, now that the 7 days are over: a hold the contributor placed by hand in time, and
  // that an earlier look was too early to see, is found here and accepted by the bank's own time for it. Only a
  // payment that is still without a hold after this look is given up as missed.
  const { payment: looked, shown } = await lookAndRecord(paymentId, now);
  // A payment Stripe is still working on has no outcome yet: a hold with a bank time inside the 7 days may be
  // about to appear. Nothing is decided until it has one. (Giving it up now would cancel it, and a hold that was
  // let go cannot be brought back.) This is judged from the very answer that was just recorded: an answer that
  // shows a hold was accepted or refused by that look, and the step below then finds nothing left to give up.
  // The same goes for a look whose answer could not be recorded at all: nothing is known, so nothing is decided.
  if (looked.status === "to_pay" && open(looked) && (shown === "processing" || shown === "unrecorded")) {
    // Looked at again in five minutes, so that such a payment never fills the helper's rounds. Nothing else about
    // it is changed: it stays an ordinary payment that is waiting, so every look at Stripe, and the collection's
    // own look before it counts, still record what becomes of it. If it waits like this for more than a day, the
    // watch says so (health.ts). (Not a payment that was given up meanwhile.)
    await db.update(pays).set({ nextTryAt: new Date(freshNow(now).getTime() + LOOK_AGAIN_AT_A_TRY_MS), updatedAt: now }).where(and(eq(pays.id, paymentId), eq(pays.status, "to_pay"), isNull(pays.endedHow), isNull(pays.problem)));
    return (await paymentById(paymentId))!;
  }
  await db.transaction(async (tx) => {
    const locked = await lockForPayment(tx, paymentId);
    // Looked at again under the locks: only a payment that is still waiting, that nobody has started to try (a try
    // on its way to Stripe keeps its own ending), and whose 7 days, and the short wait after them, are over by the real clock.
    if (locked.payment.status !== "to_pay" || !open(locked.payment)) return;
    if (!monthMissed(locked.contribution, locked.payment, new Date(freshNow(now).getTime() - CONTRIBUTION.missedGraceMs)) || (await everTried(tx, paymentId))) return;
    await giveUpInStep(tx, locked, "missed", now);
    const [contribution] = await tx.select().from(schema.contributions).where(eq(schema.contributions.id, locked.contribution.id));
    if (contribution.kind === "monthly" && contribution.status !== "ended") await addSkipped(tx, contribution, [locked.payment.number], now);
  });
  // If a PaymentIntent was made for it, it is cancelled; if one was asked for and not saved, the helper finishes that.
  await letGo(paymentId, now).catch((error) => log(`could not let go of missed contribution payment ${paymentId} yet; the helper will retry`, error));
  return (await paymentById(paymentId))!;
}

// ---------------------------------------------------------------------------
// Taking the money
// ---------------------------------------------------------------------------

/**
 * Takes the held money, whole. `mayTake` is asked with the clock read at that moment, right
 * before Stripe is asked, so nothing is taken early, late, or after a stop. A hold whose last
 * moment has passed is given up as "not taken in time" and let go. A `now` that is handed in (the
 * start of the helper's round, or a check script's pretended day) never stands for a moment
 * earlier than the real clock. The clock is looked at three times: before anything is written
 * down, with the payment locked, and once more at the very moment before Stripe is asked.
 */
export async function takePayment(paymentId: string, now?: Date, test?: { beforeDispatch?: () => Promise<void> }): Promise<ContributionPayment> {
  // Read afresh each time it is asked: the moment handed in may be the start of a helper's round that has run long.
  const clock = () => freshNow(now);
  const seen = await paymentById(paymentId);
  if (!seen) throw new MoneyError("Payment not found.");
  if (seen.status !== "held" || !open(seen)) return seen;
  if (seen.takeBy && clock() > seen.takeBy) return giveUp(paymentId, "not_taken_in_time", clock());
  try {
    await runOwnedOperation<LockedPayment, { intentId: string; amountCents: number; takeByMs: number }, { chargeId: string | null; amountReceived: number }>({
      owner: paymentOwner(paymentId),
      kind: "capture",
      labelBase: `contributioncapture:${paymentId}`,
      prepare: async ({ contribution, payment }, tx) => {
        if (!payment.stripePaymentIntentId || !payment.takeBy || !mayTake(payment, clock())) throw new MoneyError("This payment's money may not be taken now.");
        if (!(await takingOnFor(contribution, tx))) throw new MoneyError(contribution.kind === "tip" ? "Tips are switched off, so nothing is taken." : "Contributions to this host are switched off, so nothing is taken.");
        return { intentId: payment.stripePaymentIntentId, amountCents: payment.amountCents, takeByMs: payment.takeBy.getTime() };
      },
      execute: async (params, label) => {
        // (Only the check script passes this, to let the last moment go by between the decision and the request.)
        await test?.beforeDispatch?.();
        // A stop that came after the taking was written down (the contributor cancelled, the contribution ended):
        // Stripe is not asked, and the letting-go that the stop began goes on.
        const current = await paymentById(paymentId);
        if (!current || current.status !== "held" || !open(current)) throw new NotSentError("This payment was stopped, so Stripe was not asked to take its money.");
        // The last look at the clock, with everything else done: writing the action down and saving it take time
        // too. The very next thing that happens is the request to Stripe.
        if (clock().getTime() > params.takeByMs) throw new NotSentError("The last moment to take this payment's money has passed, so Stripe was not asked.");
        return captureAtStripe(params.intentId, params.amountCents, label);
      },
      // The clock is read here, after Stripe has answered.
      apply: (locked, _params, outcome, tx) => applyTaken(tx, locked, { cents: outcome.result.amountReceived, chargeId: outcome.result.chargeId }, clock()),
      // Not sent because it was too late, or refused by Stripe when it already was: the payment is given up in this same step.
      onRefused: async (locked, params, _message, tx) => {
        if (clock().getTime() > params.takeByMs) await giveUpInStep(tx, locked, "not_taken_in_time", clock());
      },
    });
  } catch (error) {
    if (error instanceof OutcomeUnknownError) return (await paymentById(paymentId))!;
    if (!(error instanceof MoneyError)) throw error;
    // Refused, by us or by Stripe (usually the hold is gone). Record how things really stand; a payment that was just given up is let go by that.
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
 * Gives a payment up only if it is still waiting for a card at this moment, asked with the payment
 * locked. For a card step whose time is over: between the look at Stripe that found no hold and
 * this step, a message from Stripe or the customer's own page may have recorded a hold that was
 * placed in time. That hold stays; a plain `giveUp` would cancel it. Returns the payment as it is.
 */
export async function giveUpIfWaiting(paymentId: string, how: string, now: Date = new Date()): Promise<ContributionPayment> {
  const gaveUp = await db.transaction(async (tx) => {
    const locked = await lockForPayment(tx, paymentId);
    if (locked.payment.status !== "to_pay" || !open(locked.payment)) return false;
    return giveUpInStep(tx, locked, how, now);
  });
  if (gaveUp) await letGo(paymentId, now).catch((error) => log(`could not let go of contribution payment ${paymentId} yet; the helper will retry`, error));
  return (await paymentById(paymentId))!;
}

/**
 * The first half of giving a payment up, inside a database step the caller owns, with the payment
 * locked: the reason is saved. A contribution whose only payment this is ends with it (one made
 * once; a tip; a monthly one that never got its first hold). The caller lets the hold go after its step
 * is saved (letGo); if it does not get that far, the helper does. Returns whether this call is
 * the one that gave it up.
 */
export async function giveUpInStep(tx: Tx, locked: LockedPayment, how: string, now: Date): Promise<boolean> {
  const { contribution, payment } = locked;
  if ((payment.status !== "to_pay" && payment.status !== "held") || payment.endedHow) return false;
  await tx.update(pays).set({ endedHow: how, nextTryAt: null, updatedAt: now }).where(eq(pays.id, payment.id));
  if (contribution.status !== "ended" && (contribution.kind !== "monthly" || contribution.status === "card_step")) {
    await tx.update(schema.contributions).set({ status: "ended", endedAt: now, endedHow: how, updatedAt: now }).where(eq(schema.contributions.id, contribution.id));
    await retireCard(tx, contribution.id, now);
  }
  return true;
}

/** Records how a letting-go ended: taken in that very moment (owed back in full), or the cancellation is finished. */
export async function applyLetGo(tx: Tx, locked: LockedPayment, result: { status: string; amountReceived: number; chargeId: string | null; heldAt?: number | null }, at: Date): Promise<void> {
  if (result.status === "succeeded") return applyTaken(tx, locked, { cents: result.amountReceived, chargeId: result.chargeId }, at);
  if (locked.payment.status !== "to_pay" && locked.payment.status !== "held") return;
  // Stripe's answer to the cancellation says whether a hold was in place on this payment. One that we had not
  // heard of (the contributor paid, and the payment was given up before the news reached us) is kept as a hold
  // that was there, so that its contributor is told that it is gone.
  if (!locked.payment.authorisedAt && result.heldAt) await tx.update(pays).set({ authorisedAt: new Date(result.heldAt * 1000) }).where(eq(pays.id, locked.payment.id));
  await markGivenUp(tx, locked.payment, at);
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
    await runOwnedOperation<LockedPayment, { intentId: string }, { status: string; amountReceived: number; chargeId: string | null; heldAt: number | null }>({
      owner: paymentOwner(paymentId),
      kind: "release",
      labelBase: `contributionrelease:${paymentId}`,
      prepare: async ({ payment }) => {
        if (!payment.endedHow || !payment.stripePaymentIntentId || payment.status === "taken" || payment.status === "given_up") throw new MoneyError("This payment is not being given up.");
        return { intentId: payment.stripePaymentIntentId };
      },
      execute: (params, label) => cancelAtStripe(params.intentId, label),
      apply: (locked, _params, outcome, tx) => applyLetGo(tx, locked, outcome.result, freshNow(now)),
    });
  } catch (error) {
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) log(`letting go of contribution payment ${paymentId}`, error);
    else throw error;
  }
}
