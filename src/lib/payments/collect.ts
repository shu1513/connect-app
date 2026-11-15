/**
 * Hosts collect their earnings with a button. There is no payday: nothing is
 * sent to a host unless the host pressed (or the founder did, for a host who
 * can no longer log in).
 *
 * A press is accepted in one locked step, which writes down the collection and
 * every transfer it will make before Stripe is asked anything. Sending comes
 * after that, one share at a time. Whatever is not confirmed by then is
 * finished by the always-on helper (reconcileOperations in jobs.ts), without
 * the host pressing again.
 */
import { and, desc, eq, inArray, isNull, like, lte, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { applyTransferSent, currentSplit, transferSteps, type TransferParams } from "./actions";
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

/** A share that was charged and has not been sent to the host. */
const UNSENT = and(eq(schema.payments.status, "charged"), inArray(schema.payments.transferStatus, ["not_due", "due"]));

/** How long one press keeps sending before it leaves the rest to the helper. */
const SEND_FOR_MS = 20_000;

type Reader = Pick<Tx, "select">;

/** For each of these payments: why its share cannot be collected right now, or null if it can. */
async function heldBackNow(reader: Reader, payments: Payment[], now: Date): Promise<Map<string, HeldBack | null>> {
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
  return new Map(
    payments.map((p) => [
      p.id,
      heldBack({ now, readyAt: p.transferDueAt, disputeOpen: p.disputeOpen, refundOnItsWay: refunding.has(p.id), actionUnfinished: busy.has(p.id) }),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Accepting a press
// ---------------------------------------------------------------------------

type StartedTransfer = StartedOperation<TransferParams> & { paymentId: string };

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
  now: Date;
}): Promise<{ existing: boolean; started: StartedTransfer[] }> {
  if (!UUID.test(input.collectionId)) throw new MoneyError(NOT_VALID);

  return db.transaction(async (tx) => {
    const [host] = await tx.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, input.hostId)).for("update");

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
    if (again && input.now < again) throw new MoneyError("Earnings were already collected in the last 24 hours.");

    // A message from Stripe about a bank dispute that is not handled yet may be about one of
    // these charges. Until it is handled (the helper does that within minutes), nothing is collected.
    const [unhandled] = await tx
      .select({ id: schema.stripeEvents.id })
      .from(schema.stripeEvents)
      .where(and(isNull(schema.stripeEvents.processedAt), like(schema.stripeEvents.type, "charge.dispute.%")))
      .limit(1);
    if (unhandled) {
      throw new MoneyError("Stripe has told us about a disputed charge and we are still checking which one. Please try again in a few minutes.");
    }

    // Lock every share that might be taken, always in the same order, then judge each as it stands now.
    const candidates = await tx
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
      .where(and(eq(schema.calls.hostId, input.hostId), UNSENT, lte(schema.payments.transferDueAt, input.now)))
      .orderBy(schema.payments.id);
    const locked: Payment[] = [];
    for (const { id } of candidates) locked.push(await lockPayment(tx, id));
    const judged = await heldBackNow(tx, locked, input.now);
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

    await tx.insert(schema.collections).values({ id: input.collectionId, hostId: input.hostId, startedBy: input.startedBy, acceptedAt: input.now });
    const started: StartedTransfer[] = [];
    for (const [index, { payment }] of ready.entries()) {
      const { amountCents, payoutFeeCents } = amounts[index];
      const params: TransferParams = { amountCents, payoutFeeCents, destination, callId: payment.callId };
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
export async function collectEarnings(input: { collectionId: string; hostId: string; startedBy: string; now: Date }): Promise<void> {
  if (!UUID.test(input.collectionId)) throw new MoneyError(NOT_VALID);
  const [known] = await db.select({ id: schema.collections.id }).from(schema.collections).where(eq(schema.collections.id, input.collectionId));
  // Never trust the saved "ready" flag when money is about to move: ask Stripe now.
  if (!known) await refreshPayoutsReady(input.hostId);
  const accepted = await acceptCollection(input);
  await sendCollection(accepted.started);
}

// ---------------------------------------------------------------------------
// What a host, and the founder, are shown
// ---------------------------------------------------------------------------

export type Earning = { payment: Payment; call: Call; shareCents: number; heldBack: HeldBack | null };

/** Every share that was charged and not yet sent: one host's, or everybody's for the founder. */
export async function unsentEarnings(now: Date, hostId?: string): Promise<Earning[]> {
  const rows = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(hostId ? and(eq(schema.calls.hostId, hostId), UNSENT) : UNSENT)
    .orderBy(schema.payments.transferDueAt);
  const judged = await heldBackNow(db, rows.map((row) => row.payment), now);
  return rows.map(({ payment, call }) => ({ payment, call, shareCents: currentSplit(payment).hostShareCents, heldBack: judged.get(payment.id) ?? null }));
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
