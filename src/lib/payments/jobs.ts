/**
 * The work the always-on helper does for payments, every few seconds:
 *   - check with Stripe on any action whose outcome is not known,
 *   - charge calls that have finished, or queue them for review,
 *   - release holds nobody decided on in time,
 *   - flag calls whose record changed after they were charged,
 *   - send hosts their share on the weekly payday.
 *
 * Each job is safe to run again and again, and safe to run on two helpers at once.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import {
  applyCaptured,
  applyRefundDone,
  applyReleased,
  applyTransferSent,
  capturePayment,
  currentSplit,
  markRefundFailed,
  releasePayment,
  transferToHost,
} from "./actions";
import { settleCancelledCall } from "./cancel";
import { failOperation, finishOperation, lockPayment, MoneyError, OutcomeUnknownError } from "./operations";
import { attendanceChargeCents, PAYOUT_FEE_CENTS } from "./pricing";
import { decisionDeadline } from "./rules";
import { syncHold } from "./hold";
import { stripe } from "./stripe";

/** An unfinished action is only checked once Stripe has had time to finish it. */
const RECONCILE_AFTER_MS = 60_000;
/** Stripe remembers an action's label for at least this long, so repeating it is safe. */
const LABEL_SAFE_MS = 23 * 3_600_000;

function log(message: string, error?: unknown) {
  // Expected refusals (already done, waiting, not allowed) are not errors.
  if (error instanceof MoneyError || error instanceof OutcomeUnknownError) {
    console.log(`[payments] ${message}: ${error.message}`);
  } else if (error) {
    console.error(`[payments] ${message}`, error);
  } else {
    console.log(`[payments] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Find out what happened to unfinished actions
// ---------------------------------------------------------------------------

export async function reconcileOperations(now: Date): Promise<void> {
  const stuck = await db
    .select()
    .from(schema.moneyOperations)
    .where(
      and(
        eq(schema.moneyOperations.status, "started"),
        lte(schema.moneyOperations.createdAt, new Date(now.getTime() - RECONCILE_AFTER_MS)),
      ),
    );

  for (const operation of stuck) {
    try {
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, operation.paymentId));
      const params = JSON.parse(operation.params);
      const canRepeat = now.getTime() - operation.createdAt.getTime() < LABEL_SAFE_MS;

      if (operation.kind === "capture" || operation.kind === "release") {
        // For these two, the hold's own state at Stripe is the whole truth.
        const intent = await stripe().paymentIntents.retrieve(payment.stripePaymentIntentId!, { expand: ["latest_charge"] });
        const chargeId = typeof intent.latest_charge === "object" ? (intent.latest_charge?.id ?? null) : intent.latest_charge;
        if (intent.status === "succeeded" && operation.kind === "capture") {
          await finishOperation(operation.id, payment.id, intent.id, (p, tx) => applyCaptured(p, params, chargeId, tx));
        } else if (intent.status === "canceled") {
          await finishOperation(operation.id, payment.id, intent.id, (p, tx) =>
            applyReleased(p, params.note ?? "The hold ended at Stripe before a charge was made.", tx),
          );
        } else {
          await failOperation(operation.id, payment.id, "Stripe shows this did not happen.");
        }
      } else if (operation.kind === "refund") {
        let refund: { id: string; status: string | null } | undefined;
        if (canRepeat) {
          // Repeating under the same label returns the original result if it already went through.
          refund = await stripe().refunds.create(
            { payment_intent: payment.stripePaymentIntentId!, amount: params.amountCents, metadata: { paymentId: payment.id, refundId: params.refundId } },
            { idempotencyKey: operation.label },
          );
        } else {
          const list = await stripe().refunds.list({ payment_intent: payment.stripePaymentIntentId!, limit: 100 });
          refund = list.data.find((r) => r.metadata?.refundId === params.refundId);
        }
        if (!refund || refund.status === "failed" || refund.status === "canceled") {
          await db.transaction((tx) => markRefundFailed(params.refundId, tx));
          await failOperation(operation.id, payment.id, "Stripe shows this refund did not happen.");
        } else if (refund.status === "succeeded") {
          const found = refund;
          await finishOperation(operation.id, payment.id, found.id, (p, tx) => applyRefundDone(p, params.refundId, found.id, tx));
        } else {
          const found = refund;
          await finishOperation(operation.id, payment.id, found.id, async (_p, tx) => {
            await tx.update(schema.refunds).set({ stripeRefundId: found.id }).where(eq(schema.refunds.id, params.refundId));
          });
        }
      } else if (operation.kind === "transfer") {
        let transferId: string | undefined;
        if (canRepeat) {
          const transfer = await stripe().transfers.create(
            {
              amount: params.amountCents,
              currency: payment.currency,
              destination: params.destination,
              source_transaction: payment.stripeChargeId!,
              transfer_group: params.callId,
              metadata: { paymentId: payment.id },
            },
            { idempotencyKey: operation.label },
          );
          transferId = transfer.id;
        } else {
          const list = await stripe().transfers.list({ transfer_group: params.callId, limit: 100 });
          transferId = list.data.find((t) => t.metadata?.paymentId === payment.id)?.id;
        }
        if (transferId) {
          const found = transferId;
          await finishOperation(operation.id, payment.id, found, (p, tx) => applyTransferSent(p, params, found, tx));
        } else {
          await failOperation(operation.id, payment.id, "Stripe shows this transfer did not happen.");
        }
      }
      log(`checked unfinished ${operation.kind} on payment ${operation.paymentId}`);
    } catch (error) {
      log(`could not check unfinished ${operation.kind} on payment ${operation.paymentId}; will retry`, error);
    }
  }

  // Refunds Stripe accepted but had not finished.
  const pendingRefunds = await db
    .select()
    .from(schema.refunds)
    .where(and(eq(schema.refunds.status, "in_progress"), isNotNull(schema.refunds.stripeRefundId)));
  for (const refund of pendingRefunds) {
    try {
      const latest = await stripe().refunds.retrieve(refund.stripeRefundId!);
      if (latest.status === "succeeded") {
        await db.transaction(async (tx) => {
          const payment = await lockPayment(tx, refund.paymentId);
          await applyRefundDone(payment, refund.id, latest.id, tx);
        });
      } else if (latest.status === "failed" || latest.status === "canceled") {
        await db.transaction((tx) => markRefundFailed(refund.id, tx));
      }
    } catch (error) {
      log(`could not check refund ${refund.id}; will retry`, error);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Charge finished calls, or queue them for review
// ---------------------------------------------------------------------------

export async function settleFinishedCalls(now: Date): Promise<void> {
  const due = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(
      and(
        inArray(schema.payments.status, ["awaiting_payment", "held"]),
        lte(schema.calls.endsAt, now),
        isNull(schema.calls.cancelledAt),
      ),
    );

  for (const { payment, call } of due) {
    try {
      await settleOne(payment, call, now);
    } catch (error) {
      log(`could not settle payment ${payment.id}; will retry`, error);
    }
  }
}

async function settleOne(payment: Payment, call: Call, now: Date): Promise<void> {
  if (payment.status === "awaiting_payment") {
    // The customer may have paid in the last moments: ask Stripe before closing.
    const synced = await syncHold(payment.id, now);
    if (synced.status !== "awaiting_payment") return;
    await releasePayment({ paymentId: payment.id, note: "The call ended without a payment." });
    log(`closed unpaid payment ${payment.id}`);
    return;
  }

  // A hold that has run out can no longer be charged. Stripe has the final word.
  if (payment.holdExpiresAt && payment.holdExpiresAt <= now) {
    await syncHold(payment.id, now);
    return;
  }

  const deadline = decisionDeadline({ callEndsAt: call.endsAt, holdExpiresAt: payment.holdExpiresAt ?? call.endsAt });

  if (payment.needsReview) {
    if (now >= deadline) {
      await releasePayment({ paymentId: payment.id, note: "No decision was made in time, so the hold was released." });
      log(`released undecided payment ${payment.id}`);
    }
    return;
  }

  const attendance = await loadAttendance(call, now);
  if (!attendance.final) {
    // Still waiting for late messages. If that somehow lasts until the deadline, let the hold go.
    if (now >= deadline) {
      await releasePayment({ paymentId: payment.id, note: "The call's record was not final in time, so the hold was released." });
    }
    return;
  }

  if (attendance.result.status === "complete" && attendance.result.totals) {
    const totals = attendance.result.totals;
    const amountCents = attendanceChargeCents({
      pricePer15Cents: payment.pricePer15Cents,
      bookedSeconds: attendance.bookedSeconds,
      hostSeconds: totals.hostSeconds,
    });
    if (amountCents === 0) {
      await releasePayment({ paymentId: payment.id, note: "Nothing was owed for this call." });
      log(`released payment ${payment.id}: nothing owed`);
    } else {
      await capturePayment({ paymentId: payment.id, amountCents, reason: "attendance", frozen: totals, callEndsAt: call.endsAt });
      log(`charged payment ${payment.id}: ${amountCents} cents`);
    }
    return;
  }

  // The record is incomplete or contradicts itself: never charge on a guess.
  await db.transaction(async (tx) => {
    const locked = await lockPayment(tx, payment.id);
    if (locked.status !== "held" || locked.needsReview) return;
    await tx
      .update(schema.payments)
      .set({ needsReview: true, reviewReason: attendance.result.reasons.join(" ") || "The call's record is incomplete.", updatedAt: new Date() })
      .where(eq(schema.payments.id, payment.id));
  });
  log(`payment ${payment.id} needs review`);
}

// ---------------------------------------------------------------------------
// 3. Flag calls whose record changed after they were charged
// ---------------------------------------------------------------------------

export async function flagChangedRecords(now: Date): Promise<void> {
  // Only calls that received a message after they were charged can have changed.
  const candidates = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(
      and(
        eq(schema.payments.status, "charged"),
        eq(schema.payments.chargeReason, "attendance"),
        eq(schema.payments.flaggedAfterCharge, false),
        sql`exists (select 1 from ${schema.attendanceEvents} e where e.call_id = ${schema.calls.id} and e.received_at > ${schema.payments.chargedAt})`,
      ),
    );

  for (const { payment, call } of candidates) {
    const attendance = await loadAttendance(call, now);
    const totals = attendance.result.totals;
    const changed = attendance.result.status !== "complete" || !totals || totals.hostSeconds !== payment.frozenHostSeconds;
    if (!changed) continue;
    await db
      .update(schema.payments)
      .set({ flaggedAfterCharge: true, reviewReason: "The call's record changed after it was charged. The charge was not changed.", updatedAt: new Date() })
      .where(eq(schema.payments.id, payment.id));
    log(`payment ${payment.id} flagged: record changed after the charge`);
  }
}

// ---------------------------------------------------------------------------
// 4. The weekly payday
// ---------------------------------------------------------------------------

export async function runPayday(now: Date): Promise<void> {
  const due = await db
    .select({ payment: schema.payments, call: schema.calls, host: schema.hostSettings })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .innerJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.calls.hostId))
    .where(
      and(
        eq(schema.payments.status, "charged"),
        inArray(schema.payments.transferStatus, ["not_due", "due"]),
        lte(schema.payments.transferDueAt, now),
        eq(schema.payments.disputeOpen, false),
        eq(schema.hostSettings.payoutsReady, true),
        isNotNull(schema.hostSettings.stripeAccountId),
      ),
    );
  if (due.length === 0) return;

  const byHost = new Map<string, typeof due>();
  for (const row of due) byHost.set(row.call.hostId, [...(byHost.get(row.call.hostId) ?? []), row]);

  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  for (const [hostId, rows] of byHost) {
    // The payout charge is taken once per host per payday, from the largest share.
    const [alreadyCharged] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.payments)
      .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
      .where(
        and(
          eq(schema.calls.hostId, hostId),
          gt(schema.payments.payoutFeeCents, 0),
          sql`${schema.payments.transferredAt} >= ${dayStart.toISOString()}::timestamptz`,
        ),
      );
    let feeLeft = alreadyCharged.count > 0 ? 0 : PAYOUT_FEE_CENTS;

    const sorted = [...rows].sort((a, b) => currentSplit(b.payment).hostShareCents - currentSplit(a.payment).hostShareCents);
    for (const { payment, call, host } of sorted) {
      try {
        const share = currentSplit(payment).hostShareCents;
        const fee = Math.min(feeLeft, share);
        if (share - fee < 1) {
          // The whole share (if any) went to the payout charge. Nothing to send.
          await db.transaction(async (tx) => {
            const locked = await lockPayment(tx, payment.id);
            if (locked.transferStatus !== "not_due" && locked.transferStatus !== "due") return;
            await applyTransferSent(locked, { amountCents: 0, payoutFeeCents: fee, destination: host.stripeAccountId!, callId: call.id }, null, tx);
          });
          feeLeft -= fee;
          continue;
        }
        await transferToHost({ paymentId: payment.id, payoutFeeCents: fee, destination: host.stripeAccountId!, callId: call.id, now });
        feeLeft -= fee;
        log(`sent host share for payment ${payment.id}`);
      } catch (error) {
        log(`could not send host share for payment ${payment.id}; will retry`, error);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Finish the money side of cancelled calls
// ---------------------------------------------------------------------------

export async function settleCancelledCalls(): Promise<void> {
  const open = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(inArray(schema.payments.status, ["awaiting_payment", "held"]), isNotNull(schema.calls.cancelledAt)));
  for (const { payment, call } of open) {
    try {
      await settleCancelledCall(call, payment);
      log(`settled cancelled call ${call.id}`);
    } catch (error) {
      log(`could not settle cancelled call ${call.id}; will retry`, error);
    }
  }
}

/** Everything the helper does for payments in one pass, in a safe order. */
export async function runPaymentJobs(now: Date): Promise<void> {
  await reconcileOperations(now);
  await settleCancelledCalls();
  await settleFinishedCalls(now);
  await flagChangedRecords(now);
  await runPayday(now);
}
