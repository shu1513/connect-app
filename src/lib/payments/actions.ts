/**
 * The four actions that move money: charge a held payment, release a hold,
 * refund, and send the host's share. Each is written down first, under one
 * label, so none can happen twice. (A host's share is written down by a
 * collection: see collect.ts.)
 *
 * The "apply…" functions record an outcome. They are also used by jobs.ts
 * when it finds out from Stripe what happened to an unfinished action.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Payment } from "@/db/schema";
import { addLedgerEntry, MoneyError, runMoneyOperation, type OperationPlan, type Tx } from "./operations";
import { MIN_CHARGE_CENTS, splitAfterRefunds, splitCharge } from "./pricing";
import { canMovePayment, decisionDeadline, readyToCollectAt } from "./rules";
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

export type CaptureParams = {
  amountCents: number;
  reason: ChargeReason;
  frozen: FrozenTotals | null;
  callEndsAt: string;
  /** The last attendance message known when the amount was worked out. */
  pricedThroughEventId: number | null;
  /** When an answer to a refund request made this charge lower than the call's record gave. */
  lowered?: Lowered;
};

/** A charge lowered (or dropped) by an answer to a refund request: what the record gave, and who lowered it. */
export type Lowered = { recordCents: number; by: "host" | "admin" };

/**
 * Records a charge Stripe has made. `amountCents` is what Stripe actually
 * received, which is the only number that counts.
 */
export async function applyCaptured(
  payment: Payment,
  params: CaptureParams,
  amountCents: number,
  stripeChargeId: string | null,
  tx: Tx,
): Promise<void> {
  const { feeCents, hostShareCents } = splitCharge(
    amountCents,
    { percentBps: payment.feePercentBps, fixedCents: payment.feeFixedCents, foreignCardBps: payment.feeForeignCardBps },
    isForeignCard(payment),
  );
  // One moment for "charged at" and for the date the host's share becomes ready.
  const chargedAt = new Date();
  await tx
    .update(schema.payments)
    .set({
      status: "charged",
      needsReview: false,
      chargedCents: amountCents,
      chargeReason: params.reason,
      chargedAt,
      stripeChargeId: stripeChargeId ?? payment.stripeChargeId,
      originalFeeCents: feeCents,
      originalHostShareCents: hostShareCents,
      frozenHostSeconds: params.frozen?.hostSeconds ?? null,
      frozenCustomerSeconds: params.frozen?.customerSeconds ?? null,
      frozenTogetherSeconds: params.frozen?.togetherSeconds ?? null,
      pricedThroughEventId: params.pricedThroughEventId ?? null,
      recordCents: params.lowered?.recordCents ?? null,
      loweredBy: params.lowered?.by ?? null,
      transferStatus: hostShareCents > 0 ? "not_due" : "not_owed",
      transferDueAt: hostShareCents > 0 ? readyToCollectAt({ callEndsAt: new Date(params.callEndsAt), chargedAt }) : null,
      updatedAt: chargedAt,
    })
    .where(eq(schema.payments.id, payment.id));
  const ref = stripeChargeId ?? payment.stripeChargeId;
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "customer_charge", amountCents, stripeRef: ref, note: params.reason });
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "platform_fee", amountCents: feeCents, stripeRef: ref });
  await addLedgerEntry(tx, { paymentId: payment.id, kind: "host_share", amountCents: hostShareCents, stripeRef: ref });
}

/**
 * Asks Stripe to charge a held payment. If Stripe says the hold was already
 * charged (an earlier attempt went through without us hearing back), that
 * charge is reported instead, so it is recorded rather than lost.
 */
export async function captureAtStripe(
  intentId: string,
  amountCents: number,
  label: string,
): Promise<{ stripeId: string; result: { chargeId: string | null; amountReceived: number } }> {
  let intent;
  try {
    intent = await stripe().paymentIntents.capture(intentId, { amount_to_capture: amountCents }, { idempotencyKey: label });
  } catch (error) {
    const current = await stripe().paymentIntents.retrieve(intentId);
    if (current.status !== "succeeded") throw error;
    intent = current;
  }
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
  return { stripeId: intent.id, result: { chargeId, amountReceived: intent.amount_received } };
}

export type CaptureInput = {
  paymentId: string;
  amountCents: number;
  reason: ChargeReason;
  frozen: FrozenTotals | null;
  callEndsAt: Date;
  pricedThroughEventId?: number | null;
  now?: Date;
  /** The most that may be charged, when less than the booked price (a call stopped for safety). */
  maxCents?: number;
  lowered?: Lowered;
};

/** Charges a held payment once. The unused part of the hold is released by Stripe. */
export function capturePayment(input: CaptureInput) {
  return runMoneyOperation(capturePlan(input));
}

/** The steps of one charge. Used on its own where several charges of a call are written down together (take.ts). */
export function capturePlan(input: CaptureInput): OperationPlan<CaptureParams, { chargeId: string | null; amountReceived: number }> {
  return {
    paymentId: input.paymentId,
    kind: "capture",
    labelBase: `capture:${input.paymentId}`,
    prepare: async (payment, tx) => {
      if (!canMovePayment(payment.status as never, "charged")) throw new MoneyError("This payment is not being held.");
      if (!payment.stripePaymentIntentId) throw new MoneyError("This payment has no hold at Stripe.");
      // The payment of a request for more time can only be charged if the host accepted that request.
      // One that was declined or ran out is only ever let go, whoever asks and for whatever reason.
      if (payment.extensionId) {
        const [extension] = await tx.select({ status: schema.callExtensions.status }).from(schema.callExtensions).where(eq(schema.callExtensions.id, payment.extensionId));
        if (extension?.status !== "accepted") throw new MoneyError("This request for more time was not accepted, so it cannot be charged.");
      }
      if (input.reason === "admin") {
        // The founder only decides calls that are waiting for review, and only before the deadline.
        if (!payment.needsReview) throw new MoneyError("This payment is not waiting for review.");
        const deadline = decisionDeadline({ callEndsAt: input.callEndsAt, holdExpiresAt: payment.holdExpiresAt ?? input.callEndsAt });
        if ((input.now ?? new Date()) >= deadline) throw new MoneyError("The deadline for deciding this call has passed.");
      } else if (payment.needsReview) {
        // A call waiting for the founder's decision is only ever charged by the founder.
        throw new MoneyError("This payment is waiting for review.");
      }
      if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_CHARGE_CENTS) {
        throw new MoneyError("The amount is below the minimum that can be charged.");
      }
      if (input.amountCents > payment.bookedCents) throw new MoneyError("The amount is more than the booked price.");
      if (input.maxCents !== undefined && input.amountCents > input.maxCents) {
        throw new MoneyError("The amount is more than the time before the call was stopped allows.");
      }
      return {
        amountCents: input.amountCents,
        reason: input.reason,
        frozen: input.frozen,
        callEndsAt: input.callEndsAt.toISOString(),
        pricedThroughEventId: input.pricedThroughEventId ?? null,
        ...(input.lowered ? { lowered: input.lowered } : {}),
      };
    },
    execute: async (params, label) => {
      const [payment] = await paymentById(input.paymentId);
      return captureAtStripe(payment.stripePaymentIntentId!, params.amountCents, label);
    },
    apply: (payment, params, outcome, tx) =>
      applyCaptured(payment, params, outcome.result.amountReceived, outcome.result.chargeId, tx),
  };
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export type ReleaseParams = { note: string; lowered?: Lowered };

export async function applyReleased(payment: Payment, note: string, tx: Tx, lowered?: Lowered): Promise<void> {
  await tx
    .update(schema.payments)
    .set({
      status: "closed_uncharged",
      needsReview: false,
      transferStatus: "not_owed",
      reviewReason: note,
      recordCents: lowered?.recordCents ?? null,
      loweredBy: lowered?.by ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, payment.id));
}

/** The steps of letting a hold at Stripe go. Used on its own where several payments of a call are written down together (take.ts). */
export function releasePlan(input: { paymentId: string; note: string; lowered?: Lowered }): OperationPlan<ReleaseParams, null> {
  return {
    paymentId: input.paymentId,
    kind: "release",
    labelBase: `release:${input.paymentId}`,
    prepare: async (payment) => {
      if (!canMovePayment(payment.status as never, "closed_uncharged")) {
        throw new MoneyError("This payment has already been charged or closed.");
      }
      return { note: input.note, ...(input.lowered ? { lowered: input.lowered } : {}) };
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
    apply: (payment, params, _outcome, tx) => applyReleased(payment, params.note, tx, params.lowered),
  };
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

  await runMoneyOperation(releasePlan(input));
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

  const nothingOwedNow = after.hostShareCents === 0 && payment.transferStatus !== "sent";
  await tx
    .update(schema.refunds)
    .set({ status: "done", stripeRefundId, finishedAt: new Date() })
    .where(eq(schema.refunds.id, refundId));
  await tx
    .update(schema.payments)
    .set({ refundedCents, transferStatus: nothingOwedNow ? "not_owed" : payment.transferStatus, updatedAt: new Date() })
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
  /**
   * One ID per refund request, made when the form is shown. Sending the same
   * request again (a double click, a retry after a lost answer) cannot refund twice.
   */
  requestId?: string;
}): Promise<void> {
  const refundId = input.requestId ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refundId)) {
    throw new MoneyError("This refund request is not valid. Reload the page and try again.");
  }
  await runMoneyOperation<RefundParams, { status: string | null }>({
    paymentId: input.paymentId,
    kind: "refund",
    labelBase: `refund:${refundId}`,
    prepare: async (payment, tx) => {
      if (payment.status !== "charged" || payment.chargedCents === null) throw new MoneyError("Nothing has been charged for this call.");
      if (payment.transferStatus === "sent") {
        throw new MoneyError("The host has already been paid for this call. A refund now has to go through support.");
      }
      if (payment.disputeOpen) throw new MoneyError("The customer's bank has disputed this charge, so it cannot be refunded as well.");
      const [pending] = await tx
        .select({ total: sql<number>`coalesce(sum(${schema.refunds.amountCents}), 0)::int` })
        .from(schema.refunds)
        .where(and(eq(schema.refunds.paymentId, payment.id), eq(schema.refunds.status, "in_progress")));
      const available = payment.chargedCents - payment.refundedCents - pending.total;
      if (!Number.isInteger(input.amountCents) || input.amountCents < 1) throw new MoneyError("Enter an amount to refund.");
      if (input.amountCents > available) throw new MoneyError("That is more than what is left to refund.");
      const [seen] = await tx.select({ id: schema.refunds.id }).from(schema.refunds).where(eq(schema.refunds.id, refundId));
      if (seen) throw new MoneyError("This refund request did not go through. Reload the page to try again.");
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

export type TransferParams = { amountCents: number; payoutFeeCents: number; destination: string; callId: string };

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

/** Asks Stripe to send a host's share. Nothing is asked when there is nothing to send. */
export async function transferAtStripe(payment: Payment, params: TransferParams, label: string): Promise<string | null> {
  if (params.amountCents < 1) return null;
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
  return transfer.id;
}

/**
 * Asking Stripe to send a share that a collection wrote down, and recording
 * the answer. The checks and the amounts were fixed when it was written down.
 */
export function transferSteps(paymentId: string) {
  return {
    paymentId,
    execute: async (params: TransferParams, label: string) => {
      const [payment] = await paymentById(paymentId);
      const transferId = await transferAtStripe(payment, params, label);
      return { stripeId: transferId ?? "nothing-to-send", result: null };
    },
    apply: (payment: Payment, params: TransferParams, outcome: { stripeId: string }, tx: Tx) =>
      applyTransferSent(payment, params, params.amountCents < 1 ? null : outcome.stripeId, tx),
  };
}

async function paymentById(paymentId: string): Promise<Payment[]> {
  const { db } = await import("@/db");
  return db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
}
