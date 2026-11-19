/**
 * Money owed back to a contributor's card (plans/25, "refund.ts" and "A refund and a collection
 * never meet"). As for a membership's pay-back, two things are kept apart:
 *
 *   - the line that says it is OWED (contribution_refunds). Written once, under the name of the
 *     one event that owes it. Writing the line is what makes the money owed;
 *   - the TRIES to send it. Each is a money action of the contribution's payment, named
 *     "contributionrefund:<line>:<attempt>". The helper repeats them until one is done.
 *
 * Before the host's share is sent, a refund lowers the share: her share and our fee shrink in the
 * same proportion. After it, only the founder can refund, and it is Connect's own money: the
 * share's line is not touched, and the books record Connect's cost.
 */
import { and, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import type { ContributionRefund } from "@/db/schema";
import { currentSplit } from "@/lib/payments/actions";
import { addLedgerEntry, MoneyError, OutcomeUnknownError, RETRY_AFTER_REFUSAL_MS, runOwnedOperation, type Tx } from "@/lib/payments/operations";
import { splitAfterRefunds } from "@/lib/payments/pricing";
import { stripe } from "@/lib/payments/stripe";
import { queueRefundEmail } from "./emails";
import { lockForPayment, lockShare, paymentOwner, type LockedPayment } from "./locks";
import { ContributionError } from "./rules";

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
 *   - once the share was sent, only the founder can refund, from Connect's own money;
 *   - what is already owed counts against what can still be refunded.
 * Returns the line. The helper sends it (sendRefund).
 */
export async function refundContribution(input: { paymentId: string; amountCents: number; by: "host" | "founder"; deciderId: string; reason: string; requestKey: string; now?: Date }): Promise<ContributionRefund> {
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
    if (sent && input.by !== "founder") throw new ContributionError("This contribution has already been collected, so only Connect can refund it now.");
    const [{ owed }] = await tx
      .select({ owed: sql<number>`coalesce(sum(${lines.amountCents}), 0)::int` })
      .from(lines)
      .where(and(eq(lines.contributionPaymentId, payment.id), ne(lines.status, "done")));
    const left = (payment.takenCents ?? 0) - payment.refundedCents - owed;
    if (input.amountCents > left) throw new ContributionError(left > 0 ? `At most $${(left / 100).toFixed(2)} of this payment can still be refunded.` : "All of this payment has been refunded already.");
    const [line] = await tx
      .insert(lines)
      .values({ contributionPaymentId: payment.id, sourceKey: `refund:${input.requestKey}`, amountCents: input.amountCents, decidedBy: input.by, deciderId: input.deciderId, reason: input.reason.replace(/\s+/g, " ").trim().slice(0, 500) || "Refunded.", connectsOwn: sent })
      .returning();
    return line;
  });
}

// ---------------------------------------------------------------------------
// Sending it
// ---------------------------------------------------------------------------

export type RefundParams = { intentId: string; amountCents: number; contributionPaymentId: string; refundId: string; attempt: number };
export type RefundOutcome = { refundId: string; attempt: number; stripeRefundId: string | null; status: "done" | "on_its_way" | "failed" };

/** What Stripe's word for a refund means here. */
export function outcomeStatus(status: string | null): RefundOutcome["status"] {
  if (status === "succeeded") return "done";
  if (status === "failed" || status === "canceled") return "failed";
  return "on_its_way";
}

/** The request of one try. Recovery sends exactly the same one again under the same label. */
export function refundAtStripe(params: RefundParams, label: string): Promise<Stripe.Refund> {
  return stripe().refunds.create(
    { payment_intent: params.intentId, amount: params.amountCents, metadata: { contributionPaymentId: params.contributionPaymentId, refundId: params.refundId, attempt: String(params.attempt) } },
    { idempotencyKey: label },
  );
}

/**
 * Records what became of one try, whoever learned it, with the payment locked. Does nothing unless
 * the line's attempt is the outcome's and the line is not done.
 */
export async function applyRefundOutcome(tx: Tx, locked: LockedPayment, outcome: RefundOutcome, now: Date): Promise<void> {
  const [line] = await tx.select().from(lines).where(eq(lines.id, outcome.refundId)).for("update");
  if (!line || line.contributionPaymentId !== locked.payment.id || line.attempt !== outcome.attempt || line.status === "done") return;
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
  const share = await lockShare(tx, locked.payment.id);
  // A payment that was taken although it was not to be has no share: all of it was owed back from the start.
  if (!share || share.chargedCents === null || share.originalHostShareCents === null) return;
  const before = currentSplit(share);
  const refundedCents = Math.min(share.chargedCents, share.refundedCents + line.amountCents);
  const after = splitAfterRefunds({ chargeCents: share.chargedCents, refundedCents, originalHostShareCents: share.originalHostShareCents });
  const nothingOwedNow = after.hostShareCents === 0 && share.transferStatus !== "sent";
  await tx.update(schema.payments).set({ refundedCents, transferStatus: nothingOwedNow ? "not_owed" : share.transferStatus, updatedAt: now }).where(eq(schema.payments.id, share.id));
  await addLedgerEntry(tx, { paymentId: share.id, kind: "platform_fee", amountCents: after.feeCents - before.feeCents, stripeRef: outcome.stripeRefundId });
  await addLedgerEntry(tx, { paymentId: share.id, kind: "host_share", amountCents: after.hostShareCents - before.hostShareCents, stripeRef: outcome.stripeRefundId });
}

/** One try to send a refund that is owed. Does nothing unless the line is owed and nothing is under way on its payment. */
export async function sendRefund(refundId: string, now: Date = new Date()): Promise<void> {
  const [line] = await db.select().from(lines).where(eq(lines.id, refundId));
  if (!line || line.status !== "owed") return;
  const outcome = (params: RefundParams, stripeRefundId: string | null, status: RefundOutcome["status"]): RefundOutcome => ({ refundId: params.refundId, attempt: params.attempt, stripeRefundId, status });
  try {
    await runOwnedOperation<LockedPayment, RefundParams, { status: string | null }>({
      owner: paymentOwner(line.contributionPaymentId),
      kind: "refund",
      labelBase: `contributionrefund:${line.id}:${line.attempt}`,
      prepare: async ({ payment }, tx) => {
        const [fresh] = await tx.select().from(lines).where(eq(lines.id, line.id)).for("update");
        if (!fresh || fresh.status !== "owed" || fresh.attempt !== line.attempt) throw new MoneyError("This refund is not waiting to be sent.");
        // Checked here, under the lock, so two helpers at once cannot send a second try right after the first failed.
        if (fresh.lastFailedAt && fresh.lastFailedAt.getTime() > now.getTime() - RETRY_AFTER_REFUSAL_MS) throw new MoneyError("The last try failed less than an hour ago.");
        // A dispute stops new steps. A try that was written down before it is still followed to its answer.
        if (frozen(payment)) throw new MoneyError("This charge is disputed at the contributor's bank, so nothing is refunded from it now.");
        if (!payment.stripePaymentIntentId) throw new MoneyError("This payment has nothing to refund from.");
        return { intentId: payment.stripePaymentIntentId, amountCents: fresh.amountCents, contributionPaymentId: payment.id, refundId: fresh.id, attempt: fresh.attempt };
      },
      execute: async (params, label) => {
        const refund = await refundAtStripe(params, label);
        return { stripeId: refund.id, result: { status: refund.status } };
      },
      apply: (locked, params, result, tx) => applyRefundOutcome(tx, locked, outcome(params, result.stripeId, outcomeStatus(result.result.status)), now),
      onRefused: (locked, params, _message, tx) => applyRefundOutcome(tx, locked, outcome(params, null, "failed"), now),
    });
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
      ),
    )
    .orderBy(lines.createdAt)
    .limit(50);
  for (const line of owed) {
    await sendRefund(line.id, now).catch((error) => console.error(`[contributions] could not send refund ${line.id}; will retry`, error));
  }
}
