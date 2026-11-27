/**
 * Money owed back to a contributor's card (plans/25, "refund.ts" and "A refund and a collection
 * never meet"). As for a membership's pay-back, two things are kept apart:
 *
 *   - the line that says it is OWED (contribution_refunds). Written once, under the name of the
 *     one event that owes it. Writing the line is what makes the money owed;
 *   - the TRIES to send it. Each is a money action of the contribution's payment, named
 *     "contributionrefund:<line>:<attempt>". The helper repeats them until one is done.
 *
 * A refund lowers the share: her share and our fee shrink in the same proportion. After the share
 * was sent only the founder can refund. The contributor is then paid from Connect's money, the
 * share gets a refund line of its own in `refunds`, and the host owes what her share lost
 * (plans/50-part-1-gifts-owed-back.md). Lines written before that plan carry `connectsOwn`: for
 * them the share is not touched, and the books record Connect's cost.
 */
import { and, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import type { ContributionRefund } from "@/db/schema";
import { currentSplit, REFUND_SEND_TIMEOUT_MS, REFUND_SEND_WITHIN_MS } from "@/lib/payments/actions";
import { addLedgerEntry, MoneyError, NotSentError, OutcomeUnknownError, RETRY_AFTER_REFUSAL_MS, runOwnedOperation, type OwnedPlan, type Tx } from "@/lib/payments/operations";
import { splitAfterRefunds } from "@/lib/payments/pricing";
import { stripe } from "@/lib/payments/stripe";
import { queueRefundEmail } from "./emails";
import { lockForPayment, lockShare, paymentOwner, type LockedPayment } from "./locks";
import { ContributionError } from "./rules";

/** What a host is told about a tip or a contribution she has collected. */
export const COLLECTED_FOR_HOST = "This contribution has already been collected, so only Connect can refund it now. If Connect does, you owe your share of it back.";

const lines = schema.contributionRefunds;
const pays = schema.contributionPayments;
const frozen = (payment: { dispute: string }) => payment.dispute === "open" || payment.dispute === "lost";

// ---------------------------------------------------------------------------
// Owing a refund
// ---------------------------------------------------------------------------

/**
 * The host or the founder gives money of a taken payment back, in full or in part. `requestKey`
 * makes one press one refund. Checked with the payment and its share both locked, so a refund and
 * a collection of the same share never meet:
 *   - while a sending of the share is written down and not finished, nothing is refunded from it;
 *   - once the share was sent, only the founder can refund, and the host then owes her share of it back;
 *   - what is already owed counts against what can still be refunded.
 * `shownSent` is what the founder's form said when it was drawn: whether the share had been sent. If that has
 * changed, nothing is refunded (the form explained another outcome than the one the press would have).
 * Returns the line. The helper sends it (sendRefund).
 */
export async function refundContribution(input: { paymentId: string; amountCents: number; by: "host" | "founder"; deciderId: string; reason: string; requestKey: string; shownSent?: boolean; now?: Date }): Promise<ContributionRefund> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) throw new ContributionError("Please give an amount to refund.");
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(lines).where(eq(lines.sourceKey, `refund:${input.requestKey}`));
    if (existing) return existing;
    const { contribution, payment } = await lockForPayment(tx, input.paymentId);
    // Looked up again now that the locks are held: the same press sent twice at the same moment gets the one line.
    const [meanwhile] = await tx.select().from(lines).where(eq(lines.sourceKey, `refund:${input.requestKey}`));
    if (meanwhile) return meanwhile;
    if (input.by === "host" && contribution.hostId !== input.deciderId) throw new ContributionError("Payment not found.");
    if (payment.status !== "taken" || payment.problem) throw new ContributionError("This payment's money has not been taken, so there is nothing to refund.");
    if (frozen(payment)) throw new ContributionError("This charge is disputed at the contributor's bank, so nothing can be refunded from it now.");
    const share = await lockShare(tx, payment.id);
    if (!share) throw new ContributionError("This payment is already being paid back in full.");
    const [sending] = await tx
      .select({ id: schema.moneyOperations.id })
      .from(schema.moneyOperations)
      .where(and(eq(schema.moneyOperations.paymentId, share.id), eq(schema.moneyOperations.kind, "transfer"), eq(schema.moneyOperations.status, "started")));
    if (sending) throw new ContributionError("This share is being sent to the host right now. Please try again in a few minutes.");
    const sent = share.transferStatus === "sent";
    if (sent && input.by !== "founder") throw new ContributionError(COLLECTED_FOR_HOST);
    if (input.shownSent !== undefined && input.shownSent !== sent) throw new ContributionError(sent ? "The host has collected her share of this payment since this page was drawn. Nothing was refunded. Please look at the form again: a refund now makes her owe her share of it back." : "This page is out of date. Nothing was refunded. Please look at the form again.");
    const [{ owed }] = await tx
      .select({ owed: sql<number>`coalesce(sum(${lines.amountCents}), 0)::int` })
      .from(lines)
      // (A line whose refund failed after Stripe had confirmed it is over: it owes nothing any more.)
      .where(and(eq(lines.contributionPaymentId, payment.id), notInArray(lines.status, ["done", "failed"])));
    const left = (payment.takenCents ?? 0) - payment.refundedCents - owed;
    if (input.amountCents > left) throw new ContributionError(left > 0 ? `At most $${(left / 100).toFixed(2)} of this payment can still be refunded.` : "All of this payment has been refunded already.");
    const [line] = await tx
      .insert(lines)
      .values({ contributionPaymentId: payment.id, sourceKey: `refund:${input.requestKey}`, amountCents: input.amountCents, decidedBy: input.by, deciderId: input.deciderId, reason: input.reason.replace(/\s+/g, " ").trim().slice(0, 500) || "Refunded.", afterCollection: sent })
      .returning();
    return line;
  });
}

// ---------------------------------------------------------------------------
// Sending it
// ---------------------------------------------------------------------------

/** `sendByMs`: the last moment the one who wrote the try down may first send it to Stripe (see refundTry). A try written down before 27 November 2026 has none. */
export type RefundParams = { intentId: string; amountCents: number; contributionPaymentId: string; refundId: string; attempt: number; sendByMs?: number };
export type RefundOutcome = { refundId: string; attempt: number; stripeRefundId: string | null; status: "done" | "on_its_way" | "failed" };

/** What Stripe's word for a refund means here. */
export function outcomeStatus(status: string | null): RefundOutcome["status"] {
  if (status === "succeeded") return "done";
  if (status === "failed" || status === "canceled") return "failed";
  return "on_its_way";
}

/**
 * The request of one try. Recovery sends exactly the same one again under the same label. (`how` is only how long
 * the request may take and whether the library may try a broken connection again: nothing of what is asked.)
 */
export function refundAtStripe(params: RefundParams, label: string, how: { maxNetworkRetries?: number; timeout?: number } = {}): Promise<Stripe.Refund> {
  return stripe().refunds.create(
    { payment_intent: params.intentId, amount: params.amountCents, metadata: { contributionPaymentId: params.contributionPaymentId, refundId: params.refundId, attempt: String(params.attempt) } },
    { idempotencyKey: label, ...how },
  );
}

/**
 * Records what became of one try, whoever learned it, with the payment locked. Does nothing unless
 * the line's attempt is the outcome's and the line is not done.
 */
export async function applyRefundOutcome(tx: Tx, locked: LockedPayment, outcome: RefundOutcome, now: Date): Promise<void> {
  // The one order of locks wherever this machine and the take-backs meet: the contribution and its payment (held by
  // the caller), the share, then the line.
  const share = await lockShare(tx, locked.payment.id);
  const [line] = await tx.select().from(lines).where(eq(lines.id, outcome.refundId)).for("update");
  // (A line that is done stays done; one that failed after it was confirmed stays failed.)
  if (!line || line.contributionPaymentId !== locked.payment.id || line.attempt !== outcome.attempt || line.status === "done" || line.status === "failed") return;
  if (outcome.status === "on_its_way" && outcome.stripeRefundId) {
    await tx.update(lines).set({ status: "at_stripe", stripeRefundId: outcome.stripeRefundId }).where(eq(lines.id, line.id));
    return;
  }
  if (outcome.status !== "done" || !outcome.stripeRefundId) {
    // Failed or cancelled at Stripe, or refused: owed again, and the next try is a new one. It is never dropped.
    await tx.update(lines).set({ status: "owed", stripeRefundId: null, attempt: line.attempt + 1, lastFailedAt: now }).where(eq(lines.id, line.id));
    return;
  }
  await tx.update(lines).set({ status: "done", stripeRefundId: outcome.stripeRefundId, finishedAt: now }).where(eq(lines.id, line.id));
  await tx.update(pays).set({ refundedCents: sql`${pays.refundedCents} + ${line.amountCents}`, updatedAt: now }).where(eq(pays.id, locked.payment.id));
  // What went back to the card is written once, under the contribution's payment.
  await addLedgerEntry(tx, { contributionPaymentId: locked.payment.id, kind: "customer_refund", amountCents: -line.amountCents, stripeRef: outcome.stripeRefundId, note: line.reason });
  // The contributor is told, once the money has really gone back.
  await queueRefundEmail(tx, locked.contribution, { id: line.id, amountCents: line.amountCents });
  if (line.connectsOwn) {
    // After the share was sent: Connect's own money. Her share stays what she really received.
    await addLedgerEntry(tx, { contributionPaymentId: locked.payment.id, kind: "connect_cost", amountCents: line.amountCents, stripeRef: outcome.stripeRefundId, note: "refunded after the host had collected" });
    return;
  }
  // A payment that was taken although it was not to be has no share: all of it was owed back from the start.
  if (!share || share.chargedCents === null || share.originalHostShareCents === null) return;
  const before = currentSplit(share);
  // What counts on the share: never more than is left of its charge.
  const counted = Math.max(0, Math.min(share.chargedCents - share.refundedCents, line.amountCents));
  const refundedCents = share.refundedCents + counted;
  const after = splitAfterRefunds({ chargeCents: share.chargedCents, refundedCents, originalHostShareCents: share.originalHostShareCents });
  const nothingOwedNow = after.hostShareCents === 0 && share.transferStatus !== "sent";
  await tx.update(schema.payments).set({ refundedCents, transferStatus: nothingOwedNow ? "not_owed" : share.transferStatus, updatedAt: now }).where(eq(schema.payments.id, share.id));
  await addLedgerEntry(tx, { paymentId: share.id, kind: "platform_fee", amountCents: after.feeCents - before.feeCents, stripeRef: outcome.stripeRefundId });
  await addLedgerEntry(tx, { paymentId: share.id, kind: "host_share", amountCents: after.hostShareCents - before.hostShareCents, stripeRef: outcome.stripeRefundId });
  // Given after the host had collected (plans/50-part-1-gifts-owed-back.md): the share gets a refund line of its
  // own, done at once, with what her share was before and after. The helper writes her take-back from that line,
  // exactly as for a call's refund (disputes/takeback.ts). Nothing of the customer's money is booked on the share:
  // that stands once, under the contribution's payment, above.
  if (!line.afterCollection || share.transferStatus !== "sent" || counted <= 0) return;
  if (!line.deciderId) {
    console.error(`[contributions] refund ${line.id} was given after collection and names nobody who decided it: no line was written for its share, so nothing is owed back for it. Look at it.`);
    return;
  }
  const [last] = await tx.select({ no: sql<number>`coalesce(max(${schema.refunds.afterCollectionNo}), 0)::int` }).from(schema.refunds).where(eq(schema.refunds.paymentId, share.id));
  await tx
    .insert(schema.refunds)
    .values({
      paymentId: share.id,
      amountCents: counted,
      decidedBy: line.deciderId,
      decidedAs: "admin",
      reason: line.reason,
      status: "done",
      stripeRefundId: outcome.stripeRefundId,
      finishedAt: now,
      afterCollection: true,
      shareBeforeCents: before.hostShareCents,
      shareAfterCents: after.hostShareCents,
      feeBeforeCents: before.feeCents,
      feeAfterCents: after.feeCents,
      hostOwesCents: Math.max(0, before.hostShareCents - after.hostShareCents),
      afterCollectionNo: last.no + 1,
      contributionRefundId: line.id,
    })
    .onConflictDoNothing();
}

/**
 * The steps of one try to send a refund that is owed, as a money action: written down, asked of Stripe, recorded.
 * (Exported so that a check can stop between the steps, as a helper that dies does.)
 *
 * The one who writes the try down sends it at once, and keeps the same times a call's refund keeps
 * (payments/actions.ts, refundPlan): the request is begun no later than REFUND_SEND_WITHIN_MS after the try was
 * written down, counted on the database's clock from the moment the helper counts from, with the clock read as the
 * very last thing before the request leaves; it is one request, given up after REFUND_SEND_TIMEOUT_MS. All of it
 * together is shorter than the time before the helper first looks at an unanswered try. So when the helper looks,
 * this request has either reached Stripe or will never be sent, and a clear "no" to the helper's own repeat, with
 * nothing on Stripe's complete list of the charge's refunds, really means that this try did not happen
 * (recover.ts). A writer that is too late sends nothing and leaves the try to the helper, which sends it under the
 * same label.
 */
export function refundTry(line: Pick<ContributionRefund, "id" | "contributionPaymentId" | "attempt">, now: Date): OwnedPlan<LockedPayment, RefundParams, { status: string | null }> {
  const outcome = (params: RefundParams, stripeRefundId: string | null, status: RefundOutcome["status"]): RefundOutcome => ({ refundId: params.refundId, attempt: params.attempt, stripeRefundId, status });
  return {
    owner: paymentOwner(line.contributionPaymentId),
    kind: "refund",
    labelBase: `contributionrefund:${line.id}:${line.attempt}`,
    prepare: async ({ payment }, tx) => {
      // The share is held while a try is written down: whoever works a take-back out on that share holds it too,
      // and so sees either no try or this one (disputes/takeback.ts, refundUnderWay).
      const share = await lockShare(tx, payment.id);
      // Nor while her share of it is being taken back at this very moment (that request to Stripe is written down
      // and unanswered): a take-back and a refund of the same share are worked out one after the other, never both
      // at once. Nothing is written here, so the next pass simply tries again.
      const [taking] = share ? await tx.select({ id: schema.hostDebts.id }).from(schema.hostDebts).where(and(eq(schema.hostDebts.paymentId, share.id), eq(schema.hostDebts.status, "taking"))).limit(1) : [];
      if (taking) throw new MoneyError("The host's share of this payment is being taken back right now. The refund is sent once that is answered.");
      const [fresh] = await tx.select().from(lines).where(eq(lines.id, line.id)).for("update");
      if (!fresh || fresh.status !== "owed" || fresh.attempt !== line.attempt) throw new MoneyError("This refund is not waiting to be sent.");
      // Checked here, under the lock, so two helpers at once cannot send a second try right after the first failed.
      if (fresh.lastFailedAt && fresh.lastFailedAt.getTime() > now.getTime() - RETRY_AFTER_REFUSAL_MS) throw new MoneyError("The last try failed less than an hour ago.");
      // A dispute stops new steps. A try that was written down before it is still followed to its answer.
      if (frozen(payment)) throw new MoneyError("This charge is disputed at the contributor's bank, so nothing is refunded from it now.");
      if (!payment.stripePaymentIntentId) throw new MoneyError("This payment has nothing to refund from.");
      // The database's time for this step: the very moment the action's own line will carry as "written down at".
      const [{ writtenAt }] = await tx.select({ writtenAt: sql<string>`(extract(epoch from now()) * 1000)::bigint` }).from(pays).where(eq(pays.id, payment.id));
      return { intentId: payment.stripePaymentIntentId, amountCents: fresh.amountCents, contributionPaymentId: payment.id, refundId: fresh.id, attempt: fresh.attempt, sendByMs: Number(writtenAt) + REFUND_SEND_WITHIN_MS };
    },
    execute: async (params, label) => {
      if (params.sendByMs !== undefined && Date.now() > params.sendByMs) throw new NotSentError("The refund was not sent to Stripe in time, so this one did not send it.");
      // One request, with a limit of time: it never goes out a second time later, after the helper has begun to look.
      const refund = await refundAtStripe(params, label, { maxNetworkRetries: 0, timeout: REFUND_SEND_TIMEOUT_MS });
      return { stripeId: refund.id, result: { status: refund.status } };
    },
    apply: (locked, params, result, tx) => applyRefundOutcome(tx, locked, outcome(params, result.stripeId, outcomeStatus(result.result.status)), now),
    // (Stripe's clear "no" to the first request, or "not sent at all" while the helper cannot have sent it either.)
    onRefused: (locked, params, _message, tx) => applyRefundOutcome(tx, locked, outcome(params, null, "failed"), now),
  };
}

/** One try to send a refund that is owed. Does nothing unless the line is owed and nothing is under way on its payment. */
export async function sendRefund(refundId: string, now: Date = new Date()): Promise<void> {
  const [line] = await db.select().from(lines).where(eq(lines.id, refundId));
  if (!line || line.status !== "owed") return;
  try {
    await runOwnedOperation(refundTry(line, now));
  } catch (error) {
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[contributions] refund ${refundId}: ${error.message}`);
    else throw error;
  }
}

/** A refund Stripe accepted but had not finished: asked about by its own id. */
async function askAboutRefund(line: ContributionRefund, now: Date): Promise<void> {
  if (!line.stripeRefundId) return;
  const refund = await stripe().refunds.retrieve(line.stripeRefundId);
  const attempt = Number(refund.metadata?.attempt ?? line.attempt);
  await db.transaction(async (tx) => {
    const locked = await lockForPayment(tx, line.contributionPaymentId);
    await applyRefundOutcome(tx, locked, { refundId: line.id, attempt, stripeRefundId: refund.id, status: outcomeStatus(refund.status) }, now);
  });
}

/**
 * The helper's part: ask about refunds that are on their way, and start a try for every line that
 * is owed: at once the first time, and an hour after a failure. Never while the charge is disputed.
 */
export async function runRefunds(now: Date): Promise<void> {
  // In no fixed order, so that many refunds waiting at Stripe can never keep a later one from being asked about.
  const onTheirWay = await db.select().from(lines).where(eq(lines.status, "at_stripe")).orderBy(sql`random()`).limit(50);
  for (const line of onTheirWay) {
    await askAboutRefund(line, now).catch((error) => console.error(`[contributions] could not ask about refund ${line.id}; will retry`, error));
  }
  const owed = await db
    .select({ id: lines.id })
    .from(lines)
    .innerJoin(pays, eq(pays.id, lines.contributionPaymentId))
    .where(
      and(
        eq(lines.status, "owed"),
        or(isNull(lines.lastFailedAt), lte(lines.lastFailedAt, new Date(now.getTime() - RETRY_AFTER_REFUSAL_MS))),
        inArray(pays.dispute, ["none", "won"]),
        eq(pays.status, "taken"),
        // A payment with an action under way cannot start a refund now, so its lines never fill the batch.
        sql`not exists (select 1 from ${schema.moneyOperations} where ${schema.moneyOperations.contributionPaymentId} = ${pays.id} and ${schema.moneyOperations.status} = 'started')`,
        // Nor can one whose share is being taken back at this moment (sendRefund refuses it under the lock): its
        // lines never fill the batch either, so a refund of another payment is never kept waiting behind them.
        sql`not exists (select 1 from ${schema.hostDebts} inner join ${schema.payments} on ${schema.payments.id} = ${schema.hostDebts.paymentId} where ${schema.payments.contributionPaymentId} = ${pays.id} and ${schema.hostDebts.status} = 'taking')`,
      ),
    )
    .orderBy(lines.createdAt)
    .limit(50);
  for (const line of owed) {
    await sendRefund(line.id, now).catch((error) => console.error(`[contributions] could not send refund ${line.id}; will retry`, error));
  }
}
