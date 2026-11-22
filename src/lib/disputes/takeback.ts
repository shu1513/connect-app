/**
 * Taking a share back from a host after a lost bank dispute (plans/47-bank-disputes.md, decision
 * 10 and part 3). The rules are in takeback-rules.ts, the words in takeback-words.ts.
 *
 * A host can collect their share of a payment before the customer's bank disputes it. If the
 * dispute is lost, the bank has taken the money from Connect and the host still has their share.
 * The helper then, every pass:
 *   1. finds what is owed: for every lost dispute, every share under it that was really sent and
 *      has no row yet gets one, with the amount worked out from what Stripe shows at that moment,
 *      and the host is told in writing (and the founder by email);
 *   2. brings rows up to date when the bank decided the other way after all;
 *   3. gives each take-back its due day once its notice has really gone out by email: 14 days after
 *      the sending service accepted it (plans/46-part-3-money-owed.md, decision 6). A notice that
 *      did not arrive leaves it without a day, and the founder is told;
 *   4. takes what is due: a money action of its own kind ("take_back") on the share's payment asks
 *      Stripe to reverse that amount of that transfer;
 *   5. tells the founder when Stripe has refused for 30 days.
 *
 * The host can say "I think this is wrong" while the take-back has its notice. It is then
 * "objected" and nothing is taken until the founder has decided: call it off, or answer in
 * writing and have it taken after all ("answered"), no earlier than the first due day and 3 days
 * after that answer went out.
 *
 * The order of locks: the share's payment first (the money action locks it, and so does every step
 * here), then the take-back's row. A dispute is read here and never locked.
 *
 * A reversal cannot be undone by the app, so it goes through the steps every money action takes
 * (operations.ts): written down under a label, asked of Stripe with that label, recorded. A row is
 * "taking" exactly while its action is unanswered; every way that action can end as "not done"
 * puts the row back to where it stood ("told", or "answered") in the same step.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Dispute, HostDebt, Refund } from "@/db/schema";
import { currentVersion, dayOf as dayOfVersion } from "@/legal/versions";
import { whenFor } from "@/lib/booking/emails";
import { errorSummary, queueEmail } from "@/lib/email";
import { appUrl, tell } from "@/lib/messages/messages";
import { formatMoney } from "@/lib/payments/access";
import { currentSplit } from "@/lib/payments/actions";
import { inTime } from "@/lib/payments/disputes";
import { addLedgerEntry, failOwnedOperation, finishOperation, lockPayment, MoneyError, OutcomeUnknownError, runMoneyOperation, type OperationPlan, type Tx } from "@/lib/payments/operations";
import { splitAfterRefunds } from "@/lib/payments/pricing";
import { stripe } from "@/lib/payments/stripe";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { aboutOwner, disputePath, ownerOf, peopleFor, type Only } from "./record";
import { outcomeOf } from "./status";
import { canAnswer, canCancel, canHold, canObject, canSettle, CONFIRM_WITHIN_MS, dueDay, dueToTake, leftAfterRefunds, OPEN, owedCents, refundOwes, RESERVED, roomOn, stateBeforeTaking, TAKEABLE, takebackLabel, tellFounderOfRefusals } from "./takeback-rules";
import {
  answeredWords,
  cancelledWords,
  handCountedWords,
  handHeldWordsForFounder,
  leftoverWords,
  notDeliveredWords,
  noticeAgainWords,
  objectedWords,
  objectedWordsForFounder,
  owedWords,
  owedWordsForFounder,
  refundCancelledWords,
  refundFellAwayWords,
  refundFellAwayWordsForFounder,
  refundOwedWords,
  refundOwedWordsForFounder,
  refundRefusedWords,
  refundTakenWords,
  refundWaitingWords,
  refundWaitingWordsForFounder,
  refusedWords,
  settledWords,
  takenWords,
  type DebtFacts,
} from "./takeback-words";

const debts = schema.hostDebts;

/** What the amount was worked out from, kept with the row. */
export type Basis = {
  /** What the sum starts from: what was sent, less what her share had already lost to refunds given after the sending. */
  sentCents: number;
  disputedCents: number;
  chargeLeftCents: number;
  transferLeftCents: number;
  othersOpenCents: number;
  sameDisputeCents: number;
  /** What was really sent, and what refunds after the sending had taken off her share. Rows from before these were kept have neither: for them `sentCents` is what was sent. */
  transferCents?: number;
  refundsTookCents?: number;
};
/** The same for a take-back that comes from a refund: what was sent, what the share lost to this refund and to the ones before it, and the room. */
export type RefundBasis = { sentCents: number; reductionCents: number; reductionsBeforeCents: number; transferLeftCents: number; othersOpenCents: number; repaidOutsideCents: number };

/** What the money action carries: enough to send the very same request again. */
export type TakeParams = { debtId: string; transferId: string; amountCents: number };

const log = (what: string, error: unknown) => console.error(`[disputes] ${what} (${errorSummary(error)}); will retry`);

type Reader = Pick<typeof db, "select">;

/**
 * What a take-back comes from: a lost bank dispute (plan 47), or a refund Connect gave after the host had collected
 * (plans/46-part-3-money-owed.md). The row names exactly one of the two.
 */
export type Cause = Dispute | Refund;
const isRefund = (cause: Cause): cause is Refund => "afterCollection" in cause;

/** The cause of one take-back, read afresh. Null when it is gone. */
async function causeOf(reader: Reader, debt: Pick<HostDebt, "disputeId" | "refundId">): Promise<Cause | null> {
  if (debt.refundId) return (await reader.select().from(schema.refunds).where(eq(schema.refunds.id, debt.refundId)))[0] ?? null;
  if (debt.disputeId) return (await reader.select().from(schema.disputes).where(eq(schema.disputes.id, debt.disputeId)))[0] ?? null;
  return null;
}

/** The page of a take-back that has no dispute's page to be shown on: for its host and for the founder. */
export const debtPath = (debtId: string) => `/debts/${debtId}`;
const pathOf = (debt: Pick<HostDebt, "id">, cause: Cause) => (isRefund(cause) ? debtPath(debt.id) : disputePath(cause.id));

/** For check scripts: only the take-backs of these disputes and refunds. */
const within = (only?: Only): SQL | undefined => (only ? or(inArray(debts.disputeId, only.disputeIds), inArray(debts.refundId, only.refundIds ?? []))! : undefined);

// ---------------------------------------------------------------------------
// Telling people
// ---------------------------------------------------------------------------

/** The people of a take-back and the words' facts for each reader. Null when the money or the people are gone. */
async function tellingFor(tx: Tx, debt: Pick<HostDebt, "amountCents" | "dueAt" | "basis">, cause: Cause) {
  const about = await aboutOwner(tx, isRefund(cause) ? { kind: "payment", id: cause.paymentId } : ownerOf(cause));
  if (!about) return null;
  const people = await peopleFor(tx, about);
  if (!people) return null;
  const basis = JSON.parse(debt.basis) as Partial<Basis>;
  // What the sum starts from, and what was really sent: two numbers where refunds after the sending came first.
  const sent = basis.sentCents ?? debt.amountCents;
  const reallySent = basis.transferCents ?? sent;
  const whole = !basis.chargeLeftCents || !basis.disputedCents || basis.disputedCents >= basis.chargeLeftCents;
  const part = whole ? sent : Math.floor((sent * basis.disputedCents!) / basis.chargeLeftCents!);
  const names = { host: people.hostName, customer: people.customer.name };
  const facts = (role: "host" | "founder", person: { timeZone: string | null }): DebtFacts => ({
    what: about.what(role, person, names),
    amount: formatMoney(debt.amountCents),
    sent: formatMoney(reallySent),
    afterRefunds: reallySent > sent ? { took: formatMoney(reallySent - sent), left: formatMoney(sent) } : null,
    part: whole ? null : { disputed: formatMoney(basis.disputedCents!), of: formatMoney(basis.chargeLeftCents!) },
    // Less than that part, and why: no more is owed than the bank took back, or no more is left of the transfer.
    capped: debt.amountCents >= part ? null : debt.amountCents >= Math.max(0, (basis.disputedCents ?? 0) - (basis.sameDisputeCents ?? 0)) ? "bank" : "transfer",
    dueOn: debt.dueAt ? whenFor(person, debt.dueAt) : null,
    hostName: people.hostName,
    customerName: people.customer.name,
    supportEmail: SUPPORT_EMAIL,
    ...(isRefund(cause)
      ? {
          refund: {
            refunded: formatMoney(cause.amountCents),
            shareBefore: formatMoney(cause.shareBeforeCents ?? 0),
            shareAfter: formatMoney(cause.shareAfterCents ?? 0),
            reason: cause.reason?.trim() || "Connect decided it in the host's place.",
            cutShort: debt.amountCents < cause.hostOwesCents,
          },
        }
      : {}),
  });
  return { people, facts };
}

/**
 * One message to the host (in the app and by email, as a pair) under a key of this take-back. Gives back the email's
 * own number, for the two messages whose sending starts a count of days (the notice, the answer to an objection).
 */
async function tellHost(tx: Tx, debt: HostDebt, cause: Cause, what: string, words: (facts: DebtFacts) => { subject: string; text: string }): Promise<string | null> {
  const telling = await tellingFor(tx, debt, cause);
  if (!telling) return null;
  const told = words(telling.facts("host", telling.people.host));
  const key = `takeback:${debt.id}:${what}:host:${telling.people.host.id}`;
  await tell(tx, { to: telling.people.host, key, subject: told.subject, text: told.text, path: pathOf(debt, cause) });
  // The email that pairs with the message is written under the same key (messages.ts).
  const [email] = await tx.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, key));
  return email?.id ?? null;
}

/** One email to each admin. What the founder is told names both people, so it is not on the Messages page. */
async function tellFounders(tx: Tx, debt: HostDebt, cause: Cause, what: string, words: (facts: DebtFacts) => { subject: string; text: string }): Promise<number> {
  const telling = await tellingFor(tx, debt, cause);
  if (!telling) return 0;
  for (const founder of telling.people.founders) {
    const told = words(telling.facts("founder", founder));
    await queueEmail(tx, { to: founder.email, key: `takeback:${debt.id}:${what}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\n${isRefund(cause) ? "The take-back's page" : "The dispute's page"} (admin login):\n${appUrl()}${pathOf(debt, cause)}\n` });
  }
  return telling.people.founders.length;
}

/** What her share of a payment lost to refunds given after it was sent to her: read from the refunds, never from the take-backs (decision 4). */
async function reductionsOn(reader: Reader, paymentId: string, before?: Refund): Promise<number> {
  const done = await reader.select().from(schema.refunds).where(and(eq(schema.refunds.paymentId, paymentId), eq(schema.refunds.afterCollection, true), eq(schema.refunds.status, "done")));
  // "Before" one refund: the ones with a smaller place among this payment's refunds after the sending. The place is
  // given when Stripe's confirmation is written down, with the payment held, so it never rests on a clock. (A line
  // without a place stands after every line that has one; among such lines the time and the number decide.)
  const place = (one: Refund): [number, number, string] => [one.afterCollectionNo ?? Number.MAX_SAFE_INTEGER, one.finishedAt?.getTime() ?? 0, one.id];
  const earlier = (a: Refund, b: Refund) => {
    const [x, y] = [place(a), place(b)];
    return x[0] !== y[0] ? x[0] < y[0] : x[1] !== y[1] ? x[1] < y[1] : x[2] < y[2];
  };
  return done.filter((one) => !before || (one.id !== before.id && earlier(one, before))).reduce((sum, one) => sum + one.hostOwesCents, 0);
}

/** Whether a refund of this payment is with Stripe and unanswered: nothing is worked out on a share while money is moving on it. */
async function refundUnderWay(reader: Reader, paymentId: string): Promise<boolean> {
  const [moving] = await reader.select({ id: schema.refunds.id }).from(schema.refunds).where(and(eq(schema.refunds.paymentId, paymentId), eq(schema.refunds.status, "in_progress"))).limit(1);
  return Boolean(moving);
}

// ---------------------------------------------------------------------------
// 1. Finding what is owed
// ---------------------------------------------------------------------------

/**
 * Every lost dispute and every share under it that was sent with a real transfer and has no row
 * yet. A look the helper repeats: a transfer that was under way when the loss arrived, and went
 * through later, is found on a later pass.
 */
async function sharesWithoutRow(only?: Only): Promise<Array<{ dispute: Dispute; paymentId: string }>> {
  const missing = (under: SQL) =>
    db
      .select({ dispute: schema.disputes, paymentId: schema.payments.id })
      .from(schema.disputes)
      .innerJoin(schema.payments, under)
      .where(
        and(
          eq(schema.disputes.outcome, "lost"),
          eq(schema.payments.transferStatus, "sent"),
          gt(schema.payments.transferCents, 0),
          isNotNull(schema.payments.stripeTransferId),
          notExists(db.select({ one: sql`1` }).from(debts).where(and(eq(debts.disputeId, schema.disputes.id), eq(debts.paymentId, schema.payments.id)))),
          only ? inArray(schema.disputes.id, only.disputeIds) : undefined,
        ),
      );
  // A call's card payment is its own share; a membership's month and a contribution's payment reach the host
  // through the payments under them.
  return [
    ...(await missing(eq(schema.payments.id, schema.disputes.paymentId))),
    ...(await missing(eq(schema.payments.monthId, schema.disputes.monthId))),
    ...(await missing(eq(schema.payments.contributionPaymentId, schema.disputes.contributionPaymentId))),
  ];
}

/**
 * Writes the row for one dispute and one share, with the share's payment held, and tells the host
 * and the founder. The amount is worked out in this step from what Stripe shows now. While another
 * take-back on the same share is being taken, this one waits for the next pass: the amount is only
 * worked out when nothing on that transfer is under way, so one reversal is never counted twice.
 * A share that owes nothing gets a row that says so, so that Stripe is not asked again every pass.
 */
async function writeDebt(dispute: Dispute, paymentId: string, now: Date): Promise<void> {
  const notLostAtStripe = await db.transaction(async (tx) => {
    const share = await lockPayment(tx, paymentId);
    // One dispute can reach several shares (a member's month pays for several calls). Their amounts are worked out
    // one after the other, never at the same moment: each must see what the others already owe. Taken after the
    // share's payment, and never the other way round, so two helpers on two shares cannot wait for each other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`takeback-dispute:${dispute.id}`}))`);
    if (share.transferStatus !== "sent" || !share.stripeTransferId || (share.transferCents ?? 0) <= 0) return false;
    const [current] = await tx.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, dispute.id));
    if (current?.outcome !== "lost") return false;
    const others = await tx.select().from(debts).where(eq(debts.paymentId, paymentId));
    if (others.some((other) => other.disputeId === dispute.id) || others.some((other) => other.status === "taking")) return false;
    // Nor while a refund of this payment is with Stripe and unanswered: both sides of the sum have to come from the
    // same confirmed refunds (plans/46-part-3-money-owed.md, decision 4).
    if (await refundUnderWay(tx, paymentId)) return false;
    // What other shares under the same dispute already owe or have paid back (a membership's month has several):
    // all of them together never owe more than the bank took back in this dispute.
    const sameDispute = await tx.select({ amountCents: debts.amountCents }).from(debts).where(and(eq(debts.disputeId, dispute.id), inArray(debts.status, [...OPEN, "taking", "taken"])));

    // Both reads at once, one try each, under one limit of time: the share's payment is held meanwhile.
    const [atStripe, transfer] = await inTime(
      Promise.all([stripe().disputes.retrieve(dispute.id, { expand: ["charge"] }, { maxNetworkRetries: 0 }), stripe().transfers.retrieve(share.stripeTransferId, {}, { maxNetworkRetries: 0 })]),
    );
    // Not lost at Stripe (an appeal, or decided the other way): nothing is written, and the record is read again.
    if (outcomeOf(atStripe.status) !== "lost") return true;
    // Without the charge, what was left of it is not known: nothing is worked out on a guess. The next pass asks again.
    const charge = typeof atStripe.charge === "string" ? null : atStripe.charge;
    if (!charge) return false;
    // For a call's own payment: Stripe's total of refunds on the charge has to be the app's. If Stripe knows of a
    // refund the app has not confirmed yet, the look waits for the app's record to catch up.
    if (dispute.paymentId === paymentId && charge.amount_refunded !== share.refundedCents) return false;
    const settledOutside = others.filter((other) => other.status === "settled").reduce((sum, other) => sum + (other.repaidCents ?? 0), 0);
    const reductions = await reductionsOn(tx, paymentId);
    const basis: Basis = {
      // What was sent, less what her share already lost to refunds given after the sending: a refund's take-back and
      // a dispute's never ask twice for the same money. With no such refund it is what was sent.
      sentCents: leftAfterRefunds(share.transferCents!, reductions),
      transferCents: share.transferCents!,
      refundsTookCents: Math.min(share.transferCents!, reductions),
      disputedCents: atStripe.amount,
      // What was left of the charge: what was taken, less what had been refunded.
      chargeLeftCents: charge.amount_captured - charge.amount_refunded,
      transferLeftCents: transfer.amount - transfer.amount_reversed,
      // Everything still set aside on this share (open or waiting for the founder), and what she paid back outside Stripe.
      othersOpenCents: others.filter((other) => RESERVED.includes(other.status)).reduce((sum, other) => sum + other.amountCents, 0) + settledOutside,
      sameDisputeCents: sameDispute.reduce((sum, other) => sum + other.amountCents, 0),
    };
    const amountCents = owedCents(basis);
    // When the notice is written, not when this pass began. The 14 days do not count from here: they count from the
    // notice email really going out, so the row has no due day yet (dateNotices gives it one).
    const toldAt = now.getTime() > Date.now() ? now : new Date();
    const [debt] = await tx
      .insert(debts)
      .values({ disputeId: dispute.id, paymentId, hostId: dispute.hostId, stripeTransferId: share.stripeTransferId, amountCents, currency: share.currency, basis: JSON.stringify(basis), status: amountCents > 0 ? "told" : "nothing", toldAt, dueAt: null })
      .onConflictDoNothing()
      .returning();
    if (!debt || amountCents === 0) return false;
    const noticeEmailId = await tellHost(tx, debt, dispute, "owed", owedWords);
    await tx.update(debts).set({ noticeEmailId }).where(eq(debts.id, debt.id));
    await tellFounders(tx, debt, dispute, "owed", owedWordsForFounder);
    return false;
  });
  // Written after the share's payment is let go: a dispute's row is never asked for while a payment is held.
  if (notLostAtStripe) await db.update(schema.disputes).set({ lookAgain: true }).where(eq(schema.disputes.id, dispute.id));
}

/**
 * A take-back was called off. Another dispute over the same share may have been told "nothing is owed" only because
 * this one had the amount set aside: those rows are taken away, so the next look works them out afresh (and writes a
 * notice of its own if something is owed after all). With the share's payment held.
 */
async function freeSetAside(tx: Tx, paymentId: string): Promise<void> {
  await tx.delete(debts).where(and(eq(debts.paymentId, paymentId), eq(debts.status, "nothing")));
  // A refund on this share that was looked at and got nothing is looked at again too.
  await tx
    .update(schema.refunds)
    .set({ debtLookedAt: null })
    .where(and(eq(schema.refunds.paymentId, paymentId), eq(schema.refunds.afterCollection, true), eq(schema.refunds.status, "done"), notExists(tx.select({ one: sql`1` }).from(debts).where(eq(debts.refundId, schema.refunds.id)))));
}

// ---------------------------------------------------------------------------
// 1b. What a refund makes her owe (plans/46-part-3-money-owed.md, decisions 3, 4 and 7)
// ---------------------------------------------------------------------------

/** Refunds that were given after the share had been sent, are confirmed, and have not been looked at: in the order they were confirmed. */
async function refundsWithoutRow(only?: Only): Promise<string[]> {
  const rows = await db
    .select({ id: schema.refunds.id })
    .from(schema.refunds)
    .where(and(eq(schema.refunds.afterCollection, true), eq(schema.refunds.status, "done"), isNull(schema.refunds.debtLookedAt), only ? inArray(schema.refunds.id, only.refundIds ?? []) : undefined))
    .orderBy(asc(schema.refunds.finishedAt), asc(schema.refunds.id));
  return rows.map((row) => row.id);
}

/**
 * The version of the Host Agreement that was in force for a payment, or null (decision 7): published (not a draft),
 * in effect at the moment Stripe gives for the charge, and accepted by this host before that second. An acceptance
 * in the very same second does not count: which came first cannot be shown.
 */
async function agreementInForce(reader: Reader, hostId: string, chargeAt: Date): Promise<string | null> {
  const version = currentVersion("host-agreement", chargeAt);
  if (version.draft || dayOfVersion(version.effectiveFrom).getTime() > chargeAt.getTime()) return null;
  const [line] = await reader
    .select({ acceptedAt: schema.agreementAcceptances.acceptedAt })
    .from(schema.agreementAcceptances)
    .where(and(eq(schema.agreementAcceptances.userId, hostId), eq(schema.agreementAcceptances.document, "host-agreement"), eq(schema.agreementAcceptances.version, version.version)));
  return line && line.acceptedAt.getTime() < Math.floor(chargeAt.getTime() / 1000) * 1000 ? version.version : null;
}

/**
 * Writes the take-back for one refund, with the share's payment held, and tells the host and the founder.
 *   - The amount: what this refund adds to what her share lost, never counted beyond what was sent, cut down to the
 *     room on the transfer (takeback-rules.ts, refundOwes).
 *   - Whether the app takes it by itself: only where the Host Agreement was in force for that payment. Otherwise the
 *     row says "waiting", has no due day, and the founder settles it.
 *   - Nothing is written while money is moving on the share (a reversal being taken, another refund with Stripe), or
 *     when Stripe cannot be asked: the next pass comes back. A passing fault never turns a take-back into one that
 *     waits for ever.
 */
async function writeRefundDebt(refundId: string, now: Date): Promise<void> {
  const [seen] = await db.select({ paymentId: schema.refunds.paymentId }).from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!seen) return;
  await db.transaction(async (tx) => {
    const share = await lockPayment(tx, seen.paymentId);
    const [refund] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).for("update");
    if (!refund || refund.status !== "done" || !refund.afterCollection || refund.debtLookedAt !== null) return;
    const looked = () => tx.update(schema.refunds).set({ debtLookedAt: now }).where(eq(schema.refunds.id, refund.id));
    const others = await tx.select().from(debts).where(eq(debts.paymentId, share.id));
    // Nothing to take back: her share lost nothing, or nothing was really sent for it (the collection charge ate it).
    if (others.some((other) => other.refundId === refund.id) || refund.hostOwesCents <= 0 || share.transferStatus !== "sent" || !share.stripeTransferId || (share.transferCents ?? 0) <= 0 || !share.callId) {
      await looked();
      return;
    }
    if (others.some((other) => other.status === "taking") || (await refundUnderWay(tx, share.id))) return;
    const [call] = await tx.select({ hostId: schema.calls.hostId }).from(schema.calls).where(eq(schema.calls.id, share.callId));
    if (!call) return;
    // Both reads at once, one try each, under one limit of time: the share's payment is held meanwhile. A failure
    // here throws, and nothing is written.
    const [transfer, charge] = await inTime(
      Promise.all([
        stripe().transfers.retrieve(share.stripeTransferId, {}, { maxNetworkRetries: 0 }),
        share.stripeChargeId
          ? stripe()
              .charges.retrieve(share.stripeChargeId, {}, { maxNetworkRetries: 0 })
              // Stripe says for good that it has no such charge: then there is no proof of the bank's time, and the
              // take-back waits for the founder (decision 7). Any other failure throws, and the next pass asks again.
              .catch((error: { code?: string }) => {
                if (error?.code === "resource_missing") return null;
                throw error;
              })
          : Promise.resolve(null),
      ]),
    );
    const intentOf = charge ? (typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null)) : null;
    const fits = charge !== null && intentOf !== null && intentOf === share.stripePaymentIntentId;
    // Stripe's total of refunds on the charge has to be the app's: if Stripe knows of a refund the app has not
    // confirmed (or the other way round), nothing is worked out from a history that is not whole. Not marked as
    // looked at: the next pass asks again.
    if (fits && charge!.amount_refunded !== share.refundedCents) return;
    const basis: RefundBasis = {
      sentCents: share.transferCents!,
      reductionCents: refund.hostOwesCents,
      reductionsBeforeCents: await reductionsOn(tx, share.id, refund),
      transferLeftCents: transfer.amount - transfer.amount_reversed,
      othersOpenCents: others.filter((other) => RESERVED.includes(other.status)).reduce((sum, other) => sum + other.amountCents, 0),
      repaidOutsideCents: others.filter((other) => other.status === "settled").reduce((sum, other) => sum + (other.repaidCents ?? 0), 0),
    };
    const amountCents = refundOwes({ ...basis, roomCents: roomOn({ transferLeftCents: basis.transferLeftCents, reservedCents: basis.othersOpenCents, repaidOutsideCents: basis.repaidOutsideCents }) });
    // The bank's hold, as near as it is recorded: Stripe's time for the charge that was held and then taken for this
    // payment, found by the number the app saved. A charge that does not fit the payment proves nothing.
    const chargeAt = fits ? new Date(charge!.created * 1000) : null;
    const agreementVersion = chargeAt ? await agreementInForce(tx, call.hostId, chargeAt) : null;
    const toldAt = now.getTime() > Date.now() ? now : new Date();
    const [debt] = await tx
      .insert(debts)
      .values({ refundId: refund.id, paymentId: share.id, hostId: call.hostId, stripeTransferId: share.stripeTransferId, amountCents, currency: share.currency, basis: JSON.stringify(basis), status: amountCents <= 0 ? "nothing" : agreementVersion ? "told" : "waiting", toldAt, dueAt: null, chargeAt, agreementVersion })
      .onConflictDoNothing()
      .returning();
    await looked();
    if (!debt || amountCents <= 0) return;
    if (debt.status === "told") {
      const noticeEmailId = await tellHost(tx, debt, refund, "owed", refundOwedWords);
      await tx.update(debts).set({ noticeEmailId }).where(eq(debts.id, debt.id));
      await tellFounders(tx, debt, refund, "owed", refundOwedWordsForFounder);
    } else {
      await tellHost(tx, debt, refund, "waiting", refundWaitingWords);
      await tellFounders(tx, debt, refund, "waiting", refundWaitingWordsForFounder);
    }
  });
}

// ---------------------------------------------------------------------------
// 2. The bank decided the other way after all
// ---------------------------------------------------------------------------

/**
 * A lost dispute that Stripe now shows as won. A take-back that only has its notice is called off
 * by itself. One that is being taken is left alone until its action is finished, and is then either
 * back at its notice (and called off here) or taken. One that was taken is not given back by the
 * app: the founder and the host are told, once.
 */
async function settleChanged(now: Date, only?: Only): Promise<void> {
  // Still open; or ended with something to put right: money she paid back (taken, by hand, or outside the app), or a
  // cost of Connect's that a waiver or a settlement had booked.
  const toPutRight = and(inArray(debts.status, ["taken", "settled", "cancelled"]), isNull(debts.leftoverToldAt), or(eq(debts.status, "taken"), gt(debts.costBookedCents, 0), gt(debts.byHandCents, 0), gt(debts.repaidCents, 0)));
  const rows = await db
    .select({ debt: debts, dispute: schema.disputes })
    .from(debts)
    .innerJoin(schema.disputes, eq(schema.disputes.id, debts.disputeId))
    .where(and(eq(schema.disputes.outcome, "won"), or(inArray(debts.status, [...OPEN]), toPutRight), only ? inArray(debts.disputeId, only.disputeIds) : undefined));
  for (const { debt, dispute } of rows) {
    await db
      .transaction(async (tx) => {
        await lockPayment(tx, debt.paymentId);
        const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
        if (!fresh || fresh.leftoverToldAt !== null) return;
        const open = OPEN.includes(fresh.status);
        if (!open && !["taken", "settled", "cancelled"].includes(fresh.status)) return;
        // With its notice only, objected to, or answered: called off. Nothing was lost after all.
        if (open) {
          await tx.update(debts).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(debts.id, fresh.id));
          await freeSetAside(tx, fresh.paymentId);
          await tellHost(tx, fresh, dispute, "cancelled", (facts) => cancelledWords(facts, "won"));
        }
        await fellAway(tx, fresh, now, `the bank decided dispute ${dispute.id} the other way after all`);
        // What she had really paid back for it, whichever way: the app does not give it back by itself.
        const paid = paidBackCents(fresh);
        if (paid > 0) {
          const how = (fresh.repaidCents ?? 0) > 0 ? "paid" : "taken";
          const asPaid = { ...fresh, amountCents: paid };
          await tellHost(tx, asPaid, dispute, "leftover", (facts) => leftoverWords("host", facts, how));
          await tellFounders(tx, asPaid, dispute, "leftover", (facts) => leftoverWords("founder", facts, how));
        }
      })
      .catch((error) => log(`could not settle take-back ${debt.id} after its dispute was won`, error));
  }
}

/** What a host has really paid back for one take-back: taken by the app, counted from a reversal made by hand, or paid outside the app. */
const paidBackCents = (debt: Pick<HostDebt, "status" | "amountCents" | "repaidCents" | "byHandCents" | "stripeReversalId">): number =>
  // (A row that a reversal by hand paid in full is "taken" with nothing left on it: all of it is in `byHandCents`.)
  (debt.status === "taken" ? debt.amountCents : 0) + (debt.repaidCents ?? 0) + debt.byHandCents;

/**
 * The cause of a take-back fell away (the bank decided the other way; the refund failed at Stripe after all): a cost
 * of Connect's that a waiver or a settlement had booked for it is taken off the books again, once, and the row is
 * marked as put right.
 */
async function fellAway(tx: Tx, debt: HostDebt, now: Date, why: string): Promise<void> {
  if (debt.costBookedCents > 0) await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "connect_cost", amountCents: -debt.costBookedCents, stripeRef: null, note: `Not a cost of Connect's after all: ${why}.` });
  await tx.update(debts).set({ costBookedCents: 0, leftoverToldAt: now, updatedAt: now }).where(eq(debts.id, debt.id));
}

// ---------------------------------------------------------------------------
// 3. The due day: from the notice really sent
// ---------------------------------------------------------------------------

/**
 * What became of one email: the moment it arrived (sent, and reported as delivered), or why it has not.
 * Both are empty while it is still on its way.
 *
 * "Arrived" is judged by this very email, not by its address: the sending service accepted it, reported it as
 * delivered, and never reported it as bounced (provider-events.ts; neither mark is ever emptied, so the order of the
 * service's reports cannot matter). An email from before those reports were kept has neither mark and so has not
 * arrived as far as the app can show: the founder sends it again.
 */
async function deliveryOf(reader: Reader, emailId: string | null, now: Date): Promise<{ arrivedAt: Date | null; problem: string | null }> {
  const mail = schema.emailOutbox;
  const [email] = emailId ? await reader.select({ status: mail.status, sentAt: mail.sentAt, deliveredAt: mail.deliveredAt, bouncedAt: mail.bouncedAt, lastError: mail.lastError }).from(mail).where(eq(mail.id, emailId)) : [];
  if (!email) return { arrivedAt: null, problem: "there is no email for it" };
  if (email.bouncedAt) return { arrivedAt: null, problem: `it bounced${email.lastError ? ` (${email.lastError})` : ""}` };
  if (email.status === "failed") return { arrivedAt: null, problem: email.lastError ?? "it could not be sent" };
  if (email.status !== "sent") return { arrivedAt: null, problem: null };
  if (!email.sentAt) return { arrivedAt: null, problem: "it is marked as sent, with no time of sending" };
  // Arrived: sent, and reported as delivered. The days count from the later of the two moments, so a report that
  // comes a day after the sending gives the host that day too.
  if (email.deliveredAt) return { arrivedAt: new Date(Math.max(email.sentAt.getTime(), email.deliveredAt.getTime())), problem: null };
  // Sent, and the sending service has not said that it was delivered. For a while that is simply waiting.
  return { arrivedAt: null, problem: now.getTime() - email.sentAt.getTime() > CONFIRM_WITHIN_MS ? "the sending service has not confirmed that it was delivered" : null };
}

/**
 * The day a take-back should have as things stand, worked out from its emails (takeback-rules.ts, dueDay), and what
 * is wrong with them, if anything. `as` is the state it is judged in: for one that is being taken, the state it had
 * before.
 */
async function dayOf(reader: Reader, debt: HostDebt, now: Date, as: string = debt.status): Promise<{ day: Date | null; problems: Array<{ which: "notice" | "answer"; emailId: string | null; problem: string }> }> {
  const notice = await deliveryOf(reader, debt.noticeEmailId, now);
  const answer = as === "answered" ? await deliveryOf(reader, debt.answerEmailId, now) : null;
  const problems: Array<{ which: "notice" | "answer"; emailId: string | null; problem: string }> = [];
  if (notice.problem) problems.push({ which: "notice", emailId: debt.noticeEmailId, problem: notice.problem });
  if (answer?.problem) problems.push({ which: "answer", emailId: debt.answerEmailId, problem: answer.problem });
  return { day: dueDay({ status: as, promisedAt: debt.firstDueAt, noticeArrivedAt: notice.arrivedAt, answerArrivedAt: answer?.arrivedAt ?? null }), problems };
}

/** The emails the founder has been told about, as kept on the row. */
const toldAbout = (debt: Pick<HostDebt, "noticeProblemsTold">): string[] => debt.noticeProblemsTold.split(" ").filter(Boolean);

const sameDay = (a: Date | null, b: Date | null): boolean => (a === null ? b === null : b !== null && a.getTime() === b.getTime());

/**
 * Gives a take-back its due day, and takes it away again. The day is never kept by itself: every pass works it out
 * afresh from the emails (dueDay). So:
 *   - no day while the notice (or the answer to an objection) is still on its way, or not yet reported as delivered,
 *     as in a copy of the app with no sending service;
 *   - no day when that email failed, bounced, or was not reported as delivered within two days: the founder is told,
 *     once for each such email, and can send it again or call the take-back off;
 *   - a day that was given is taken away again when its email turns out to have bounced;
 *   - a take-back from before this rule keeps the day its notice named as the earliest, and gets a day only once a
 *     notice of it has provably arrived.
 * Everything is read and written with the share's payment held, the same lock the taking starts under and the same
 * lock a report from the sending service is written under.
 */
export async function dateNotices(now: Date, only?: Only): Promise<void> {
  const rows = await db.select().from(debts).where(and(inArray(debts.status, [...TAKEABLE]), within(only)));
  for (const debt of rows) {
    const dispute = await causeOf(db, debt);
    if (!dispute) continue;
    // A first look without the lock, only to leave alone what needs nothing. What is written is decided under it.
    const seen = await dayOf(db, debt, now);
    // (A take-back with no email at all for its notice, or for its answer, is told under a name of its own for each.)
    const nameOf = (one: (typeof seen.problems)[number]) => one.emailId ?? `no-${one.which}`;
    const untold = (problems: typeof seen.problems, row: Pick<HostDebt, "noticeProblemsTold">) => problems.filter((one) => !toldAbout(row).includes(nameOf(one)));
    if (sameDay(seen.day, debt.dueAt) && untold(seen.problems, debt).length === 0 && (seen.problems.length === 0) === (debt.noticeProblemToldAt === null)) continue;
    await db
      .transaction(async (tx) => {
        await lockPayment(tx, debt.paymentId);
        const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
        if (!fresh || !TAKEABLE.includes(fresh.status)) return;
        const { day, problems } = await dayOf(tx, fresh, now);
        // Each email that has something wrong is told to the founder once, on its own (a failed answer too, while
        // the notice is failing), and written down as told only when somebody was there to tell: with no admin in
        // the database, the next pass tries again.
        const told = toldAbout(fresh);
        for (const one of untold(problems, fresh)) {
          const key = nameOf(one);
          if ((await tellFounders(tx, fresh, dispute, `undelivered:${key}`, (facts) => notDeliveredWords(facts, one.which, one.problem))) > 0) told.push(key);
        }
        const toldAt = problems.length === 0 ? null : told.length > 0 ? (fresh.noticeProblemToldAt ?? now) : null;
        const firstDueAt = fresh.firstDueAt ?? (fresh.status === "told" ? day : null);
        const noticeProblemsTold = told.join(" ");
        if (sameDay(day, fresh.dueAt) && sameDay(firstDueAt, fresh.firstDueAt) && sameDay(toldAt, fresh.noticeProblemToldAt) && noticeProblemsTold === fresh.noticeProblemsTold) return;
        await tx.update(debts).set({ dueAt: day, firstDueAt, noticeProblemToldAt: toldAt, noticeProblemsTold, updatedAt: now }).where(eq(debts.id, fresh.id));
      })
      .catch((error) => log(`could not give take-back ${debt.id} its due day`, error));
  }
}

// ---------------------------------------------------------------------------
// 4. An objection, and the founder's answer
// ---------------------------------------------------------------------------

export class DebtError extends Error {}

const tidy = (text: string): string => text.replace(/\r\n/g, "\n").trim();

/** One take-back with its cause (its dispute, or its refund), both read with the share's payment held and the row locked. */
async function lockedDebt(tx: Tx, debtId: string): Promise<{ debt: HostDebt; dispute: Cause } | null> {
  const [found] = await tx.select({ paymentId: debts.paymentId }).from(debts).where(eq(debts.id, debtId));
  if (!found) return null;
  await lockPayment(tx, found.paymentId);
  const [debt] = await tx.select().from(debts).where(eq(debts.id, debtId)).for("update");
  if (!debt) return null;
  const dispute = await causeOf(tx, debt);
  return dispute ? { debt, dispute } : null;
}

/**
 * "I think this is wrong", pressed by the host: nothing is taken until the founder has decided. Judged with the share's
 * payment held, the same lock the taking starts under, so an objection made a moment before the due day always wins.
 * Only while the take-back has its notice: one whose objection was answered cannot be objected to again here.
 */
export async function objectToDebt(input: { debtId: string; hostId: string; objection: string; disputeId?: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const objection = tidy(input.objection);
  if (objection.length < 10) throw new DebtError("Please say in a sentence or two why you think this is wrong.");
  if (objection.length > 2000) throw new DebtError("Please keep it under 2,000 characters.");
  await db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    // (A take-back named together with another dispute's page is not that page's to object to.)
    if (!found || found.debt.hostId !== input.hostId || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId)) throw new DebtError("This is not one of your take-backs.");
    const { debt, dispute } = found;
    if (!canObject(debt)) throw new DebtError(debt.status === "objected" ? "We already have your objection. Nothing is taken until we have answered you." : debt.status === "answered" ? "We have answered your objection. If you still think this is wrong, please write to us." : "This can no longer be objected to here. Please write to us.");
    const [held] = await tx.update(debts).set({ status: "objected", objectedAt: now, objection, dueAt: null, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
    await tellHost(tx, held, dispute, "objected", objectedWords);
    await tellFounders(tx, held, dispute, "objected", (facts) => objectedWordsForFounder(facts, objection));
  });
}

/** The founder holds a take-back for an objection that came by email: the same as the host's own button, from this moment. */
export async function holdDebt(input: { debtId: string; adminId: string; note: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const note = tidy(input.note) || "The host objected by email.";
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId) || !canHold(found.debt)) return false;
    await tx.update(debts).set({ status: "objected", objectedAt: now, objection: note.slice(0, 2000), dueAt: null, updatedAt: now }).where(eq(debts.id, found.debt.id));
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: "take-back held for an objection", targetUserId: found.debt.hostId, targetId: found.debt.id });
    return true;
  });
}

/**
 * The founder has read the objection and it is taken after all. The answer goes to the host in writing; the take-back
 * gets no due day here: that comes from the answer's email really going out (3 days after it, and never before the
 * first due day).
 */
export async function answerObjection(input: { debtId: string; adminId: string; answer: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const answer = tidy(input.answer);
  if (answer.length < 10) throw new DebtError("Write the answer the host will read: why it is taken after all.");
  if (answer.length > 2000) throw new DebtError("Please keep the answer under 2,000 characters.");
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId) || !canAnswer(found.debt)) return false;
    const { debt, dispute } = found;
    const [answered] = await tx.update(debts).set({ status: "answered", answer, answeredAt: now, answeredBy: input.adminId, dueAt: null, noticeProblemToldAt: null, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
    const answerEmailId = await tellHost(tx, answered, dispute, "answered", (facts) => answeredWords(facts, answer));
    await tx.update(debts).set({ answerEmailId }).where(eq(debts.id, debt.id));
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: "objection to a take-back answered: taken after all", targetUserId: debt.hostId, targetId: debt.id });
    return true;
  });
}

/**
 * The founder sends the notice (or the answer to an objection) again, when the first one did not arrive: it failed,
 * it bounced, or the sending service never said that it was delivered. A new message and a new email, with the same
 * words; the days count from this one arriving, and never end before a day an earlier notice named. Only for a
 * take-back that has something wrong with its email: one that has its day needs no second notice.
 */
export async function sendNoticeAgain(input: { debtId: string; adminId: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId) || !TAKEABLE.includes(found.debt.status)) return false;
    const { debt, dispute } = found;
    const { problems } = await dayOf(tx, debt, now);
    // The notice first; the answer only when the notice itself is fine.
    const [first] = problems;
    if (!first) return false;
    const which = first.which;
    const [waiting] = await tx.update(debts).set({ dueAt: null, noticeProblemToldAt: null, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
    // A key of its own, so that it is a new message and a new email beside the first.
    const again = `again:${now.getTime()}`;
    if (which === "answer") {
      const answerEmailId = await tellHost(tx, waiting, dispute, `answered:${again}`, (facts) => answeredWords(facts, debt.answer ?? ""));
      await tx.update(debts).set({ answerEmailId }).where(eq(debts.id, debt.id));
    } else {
      // The notice again says where things stand now: one whose objection was answered is not told to press a
      // button it no longer has.
      const noticeEmailId = await tellHost(tx, waiting, dispute, `owed:${again}`, (facts) => noticeAgainWords(facts, debt.status === "answered" ? (debt.answer ?? "") : null));
      await tx.update(debts).set({ noticeEmailId }).where(eq(debts.id, debt.id));
    }
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: `take-back: the ${which} was sent again`, targetUserId: debt.hostId, targetId: debt.id });
    return true;
  });
}

// ---------------------------------------------------------------------------
// 5. Taking it
// ---------------------------------------------------------------------------

/** Asks Stripe to take the amount back out of the transfer. The take-back's id goes with it, so it can be found again. */
export async function reverseAtStripe(params: TakeParams, label: string): Promise<{ id: string }> {
  return stripe().transfers.createReversal(params.transferId, { amount: params.amountCents, metadata: { debtId: params.debtId } }, { idempotencyKey: label });
}

/** Stripe did it: the row is "taken", the money record gets its line, and the host is told. With the share's payment held. */
export async function applyTaken(tx: Tx, params: TakeParams, reversalId: string): Promise<void> {
  const now = new Date();
  const [debt] = await tx
    .update(debts)
    .set({ status: "taken", stripeReversalId: reversalId, takenAt: now, updatedAt: now })
    .where(and(eq(debts.id, params.debtId), eq(debts.status, "taking")))
    .returning();
  if (!debt) return;
  const cause = await causeOf(tx, debt);
  const why = debt.refundId ? `a refund given after the host had collected (${debt.refundId})` : `a lost bank dispute (${debt.disputeId})`;
  await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "host_takeback", amountCents: debt.amountCents, stripeRef: reversalId, note: `Taken back from the host after ${why}.` });
  if (cause) await tellHost(tx, debt, cause, "taken", isRefund(cause) ? refundTakenWords : takenWords);
}

/**
 * It did not happen: the row is back where it stood (at its notice, or "answered" if an objection had been answered,
 * so that it cannot be objected to a second time), with what Stripe said. Tried again a day later. With the share's
 * payment held.
 */
export async function backToTold(tx: Tx, debtId: string, message: string): Promise<void> {
  const now = new Date();
  await tx
    .update(debts)
    .set({ status: sql`case when ${debts.answer} is not null then 'answered' else 'told' end`, refusal: message, refusedAt: now, firstRefusedAt: sql`coalesce(${debts.firstRefusedAt}, ${now.toISOString()}::timestamptz)`, updatedAt: now })
    .where(and(eq(debts.id, debtId), eq(debts.status, "taking")));
}

/** The money action of one take-back, on its share's payment. `now` is the moment it is judged at (the helper's pass). */
export function takePlan(debt: Pick<HostDebt, "id" | "paymentId">, now: Date = new Date()): OperationPlan<TakeParams, null> {
  return {
    paymentId: debt.paymentId,
    kind: "take_back",
    labelBase: takebackLabel(debt.id),
    // With the share's payment held, everything is judged again on the row as it is now: only a take-back that has
    // its notice, whose 14 days are over and that was not refused within the last day is started, and only while
    // its dispute is still recorded as lost. One that was cancelled, is being taken or was taken is refused here,
    // and nothing is written down.
    prepare: async (_payment, tx) => {
      const [row] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
      if (!row || !dueToTake(row, now)) throw new MoneyError("This take-back is not waiting to be taken.");
      // The day on the row was worked out a moment ago. Here, with the share's payment held, the emails are read once
      // more: a notice that bounced since, or that turns out not to have gone out, stops it at the last moment.
      const { day } = await dayOf(tx, row, now);
      if (day === null || now < day) throw new MoneyError("The notice of this take-back is not confirmed as delivered, or its day has not come.");
      // What it comes from, as it stands now: a dispute still recorded as lost, or a refund still confirmed.
      const cause = await causeOf(tx, row);
      if (!cause) throw new MoneyError("What this take-back comes from is gone.");
      if (isRefund(cause) ? cause.status !== "done" : cause.outcome !== "lost") throw new MoneyError(isRefund(cause) ? "The refund of this take-back is not confirmed." : "The dispute of this take-back is not lost any more.");
      await tx.update(debts).set({ status: "taking", updatedAt: new Date() }).where(eq(debts.id, row.id));
      return { debtId: row.id, transferId: row.stripeTransferId, amountCents: row.amountCents };
    },
    execute: async (params, label) => ({ stripeId: (await reverseAtStripe(params, label)).id, result: null }),
    apply: (_payment, params, outcome, tx) => applyTaken(tx, params, outcome.stripeId),
    onRefused: (_payment, params, message, tx) => backToTold(tx, params.debtId, message),
  };
}

/** One take-back whose notice is over. For one that comes from a dispute, Stripe is first asked whether the dispute is still lost. */
async function takeOne(debt: HostDebt, now: Date): Promise<void> {
  if (debt.disputeId) {
    const disputeId = debt.disputeId;
    const [dispute] = await db.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, disputeId));
    // Not lost in the record any more (an appeal is open, or it was won): nothing is taken while that is so.
    if (dispute?.outcome !== "lost") return;
    const atStripe = await stripe().disputes.retrieve(disputeId);
    if (outcomeOf(atStripe.status) !== "lost") {
      await db.update(schema.disputes).set({ lookAgain: true }).where(eq(schema.disputes.id, disputeId));
      return;
    }
  }
  // A take-back that comes from a refund: Stripe is asked once more whether that refund still stands. A refund Stripe
  // first confirmed can fail afterwards; then the customer got nothing, and nothing is owed.
  if (debt.refundId && !(await refundStands(debt.refundId, now))) return;
  // A reversal somebody made by hand on this transfer, that nobody has accounted for: it may already have paid
  // this very take-back. Nothing more is taken from the transfer until the founder has said what it was for.
  const byHand = await handReversalsOpen(debt);
  if (byHand.length > 0) {
    await holdForHand(debt, byHand, now);
    return;
  }
  if (debt.handToldAt) await db.update(debts).set({ handToldAt: null, updatedAt: now }).where(eq(debts.id, debt.id));
  try {
    await runMoneyOperation(takePlan(debt, now));
  } catch (error) {
    // A clear "no" put the row back to its notice (tried again tomorrow). No clear answer leaves the action
    // written down: the helper's check of unfinished actions finds out what happened.
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[disputes] take-back ${debt.id} was not taken now: ${error.message}`);
    else throw error;
  }
}

/** Only after this long is "Stripe's list does not show it" taken as "it did not happen": an hour after the last moment the request may still have been sent. */
const SETTLED_AFTER_MS = 24 * 3_600_000;
/** A repeat under the same label is sent up to this age of the action (Stripe keeps a label for 24 hours). */
const RESEND_UNTIL_MS = 23 * 3_600_000;

/**
 * Asking Stripe what it has is not the action itself. If the asking fails, even with a clear "no" (no permission,
 * say), that proves nothing about the take-back: it stays unanswered and is looked at again.
 */
async function lookUp<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new Error(`Could not look this up at Stripe: ${errorSummary(error)}`);
  }
}

/**
 * For the helper's check of unfinished money actions (payments/jobs.ts): what became of a take-back that got no answer.
 *   - While a repeat is safe AND the dispute is still lost (here and at Stripe): the same request under the same
 *     label, which gives the first reply back, or does it now. A repeat can be the first time Stripe really does
 *     it, so it is never sent for a dispute that is no longer lost. A repeat that brings no reversal, whatever
 *     Stripe said to it, settles nothing by itself.
 *   - Then, and otherwise, every page of the transfer's own reversals is searched for this take-back's id.
 *   - "It did not happen" is concluded only from a search that was read to the end, and only once the request can no
 *     longer be on its way (24 hours; a repeat is sent up to 23). Before that, nothing is concluded.
 */
export async function recoverTakeback(operation: { id: string; paymentId: string | null; label: string; createdAt: Date }, params: TakeParams, canRepeat: boolean): Promise<void> {
  if (!operation.paymentId) return;
  const [row] = await db.select({ disputeId: debts.disputeId, refundId: debts.refundId }).from(debts).where(eq(debts.id, params.debtId));
  const disputeId = row?.disputeId ?? null;
  const [dispute] = disputeId ? await db.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, disputeId)) : [];
  const age = () => Date.now() - operation.createdAt.getTime();
  // A repeat can be the first time Stripe really does it. So it is sent only while everything that allowed the
  // first request still holds: the dispute is still lost (here and at Stripe), and the notice (and an answer) has
  // arrived and its day has come. A reversal Stripe already made is found and booked below either way.
  // (A take-back that comes from a refund has no dispute to ask about: its refund is checked under the lock below.)
  let resend = canRepeat && Boolean(row) && (disputeId ? dispute?.outcome === "lost" : true);
  if (resend && disputeId) resend = outcomeOf((await lookUp(() => stripe().disputes.retrieve(disputeId))).status) === "lost";
  // The same two looks the first request had: the refund still stands at Stripe, and no reversal made by hand on the
  // transfer is unaccounted for. If either cannot be asked, nothing is sent again (the search below still runs).
  if (resend && row?.refundId) resend = await refundStands(row.refundId).catch(() => false);
  if (resend) resend = await handReversalsOpen({ paymentId: operation.paymentId, stripeTransferId: params.transferId }).then((open) => open.length === 0, () => false);
  // The last look, after everything that takes time and with the share's payment held: the same lock a report from the
  // sending service is written under, and the one the first request was authorised under. A bounce that was recorded
  // before this moment stops the repeat.
  if (resend) {
    resend = await db.transaction(async (tx) => {
      await lockPayment(tx, operation.paymentId!);
      const [whole] = await tx.select().from(debts).where(eq(debts.id, params.debtId)).for("update");
      // Only this very action, still unanswered, and only while its row is still "being taken": an action that was
      // answered meanwhile (a clear "no" put the row back to its notice) is never sent again from an old look.
      const [action] = await tx.select({ status: schema.moneyOperations.status }).from(schema.moneyOperations).where(eq(schema.moneyOperations.id, operation.id));
      if (!whole || whole.status !== "taking" || action?.status !== "started") return false;
      // What it comes from once more, as the app has it now: a dispute may have been recorded as won while this
      // waited for the lock.
      const cause = await causeOf(tx, whole);
      if (!cause || (isRefund(cause) ? cause.status !== "done" : cause.outcome !== "lost")) return false;
      const at = new Date();
      const { day } = await dayOf(tx, whole, at, stateBeforeTaking(whole));
      return day !== null && day.getTime() <= at.getTime();
    });
  }
  let reversalId: string | undefined;
  // The clock is read right before the request goes out: the reads above can take time, and a repeat is only safe
  // while Stripe still knows the label.
  if (resend && age() < RESEND_UNTIL_MS) {
    try {
      reversalId = (await reverseAtStripe(params, operation.label)).id;
    } catch (error) {
      // Whatever a repeat is answered with, a "no" included, proves nothing about the first request (it may have gone
      // through before, say, a permission was taken away): the transfer's own list is what settles it.
      console.error(`[disputes] the repeat of take-back ${params.debtId} got no reversal (${errorSummary(error)}); Stripe's list is searched instead`);
    }
  }
  // Only a search that BEGAN after the request could no longer be on its way can say "it did not happen".
  const conclusive = age() >= SETTLED_AFTER_MS;
  if (reversalId === undefined) {
    await lookUp(async () => {
      for await (const reversal of stripe().transfers.listReversals(params.transferId, { limit: 100 })) {
        if (reversal.metadata?.debtId === params.debtId) {
          reversalId = reversal.id;
          break;
        }
      }
    });
  }
  if (reversalId !== undefined) {
    const found = reversalId;
    await finishOperation(operation.id, operation.paymentId, found, (_payment, tx) => applyTaken(tx, params, found));
    return;
  }
  // Not found, but the request may still be on its way (or another helper may just be sending it): looked at again.
  if (!conclusive) return;
  await refuseTakeback(operation, params, "Stripe shows this take-back did not happen.");
}

/** An unanswered take-back that definitely did not happen: the action is marked failed and the row put back, in one step. */
export async function refuseTakeback(operation: { id: string; paymentId: string | null }, params: TakeParams, message: string): Promise<void> {
  if (!operation.paymentId) return;
  const paymentId = operation.paymentId;
  await failOwnedOperation(operation.id, { column: "paymentId", id: paymentId, lock: (tx) => lockPayment(tx, paymentId) }, message, (_payment, tx) => backToTold(tx, params.debtId, message));
}

// ---------------------------------------------------------------------------
// The founder
// ---------------------------------------------------------------------------

/**
 * The founder calls a take-back off, which is how a host's objection is honoured. Possible until the app starts
 * taking it. Written down as an admin action in the same step, and the host is told. For one that comes from a
 * refund, Connect carries the amount, and the books say so (a cost of Connect's own), once.
 */
export async function cancelDebt(input: { debtId: string; adminId: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const [found] = await db.select({ paymentId: debts.paymentId, disputeId: debts.disputeId }).from(debts).where(eq(debts.id, input.debtId));
  // (A take-back named together with another dispute's page is not this page's to cancel.)
  if (!found || (input.disputeId !== undefined && found.disputeId !== input.disputeId)) return false;
  return db.transaction(async (tx) => {
    await lockPayment(tx, found.paymentId);
    const [debt] = await tx.select().from(debts).where(eq(debts.id, input.debtId)).for("update");
    if (!debt || !canCancel(debt)) return false;
    const cause = await causeOf(tx, debt);
    // Connect carries it, and the books say so, once (decision 8), whatever the take-back came from. The amount is
    // kept on the row, so that it can be taken off again if the cause falls away (the bank decides the other way).
    await tx.update(debts).set({ status: "cancelled", cancelledAt: now, cancelledBy: input.adminId, dueAt: null, costBookedCents: debt.costBookedCents + debt.amountCents, updatedAt: now }).where(eq(debts.id, debt.id));
    await freeSetAside(tx, debt.paymentId);
    await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "connect_cost", amountCents: debt.amountCents, stripeRef: null, note: debt.refundId ? `Connect carries the host's part of a refund given after collection (${debt.refundId}): the take-back was called off.` : `Connect carries the host's share after a lost bank dispute (${debt.disputeId}): the take-back was called off.` });
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: debt.refundId ? "take-back after a refund called off" : "take-back after a lost dispute cancelled", targetUserId: debt.hostId, targetId: debt.id });
    if (cause) await tellHost(tx, debt, cause, "cancelled", isRefund(cause) ? refundCancelledWords : (facts) => cancelledWords(facts, "founder"));
    return true;
  });
}

/**
 * The founder records that a take-back was settled with the host outside the app: what she paid back (to Connect's
 * bank account, say) and how. The books get that payment as paid back by the host, and only the rest, if any, as a
 * cost Connect carries. A reversal the founder made by hand at Stripe is NOT entered here: it is accounted for on
 * its own (countHandReversal), because Stripe already shows it. Possible while the take-back is open or waiting.
 */
export async function settleOutside(input: { debtId: string; adminId: string; repaidCents: number; note: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const note = tidy(input.note);
  if (note.length < 5) throw new DebtError("Note how it was settled: when, and how the host paid.");
  if (note.length > 2000) throw new DebtError("Please keep the note under 2,000 characters.");
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId) || !canSettle(found.debt)) return false;
    const { debt, dispute: cause } = found;
    if (!Number.isInteger(input.repaidCents) || input.repaidCents < 0 || input.repaidCents > debt.amountCents) throw new DebtError(`What the host paid back has to be between $0.00 and ${formatMoney(debt.amountCents)}.`);
    const letGo = debt.amountCents - input.repaidCents;
    const why = debt.refundId ? `a refund given after collection (${debt.refundId})` : `a lost bank dispute (${debt.disputeId})`;
    const [settled] = await tx.update(debts).set({ status: "settled", repaidCents: input.repaidCents, settledNote: note, settledAt: now, dueAt: null, costBookedCents: debt.costBookedCents + letGo, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
    if (input.repaidCents > 0) await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "host_repaid", amountCents: input.repaidCents, stripeRef: null, note: `Paid back by the host outside the app, for ${why}.` });
    if (letGo > 0) await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "connect_cost", amountCents: letGo, stripeRef: null, note: `Connect carries the rest of the host's part of ${why}.` });
    // What was let go is room again for another take-back on this share that had got nothing.
    await freeSetAside(tx, debt.paymentId);
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: debt.refundId ? "take-back after a refund settled outside the app" : "take-back after a lost dispute settled outside the app", targetUserId: debt.hostId, targetId: debt.id });
    await tellHost(tx, settled, cause, "settled", (facts) => settledWords(facts, formatMoney(input.repaidCents), letGo > 0 ? formatMoney(letGo) : null));
    return true;
  });
}

/** After 30 days of refusals the founder is told, once. It keeps being tried. */
async function tellOfRefusals(now: Date, only?: Only): Promise<void> {
  const refused = await db.select().from(debts).where(and(inArray(debts.status, [...TAKEABLE]), isNotNull(debts.firstRefusedAt), isNull(debts.founderToldAt), within(only)));
  for (const debt of refused) {
    if (!tellFounderOfRefusals(debt, now)) continue;
    await db
      .transaction(async (tx) => {
        // Judged again on the row as it is now: one that was cancelled or taken meanwhile is nothing to write about.
        await lockPayment(tx, debt.paymentId);
        const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
        if (!fresh || !tellFounderOfRefusals(fresh, now)) return;
        // "It keeps trying" is only true while it can be tried: the emails are read as they are now, not as the day
        // on the row was worked out a moment ago (a bounce may have been recorded since).
        const { day } = await dayOf(tx, fresh, now);
        if (day === null || day.getTime() > now.getTime()) return;
        const cause = await causeOf(tx, fresh);
        if (!cause) return;
        await tx.update(debts).set({ founderToldAt: now, updatedAt: now }).where(eq(debts.id, fresh.id));
        await tellFounders(tx, fresh, cause, "refused", (facts) => (isRefund(cause) ? refundRefusedWords(facts, fresh.refusal) : refusedWords(facts, fresh.refusal)));
      })
      .catch((error) => log(`could not tell the founder about take-back ${debt.id}`, error));
  }
}

// ---------------------------------------------------------------------------
// A refund that Stripe first confirmed and that then failed after all
// ---------------------------------------------------------------------------

/**
 * Whether a confirmed refund still stands at Stripe. Stripe can confirm a refund and say later that it failed (the
 * customer's bank sent it back): then the customer got nothing, Connect has its money again, and the host owes
 * nothing for it. In that case the app's record of the refund is undone here, and the answer is no. Asks Stripe;
 * throws when Stripe cannot be asked, and the caller then does nothing for now.
 */
export async function refundStands(refundId: string, now: Date = new Date()): Promise<boolean> {
  const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
  // Only a refund the app has confirmed, with Stripe's own number for it, can be shown to stand.
  if (!refund || refund.status !== "done" || !refund.stripeRefundId) return false;
  const atStripe = await stripe().refunds.retrieve(refund.stripeRefundId);
  if (atStripe.status === "succeeded") return true;
  if (atStripe.status === "failed" || atStripe.status === "canceled") await undoFailedRefund(refund.id, atStripe.failure_reason ?? `Stripe says: ${atStripe.status}`, now);
  return false;
}

/**
 * Stripe's message that a refund changed (its failure, above all): what Stripe says now is read from Stripe, never
 * from the message. A refund still on its way that failed is marked so; a confirmed one that failed is undone.
 */
export async function refundChangedAtStripe(stripeRefundId: string, now: Date = new Date()): Promise<void> {
  const rows = await db.select().from(schema.refunds).where(eq(schema.refunds.stripeRefundId, stripeRefundId));
  for (const refund of rows) {
    if (refund.status === "done") await refundStands(refund.id, now);
    // (One still on its way is finished by the helper's own look at pending refunds, within the minute.)
  }
}

/**
 * Undoes the app's record of a refund that failed at Stripe after it had been confirmed. With the payment held and
 * only once: the payment counts as refunded by that much less, the three lines in the books are written back, and
 * the take-back that came from it is called off with no cost to anyone. What the host had already paid back for it
 * (taken, by hand, or outside the app) is not sent back by the app: she and the founder are told. The founder is
 * always told, because the customer did not get the money.
 */
export async function undoFailedRefund(refundId: string, reason: string, now: Date = new Date()): Promise<boolean> {
  const [seen] = await db.select({ paymentId: schema.refunds.paymentId }).from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!seen) return false;
  return db.transaction(async (tx) => {
    const payment = await lockPayment(tx, seen.paymentId);
    const [refund] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).for("update");
    if (!refund || refund.status !== "done" || payment.chargedCents === null || payment.originalHostShareCents === null) return false;
    const rows = await tx.select().from(debts).where(eq(debts.paymentId, payment.id));
    // Not while a taking on this share is unanswered: what came of it is found out first.
    if (rows.some((row) => row.status === "taking")) return false;

    const before = currentSplit(payment);
    const refundedCents = Math.max(0, payment.refundedCents - refund.amountCents);
    const after = splitAfterRefunds({ chargeCents: payment.chargedCents, refundedCents, originalHostShareCents: payment.originalHostShareCents });
    await tx.update(schema.refunds).set({ status: "failed", failure: reason.slice(0, 500), failedLateAt: now }).where(eq(schema.refunds.id, refund.id));
    // A share that this refund had left with nothing is owed again, and waits for its day like any other.
    await tx
      .update(schema.payments)
      .set({ refundedCents, transferStatus: payment.transferStatus === "not_owed" && after.hostShareCents > 0 ? "not_due" : payment.transferStatus, updatedAt: now })
      .where(eq(schema.payments.id, payment.id));
    const note = `The refund ${refund.id} failed at Stripe after it had been confirmed.`;
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "customer_refund", amountCents: refund.amountCents, stripeRef: refund.stripeRefundId, note });
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: after.feeCents - before.feeCents, stripeRef: refund.stripeRefundId, note });
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: after.hostShareCents - before.hostShareCents, stripeRef: refund.stripeRefundId, note });

    // Its take-back, if one was written and shown to anyone.
    const debt = rows.find((row) => row.refundId === refund.id && row.status !== "nothing") ?? null;
    let forFounder: { amount: string; paidBack: string | null } | null = null;
    if (debt && debt.leftoverToldAt === null) {
      const wasOpen = RESERVED.includes(debt.status);
      const paid = paidBackCents(debt);
      if (wasOpen) await tx.update(debts).set({ status: "cancelled", cancelledAt: now, dueAt: null, updatedAt: now }).where(eq(debts.id, debt.id));
      await fellAway(tx, debt, now, `refund ${refund.id} failed at Stripe after all`);
      // She is told when she still had it before her as owed, or had paid something for it.
      if (wasOpen || paid > 0) await tellHost(tx, debt, refund, "fell-away", (facts) => refundFellAwayWords(facts, paid > 0 ? formatMoney(paid) : null));
      forFounder = { amount: formatMoney(debt.amountCents + debt.byHandCents), paidBack: paid > 0 ? formatMoney(paid) : null };
    }
    await freeSetAside(tx, payment.id);

    const about = await aboutOwner(tx, { kind: "payment", id: payment.id });
    const people = about ? await peopleFor(tx, about) : null;
    if (about && people) {
      const names = { host: people.hostName, customer: people.customer.name };
      for (const founder of people.founders) {
        const told = refundFellAwayWordsForFounder({ what: about.what("founder", founder, names), customerName: people.customer.name, hostName: people.hostName, refunded: formatMoney(refund.amountCents), reason, debt: forFounder });
        await queueEmail(tx, { to: founder.email, key: `refund-failed-late:${refund.id}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\n${debt ? `The take-back's page (admin login):\n${appUrl()}${debtPath(debt.id)}` : `The refund page (admin login):\n${appUrl()}/admin/refund`}\n` });
      }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// A reversal somebody made by hand at Stripe
// ---------------------------------------------------------------------------

export type HandReversalSeen = { id: string; amountCents: number; at: Date };

/**
 * The reversals of a transfer that the app did not make for a take-back of this share, and that the founder has not
 * accounted for yet. While there is one, the app takes nothing more from that transfer by itself: such a reversal may
 * already have paid the very take-back the app is about to take. Asks Stripe (every page); throws when it cannot.
 */
export async function handReversalsOpen(debt: Pick<HostDebt, "paymentId" | "stripeTransferId">): Promise<HandReversalSeen[]> {
  const ours = new Set((await db.select({ id: debts.id }).from(debts).where(eq(debts.paymentId, debt.paymentId))).map((row) => row.id));
  const known = new Set((await db.select({ id: schema.handReversals.stripeReversalId }).from(schema.handReversals).where(eq(schema.handReversals.stripeTransferId, debt.stripeTransferId))).map((row) => row.id));
  const open: HandReversalSeen[] = [];
  for await (const reversal of stripe().transfers.listReversals(debt.stripeTransferId, { limit: 100 })) {
    // The app's own reversals carry the take-back they were made for.
    if ((reversal.metadata?.debtId && ours.has(reversal.metadata.debtId)) || known.has(reversal.id)) continue;
    open.push({ id: reversal.id, amountCents: reversal.amount, at: new Date(reversal.created * 1000) });
  }
  return open;
}

/** Puts a due take-back on hold because of such a reversal, and tells the founder, once for that reversal. */
async function holdForHand(debt: HostDebt, open: HandReversalSeen[], now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await lockPayment(tx, debt.paymentId);
    const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
    if (!fresh || !TAKEABLE.includes(fresh.status) || fresh.handToldAt !== null) return;
    const cause = await causeOf(tx, fresh);
    if (!cause) return;
    await tx.update(debts).set({ handToldAt: now, updatedAt: now }).where(eq(debts.id, fresh.id));
    const total = open.reduce((sum, one) => sum + one.amountCents, 0);
    await tellFounders(tx, fresh, cause, `hand:${open[0].id}`, (facts) => handHeldWordsForFounder(facts, formatMoney(total)));
  });
}

/**
 * The founder says what a reversal made by hand was for: this take-back (then it is counted for it, in the books as
 * taken back, and only the rest stays owed), or nothing to do with any take-back. A reversal is accounted for once,
 * ever. One that is larger than what this take-back still owes is counted up to that amount; the rest of it is then
 * taken to have had another reason.
 */
export async function countHandReversal(input: { debtId: string; adminId: string; reversalId: string; forThis: boolean; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const [seen] = await db.select().from(debts).where(eq(debts.id, input.debtId));
  if (!seen) return false;
  // Asked of Stripe first, outside any lock: it has to be a reversal of this very transfer that is still unaccounted for.
  const reversal = (await handReversalsOpen(seen)).find((one) => one.id === input.reversalId);
  if (!reversal) throw new DebtError("That reversal is not one that is waiting to be accounted for on this transfer.");
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found) return false;
    const { debt, dispute: cause } = found;
    if (input.forThis && !RESERVED.includes(debt.status)) throw new DebtError("This take-back is no longer open, so a reversal cannot be counted for it.");
    const counted = input.forThis ? Math.min(reversal.amountCents, debt.amountCents) : 0;
    const written = await tx
      .insert(schema.handReversals)
      .values({ stripeReversalId: reversal.id, stripeTransferId: debt.stripeTransferId, paymentId: debt.paymentId, debtId: input.forThis ? debt.id : null, amountCents: reversal.amountCents, countedCents: counted, decidedBy: input.adminId })
      .onConflictDoNothing()
      .returning({ id: schema.handReversals.stripeReversalId });
    if (written.length === 0) return false;
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: input.forThis ? "reversal made by hand counted for a take-back" : "reversal made by hand marked as not for a take-back", targetUserId: debt.hostId, targetId: debt.id });
    if (counted > 0) {
      const left = debt.amountCents - counted;
      await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "host_takeback", amountCents: counted, stripeRef: reversal.id, note: `Taken back from the host by a reversal made by hand at Stripe, counted for take-back ${debt.id}.` });
      const [after] = await tx
        .update(debts)
        .set({ amountCents: left, byHandCents: debt.byHandCents + counted, ...(left === 0 ? { status: "taken", takenAt: now, stripeReversalId: reversal.id, dueAt: null } : {}), updatedAt: now })
        .where(eq(debts.id, debt.id))
        .returning();
      // The same money was set aside twice until now (once at Stripe, once on the row): that room is free again.
      await freeSetAside(tx, debt.paymentId);
      await tellHost(tx, after, cause, `hand:${reversal.id}`, (facts) => handCountedWords(facts, formatMoney(counted), left > 0 ? formatMoney(left) : null));
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// The helper's pass, and what the pages show
// ---------------------------------------------------------------------------

/** The helper's work on take-backs, each pass. Each step and each row on its own: one that fails does not stop the others. */
export async function takeBackPass(now: Date, only?: Only): Promise<void> {
  for (const { dispute, paymentId } of await sharesWithoutRow(only)) {
    await writeDebt(dispute, paymentId, now).catch((error) => log(`could not work out what is owed for dispute ${dispute.id}`, error));
  }
  for (const refundId of await refundsWithoutRow(only)) {
    // First whether the refund still stands at Stripe (one that failed after all is undone there, and owes nothing).
    await refundStands(refundId, now)
      .then((stands) => (stands ? writeRefundDebt(refundId, now) : undefined))
      .catch((error) => log(`could not work out what is owed for refund ${refundId}`, error));
  }
  await settleChanged(now, only);
  await dateNotices(now, only);
  const told = await db
    .select()
    .from(debts)
    .where(and(inArray(debts.status, [...TAKEABLE]), lte(debts.dueAt, now), within(only)))
    .orderBy(asc(debts.dueAt));
  for (const debt of told) {
    if (!dueToTake(debt, now)) continue;
    await takeOne(debt, now).catch((error) => log(`could not take back for take-back ${debt.id}`, error));
  }
  await tellOfRefusals(now, only);
}

/** The take-backs of one dispute, for its page. A share that owes nothing is not shown. */
export async function debtsOfDispute(disputeId: string): Promise<HostDebt[]> {
  return db.select().from(debts).where(and(eq(debts.disputeId, disputeId), sql`${debts.status} <> 'nothing'`)).orderBy(asc(debts.toldAt));
}

/** Where a take-back is shown: on its dispute's page, or on a page of its own when it comes from a refund. */
export const pageOfDebt = (debt: Pick<HostDebt, "id" | "disputeId">): string => (debt.disputeId ? disputePath(debt.disputeId) : debtPath(debt.id));

/** What a host owes or has paid back, for their earnings: everything still open or waiting, and the latest that were taken or settled, each with its page. */
export async function debtsOfHost(hostId: string, takenShown = 10): Promise<Array<HostDebt & { path: string }>> {
  const open = await db.select().from(debts).where(and(eq(debts.hostId, hostId), inArray(debts.status, [...RESERVED, "taking"]))).orderBy(sql`${debts.dueAt} asc nulls last`, asc(debts.toldAt));
  const taken = await db.select().from(debts).where(and(eq(debts.hostId, hostId), inArray(debts.status, ["taken", "settled"]))).orderBy(sql`coalesce(${debts.takenAt}, ${debts.settledAt}) desc`).limit(takenShown);
  // (One that was taken between the two reads is shown once, as taken.)
  const settled = new Set(taken.map((row) => row.id));
  return [...open.filter((row) => !settled.has(row.id)), ...taken].map((row) => ({ ...row, path: pageOfDebt(row) }));
}

/** One take-back for its own page: the row, what it comes from, and the words for the payment as this reader calls it. Null when it is not there. */
export async function debtForPage(debtId: string, role: "host" | "founder", reader: { timeZone: string | null }): Promise<{ debt: HostDebt; cause: Cause; what: string; hostName: string; customerName: string } | null> {
  const [debt] = await db.select().from(debts).where(eq(debts.id, debtId));
  if (!debt || debt.status === "nothing") return null;
  const cause = await causeOf(db, debt);
  if (!cause) return null;
  const about = await aboutOwner(db, isRefund(cause) ? { kind: "payment", id: cause.paymentId } : ownerOf(cause));
  if (!about) return null;
  const [host] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, about.hostId));
  const [customer] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, about.customerId));
  const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, about.hostId));
  const names = { host: profile?.displayName ?? host?.name ?? "the host", customer: customer?.name ?? "the customer" };
  return { debt, cause, what: about.what(role, reader, names), hostName: names.host, customerName: names.customer };
}

/** For the founder's list: every take-back that is open, waiting or being taken, and the latest that ended, each with its page. */
export async function debtsForFounder(endedShown = 30): Promise<{ open: Array<HostDebt & { path: string }>; ended: Array<HostDebt & { path: string }> }> {
  const open = await db.select().from(debts).where(inArray(debts.status, [...RESERVED, "taking"])).orderBy(sql`${debts.dueAt} asc nulls last`, asc(debts.toldAt));
  const ended = await db.select().from(debts).where(inArray(debts.status, ["taken", "settled", "cancelled"])).orderBy(sql`coalesce(${debts.takenAt}, ${debts.settledAt}, ${debts.cancelledAt}, ${debts.updatedAt}) desc`).limit(endedShown);
  const withPath = (row: HostDebt) => ({ ...row, path: pageOfDebt(row) });
  return { open: open.map(withPath), ended: ended.map(withPath) };
}
