/**
 * Hosts collect their earnings with a button. There is no payday: nothing is
 * sent to a host unless the host pressed (or the founder did, for a host who
 * can no longer log in).
 *
 * A press is accepted in one locked step, which writes down the collection and
 * every transfer it will make before Stripe is asked anything. Sending comes
 * after that, one share at a time. Whatever is not confirmed by then is
 * finished by the always-on helper (reconcileOperations in jobs.ts), without
 * the host pressing again. The one exception: a transfer the helper only
 * reaches more than 23 hours later is not repeated. If Stripe never made it,
 * that share is ready again for the host's next collection.
 */
import { and, asc, desc, eq, inArray, isNull, like, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, MembershipMonth, Payment } from "@/db/schema";
import { isFrozen } from "@/lib/membership/rules";
import { countPair } from "@/lib/contributions/charge";
import { lockContribution, lockContributionPayment, lockPair } from "@/lib/contributions/locks";
import { applyTransferSent, currentSplit, transferSteps, type TransferParams } from "./actions";
import { requestHolds } from "@/lib/refunds/requests";
import { refreshPayoutsReady } from "./hosts";
import {
  completeMoneyOperation,
  failOperation,
  finishOperation,
  lockPayment,
  MoneyError,
  OutcomeUnknownError,
  startMoneyOperation,
  type StartedOperation,
  type Tx,
} from "./operations";
import { collectionAmounts } from "./pricing";
import { canCollectAgainAt, heldBack, type HeldBack } from "./rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_VALID = "This request is not valid. Reload the page and try again.";
export const DISPUTE_MESSAGE_WAITING =
  "Stripe has told us about a disputed charge and we are still checking which one. Please try again in a few minutes.";

/** A share that was charged and has not been sent to the host. */
const UNSENT = and(eq(schema.payments.status, "charged"), inArray(schema.payments.transferStatus, ["not_due", "due"]));

/** How long one press keeps sending before it leaves the rest to the helper. */
const SEND_FOR_MS = 20_000;

type Reader = Pick<Tx, "select">;

/** For each of these payments: why its share cannot be collected right now, or null if it can. */
async function heldBackNow(reader: Reader, payments: Payment[], now: Date, waitingPairs?: Set<string>): Promise<Map<string, HeldBack | null>> {
  const ids = payments.map((p) => p.id);
  if (ids.length === 0) return new Map();
  const refunds = await reader
    .select({ paymentId: schema.refunds.paymentId })
    .from(schema.refunds)
    .where(and(inArray(schema.refunds.paymentId, ids), eq(schema.refunds.status, "in_progress")));
  const unfinished = await reader
    .select({ paymentId: schema.moneyOperations.paymentId })
    .from(schema.moneyOperations)
    .where(and(inArray(schema.moneyOperations.paymentId, ids), eq(schema.moneyOperations.status, "started")));
  const refunding = new Set(refunds.map((r) => r.paymentId));
  const busy = new Set(unfinished.map((o) => o.paymentId));
  // A refund request that is not answered holds every charge of its call. (Expired member time has no call, and no request.)
  const requests = await requestHolds(reader, [...new Set(payments.flatMap((p) => (p.callId ? [p.callId] : [])))]);
  // Money of a membership's month whose bank dispute is open or lost is held back like a disputed charge.
  const monthIds = [...new Set(payments.flatMap((p) => (p.monthId ? [p.monthId] : [])))];
  const months = monthIds.length > 0 ? await reader.select({ id: schema.membershipMonths.id, dispute: schema.membershipMonths.dispute }).from(schema.membershipMonths).where(inArray(schema.membershipMonths.id, monthIds)) : [];
  const frozen = new Set(months.filter(isFrozen).map((m) => m.id));
  // A contribution's share: its own payment (which owns everything at Stripe) is looked at. It is held back while
  // that payment's dispute is open or lost, the founder holds it, an action of that payment is under way, or a
  // refund of it is owed and not done. So a refund and a collection of the same share never meet.
  const cpIds = [...new Set(payments.flatMap((p) => (p.contributionPaymentId ? [p.contributionPaymentId] : [])))];
  const cps = cpIds.length > 0 ? await reader.select({ id: schema.contributionPayments.id, dispute: schema.contributionPayments.dispute, founderHold: schema.contributionPayments.founderHold }).from(schema.contributionPayments).where(inArray(schema.contributionPayments.id, cpIds)) : [];
  const cpBusy = cpIds.length > 0 ? await reader.select({ id: schema.moneyOperations.contributionPaymentId }).from(schema.moneyOperations).where(and(inArray(schema.moneyOperations.contributionPaymentId, cpIds), eq(schema.moneyOperations.status, "started"))) : [];
  const cpOwing = cpIds.length > 0 ? await reader.select({ id: schema.contributionRefunds.contributionPaymentId }).from(schema.contributionRefunds).where(and(inArray(schema.contributionRefunds.contributionPaymentId, cpIds), ne(schema.contributionRefunds.status, "done"))) : [];
  const cpDisputed = new Set(cps.filter(isFrozen).map((cp) => cp.id));
  const cpHeld = new Set(cps.filter((cp) => cp.founderHold === "held").map((cp) => cp.id));
  const cpUnderWay = new Set(cpBusy.map((row) => row.id));
  const cpRefunding = new Set(cpOwing.map((row) => row.id));
  const of = (p: Payment, set: Set<string | null>) => p.contributionPaymentId !== null && set.has(p.contributionPaymentId);
  return new Map(
    payments.map((p) => [
      p.id,
      heldBack({
        now,
        readyAt: p.transferDueAt,
        disputeOpen: p.disputeOpen || (p.monthId !== null && frozen.has(p.monthId)) || of(p, cpDisputed),
        refundOnItsWay: refunding.has(p.id) || of(p, cpRefunding),
        founderHolds: of(p, cpHeld),
        actionUnfinished: busy.has(p.id) || of(p, cpUnderWay) || (waitingPairs?.has(p.id) ?? false),
        request: p.callId ? (requests.get(p.callId) ?? null) : null,
      }),
    ]),
  );
}

/**
 * Whether a message from Stripe about a bank dispute is still waiting to be handled. It may be
 * about any charge, so until it is handled (the helper does that within minutes) nobody collects.
 */
export async function disputeMessageWaiting(reader: Reader = db): Promise<boolean> {
  const [unhandled] = await reader
    .select({ id: schema.stripeEvents.id })
    .from(schema.stripeEvents)
    .where(and(isNull(schema.stripeEvents.processedAt), like(schema.stripeEvents.type, "charge.dispute.%")))
    .limit(1);
  return Boolean(unhandled);
}

// ---------------------------------------------------------------------------
// Accepting a press
// ---------------------------------------------------------------------------

type StartedTransfer = StartedOperation<TransferParams> & { paymentId: string };

/**
 * Whose money a payment is: the host of its call; for expired member time, the host of its month's
 * membership; for a contribution's share, the host of the contribution. Used with the joins of
 * `withOwners` below, always together.
 */
const hostOfPayment = sql<string>`coalesce(${schema.calls.hostId}, ${schema.memberships.hostId}, ${schema.contributions.hostId})`;

/** Whether any payment of this contributor to this host has an action whose outcome is not known yet. */
async function pairOutcomeUnknown(tx: Tx, contributorId: string, hostId: string): Promise<boolean> {
  const [unknown] = await tx
    .select({ id: schema.moneyOperations.id })
    .from(schema.moneyOperations)
    .innerJoin(schema.contributionPayments, eq(schema.contributionPayments.id, schema.moneyOperations.contributionPaymentId))
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
    .where(and(eq(schema.contributions.contributorId, contributorId), eq(schema.contributions.hostId, hostId), eq(schema.moneyOperations.status, "started")))
    .limit(1);
  return Boolean(unknown);
}

/**
 * Counts the $1,000 rule again for every contributor who has a share with this host that is not
 * sent, each in a step of its own under the pair's lock, and writes any 30 days that are due. A
 * pair with an outcome that is not known is left for now: its shares wait anyway.
 */
async function countPairsOf(hostId: string, now: Date): Promise<void> {
  const givers = await db
    .selectDistinct({ contributorId: schema.contributions.contributorId })
    .from(schema.payments)
    .innerJoin(schema.contributionPayments, eq(schema.contributionPayments.id, schema.payments.contributionPaymentId))
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
    .where(and(eq(schema.contributions.hostId, hostId), UNSENT));
  for (const contributorId of givers.map((row) => row.contributorId).sort()) {
    await db.transaction(async (tx) => {
      await lockPair(tx, contributorId, hostId);
      if (!(await pairOutcomeUnknown(tx, contributorId, hostId))) await countPair(tx, contributorId, hostId, now);
    });
  }
}

/**
 * The locked step. With the host's row locked, so that two presses at once
 * make one collection:
 *   1. this same press, sent again, gets the collection it already made;
 *   2. the 24 hours since the host's last collection are checked;
 *   3. every share that is ready is locked, checked once more, and its
 *      transfer written down as "started", with the exact amounts.
 * From then on the app's standing rule applies to each of those payments: one
 * money action at a time. Nothing has been asked of Stripe yet.
 */
export async function acceptCollection(input: {
  /** Made when the button was shown. */
  collectionId: string;
  hostId: string;
  /** The host, or the founder for a host who can no longer log in. */
  startedBy: string;
  /** Only the check scripts pass this, to pretend it is another day. */
  now?: Date;
}): Promise<{ existing: boolean; started: StartedTransfer[] }> {
  if (!UUID.test(input.collectionId)) throw new MoneyError(NOT_VALID);
  // The $1,000 rule's count for her contribution shares, written in steps of its own first, so that the later
  // dates it finds are kept also when this press ends up with nothing to collect. (The step below counts
  // again under its own locks before it judges anything.)
  await countPairsOf(input.hostId, input.now ?? new Date());

  return db.transaction(async (tx) => {
    const [host] = await tx.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, input.hostId)).for("update");
    // The moment of acceptance is read here, with the host's row locked, not when the press arrived:
    // the 24 hours until the next collection are counted from it.
    const now = input.now ?? new Date();

    const [same] = await tx.select().from(schema.collections).where(eq(schema.collections.id, input.collectionId));
    if (same) {
      if (same.hostId !== input.hostId) throw new MoneyError(NOT_VALID);
      return { existing: true, started: [] };
    }

    if (!host?.stripeAccountId || !host.payoutsReady) {
      throw new MoneyError("The payout account at Stripe is not ready to receive money yet.");
    }
    const destination = host.stripeAccountId;

    const [last] = await tx
      .select({ acceptedAt: schema.collections.acceptedAt })
      .from(schema.collections)
      .where(eq(schema.collections.hostId, input.hostId))
      .orderBy(desc(schema.collections.acceptedAt))
      .limit(1);
    const again = canCollectAgainAt(last?.acceptedAt ?? null);
    if (again && now < again) throw new MoneyError("Earnings were already collected in the last 24 hours.");

    if (await disputeMessageWaiting(tx)) throw new MoneyError(DISPUTE_MESSAGE_WAITING);

    // Lock every share that might be taken, always in the same order, then judge each as it stands now.
    const candidates = await tx
      .select({ id: schema.payments.id, callId: schema.payments.callId, monthId: schema.payments.monthId, contributionPaymentId: schema.payments.contributionPaymentId, contributionId: schema.contributions.id, contributorId: schema.contributions.contributorId })
      .from(schema.payments)
      .leftJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
      .leftJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.payments.monthId))
      .leftJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
      .leftJoin(schema.contributionPayments, eq(schema.contributionPayments.id, schema.payments.contributionPaymentId))
      .leftJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
      .where(and(sql`${hostOfPayment} = ${input.hostId}`, UNSENT, lte(schema.payments.transferDueAt, now)))
      .orderBy(schema.payments.id);
    // The order of locks is the same everywhere: this host's collection, then membership months, then the
    // calls, then their payments, then request and refund records. So whether a month is under a bank dispute,
    // and whether a call has an unanswered refund request, is read with that month and that call locked, in
    // the same step that starts the transfer.
    const monthIds = [...new Set(candidates.flatMap((c) => (c.monthId ? [c.monthId] : [])))];
    if (monthIds.length > 0) await tx.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(inArray(schema.membershipMonths.id, monthIds)).orderBy(asc(schema.membershipMonths.id)).for("update");
    // Then, for her contribution shares: the pairs (contributor and host), the contributions and their payments,
    // each kind sorted (src/lib/contributions/locks.ts).
    const contributorIds = [...new Set(candidates.flatMap((c) => (c.contributorId ? [c.contributorId] : [])))].sort();
    for (const contributorId of contributorIds) await lockPair(tx, contributorId, input.hostId);
    for (const id of [...new Set(candidates.flatMap((c) => (c.contributionId ? [c.contributionId] : [])))].sort()) await lockContribution(tx, id);
    for (const id of [...new Set(candidates.flatMap((c) => (c.contributionPaymentId ? [c.contributionPaymentId] : [])))].sort()) await lockContributionPayment(tx, id);
    const callIds = [...new Set(candidates.flatMap((c) => (c.callId ? [c.callId] : [])))];
    if (callIds.length > 0) await tx.select({ id: schema.calls.id }).from(schema.calls).where(inArray(schema.calls.id, callIds)).orderBy(asc(schema.calls.id)).for("update");
    let locked: Payment[] = [];
    for (const { id } of candidates) locked.push(await lockPayment(tx, id));
    // Looked at again now that the locks are held: a dispute message may have come in while we waited for them.
    if (await disputeMessageWaiting(tx)) throw new MoneyError(DISPUTE_MESSAGE_WAITING);
    // The third of the $1,000 rule's three moments: the host collects. For each pair whose shares are here: if any
    // payment of the pair has an outcome that is not known yet, that pair's shares wait; otherwise the pair is
    // counted again and any 30 days that are due are written. Only then is anything judged.
    const waitingPairs = new Set<string>();
    for (const contributorId of contributorIds) {
      if (await pairOutcomeUnknown(tx, contributorId, input.hostId)) {
        for (const c of candidates) if (c.contributorId === contributorId) waitingPairs.add(c.id);
      } else {
        await countPair(tx, contributorId, input.hostId, now);
      }
    }
    // Read again: the count may have moved a share's date later.
    if (contributorIds.length > 0) locked = await tx.select().from(schema.payments).where(inArray(schema.payments.id, locked.map((p) => p.id))).orderBy(schema.payments.id);
    const judged = await heldBackNow(tx, locked, now, waitingPairs);
    const ready = locked
      .filter((p) => p.status === "charged" && (p.transferStatus === "not_due" || p.transferStatus === "due") && p.stripeChargeId)
      .filter((p) => judged.get(p.id) === null)
      .map((payment) => ({ payment, shareCents: currentSplit(payment).hostShareCents }))
      .filter((share) => share.shareCents > 0);

    const amounts = collectionAmounts(ready.map((share) => ({ id: share.payment.id, shareCents: share.shareCents })));
    if (!amounts) {
      throw new MoneyError(
        ready.length === 0
          ? "Nothing is ready to collect right now."
          : "What is ready is not more than the 25-cent collection charge, so there is nothing to collect yet.",
      );
    }

    await tx.insert(schema.collections).values({ id: input.collectionId, hostId: input.hostId, startedBy: input.startedBy, acceptedAt: now });
    const started: StartedTransfer[] = [];
    for (const [index, { payment }] of ready.entries()) {
      const { amountCents, payoutFeeCents } = amounts[index];
      // Money of a membership's month is grouped under the month, as its charge is; a contribution's share under
      // its contribution's payment; a card payment under its call.
      const params: TransferParams = { amountCents, payoutFeeCents, destination, group: payment.monthId ?? payment.contributionPaymentId ?? payment.callId! };
      const operation = await startMoneyOperation(tx, {
        paymentId: payment.id,
        kind: "transfer",
        labelBase: `transfer:${payment.id}`,
        prepare: async () => params,
      });
      // Cannot happen while the record is sound: a finished transfer always marks the payment as sent.
      if (operation === "already_done") throw new Error(`Payment ${payment.id} has a finished transfer but is not marked as sent.`);
      await tx
        .insert(schema.collectionItems)
        .values({ collectionId: input.collectionId, paymentId: payment.id, operationId: operation.operationId, amountCents, payoutFeeCents });
      started.push({ ...operation, paymentId: payment.id });
    }
    return { existing: false, started };
  });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * A share so small that the collection charge takes all of it: nothing goes to
 * Stripe for it. It counts as sent only once another share of its collection
 * has gone through, because a collection in which nothing went through carries
 * no charge. Returns false while that cannot be known yet.
 */
export async function settleEmptyShare(operation: { id: string; paymentId: string }, params: TransferParams): Promise<boolean> {
  const [item] = await db.select().from(schema.collectionItems).where(eq(schema.collectionItems.operationId, operation.id));
  // A transfer written down under the old weekly payday has no collection. There, an empty share was simply recorded.
  let others = ["succeeded"];
  if (item) {
    const rows = await db
      .select({ status: schema.moneyOperations.status })
      .from(schema.collectionItems)
      .innerJoin(schema.moneyOperations, eq(schema.moneyOperations.id, schema.collectionItems.operationId))
      .where(and(eq(schema.collectionItems.collectionId, item.collectionId), ne(schema.collectionItems.operationId, operation.id)));
    others = rows.map((row) => row.status);
  }
  if (others.includes("succeeded")) {
    await finishOperation(operation.id, operation.paymentId, "nothing-to-send", (payment, tx) => applyTransferSent(payment, params, null, tx));
    return true;
  }
  if (others.includes("started")) return false;
  await failOperation(operation.id, operation.paymentId, "Nothing else in this collection went through, so its charge was not taken.");
  return true;
}

/**
 * Sends what an accepted collection wrote down, one share after another. A
 * share Stripe refuses stays ready for a later collection. A share with no
 * clear answer stays "started" and is finished by the helper.
 */
export async function sendCollection(started: StartedTransfer[]): Promise<void> {
  const stopAt = Date.now() + SEND_FOR_MS;
  // The share that only carries the charge goes last: it depends on the others.
  const inOrder = [...started.filter((s) => s.params.amountCents >= 1), ...started.filter((s) => s.params.amountCents < 1)];
  for (const transfer of inOrder) {
    if (Date.now() > stopAt) return; // a very large collection: the helper finishes the rest
    try {
      if (transfer.params.amountCents < 1) await settleEmptyShare({ id: transfer.operationId, paymentId: transfer.paymentId }, transfer.params);
      else await completeMoneyOperation(transfer, transferSteps(transfer.paymentId));
    } catch (error) {
      // A refusal or a lost answer is already recorded on the transfer itself.
      if (!(error instanceof MoneyError || error instanceof OutcomeUnknownError)) {
        console.error(`[payments] could not send the share of payment ${transfer.paymentId}; the helper will check it`, error);
      }
    }
  }
}

/**
 * One press of "Collect earnings". Throws MoneyError, with words for the
 * person, when there is no collection: then nothing was charged and the 24
 * hours were not used up.
 */
export async function collectEarnings(input: { collectionId: string; hostId: string; startedBy: string; now?: Date }): Promise<void> {
  if (!UUID.test(input.collectionId)) throw new MoneyError(NOT_VALID);
  const [known] = await db.select({ id: schema.collections.id }).from(schema.collections).where(eq(schema.collections.id, input.collectionId));
  // Never trust the saved "ready" flag when money is about to move: ask Stripe now.
  if (!known) await refreshPayoutsReady(input.hostId);
  const accepted = await acceptCollection(input);
  await sendCollection(accepted.started);
}

/**
 * The founder's final collection for a host whose account is closed and who can therefore not log
 * in to collect. Refused for an open account: that host collects for themselves. Otherwise it is an
 * ordinary collection, to the host's own payout account, and the record says who pressed.
 */
export async function collectForClosedHost(input: { collectionId: string; hostId: string; adminId: string; now?: Date }): Promise<void> {
  const [host] = await db.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, input.hostId));
  if (!host) throw new MoneyError("Host not found.");
  if (!host.closedAt) throw new MoneyError("This host's account is open, so they collect their earnings themselves.");
  await collectEarnings({ collectionId: input.collectionId, hostId: input.hostId, startedBy: input.adminId, now: input.now });
}

// ---------------------------------------------------------------------------
// What a host, and the founder, are shown
// ---------------------------------------------------------------------------

/**
 * A share that was earned and not yet sent. `call` is the call it is for; expired member time has
 * none, and `month` is then the membership month it expired from; a contribution's share has
 * neither, and `project` is then the name of the project it was given to. `hostId` is whose money it is.
 */
export type Earning = { payment: Payment; call: Call | null; month: MembershipMonth | null; project: string | null; hostId: string; shareCents: number; heldBack: HeldBack | null };

/** Every share that was charged and not yet sent: one host's, or everybody's for the founder. */
export async function unsentEarnings(now: Date, hostId?: string): Promise<Earning[]> {
  const rows = await db
    .select({ payment: schema.payments, call: schema.calls, month: schema.membershipMonths, project: schema.projects.name, hostId: hostOfPayment })
    .from(schema.payments)
    .leftJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .leftJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.payments.monthId))
    .leftJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .leftJoin(schema.contributionPayments, eq(schema.contributionPayments.id, schema.payments.contributionPaymentId))
    .leftJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.contributions.projectId))
    .where(hostId ? and(sql`${hostOfPayment} = ${hostId}`, UNSENT) : UNSENT)
    .orderBy(schema.payments.transferDueAt);
  const judged = await heldBackNow(db, rows.map((row) => row.payment), now);
  return rows.map(({ payment, call, month, project, hostId: owner }) => ({ payment, call, month, project, hostId: owner, shareCents: currentSplit(payment).hostShareCents, heldBack: judged.get(payment.id) ?? null }));
}

/** What pressing the button now would send, after the collection charge. Null when there would be no collection. */
export function wouldCollect(ready: Earning[]): { sendCents: number; feeCents: number } | null {
  const amounts = collectionAmounts(ready.map((e) => ({ id: e.payment.id, shareCents: e.shareCents })));
  if (!amounts) return null;
  return { sendCents: amounts.reduce((sum, a) => sum + a.amountCents, 0), feeCents: amounts.reduce((sum, a) => sum + a.payoutFeeCents, 0) };
}

export type CollectionView = {
  id: string;
  acceptedAt: Date;
  /** Sent to the host's Stripe account, after the collection charge. */
  sentCents: number;
  /** The collection charge that was really taken. */
  feeCents: number;
  /** Written down, with no clear answer from Stripe yet. */
  checkingCents: number;
  /** Stripe refused these; they stay ready for a later collection. */
  refusedCents: number;
};

/** The host's latest collection, as it stands now, and when they can collect again. */
export async function lastCollectionOf(hostId: string): Promise<{ last: CollectionView; againAt: Date } | null> {
  const [last] = await db
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.hostId, hostId))
    .orderBy(desc(schema.collections.acceptedAt))
    .limit(1);
  if (!last) return null;
  const items = await db
    .select({ amountCents: schema.collectionItems.amountCents, payoutFeeCents: schema.collectionItems.payoutFeeCents, status: schema.moneyOperations.status })
    .from(schema.collectionItems)
    .innerJoin(schema.moneyOperations, eq(schema.moneyOperations.id, schema.collectionItems.operationId))
    .where(eq(schema.collectionItems.collectionId, last.id));
  const view: CollectionView = { id: last.id, acceptedAt: last.acceptedAt, sentCents: 0, feeCents: 0, checkingCents: 0, refusedCents: 0 };
  for (const item of items) {
    if (item.status === "succeeded") {
      view.sentCents += item.amountCents;
      view.feeCents += item.payoutFeeCents;
    } else if (item.status === "started") view.checkingCents += item.amountCents;
    else view.refusedCents += item.amountCents + item.payoutFeeCents;
  }
  return { last: view, againAt: canCollectAgainAt(last.acceptedAt)! };
}
