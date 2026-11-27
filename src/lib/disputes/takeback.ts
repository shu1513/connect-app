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
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, ne, notExists, or, sql, type SQL } from "drizzle-orm";
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
import { lockForPayment, lockShare } from "@/lib/contributions/locks";
import { aboutOwner, disputePath, ownerOf, peopleFor, type Only, type Owner } from "./record";
import { outcomeOf } from "./status";
import { againstBank, canAnswer, canCancel, canHold, canObject, canSettle, CONFIRM_WITHIN_MS, dueDay, dueToTake, leftAfterRefunds, OPEN, owedCents, paidBackCents, refundOwes, repaidOutsideStanding, RESERVED, roomOn, stateBeforeTaking, TAKEABLE, takebackLabel, tellFounderOfRefusals, toGiveBackCents } from "./takeback-rules";
import {
  answeredWords,
  cancelledWords,
  contributionRefundFailedWordsForFounder,
  handCountedWords,
  handHeldWordsForFounder,
  handTwiceWords,
  leftoverWords,
  loweredWords,
  noRoomWordsForFounder,
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
  refundTotalsWordsForFounder,
  refundWaitingWords,
  refundWaitingWordsForFounder,
  refusedWords,
  settledWords,
  shareRestoredWords,
  takenWords,
  type DebtFacts,
} from "./takeback-words";

const debts = schema.hostDebts;
const counts = schema.handReversalCounts;
/** An id as the database makes them. */
const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long one search through a list at Stripe may take before it is given up as unfinished. */
const SEARCH_WITHIN_MS = 20_000;

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
export type TakeParams = { debtId: string; transferId: string; amountCents: number; /** The request carries its attempt's label (every taking written down since labels exist). */ labelled?: boolean };

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

/**
 * What a share belongs to. A call's share is the call's own payment. The share of a contribution or a tip is a row of
 * its own, and its charge, its refunds and its people are the contribution payment's
 * (plans/50-part-1-gifts-owed-back.md).
 */
export async function ownerOfShare(reader: Reader, paymentId: string): Promise<Owner> {
  const [share] = await reader.select({ parentId: schema.payments.contributionPaymentId }).from(schema.payments).where(eq(schema.payments.id, paymentId));
  return share?.parentId ? { kind: "contribution", id: share.parentId } : { kind: "payment", id: paymentId };
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
async function tellingFor(tx: Tx, debt: Pick<HostDebt, "amountCents" | "dueAt" | "basis"> & { byHandCents?: number }, cause: Cause) {
  const about = await aboutOwner(tx, isRefund(cause) ? await ownerOfShare(tx, cause.paymentId) : ownerOf(cause));
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
  // What was first owed: what is still owed, and what a reversal made by hand has already paid of it. The sums and
  // the reasons for a smaller amount are about that first amount, never about what is left of it.
  const byHand = debt.byHandCents ?? 0;
  const assessed = debt.amountCents + byHand;
  const facts = (role: "host" | "founder", person: { timeZone: string | null }): DebtFacts => ({
    what: about.what(role, person, names),
    amount: formatMoney(debt.amountCents),
    sent: formatMoney(reallySent),
    afterRefunds: reallySent > sent ? { took: formatMoney(reallySent - sent), left: formatMoney(sent) } : null,
    part: whole ? null : { disputed: formatMoney(basis.disputedCents!), of: formatMoney(basis.chargeLeftCents!) },
    // Less than that part, and why: no more is owed than the bank took back, or no more is left of the transfer.
    capped: assessed >= part ? null : assessed >= Math.max(0, (basis.disputedCents ?? 0) - (basis.sameDisputeCents ?? 0)) ? "bank" : "transfer",
    byHand: byHand > 0 ? { assessed: formatMoney(assessed), taken: formatMoney(byHand) } : null,
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
            cutShort: assessed < cause.hostOwesCents,
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
async function tellFounders(tx: Tx, debt: HostDebt, cause: Cause, what: string, words: (facts: DebtFacts) => { subject: string; text: string }, ownPage = false): Promise<number> {
  const telling = await tellingFor(tx, debt, cause);
  if (!telling) return 0;
  for (const founder of telling.people.founders) {
    const told = words(telling.facts("founder", founder));
    await queueEmail(tx, { to: founder.email, key: `takeback:${debt.id}:${what}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\n${isRefund(cause) || ownPage ? "The take-back's page" : "The dispute's page"} (admin login):\n${appUrl()}${isRefund(cause) || ownPage ? `${debtPath(debt.id)}?as=founder` : pathOf(debt, cause)}\n` });
  }
  return telling.people.founders.length;
}

/** What her share of a payment lost to refunds given after it was sent to her: read from the refunds, never from the take-backs (decision 4). */
/**
 * The order of a payment's refunds given after the sending: by the place each got when Stripe's confirmation was
 * written down, with the payment held, so it never rests on a clock. (A line without a place stands after every line
 * that has one; among such lines the time and the number decide.)
 */
function earlier(a: Refund, b: Refund): boolean {
  const place = (one: Refund): [number, number, string] => [one.afterCollectionNo ?? Number.MAX_SAFE_INTEGER, one.finishedAt?.getTime() ?? 0, one.id];
  const [x, y] = [place(a), place(b)];
  return x[0] !== y[0] ? x[0] < y[0] : x[1] !== y[1] ? x[1] < y[1] : x[2] < y[2];
}

async function reductionsOn(reader: Reader, paymentId: string, before?: Refund): Promise<number> {
  const done = await reader.select().from(schema.refunds).where(and(eq(schema.refunds.paymentId, paymentId), eq(schema.refunds.afterCollection, true), eq(schema.refunds.status, "done")));
  return done.filter((one) => !before || (one.id !== before.id && earlier(one, before))).reduce((sum, one) => sum + one.hostOwesCents, 0);
}

/**
 * Stripe's total of refunds on a charge is not the app's: a refund was made at Stripe outside the app, or Stripe has
 * taken one back that the app has not undone yet. Until the two agree nothing is worked out for that payment (the
 * sums would rest on a history that is not whole). So that this does not wait unseen, the founder is told, once for
 * that pair of totals.
 */
async function tellOfRefundTotals(tx: Tx, paymentId: string, atStripeCents: number, inAppCents: number): Promise<void> {
  const owner = await ownerOfShare(tx, paymentId);
  const about = await aboutOwner(tx, owner);
  const people = about ? await peopleFor(tx, about) : null;
  if (!about || !people) return;
  const names = { host: people.hostName, customer: people.customer.name };
  // (A call's refunds are on the founder's refund page; a contribution's and a tip's are on the projects page.)
  const where = owner.kind === "contribution" ? `The projects page (admin login):\n${appUrl()}/admin/projects` : `The refund page (admin login):\n${appUrl()}/admin/refund`;
  for (const founder of people.founders) {
    const told = refundTotalsWordsForFounder({ what: about.what("founder", founder, names), hostName: people.hostName, atStripe: formatMoney(atStripeCents), inApp: formatMoney(inAppCents) });
    await queueEmail(tx, { to: founder.email, key: `refund-totals:${paymentId}:${atStripeCents}:${inAppCents}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\n${where}\n` });
  }
}

/**
 * Stripe's total of refunds on the charge behind a share, beside the total the app has confirmed for it (for the share
 * of a contribution or a tip: its contribution payment's). Null when the two agree, or when there is nothing to
 * compare (no charge of its own, as for a member's call, or a charge that is gone or does not fit the payment). While
 * they differ nothing is worked out for that payment, and nothing is taken for a refund of it either: the history the
 * amounts rest on is not whole. Asks Stripe, with nothing held; throws when Stripe cannot be asked.
 */
async function refundTotalsApart(paymentId: string): Promise<{ atStripeCents: number; inAppCents: number } | null> {
  const [share] = await db
    .select({ chargeId: schema.payments.stripeChargeId, intentId: schema.payments.stripePaymentIntentId, refundedCents: schema.payments.refundedCents, callId: schema.payments.callId, parentId: schema.payments.contributionPaymentId })
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId));
  if (!share?.chargeId) return null;
  const [parent] = !share.callId && share.parentId ? await db.select({ intentId: schema.contributionPayments.stripePaymentIntentId, refundedCents: schema.contributionPayments.refundedCents }).from(schema.contributionPayments).where(eq(schema.contributionPayments.id, share.parentId)) : [];
  const own = parent ?? share;
  const charge = await stripe()
    .charges.retrieve(share.chargeId, {}, { maxNetworkRetries: 0 })
    .catch((error: { code?: string }) => {
      if (error?.code === "resource_missing") return null;
      throw error;
    });
  const intentOf = charge ? (typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null)) : null;
  if (!charge || intentOf === null || intentOf !== own.intentId) return null;
  return charge.amount_refunded === own.refundedCents ? null : { atStripeCents: charge.amount_refunded, inAppCents: own.refundedCents };
}

/**
 * What is left on a share's transfer, as the app knows it: what was sent, less what the app itself took back for this
 * share's take-backs, less every part of a reversal made by hand that the founder has accounted for. A reversal made
 * by hand that nobody has accounted for yet is NOT taken off here. Until the founder has said what it was for the app
 * takes nothing from that transfer (takeOne), and it may turn out to be the payment of the very take-back that is
 * being written: taken off here and counted there, it would be taken off twice.
 */
async function leftOnTransfer(tx: Tx, paymentId: string, transferAmountCents: number, rows: HostDebt[]): Promise<number> {
  const [{ counted }] = await tx.select({ counted: sql<number>`coalesce(sum(${counts.cents}), 0)::int` }).from(counts).where(eq(counts.paymentId, paymentId));
  const taken = rows.filter((row) => row.status === "taken").reduce((sum, row) => sum + row.amountCents, 0);
  return Math.max(0, transferAmountCents - taken - counted);
}

/** Whether a refund of this payment is with Stripe and unanswered: nothing is worked out on a share while money is moving on it. */
async function refundUnderWay(reader: Reader, paymentId: string): Promise<boolean> {
  const [moving] = await reader.select({ id: schema.refunds.id }).from(schema.refunds).where(and(eq(schema.refunds.paymentId, paymentId), eq(schema.refunds.status, "in_progress"))).limit(1);
  if (moving) return true;
  // The share of a contribution or a tip: its refunds are tries of the contribution's payment. Money is moving while
  // one of them is with Stripe, or is written down and unanswered. (A try is written down with the share held, and
  // whoever asks here holds the share: so the answer cannot be out of date. A line that is only owed and waits for
  // its next try does not count: it cannot be tried while a dispute is lost, and would hold everything up for ever.)
  const owner = await ownerOfShare(reader, paymentId);
  if (owner.kind !== "contribution") return false;
  const [withStripe] = await reader.select({ id: schema.contributionRefunds.id }).from(schema.contributionRefunds).where(and(eq(schema.contributionRefunds.contributionPaymentId, owner.id), eq(schema.contributionRefunds.status, "at_stripe"))).limit(1);
  if (withStripe) return true;
  const [unanswered] = await reader.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.contributionPaymentId, owner.id), eq(schema.moneyOperations.kind, "refund"), eq(schema.moneyOperations.status, "started"))).limit(1);
  return Boolean(unanswered);
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
    const sameDispute = await tx.select().from(debts).where(eq(debts.disputeId, dispute.id));

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
    if (dispute.paymentId === paymentId && charge.amount_refunded !== share.refundedCents) {
      await tellOfRefundTotals(tx, paymentId, charge.amount_refunded, share.refundedCents);
      return false;
    }
    // The same for the share of a contribution or a tip: the charge is the contribution payment's, and so is the
    // total of its refunds (the share's own total leaves out refunds Connect once paid from its own money).
    if (dispute.contributionPaymentId && share.contributionPaymentId === dispute.contributionPaymentId) {
      const [parent] = await tx.select({ refundedCents: schema.contributionPayments.refundedCents }).from(schema.contributionPayments).where(eq(schema.contributionPayments.id, dispute.contributionPaymentId));
      if (!parent) return false;
      if (charge.amount_refunded !== parent.refundedCents) {
        await tellOfRefundTotals(tx, paymentId, charge.amount_refunded, parent.refundedCents);
        return false;
      }
    }
    const settledOutside = repaidOutsideStanding(others);
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
      transferLeftCents: await leftOnTransfer(tx, paymentId, transfer.amount, others),
      // Everything still set aside on this share (open or waiting for the founder), and what she paid back outside Stripe.
      othersOpenCents: others.filter((other) => RESERVED.includes(other.status)).reduce((sum, other) => sum + other.amountCents, 0) + settledOutside,
      sameDisputeCents: sameDispute.reduce((sum, other) => sum + againstBank(other), 0),
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
async function freeSetAside(tx: Tx, paymentId: string, disputeId: string | null = null): Promise<void> {
  // The same lock under which a dispute's shares are worked out (writeDebt), taken after the share's payment as
  // there: a share that is being worked out at this moment finishes first, and a "nothing" it writes is cleared here.
  if (disputeId) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`takeback-dispute:${disputeId}`}))`);
  // On this share; and, for a dispute's take-back, on the other shares of the same dispute too: they share what the bank took.
  await tx.delete(debts).where(and(eq(debts.status, "nothing"), disputeId ? or(eq(debts.paymentId, paymentId), eq(debts.disputeId, disputeId)) : eq(debts.paymentId, paymentId)));
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
    // In the order they were confirmed (their places), as the sums count them: where room is short, the earlier
    // refund's take-back gets it first.
    .orderBy(sql`${schema.refunds.afterCollectionNo} asc nulls last`, asc(schema.refunds.finishedAt), asc(schema.refunds.id));
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
    if (others.some((other) => other.refundId === refund.id) || refund.hostOwesCents <= 0 || share.transferStatus !== "sent" || !share.stripeTransferId || (share.transferCents ?? 0) <= 0 || (!share.callId && !share.contributionPaymentId)) {
      await looked();
      return;
    }
    if (others.some((other) => other.status === "taking") || (await refundUnderWay(tx, share.id))) return;
    // Whose share it is, and where its charge lives: a call's own payment, or the payment of a contribution or a tip
    // (the PaymentIntent and the total of refunds are there; the share only carries the charge's number).
    const parentId = share.callId ? null : share.contributionPaymentId;
    const [parent] = parentId
      ? await tx
          .select({ hostId: schema.contributions.hostId, intentId: schema.contributionPayments.stripePaymentIntentId, refundedCents: schema.contributionPayments.refundedCents })
          .from(schema.contributionPayments)
          .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
          .where(eq(schema.contributionPayments.id, parentId))
      : [];
    const [ofCall] = share.callId ? await tx.select({ hostId: schema.calls.hostId }).from(schema.calls).where(eq(schema.calls.id, share.callId)) : [];
    const call = ofCall ?? (parent ? { hostId: parent.hostId } : null);
    if (!call) return;
    const ownIntentId = parent ? parent.intentId : share.stripePaymentIntentId;
    const ownRefundedCents = parent ? parent.refundedCents : share.refundedCents;
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
    const fits = charge !== null && intentOf !== null && intentOf === ownIntentId;
    // Stripe's total of refunds on the charge has to be the app's: if Stripe knows of a refund the app has not
    // confirmed (or the other way round), nothing is worked out from a history that is not whole. Not marked as
    // looked at: the next pass asks again.
    if (fits && charge!.amount_refunded !== ownRefundedCents) {
      await tellOfRefundTotals(tx, share.id, charge!.amount_refunded, ownRefundedCents);
      return;
    }
    const basis: RefundBasis = {
      sentCents: share.transferCents!,
      reductionCents: refund.hostOwesCents,
      reductionsBeforeCents: await reductionsOn(tx, share.id, refund),
      transferLeftCents: await leftOnTransfer(tx, share.id, transfer.amount, others),
      othersOpenCents: others.filter((other) => RESERVED.includes(other.status)).reduce((sum, other) => sum + other.amountCents, 0),
      repaidOutsideCents: repaidOutsideStanding(others),
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
          await freeSetAside(tx, fresh.paymentId, fresh.disputeId);
          await tellHost(tx, fresh, dispute, "cancelled", (facts) => cancelledWords(facts, "won"));
        }
        await fellAway(tx, fresh, now, `the bank decided dispute ${dispute.id} the other way after all`);
        // What she had paid outside the app for it goes back to her and uses up no room any more: a take-back on
        // this share (or on a sister share of the dispute) that had got nothing is worked out again.
        if (!open) await freeSetAside(tx, fresh.paymentId, fresh.disputeId);
        // What she had really paid back for it, whichever way: the app does not give it back by itself.
        const paid = toGiveBackCents(fresh);
        if (paid > 0) {
          const how = (fresh.repaidCents ?? 0) > 0 ? "paid" : "taken";
          const asPaid = { ...fresh, amountCents: paid, byHandCents: 0 };
          await tellHost(tx, asPaid, dispute, "leftover", (facts) => leftoverWords("host", facts, how));
          await tellFounders(tx, asPaid, dispute, "leftover", (facts) => leftoverWords("founder", facts, how));
        }
      })
      .catch((error) => log(`could not settle take-back ${debt.id} after its dispute was won`, error));
  }
}


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
  // The attempt's own label goes with it, so that this very request can be told from any other reversal of the
  // transfer. A taking that was written down before labels existed is sent again exactly as it first was, without
  // one: the same label must carry the same request.
  const metadata: Record<string, string> = params.labelled ? { debtId: params.debtId, attempt: label } : { debtId: params.debtId };
  return stripe().transfers.createReversal(params.transferId, { amount: params.amountCents, metadata }, { idempotencyKey: label });
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
      // A refund Stripe has said failed after all, whose undoing waits for money to stop moving: nothing is taken for it.
      if (isRefund(cause) && cause.undoPendingAt !== null) throw new MoneyError("The refund of this take-back failed at Stripe and is being undone.");
      // The share of a contribution or a tip: its refunds are actions of the contribution's payment, which this
      // action's own place on the share does not keep out. Nothing is taken while one of them is unanswered.
      if (isRefund(cause) && cause.contributionRefundId !== null && (await refundUnderWay(tx, row.paymentId))) throw new MoneyError("A refund of this contribution is with Stripe and unanswered, so nothing is taken from its share now.");
      // And never for more than is left to take out of the transfer, as the app knows it at this moment.
      if (row.amountCents > (await roomToTake(tx, row))) throw new MoneyError("More is owed than can still be taken out of this transfer.");
      await tx.update(debts).set({ status: "taking", updatedAt: new Date() }).where(eq(debts.id, row.id));
      return { debtId: row.id, transferId: row.stripeTransferId, amountCents: row.amountCents, labelled: true };
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
  // Nor while Stripe's total of refunds on the charge is not the app's: then no new take-back is worked out for the
  // payment (writeRefundDebt), and one that was written before is not taken either. The founder is told, once for
  // that pair of totals.
  if (debt.refundId) {
    const apart = await refundTotalsApart(debt.paymentId);
    if (apart) {
      await db.transaction((tx) => tellOfRefundTotals(tx, debt.paymentId, apart.atStripeCents, apart.inAppCents));
      return;
    }
  }
  // A reversal somebody made by hand on this transfer, that nobody has accounted for: it may already have paid
  // this very take-back. Nothing more is taken from the transfer until the founder has said what it was for.
  const byHand = await handReversalsOpen(debt);
  if (byHand.length > 0) {
    await tellOfHand(debt, byHand, now);
    return;
  }
  if (debt.handToldAt) await db.update(debts).set({ handToldAt: null, updatedAt: now }).where(eq(debts.id, debt.id));
  // Never more than the app's own record says is left to take out of the transfer. What the founder has recorded
  // since the take-back was written (a payment outside the app, a part of a reversal made by hand) may have used the
  // room up. Then nothing is taken, the founder is told once, and it is theirs to settle.
  const fits = await db.transaction(async (tx) => {
    await lockPayment(tx, debt.paymentId);
    const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
    if (!fresh || !TAKEABLE.includes(fresh.status)) return false;
    const room = await roomToTake(tx, fresh);
    if (fresh.amountCents <= room) return true;
    const cause = await causeOf(tx, fresh);
    if (cause) await tellFounders(tx, fresh, cause, "noroom", (facts) => noRoomWordsForFounder(facts, formatMoney(room)), true);
    return false;
  });
  if (!fits) return;
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
  // (If Stripe cannot be asked about the dispute, nothing is sent again; the search below still runs, so a reversal
  // Stripe already made is found and booked whatever becomes of that question.)
  if (resend && disputeId) resend = await stripe().disputes.retrieve(disputeId).then((atStripe) => outcomeOf(atStripe.status) === "lost", () => false);
  // The same two looks the first request had: the refund still stands at Stripe, and no reversal made by hand on the
  // transfer is unaccounted for. If either cannot be asked, nothing is sent again (the search below still runs).
  if (resend && row?.refundId) resend = await refundStands(row.refundId).catch(() => false);
  // And Stripe's total of refunds on the charge is still the app's (takeOne). A reversal Stripe already made is found
  // and booked below whatever this says.
  if (resend && row?.refundId) resend = await refundTotalsApart(operation.paymentId).then((apart) => apart === null, () => false);
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
      if (!cause || (isRefund(cause) ? cause.status !== "done" || cause.undoPendingAt !== null : cause.outcome !== "lost")) return false;
      // The share of a contribution or a tip: not while a refund of that contribution is with Stripe and unanswered,
      // exactly as for the first request. (A reversal Stripe already made is still found and booked below.)
      if (isRefund(cause) && cause.contributionRefundId !== null && (await refundUnderWay(tx, whole.paymentId))) return false;
      // Nor for more than is left to take out of the transfer, as the app knows it NOW: the founder may have recorded
      // a payment outside the app, or a part of a reversal made by hand, since the taking was written down. (A
      // reversal Stripe already made for this attempt is still found and booked below.)
      if (params.amountCents > (await roomToTake(tx, whole))) return false;
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
    const until = Date.now() + SEARCH_WITHIN_MS;
    await lookUp(async () => {
      for await (const reversal of stripe().transfers.listReversals(params.transferId, { limit: 100 }, { timeout: SEARCH_WITHIN_MS })) {
        // This very attempt's request, by its label and its amount: a reversal that only carries the take-back's id is not booked as this one.
        if (isAttempt(reversal, { label: operation.label, debtId: params.debtId, amountCents: params.amountCents, labelled: params.labelled === true })) {
          reversalId = reversal.id;
          break;
        }
        if (Date.now() > until) throw new Error("the search through this transfer's reversals took too long");
      }
      // (Also when the last page came late and held nothing: a search that ran past its time proves nothing.)
      if (reversalId === undefined && Date.now() > until) throw new Error("the search through this transfer's reversals took too long");
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
    await freeSetAside(tx, debt.paymentId, debt.disputeId);
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
    await freeSetAside(tx, debt.paymentId, debt.disputeId);
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
 * from the message. Only a failure is acted on here; a refund that went through is finished by the helper's own look.
 */
export async function refundChangedAtStripe(stripeRefundId: string, now: Date = new Date()): Promise<void> {
  const atStripe = await stripe()
    .refunds.retrieve(stripeRefundId)
    .catch((error: { code?: string }) => {
      if (error?.code === "resource_missing") return null; // Stripe does not know it: not ours
      throw error;
    });
  if (!atStripe || (atStripe.status !== "failed" && atStripe.status !== "canceled")) return;
  // Which line it is: the one that carries Stripe's number for it. Only when no line does (the app has not recorded
  // Stripe's answer to its request yet) is it found by the app's own number, which the refund carries AT STRIPE (read
  // from Stripe, not from the message), and then only a line that is still on its way, has no Stripe number of its
  // own, and is for the same charge and the same amount. A number somebody typed onto another refund by hand can
  // therefore never reach a refund that Stripe has already answered about.
  let rows = await db.select({ id: schema.refunds.id }).from(schema.refunds).where(eq(schema.refunds.stripeRefundId, atStripe.id));
  const ours = atStripe.metadata?.refundId;
  if (rows.length === 0 && ours && IS_ID.test(ours)) {
    const intentId = typeof atStripe.payment_intent === "string" ? atStripe.payment_intent : (atStripe.payment_intent?.id ?? null);
    rows = intentId
      ? await db
          .select({ id: schema.refunds.id })
          .from(schema.refunds)
          .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
          .where(and(eq(schema.refunds.id, ours), eq(schema.refunds.status, "in_progress"), isNull(schema.refunds.stripeRefundId), eq(schema.refunds.amountCents, atStripe.amount), eq(schema.payments.stripePaymentIntentId, intentId)))
      : [];
  }
  for (const refund of rows) await refundFailedAtStripe(refund.id, atStripe.failure_reason ?? `Stripe says: ${atStripe.status}`, now, atStripe.id);
  // Neither a call's refund nor a share's own line: a refund of a contribution or a tip that was confirmed and has no
  // line on its share (it was given before the host collected, or in the old way from Connect's own money).
  if (rows.length === 0) {
    const [line] = await db.select({ id: schema.contributionRefunds.id }).from(schema.contributionRefunds).where(and(eq(schema.contributionRefunds.stripeRefundId, atStripe.id), eq(schema.contributionRefunds.status, "done")));
    if (line) await undoFailedContributionRefund(line.id, atStripe.id, atStripe.failure_reason ?? `Stripe says: ${atStripe.status}`, now);
  }
}

/**
 * A refund of a contribution or a tip that Stripe confirmed and then says failed, where the share has no refund line
 * of its own (it was given before the host collected, or in the old way from Connect's own money). The customer got
 * nothing, so the app's record of it is undone, with the contribution's locks and the share held, and only once: the
 * contribution's payment counts as refunded by that much less, what went back is written back, the share is made
 * whole again (or Connect's cost is taken off its books), and the line is over ("failed"). It is not sent again by
 * itself: a new refund is a new decision, and the founder is told. While money is moving on the payment or its share
 * it throws, so that Stripe delivers its message again later.
 */
export async function undoFailedContributionRefund(lineId: string, stripeRefundId: string, reason: string, now: Date = new Date()): Promise<boolean> {
  const [seen] = await db.select({ parentId: schema.contributionRefunds.contributionPaymentId }).from(schema.contributionRefunds).where(eq(schema.contributionRefunds.id, lineId));
  if (!seen) return false;
  // Its share has a line of its own: it is undone from there, with her take-back.
  const [own] = await db.select({ id: schema.refunds.id }).from(schema.refunds).where(eq(schema.refunds.contributionRefundId, lineId));
  if (own) return undoFailedRefund(own.id, reason, now);
  return db.transaction(async (tx) => {
    await lockForPayment(tx, seen.parentId);
    const share = await lockShare(tx, seen.parentId);
    const [line] = await tx.select().from(schema.contributionRefunds).where(eq(schema.contributionRefunds.id, lineId)).for("update");
    // Only the very line, still done, that carries this very refund of Stripe's.
    if (!line || line.status !== "done" || line.stripeRefundId !== stripeRefundId) return false;
    const [moving] = await tx
      .select({ id: schema.moneyOperations.id })
      .from(schema.moneyOperations)
      .where(and(or(eq(schema.moneyOperations.contributionPaymentId, seen.parentId), share ? eq(schema.moneyOperations.paymentId, share.id) : undefined), eq(schema.moneyOperations.status, "started")))
      .limit(1);
    if (moving) throw new Error(`Refund ${line.id} of a contribution failed at Stripe after it was confirmed, and money is moving on its payment: it is undone when Stripe's message comes again.`);
    const note = `The refund ${line.id} failed at Stripe after it had been confirmed.`;
    await tx.update(schema.contributionRefunds).set({ status: "failed", failedAt: now }).where(eq(schema.contributionRefunds.id, line.id));
    await tx.update(schema.contributionPayments).set({ refundedCents: sql`greatest(0, ${schema.contributionPayments.refundedCents} - ${line.amountCents})`, updatedAt: now }).where(eq(schema.contributionPayments.id, seen.parentId));
    await addLedgerEntry(tx, { contributionPaymentId: seen.parentId, kind: "customer_refund", amountCents: line.amountCents, stripeRef: stripeRefundId, note });
    // What the host was sent while her share was smaller than it now is again. The app does not send it by itself.
    let underpaid = 0;
    if (line.connectsOwn) {
      // The old way: her share was never touched, and the whole refund stood in the books as Connect's cost.
      await addLedgerEntry(tx, { contributionPaymentId: seen.parentId, kind: "connect_cost", amountCents: -line.amountCents, stripeRef: stripeRefundId, note });
    } else if (share && share.chargedCents !== null && share.originalHostShareCents !== null) {
      const before = currentSplit(share);
      const refundedCents = Math.max(0, share.refundedCents - line.amountCents);
      const after = splitAfterRefunds({ chargeCents: share.chargedCents, refundedCents, originalHostShareCents: share.originalHostShareCents });
      // A share that this refund had left with nothing is owed again, and waits for its day like any other.
      await tx.update(schema.payments).set({ refundedCents, transferStatus: share.transferStatus === "not_owed" && after.hostShareCents > 0 ? "not_due" : share.transferStatus, updatedAt: now }).where(eq(schema.payments.id, share.id));
      await addLedgerEntry(tx, { paymentId: share.id, kind: "platform_fee", amountCents: after.feeCents - before.feeCents, stripeRef: stripeRefundId, note });
      await addLedgerEntry(tx, { paymentId: share.id, kind: "host_share", amountCents: after.hostShareCents - before.hostShareCents, stripeRef: stripeRefundId, note });
      if (share.transferStatus === "sent") underpaid = Math.max(0, after.hostShareCents - before.hostShareCents);
    }
    const about = await aboutOwner(tx, { kind: "contribution", id: seen.parentId });
    const people = about ? await peopleFor(tx, about) : null;
    if (about && people) {
      const names = { host: people.hostName, customer: people.customer.name };
      for (const founder of people.founders) {
        const told = contributionRefundFailedWordsForFounder({ what: about.what("founder", founder, names), customerName: people.customer.name, hostName: people.hostName, refunded: formatMoney(line.amountCents), reason, connectsOwn: line.connectsOwn, underpaid: underpaid > 0 ? formatMoney(underpaid) : null });
        await queueEmail(tx, { to: founder.email, key: `contribution-refund-failed-late:${line.id}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\nThe projects page (admin login):\n${appUrl()}/admin/projects\n` });
      }
    }
    return true;
  });
}

/**
 * Stripe says, for good, that a refund failed. Applied with the payment held, by what the refund's line says at that
 * very moment, so that an answer somebody read a moment earlier can never be written over it afterwards:
 *   - on its way: marked failed, for good, with Stripe's number (also when the app had not recorded that number yet:
 *     the action that is still finding out what Stripe answered then ends as it will, and a "paid" it read earlier is
 *     ignored, because only a refund that is on its way is ever confirmed);
 *   - confirmed: undone (undoFailedRefund), now or, while money is moving on the payment, on the helper's next pass.
 */
export async function refundFailedAtStripe(refundId: string, reason: string, now: Date = new Date(), stripeRefundId: string | null = null): Promise<void> {
  const [seen] = await db.select({ paymentId: schema.refunds.paymentId }).from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!seen) return;
  const state = await db.transaction(async (tx) => {
    await lockPayment(tx, seen.paymentId);
    const [refund] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).for("update");
    if (!refund) return null;
    // Looked at again with the payment held: a line that has meanwhile got Stripe's number for ANOTHER refund is not this one.
    if (stripeRefundId !== null && refund.stripeRefundId !== null && refund.stripeRefundId !== stripeRefundId) return null;
    if (refund.status !== "in_progress") return refund.status;
    await tx.update(schema.refunds).set({ status: "failed", finishedAt: now, failure: reason.slice(0, 500), stripeRefundId: refund.stripeRefundId ?? stripeRefundId }).where(eq(schema.refunds.id, refund.id));
    return "in_progress";
  });
  if (state === "done") await undoFailedRefund(refundId, reason, now);
}

/**
 * Undoes the app's record of a refund that failed at Stripe after it had been confirmed. With the payment held and
 * only once: the payment counts as refunded by that much less, the three lines in the books are written back, and
 * the take-back that came from it is called off with no cost to anyone. What the host had already paid back for it
 * (taken, by hand, or outside the app) is not sent back by the app: she and the founder are told. The founder is
 * always told, because the customer did not get the money.
 */
export async function undoFailedRefund(refundId: string, reason: string, now: Date = new Date()): Promise<boolean> {
  const [seen] = await db.select({ paymentId: schema.refunds.paymentId, sourceId: schema.refunds.contributionRefundId }).from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!seen) return false;
  // A share's line that stands for the refund of a contribution or a tip (plans/50-part-1-gifts-owed-back.md): the
  // contribution's payment it belongs to. Its locks are taken first, in that machine's own order, and the share after.
  const owner = seen.sourceId ? await ownerOfShare(db, seen.paymentId) : null;
  const parentId = owner?.kind === "contribution" ? owner.id : null;
  return db.transaction(async (tx) => {
    if (parentId) await lockForPayment(tx, parentId);
    const payment = await lockPayment(tx, seen.paymentId);
    // The contribution's own line comes before the share's line (the one order of locks).
    const [source] = seen.sourceId ? await tx.select().from(schema.contributionRefunds).where(eq(schema.contributionRefunds.id, seen.sourceId)).for("update") : [];
    const [refund] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).for("update");
    if (!refund || refund.status !== "done" || payment.chargedCents === null || payment.originalHostShareCents === null) return false;
    // Both sides are undone, or neither: only for the very line of the contribution, still done, that carries the very
    // same refund of Stripe's. Anything else is left exactly as it is, for a person to look at.
    if (refund.contributionRefundId !== null && (!parentId || !source || source.id !== refund.contributionRefundId || source.contributionPaymentId !== parentId || source.status !== "done" || source.stripeRefundId === null || source.stripeRefundId !== refund.stripeRefundId)) {
      console.error(`[disputes] refund ${refund.id} of a contribution's share failed at Stripe after all, and its contribution's line ${refund.contributionRefundId} is not the one that was confirmed: nothing was changed. Look at it.`);
      return false;
    }
    const rows = await tx.select().from(debts).where(eq(debts.paymentId, payment.id));
    // Not while money is moving on this payment (a taking, a sending of the share, another refund): what comes of
    // that is found out first. The failure is kept on the refund's line, and the helper comes back to it on every
    // pass until it is undone: it is never lost because the moment was wrong.
    const [moving] = await tx.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started"))).limit(1);
    // (For a contribution's share also an action of the contribution's payment: another refund of it, above all.)
    const [movingOnParent] = parentId ? await tx.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.contributionPaymentId, parentId), eq(schema.moneyOperations.status, "started"))).limit(1) : [];
    // (And another refund of it that Stripe has accepted and not finished: its action is over, its outcome is not.)
    const [withStripe] = parentId ? await tx.select({ id: schema.contributionRefunds.id }).from(schema.contributionRefunds).where(and(eq(schema.contributionRefunds.contributionPaymentId, parentId), eq(schema.contributionRefunds.status, "at_stripe"))).limit(1) : [];
    if (moving || movingOnParent || withStripe || rows.some((row) => row.status === "taking")) {
      if (refund.undoPendingAt === null) await tx.update(schema.refunds).set({ undoPendingAt: now, failure: reason.slice(0, 500) }).where(eq(schema.refunds.id, refund.id));
      return false;
    }

    const split = (refunded: number) => splitAfterRefunds({ chargeCents: payment.chargedCents!, refundedCents: refunded, originalHostShareCents: payment.originalHostShareCents! });
    const before = currentSplit(payment);
    const refundedCents = Math.max(0, payment.refundedCents - refund.amountCents);
    const after = split(refundedCents);

    // A refund given BEFORE she collected had made her share smaller, and that smaller share is what was sent. What
    // was therefore never sent to her is worked out where it happened, at the collection: her share after the OTHER
    // refunds given before the sending, less what was really sent with its charge for collecting, and less what
    // she was already told is owed to her for an earlier refund of this kind. (Refunds given after the sending do
    // not come into it: they are take-backs of their own.) The app does not send it by itself.
    let underpaid = 0;
    if (!refund.afterCollection && payment.transferStatus === "sent") {
      const others = await tx.select({ id: schema.refunds.id, status: schema.refunds.status, amountCents: schema.refunds.amountCents, underpaidCents: schema.refunds.underpaidCents }).from(schema.refunds).where(and(eq(schema.refunds.paymentId, payment.id), eq(schema.refunds.afterCollection, false), ne(schema.refunds.id, refund.id)));
      const stillStanding = others.filter((one) => one.status === "done").reduce((sum, one) => sum + one.amountCents, 0);
      const alreadyTold = others.reduce((sum, one) => sum + one.underpaidCents, 0);
      underpaid = Math.max(0, split(stillStanding).hostShareCents - ((payment.transferCents ?? 0) + (payment.payoutFeeCents ?? 0)) - alreadyTold);
    }

    await tx.update(schema.refunds).set({ status: "failed", failure: reason.slice(0, 500), failedLateAt: now, undoPendingAt: null, underpaidCents: underpaid }).where(eq(schema.refunds.id, refund.id));
    // A share that this refund had left with nothing is owed again, and waits for its day like any other.
    await tx
      .update(schema.payments)
      .set({ refundedCents, transferStatus: payment.transferStatus === "not_owed" && after.hostShareCents > 0 ? "not_due" : payment.transferStatus, updatedAt: now })
      .where(eq(schema.payments.id, payment.id));
    const note = `The refund ${refund.id} failed at Stripe after it had been confirmed.`;
    if (parentId && source) {
      // What went back to the card stands once, under the contribution's payment: it is written back there, that
      // payment counts as refunded by that much less, and the contribution's own line is over ("failed"). It is not
      // tried again by itself: a new refund is a new decision, as for a call. (That it is the very line was judged
      // above, before anything was changed.)
      await tx.update(schema.contributionRefunds).set({ status: "failed", failedAt: now }).where(eq(schema.contributionRefunds.id, source.id));
      await tx.update(schema.contributionPayments).set({ refundedCents: sql`greatest(0, ${schema.contributionPayments.refundedCents} - ${source.amountCents})`, updatedAt: now }).where(eq(schema.contributionPayments.id, parentId));
      await addLedgerEntry(tx, { contributionPaymentId: parentId, kind: "customer_refund", amountCents: source.amountCents, stripeRef: refund.stripeRefundId, note });
    } else {
      await addLedgerEntry(tx, { paymentId: payment.id, kind: "customer_refund", amountCents: refund.amountCents, stripeRef: refund.stripeRefundId, note });
    }
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: after.feeCents - before.feeCents, stripeRef: refund.stripeRefundId, note });
    await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: after.hostShareCents - before.hostShareCents, stripeRef: refund.stripeRefundId, note });

    // Its take-back, if one was written and shown to anyone.
    const debt = rows.find((row) => row.refundId === refund.id && row.status !== "nothing") ?? null;
    let forFounder: { amount: string; paidBack: string | null } | null = null;
    if (debt && debt.leftoverToldAt === null) {
      const wasOpen = RESERVED.includes(debt.status);
      // What she really paid for it, less what the founder was already told to give back of it.
      const paid = toGiveBackCents(debt);
      // What was first written as owed, whatever a reversal by hand has since paid of it.
      const first = { ...debt, amountCents: debt.amountCents + debt.byHandCents, byHandCents: 0 };
      if (wasOpen) await tx.update(debts).set({ status: "cancelled", cancelledAt: now, dueAt: null, updatedAt: now }).where(eq(debts.id, debt.id));
      await fellAway(tx, debt, now, `refund ${refund.id} failed at Stripe after all`);
      // She is told when she still had it before her as owed, or had paid something for it.
      if (wasOpen || paid > 0) await tellHost(tx, first, refund, "fell-away", (facts) => refundFellAwayWords(facts, paid > 0 ? formatMoney(paid) : null));
      forFounder = { amount: formatMoney(first.amountCents), paidBack: paid > 0 ? formatMoney(paid) : null };
    }
    // The refunds that are left: what each takes off her share is worked out again, in their order, now that this
    // one is gone (the cents can fall differently).
    const excess = await reworkRefundsLeft(tx, payment, refundedCents, now);
    await freeSetAside(tx, payment.id);

    const about = await aboutOwner(tx, await ownerOfShare(tx, payment.id));
    const people = about ? await peopleFor(tx, about) : null;
    if (about && people) {
      const names = { host: people.hostName, customer: people.customer.name };
      if (underpaid > 0) {
        const told = shareRestoredWords({ what: about.what("host", people.host, names), customerName: people.customer.name, underpaid: formatMoney(underpaid), supportEmail: SUPPORT_EMAIL });
        await tell(tx, { to: people.host, key: `refund-failed-late:${refund.id}:host:${people.host.id}`, subject: told.subject, text: told.text, path: "/host" });
      }
      for (const founder of people.founders) {
        const told = refundFellAwayWordsForFounder({
          what: about.what("founder", founder, names),
          customerName: people.customer.name,
          hostName: people.hostName,
          refunded: formatMoney(refund.amountCents),
          reason,
          debt: forFounder,
          underpaid: underpaid > 0 ? formatMoney(underpaid) : null,
          excess: excess > 0 ? formatMoney(excess) : null,
        });
        await queueEmail(tx, { to: founder.email, key: `refund-failed-late:${refund.id}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\n${debt ? `The take-back's page (admin login):\n${appUrl()}${debtPath(debt.id)}?as=founder` : parentId ? `The projects page (admin login):\n${appUrl()}/admin/projects` : `The refund page (admin login):\n${appUrl()}/admin/refund`}\n` });
      }
    }
    return true;
  });
}

/**
 * After a refund was undone: the refunds of the payment that are left, given after the sending, in their order. What
 * each takes off her share is worked out again from the payment as it now stands and written on the refund. That is
 * the most its take-back may ask (and never more than was sent). Then, for its take-back:
 *   - still open: if more is on it than that, it is lowered to it (never raised), and she is told the new amount; one
 *     that comes down to nothing is called off, and she is told that too;
 *   - already ended: what she really paid is compared with it. Only what she paid ABOVE it is too much, and that is
 *     added up for the founder to give back. A part that Connect had waived is not money she paid: where the waiver
 *     is now larger than what was left to waive, the cost in the books is lowered instead.
 */
async function reworkRefundsLeft(tx: Tx, payment: { id: string; chargedCents: number | null; originalHostShareCents: number | null; transferCents: number | null }, refundedCents: number, now: Date): Promise<number> {
  if (payment.chargedCents === null || payment.originalHostShareCents === null) return 0;
  const left = (await tx.select().from(schema.refunds).where(and(eq(schema.refunds.paymentId, payment.id), eq(schema.refunds.afterCollection, true), eq(schema.refunds.status, "done")))).sort((a, b) => (earlier(a, b) ? -1 : 1));
  const split = (refunded: number) => splitAfterRefunds({ chargeCents: payment.chargedCents!, refundedCents: refunded, originalHostShareCents: payment.originalHostShareCents! });
  // Everything refunded that is not one of these (before the sending) comes first.
  let running = Math.max(0, refundedCents - left.reduce((sum, one) => sum + one.amountCents, 0));
  let reductions = 0;
  let excess = 0;
  for (const one of left) {
    const [before, after] = [split(running), split(running + one.amountCents)];
    running += one.amountCents;
    const owes = Math.max(0, before.hostShareCents - after.hostShareCents);
    // The most this refund's take-back may ask now: what it adds to the reductions, never counted beyond what was sent.
    const most = refundOwes({ sentCents: payment.transferCents ?? 0, reductionsBeforeCents: reductions, reductionCents: owes, roomCents: Number.MAX_SAFE_INTEGER });
    reductions += owes;
    if (owes !== one.hostOwesCents || one.shareBeforeCents !== before.hostShareCents || one.shareAfterCents !== after.hostShareCents) {
      await tx.update(schema.refunds).set({ shareBeforeCents: before.hostShareCents, shareAfterCents: after.hostShareCents, feeBeforeCents: before.feeCents, feeAfterCents: after.feeCents, hostOwesCents: owes }).where(eq(schema.refunds.id, one.id));
    }
    const [debt] = await tx.select().from(debts).where(and(eq(debts.refundId, one.id), ne(debts.status, "nothing"))).for("update");
    if (!debt) continue;
    const fresh = { ...one, shareBeforeCents: before.hostShareCents, shareAfterCents: after.hostShareCents, hostOwesCents: owes };
    // What she has paid above that most, and was not yet told to get back: money she paid too much, whatever state
    // the take-back is in (also what a reversal by hand took of one that is still open, or was called off).
    const over = Math.max(0, paidBackCents(debt) - most - debt.excessToldCents);
    if (over > 0) {
      excess += over;
      await tx.update(debts).set({ excessToldCents: debt.excessToldCents + over, updatedAt: now }).where(eq(debts.id, debt.id));
    }
    if (RESERVED.includes(debt.status)) {
      // What may still be asked: that most, less what a reversal by hand has already paid of it.
      const stillOwed = Math.max(0, most - debt.byHandCents);
      if (debt.amountCents <= stillOwed) continue;
      const was = formatMoney(debt.amountCents + debt.byHandCents);
      const covered = stillOwed === 0 && debt.byHandCents > 0;
      const [lowered] = await tx
        .update(debts)
        .set({ amountCents: stillOwed, ...(stillOwed === 0 ? (covered ? { status: "taken", takenAt: now, dueAt: null } : { status: "cancelled", cancelledAt: now, dueAt: null }) : {}), updatedAt: now })
        .where(eq(debts.id, debt.id))
        .returning();
      await tellHost(tx, lowered, fresh, `lowered:${stillOwed}`, (facts) => loweredWords(facts, was, covered ? "covered" : stillOwed === 0 ? "nothing" : "lower"));
    } else if (debt.costBookedCents > 0) {
      // Ended with a cost of Connect's in the books (called off by the founder, or settled for less): a waiver can
      // cover no more than what was left to pay. The rest of it was never a cost.
      const fairCost = Math.max(0, most - paidBackCents(debt));
      if (debt.costBookedCents > fairCost) {
        await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "connect_cost", amountCents: fairCost - debt.costBookedCents, stripeRef: null, note: `Less was owed for refund ${one.id} than was worked out: an earlier refund of the payment failed at Stripe after all.` });
        await tx.update(debts).set({ costBookedCents: fairCost, updatedAt: now }).where(eq(debts.id, debt.id));
      }
    }
  }
  return excess;
}

// ---------------------------------------------------------------------------
// A reversal somebody made by hand at Stripe
// ---------------------------------------------------------------------------

export type HandReversalSeen = { id: string; amountCents: number; /** The part of it nobody has accounted for yet. */ openCents: number; at: Date; /** What the reversal carries at Stripe, for looking at it again. */ metadata: Record<string, string> };

/** A taking that was written down: its label, its take-back, its amount, and whether its request carries the label (every one written since labels exist does). */
type Attempt = { label: string; debtId: string; amountCents: number; labelled: boolean };

/**
 * Whether a reversal Stripe shows is the one a written-down taking asked for. Its amount has to be the attempt's. And
 * it has to carry that very attempt's label; only for an attempt written down before labels existed (its request
 * could not carry one) does the take-back's id stand in, on a reversal that carries no label at all. So a reversal
 * somebody made by hand and marked with a take-back's id is never taken for a new attempt's own request.
 */
function isAttempt(reversal: { amount: number; metadata?: Record<string, string> | null }, attempt: Attempt): boolean {
  const meta = reversal.metadata ?? {};
  if (reversal.amount !== attempt.amountCents) return false;
  return meta.attempt ? meta.attempt === attempt.label : !attempt.labelled && meta.debtId === attempt.debtId;
}

/**
 * Of some reversals of a transfer, as Stripe showed them: the ones the app did not make for a take-back of this share,
 * with the part of each that the founder has not accounted for yet. Everything is read from the database through ONE
 * reader, so in one picture: the app's own reversals are known by their numbers, which the take-backs keep, and one
 * whose answer is not recorded yet by the attempt that asked for it (a taking that is written down and unanswered).
 * Read at two moments, the same reversal could be in neither list for an instant.
 */
async function unaccounted(reader: Reader, debt: Pick<HostDebt, "paymentId" | "stripeTransferId">, seen: Array<{ id: string; amount: number; created: number; metadata?: Record<string, string> | null }>): Promise<HandReversalSeen[]> {
  const rows = await reader.select({ stripeReversalId: debts.stripeReversalId }).from(debts).where(eq(debts.paymentId, debt.paymentId));
  const recorded = new Set(rows.map((row) => row.stripeReversalId).filter((id): id is string => id !== null));
  const attempts: Attempt[] = (await reader.select({ label: schema.moneyOperations.label, params: schema.moneyOperations.params }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, debt.paymentId), eq(schema.moneyOperations.kind, "take_back"), eq(schema.moneyOperations.status, "started")))).map((one) => {
    const params = JSON.parse(one.params) as TakeParams;
    return { label: one.label, debtId: params.debtId, amountCents: params.amountCents, labelled: params.labelled === true };
  });
  const counted = new Map<string, number>();
  for (const line of await reader.select({ id: counts.stripeReversalId, cents: counts.cents }).from(counts).where(eq(counts.stripeTransferId, debt.stripeTransferId))) counted.set(line.id, (counted.get(line.id) ?? 0) + line.cents);
  const open: HandReversalSeen[] = [];
  for (const reversal of seen) {
    if (recorded.has(reversal.id) || attempts.some((attempt) => isAttempt(reversal, attempt))) continue;
    const openCents = reversal.amount - (counted.get(reversal.id) ?? 0);
    if (openCents > 0) open.push({ id: reversal.id, amountCents: reversal.amount, openCents, at: new Date(reversal.created * 1000), metadata: reversal.metadata ?? {} });
  }
  return open;
}

/**
 * The reversals of a transfer that the app did not make for a take-back of this share, with the part of each that the
 * founder has not accounted for yet. While there is such a part, the app takes nothing more from that transfer by
 * itself: it may already have paid the very take-back the app is about to take. Asks Stripe first (every page, within
 * a limit of time), then reads the app's own record in one picture; throws when Stripe cannot be asked, and the
 * caller then does nothing for now.
 */
export async function handReversalsOpen(debt: Pick<HostDebt, "paymentId" | "stripeTransferId">): Promise<HandReversalSeen[]> {
  const seen: Array<{ id: string; amount: number; created: number; metadata?: Record<string, string> | null }> = [];
  const until = Date.now() + SEARCH_WITHIN_MS;
  for await (const reversal of stripe().transfers.listReversals(debt.stripeTransferId, { limit: 100 }, { timeout: SEARCH_WITHIN_MS })) {
    if (Date.now() > until) throw new Error("the search through this transfer's reversals took too long");
    seen.push({ id: reversal.id, amount: reversal.amount, created: reversal.created, metadata: reversal.metadata });
  }
  // (Also when the last page came late: a list that was read past its time is not relied on.)
  if (Date.now() > until) throw new Error("the search through this transfer's reversals took too long");
  if (seen.length === 0) return [];
  // After Stripe's list, and in one picture: a reversal of the app's own that Stripe already shows is then either
  // still an unanswered attempt or already recorded, never neither.
  return db.transaction((tx) => unaccounted(tx, debt, seen), { isolationLevel: "repeatable read", accessMode: "read only" });
}

/**
 * Tells the founder, once for that reversal, that a reversal made by hand is unaccounted for on a take-back's
 * transfer. A take-back that would be taken now is marked as held for it. Looked at once more with the share's
 * payment held: a reversal that turns out to be the app's own (its answer was recorded meanwhile) is not told.
 */
async function tellOfHand(debt: HostDebt, open: HandReversalSeen[], now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await lockPayment(tx, debt.paymentId);
    const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
    if (!fresh || fresh.status === "nothing") return;
    const still = await unaccounted(tx, fresh, open.map((one) => ({ id: one.id, amount: one.amountCents, created: Math.floor(one.at.getTime() / 1000), metadata: one.metadata })));
    if (still.length === 0) return;
    const cause = await causeOf(tx, fresh);
    if (!cause) return;
    if (TAKEABLE.includes(fresh.status) && fresh.handToldAt === null) await tx.update(debts).set({ handToldAt: now, updatedAt: now }).where(eq(debts.id, fresh.id));
    const total = still.reduce((sum, one) => sum + one.openCents, 0);
    // Under a key of the whole set: the same set is told once, and a set that has grown is told again with its new total.
    await tellFounders(tx, fresh, cause, `hand:${still.map((one) => one.id).sort().join("+")}`, (facts) => handHeldWordsForFounder(facts, formatMoney(total), ["taken", "settled", "cancelled"].includes(fresh.status)), true);
  });
}

/**
 * Stripe's message that a transfer was reversed. The app's own reversals are known; one made by hand is not, and the
 * founder is told at once, also when every take-back of that share has already ended: if it was meant for one of
 * them, the host has paid twice.
 */
export async function reversalSeenOnTransfer(stripeTransferId: string, now: Date = new Date()): Promise<void> {
  const rows = await db.select().from(debts).where(and(eq(debts.stripeTransferId, stripeTransferId), ne(debts.status, "nothing"))).orderBy(sql`${debts.createdAt} desc`);
  if (rows.length === 0) return;
  const open = await handReversalsOpen(rows[0]);
  if (open.length === 0) return;
  await tellOfHand(rows.find((row) => TAKEABLE.includes(row.status)) ?? rows.find((row) => RESERVED.includes(row.status)) ?? rows[0], open, now);
}

/**
 * What can still be taken out of a share's transfer for a take-back, as the app knows it: what is left on the
 * transfer (leftOnTransfer), less what she paid back outside Stripe for this share. A take-back is never taken for
 * more than this, whatever it was written for: what the founder has recorded since (a payment outside the app, a
 * part of a reversal made by hand) may have used up room that was there when it was written.
 */
async function roomToTake(tx: Tx, debt: Pick<HostDebt, "paymentId">): Promise<number> {
  const rows = await tx.select().from(debts).where(eq(debts.paymentId, debt.paymentId));
  const [share] = await tx.select({ transferCents: schema.payments.transferCents }).from(schema.payments).where(eq(schema.payments.id, debt.paymentId));
  return Math.max(0, (await leftOnTransfer(tx, debt.paymentId, share?.transferCents ?? 0, rows)) - repaidOutsideStanding(rows));
}

/**
 * The founder says what a reversal made by hand was for, or a part of it (`cents`; all that fits, when none is given):
 *   - "paid": that part paid this take-back, which is still open. It is counted for it (in the books as taken back),
 *     never for more than the take-back still owes; only the rest of the take-back stays owed.
 *   - "twice": that part was taken for this take-back although it had already ended (taken, settled, or called off).
 *     It is booked as taken back and marked as owed back to her, and she and the founder are told. The app does not
 *     send it back by itself.
 *   - "other": that part had nothing to do with a take-back.
 * A part of the reversal that is left over stays unaccounted for, and the hold stays, until the founder has said what
 * it was for. So one reversal can pay an open take-back in part and be a second payment of an ended one in part.
 * Each cent of a reversal is counted once, ever: what is still open is read again with the share's payment held. And
 * a form is counted once: it names what was open when it was shown (`openWasCents`), and if that is no longer so
 * (the same form sent twice, or another person was quicker), nothing is counted.
 */
export async function countHandReversal(input: { debtId: string; adminId: string; reversalId: string; as: "paid" | "twice" | "other"; cents?: number; openWasCents?: number; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const [seen] = await db.select().from(debts).where(eq(debts.id, input.debtId));
  if (!seen) return false;
  // Asked of Stripe first, outside any lock: it has to be a reversal of this very transfer with a part still open.
  const reversal = (await handReversalsOpen(seen)).find((one) => one.id === input.reversalId);
  if (!reversal) throw new DebtError("That reversal is not one that is waiting to be accounted for on this transfer.");
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found) return false;
    const { debt, dispute: cause } = found;
    const [{ already }] = await tx.select({ already: sql<number>`coalesce(sum(${counts.cents}), 0)::int` }).from(counts).where(eq(counts.stripeReversalId, reversal.id));
    const open = reversal.amountCents - already;
    if (open <= 0) return false;
    if (input.openWasCents !== undefined && input.openWasCents !== open) throw new DebtError("Part of this reversal was accounted for since this page was shown (or this form was sent twice). Nothing was counted now. Look at the page again.");
    if (input.as === "paid" && !RESERVED.includes(debt.status)) throw new DebtError("This take-back is no longer open, so a reversal cannot be counted as having paid it. If it was taken for it all the same, the host is owed it back: say so instead.");
    if (input.as === "twice" && !["taken", "settled", "cancelled"].includes(debt.status)) throw new DebtError("This take-back has not ended. If the reversal was for it, count it as having paid it.");
    // The most that fits: what is open of the reversal, and for a take-back that is still open, no more than it still owes.
    const most = input.as === "paid" ? Math.min(open, debt.amountCents) : open;
    const cents = input.cents ?? most;
    if (!Number.isInteger(cents) || cents < 1 || cents > most) throw new DebtError(most < 1 ? "Nothing of this reversal can be counted here." : `The part has to be between $0.01 and ${formatMoney(most)}.`);
    await tx.insert(counts).values({ stripeReversalId: reversal.id, stripeTransferId: debt.stripeTransferId, paymentId: debt.paymentId, kind: input.as, debtId: input.as === "other" ? null : debt.id, cents, decidedBy: input.adminId });
    const action = input.as === "paid" ? "reversal made by hand counted for a take-back" : input.as === "twice" ? "reversal made by hand recorded as taken on top of an ended take-back" : "reversal made by hand marked as not for a take-back";
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action, targetUserId: debt.hostId, targetId: debt.id });
    if (input.as === "paid") {
      const left = debt.amountCents - cents;
      await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "host_takeback", amountCents: cents, stripeRef: reversal.id, note: `Taken back from the host by a reversal made by hand at Stripe, counted for take-back ${debt.id}.` });
      const [after] = await tx
        .update(debts)
        // (A take-back that a reversal by hand paid in full is "taken" with nothing left on it and no reversal of the app's own.)
        .set({ amountCents: left, byHandCents: debt.byHandCents + cents, ...(left === 0 ? { status: "taken", takenAt: now, dueAt: null } : {}), updatedAt: now })
        .where(eq(debts.id, debt.id))
        .returning();
      await freeSetAside(tx, debt.paymentId, debt.disputeId);
      await tellHost(tx, after, cause, `hand:${reversal.id}:${already}`, (facts) => handCountedWords(facts, formatMoney(cents), left > 0 ? formatMoney(left) : null));
    } else if (input.as === "twice") {
      await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "host_takeback", amountCents: cents, stripeRef: reversal.id, note: `Taken from the host by a reversal made by hand at Stripe on top of take-back ${debt.id}, which had ended: owed back to the host.` });
      const [after] = await tx.update(debts).set({ overpaidCents: debt.overpaidCents + cents, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
      const ended = debt.status === "cancelled" ? "called_off" : "paid";
      await tellHost(tx, after, cause, `twice:${reversal.id}:${already}`, (facts) => handTwiceWords("host", facts, formatMoney(cents), ended));
      await tellFounders(tx, after, cause, `twice:${reversal.id}:${already}`, (facts) => handTwiceWords("founder", facts, formatMoney(cents), ended), true);
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
  // A refund that failed after all and could not be undone at that moment (money was moving on its payment).
  for (const waiting of await db.select({ id: schema.refunds.id, failure: schema.refunds.failure }).from(schema.refunds).where(and(isNotNull(schema.refunds.undoPendingAt), eq(schema.refunds.status, "done"), only ? inArray(schema.refunds.id, only.refundIds ?? []) : undefined))) {
    await undoFailedRefund(waiting.id, waiting.failure ?? "Stripe says it failed.", now).catch((error) => log(`could not undo refund ${waiting.id}, which failed at Stripe after all`, error));
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
  const about = await aboutOwner(db, isRefund(cause) ? await ownerOfShare(db, cause.paymentId) : ownerOf(cause));
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
