/**
 * The four actions that move money: charge a held payment, release a hold,
 * refund, and send the host's share. Each goes through runMoneyOperation(),
 * so none can happen twice.
 *
 * The "apply…" functions record an outcome. They are also used by
 * reconcile.ts when it finds out from Stripe what happened to an unfinished action.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Payment } from "@/db/schema";
import { addLedgerEntry, MoneyError, runMoneyOperation, type Tx } from "./operations";
import { MIN_CHARGE_CENTS, splitAfterRefunds, splitCharge } from "./pricing";
import { canMovePayment, transferDueAt } from "./rules";
import { stripe } from "./stripe";

export type FrozenTotals = { hostSeconds: number; customerSeconds: number; togetherSeconds: number };
export type ChargeReason = "attendance" | "late_cancel" | "admin";

const isForeignCard = (payment: Payment) => payment.cardCountry !== null && payment.cardCountry !== "US";

/** The host's share and our fee as they stand now, after any refunds. */
export function currentSplit(payment: Payment): { feeCents: number; hostShareCents: number } {
  if (payment.chargedCents === null || payment.originalHostShareCents === null) return { feeCents: 0, hostShareCents: 0 };
  return splitAfterRefunds({
    chargeCents: payment.chargedCents,
    refundedCents: payment.refundedCents,
    originalHostShareCents: payment.originalHostShareCents,
  });
}

// ---------------------------------------------------------------------------
// Charge
// ---------------------------------------------------------------------------

type CaptureParams = { amountCents: number; reason: ChargeReason; frozen: FrozenTotals | null; callEndsAt: string };

export async function applyCaptured(
  payment: Payment,
  params: CaptureParams,
  stripeChargeId: string | null,
  tx: Tx,
): Promise<void> {
  const { feeCents, hostShareCents } = splitCharge(
    params.amountCents,
    { percentBps: payment.feePercentBps, fixedCents: payment.feeFixedCents, foreignCardBps: payment.feeForeignCardBps },
    isForeignCard(payment),
  );
  await tx
    .update(schema.payments)
    .set({
      status: "charged",
      needsReview: false,
      chargedCents: params.amountCents,
      chargeReason: params.reason,
      chargedAt: new Date(),
      stripeChargeId: stripeChargeId ?? payment.stripeChargeId,
      originalFeeCents: feeCents,
      originalHostShareCents: hostShareCents,
      frozenHostSeconds: params.frozen?.hostSeconds ?? null,
      frozenCustomerSeconds: params.frozen?.customerSeconds ?? null,
      frozenTogetherSeconds: params.frozen?.togetherSeconds ?? null,
      transferStatus: hostShareCents > 0 ? "not_due" : "not_owed",
      transferDueAt: hostShareCents > 0 ? transferDueAt(new Date(params.callEndsAt)) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, payment.id));
  const ref = stripeChargeId ?? payment.stripeChargeId;
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "customer_charge", amountCents: params.amountCents, stripeRef: ref, note: params.reason });
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: feeCents, stripeRef: ref });
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: hostShareCents, stripeRef: ref });
}

/** Charges a held payment once. The unused part of the hold is released by Stripe. */
export function capturePayment(input: {
  paymentId: string;
  amountCents: number;
  reason: ChargeReason;
  frozen: FrozenTotals | null;
  callEndsAt: Date;
}) {
  return runMoneyOperation<CaptureParams, { chargeId: string | null }>({
    paymentId: input.paymentId,
    kind: "capture",
    labelBase: `capture:${input.paymentId}`,
    prepare: async (payment) => {
      if (!canMovePayment(payment.status as never, "charged")) throw new MoneyError("This payment is not being held.");
      if (!payment.stripePaymentIntentId) throw new MoneyError("This payment has no hold at Stripe.");
      // A call waiting for the founder's decision is only ever charged by the founder.
      if (payment.needsReview && input.reason !== "admin") throw new MoneyError("This payment is waiting for review.");
      if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_CHARGE_CENTS) {
        throw new MoneyError("The amount is below the minimum that can be charged.");
      }
      if (input.amountCents > payment.bookedCents) throw new MoneyError("The amount is more than the booked price.");
      return {
        amountCents: input.amountCents,
        reason: input.reason,
        frozen: input.frozen,
        callEndsAt: input.callEndsAt.toISOString(),
      };
    },
    execute: async (params, label) => {
      const [payment] = await paymentById(input.paymentId);
      const intent = await stripe().paymentIntents.capture(
        payment.stripePaymentIntentId!,
        { amount_to_capture: params.amountCents },
        { idempotencyKey: label },
      );
      const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
      return { stripeId: intent.id, result: { chargeId } };
    },
    apply: (payment, params, outcome, tx) => applyCaptured(payment, params, outcome.result.chargeId, tx),
  });
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export async function applyReleased(payment: Payment, note: string, tx: Tx): Promise<void> {
  await tx
    .update(schema.payments)
    .set({ status: "closed_uncharged", needsReview: false, transferStatus: "not_owed", reviewReason: note, updatedAt: new Date() })
    .where(eq(schema.payments.id, payment.id));
}

/** Lets a hold go without charging anything. Also closes a payment that was never paid. */
export async function releasePayment(input: { paymentId: string; note: string }): Promise<void> {
  const [before] = await paymentById(input.paymentId);
  if (!before) throw new MoneyError("Payment not found.");

  // Nothing at Stripe to cancel: the customer never started paying.
  if (!before.stripePaymentIntentId) {
    const { db } = await import("@/db");
    await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId)).for("update");
      if (payment.stripePaymentIntentId || !canMovePayment(payment.status as never, "closed_uncharged")) return;
      await applyReleased(payment, input.note, tx);
    });
    const [after] = await paymentById(input.paymentId);
    if (!after.stripePaymentIntentId) return;
  }

  await runMoneyOperation<{ note: string }, null>({
    paymentId: input.paymentId,
    kind: "release",
    labelBase: `release:${input.paymentId}`,
    prepare: async (payment) => {
      if (!canMovePayment(payment.status as never, "closed_uncharged")) {
        throw new MoneyError("This payment has already been charged or closed.");
      }
      return { note: input.note };
    },
    execute: async (_params, label) => {
      const [payment] = await paymentById(input.paymentId);
      const intentId = payment.stripePaymentIntentId!;
      try {
        await stripe().paymentIntents.cancel(intentId, {}, { idempotencyKey: label });
      } catch (error) {
        // Stripe refuses to cancel something already cancelled (for example a hold that ran out). That is fine.
        const intent = await stripe().paymentIntents.retrieve(intentId);
        if (intent.status !== "canceled") throw error;
      }
      return { stripeId: intentId, result: null };
    },
    apply: (payment, params, _outcome, tx) => applyReleased(payment, params.note, tx),
  });
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

type RefundParams = { refundId: string; amountCents: number };

/** Records a refund that Stripe has confirmed, and shrinks the host's share and our fee to match. */
export async function applyRefundDone(payment: Payment, refundId: string, stripeRefundId: string, tx: Tx): Promise<void> {
  const [refund] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).for("update");
  if (!refund || refund.status === "done") return;

  const before = currentSplit(payment);
  const refundedCents = payment.refundedCents + refund.amountCents;
  const after = splitAfterRefunds({
    chargeCents: payment.chargedCents!,
    refundedCents,
    originalHostShareCents: payment.originalHostShareCents!,
  });

  await tx
    .update(schema.refunds)
    .set({ status: "done", stripeRefundId, finishedAt: new Date() })
    .where(eq(schema.refunds.id, refundId));
  await tx
    .update(schema.payments)
    .set({
      refundedCents,
      transferStatus: after.hostShareCents === 0 && payment.transferStatus !== "sent" ? "not_owed" : payment.transferStatus,
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, payment.id));
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "customer_refund", amountCents: -refund.amountCents, stripeRef: stripeRefundId });
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: after.feeCents - before.feeCents, stripeRef: stripeRefundId });
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: after.hostShareCents - before.hostShareCents, stripeRef: stripeRefundId });
}

export async function markRefundFailed(refundId: string, tx: Tx): Promise<void> {
  await tx
    .update(schema.refunds)
    .set({ status: "failed", finishedAt: new Date() })
    .where(and(eq(schema.refunds.id, refundId), eq(schema.refunds.status, "in_progress")));
}

/**
 * Gives money back to the customer. Allowed until the host's share has been
 * sent. Our fee shrinks in the same proportion, so a full refund is truly full.
 */
export async function refundPayment(input: {
  paymentId: string;
  amountCents: number;
  decidedBy: string;
  decidedAs: "host" | "admin";
  reason: string | null;
}): Promise<void> {
  const refundId = randomUUID();
  await runMoneyOperation<RefundParams, { status: string | null }>({
    paymentId: input.paymentId,
    kind: "refund",
    labelBase: `refund:${refundId}`,
    prepare: async (payment, tx) => {
      if (payment.status !== "charged" || payment.chargedCents === null) throw new MoneyError("Nothing has been charged for this call.");
      if (payment.transferStatus === "sent") {
        throw new MoneyError("The host has already been paid for this call. A refund now has to go through support.");
      }
      if (payment.disputeOpen) throw new MoneyError("The customer's bank is disputing this charge, so it cannot be refunded as well.");
      const [pending] = await tx
        .select({ total: sql<number>`coalesce(sum(${schema.refunds.amountCents}), 0)::int` })
        .from(schema.refunds)
        .where(and(eq(schema.refunds.paymentId, payment.id), eq(schema.refunds.status, "in_progress")));
      const available = payment.chargedCents - payment.refundedCents - pending.total;
      if (!Number.isInteger(input.amountCents) || input.amountCents < 1) throw new MoneyError("Enter an amount to refund.");
      if (input.amountCents > available) throw new MoneyError("That is more than what is left to refund.");
      await tx.insert(schema.refunds).values({
        id: refundId,
        paymentId: payment.id,
        amountCents: input.amountCents,
        decidedBy: input.decidedBy,
        decidedAs: input.decidedAs,
        reason: input.reason,
      });
      return { refundId, amountCents: input.amountCents };
    },
    execute: async (params, label) => {
      const [payment] = await paymentById(input.paymentId);
      const refund = await stripe().refunds.create(
        {
          payment_intent: payment.stripePaymentIntentId!,
          amount: params.amountCents,
          metadata: { paymentId: payment.id, refundId: params.refundId },
        },
        { idempotencyKey: label },
      );
      return { stripeId: refund.id, result: { status: refund.status } };
    },
    apply: async (payment, params, outcome, tx) => {
      if (outcome.result.status === "succeeded") {
        await applyRefundDone(payment, params.refundId, outcome.stripeId, tx);
      } else if (outcome.result.status === "failed" || outcome.result.status === "canceled") {
        await markRefundFailed(params.refundId, tx);
      } else {
        // Still on its way. reconcile.ts finishes it once Stripe confirms.
        await tx.update(schema.refunds).set({ stripeRefundId: outcome.stripeId }).where(eq(schema.refunds.id, params.refundId));
      }
    },
    onRefused: (_payment, params, _message, tx) => markRefundFailed(params.refundId, tx),
  });
}

// ---------------------------------------------------------------------------
// Send the host's share
// ---------------------------------------------------------------------------

type TransferParams = { amountCents: number; payoutFeeCents: number; destination: string; callId: string };

export async function applyTransferSent(payment: Payment, params: TransferParams, stripeTransferId: string | null, tx: Tx): Promise<void> {
  await tx
    .update(schema.payments)
    .set({
      transferStatus: "sent",
      transferCents: params.amountCents,
      payoutFeeCents: params.payoutFeeCents,
      stripeTransferId,
      transferredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, payment.id));
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_transfer", amountCents: -params.amountCents, stripeRef: stripeTransferId });
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "payout_fee", amountCents: params.payoutFeeCents, stripeRef: stripeTransferId });
}

/** Sends the host's share for one call to the host's Stripe account. */
export async function transferToHost(input: {
  paymentId: string;
  payoutFeeCents: number;
  destination: string;
  callId: string;
  now: Date;
}): Promise<void> {
  await runMoneyOperation<TransferParams, null>({
    paymentId: input.paymentId,
    kind: "transfer",
    labelBase: `transfer:${input.paymentId}`,
    prepare: async (payment, tx) => {
      if (payment.status !== "charged") throw new MoneyError("Nothing has been charged for this call.");
      if (payment.transferStatus !== "not_due" && payment.transferStatus !== "due") {
        throw new MoneyError("The host's share has already been sent, or nothing is owed.");
      }
      if (!payment.transferDueAt || payment.transferDueAt > input.now) throw new MoneyError("The host's share is not due yet.");
      if (payment.disputeOpen) throw new MoneyError("The customer's bank is disputing this charge.");
      if (!payment.stripeChargeId) throw new MoneyError("This payment has no charge at Stripe.");
      const [pending] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.refunds)
        .where(and(eq(schema.refunds.paymentId, payment.id), eq(schema.refunds.status, "in_progress")));
      if (pending.count > 0) throw new MoneyError("A refund is still in progress on this call.");

      const { hostShareCents } = currentSplit(payment);
      const payoutFeeCents = Math.min(input.payoutFeeCents, hostShareCents);
      const amountCents = hostShareCents - payoutFeeCents;
      if (amountCents < 1) throw new MoneyError("There is nothing to send for this call.");
      return { amountCents, payoutFeeCents, destination: input.destination, callId: input.callId };
    },
    execute: async (params, label) => {
      const [payment] = await paymentById(input.paymentId);
      const transfer = await stripe().transfers.create(
        {
          amount: params.amountCents,
          currency: payment.currency,
          destination: params.destination,
          source_transaction: payment.stripeChargeId!,
          transfer_group: params.callId,
          metadata: { paymentId: payment.id },
        },
        { idempotencyKey: label },
      );
      return { stripeId: transfer.id, result: null };
    },
    apply: (payment, params, outcome, tx) => applyTransferSent(payment, params, outcome.stripeId, tx),
  });
}

async function paymentById(paymentId: string): Promise<Payment[]> {
  const { db } = await import("@/db");
  return db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
}
