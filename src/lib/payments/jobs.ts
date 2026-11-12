/**
 * The work the always-on helper does for payments, every few seconds:
 *   - check with Stripe on any action whose outcome is not known,
 *   - handle saved Stripe messages that could not be handled when they arrived,
 *   - finish the money side of cancelled calls,
 *   - charge calls that have finished, or queue them for review,
 *   - release holds nobody decided on in time,
 *   - flag calls whose record changed after they were charged,
 *   - send hosts their share on the weekly payday.
 *
 * Each job is safe to run again and again, and safe to run on two helpers at once.
 */
import { and, eq, inArray, isNotNull, isNull, like, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import {
  applyCaptured,
  applyRefundDone,
  applyReleased,
  applyTransferSent,
  captureAtStripe,
  capturePayment,
  markRefundFailed,
  releasePayment,
  sendHostShare,
  transferAtStripe,
} from "./actions";
import { settleCancelledCall } from "./cancel";
import { refreshPayoutsReady } from "./hosts";
import { failOperation, finishOperation, lockPayment, MoneyError, OutcomeUnknownError } from "./operations";
import { attendanceChargeCents } from "./pricing";
import { confirmWithSavedCard, syncHold } from "./hold";
import { decisionDeadline } from "./rules";
import { isDefiniteRefusal, stripe, stripeErrorMessage } from "./stripe";
import { handleStripeEvent } from "./stripe-events";

/** An unfinished action is only checked once Stripe has had time to finish it. */
const RECONCILE_AFTER_MS = 60_000;
/**
 * Stripe remembers an action's label for at least 24 hours. Inside this
 * window, sending the same request again is safe: Stripe returns the original
 * result, or does it now if it never arrived.
 */
const LABEL_SAFE_MS = 23 * 3_600_000;
/** How often a host's payout account is re-checked with Stripe while money is waiting for them. */
const HOST_RECHECK_MS = 3_600_000;

/** After Stripe refuses an action, wait this long before trying it again. */
const RETRY_AFTER_REFUSAL_MS = 3_600_000;

/**
 * Whether Stripe refused this kind of action on this payment a short while ago.
 * Without this, a payout Stripe keeps refusing (for example because our Stripe
 * balance is short) would be tried again every few seconds.
 */
async function recentlyRefused(paymentId: string, kind: string, now: Date): Promise<boolean> {
  const [refused] = await db
    .select({ id: schema.moneyOperations.id })
    .from(schema.moneyOperations)
    .where(
      and(
        eq(schema.moneyOperations.paymentId, paymentId),
        eq(schema.moneyOperations.kind, kind),
        eq(schema.moneyOperations.status, "failed"),
        sql`${schema.moneyOperations.finishedAt} > ${new Date(now.getTime() - RETRY_AFTER_REFUSAL_MS).toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return Boolean(refused);
}

/**
 * A charge attempt we wrote off as refused can still have gone through at
 * Stripe. Before anything else is decided about a held payment with such an
 * attempt, ask Stripe and record what it really shows. Returns the payment as
 * it stands afterwards.
 */
async function afterCheckingRefusedCharge(payment: Payment, now: Date): Promise<Payment> {
  if (payment.status !== "held") return payment;
  const [refused] = await db
    .select({ id: schema.moneyOperations.id })
    .from(schema.moneyOperations)
    .where(
      and(
        eq(schema.moneyOperations.paymentId, payment.id),
        eq(schema.moneyOperations.kind, "capture"),
        eq(schema.moneyOperations.status, "failed"),
      ),
    )
    .limit(1);
  return refused ? syncHold(payment.id, now) : payment;
}

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
      // Measured on the real clock, right before acting, so a slow pass can never repeat a request too late.
      const canRepeat = () => Date.now() - operation.createdAt.getTime() < LABEL_SAFE_MS;
      const giveUp = (why: string) => failOperation(operation.id, payment.id, why);

      if (operation.kind === "capture") {
        if (canRepeat() && Number.isInteger(params.amountCents)) {
          // The original request may still be on its way, so "not charged yet" proves nothing.
          // Sending it again under the same label is the only safe way to find out.
          const outcome = await captureAtStripe(payment.stripePaymentIntentId!, params.amountCents, operation.label);
          await finishOperation(operation.id, payment.id, outcome.stripeId, (p, tx) =>
            applyCaptured(p, params, outcome.result.amountReceived, outcome.result.chargeId, tx),
          );
        } else {
          // Too old to repeat safely. By now the hold's own state at Stripe is settled.
          const intent = await stripe().paymentIntents.retrieve(payment.stripePaymentIntentId!);
          const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
          if (intent.status === "succeeded") {
            await finishOperation(operation.id, payment.id, intent.id, (p, tx) => applyCaptured(p, params, intent.amount_received, chargeId, tx));
          } else if (intent.status === "canceled") {
            await finishOperation(operation.id, payment.id, intent.id, (p, tx) =>
              applyReleased(p, "The hold ended at Stripe before a charge was made.", tx),
            );
          } else {
            await giveUp("Stripe shows this charge did not happen.");
          }
        }
      } else if (operation.kind === "hold") {
        // The automatic try with a saved card. Asking Stripe how the hold stands is always safe.
        let current = await syncHold(payment.id, now);
        if (current.status !== "held" && canRepeat()) {
          // The first request may never have arrived, or may still be on its way. Sending the same
          // request under the same label is the only safe way to find out: Stripe returns the first
          // answer, or does it now. A clear "no" is thrown and handled below.
          await confirmWithSavedCard({ intentId: params.intentId, paymentMethodId: params.paymentMethodId }, operation.label);
          current = await syncHold(payment.id, now);
        }
        if (current.status === "held") {
          await finishOperation(operation.id, payment.id, params.intentId, async () => undefined);
        } else {
          const intent = await stripe().paymentIntents.retrieve(params.intentId);
          if (intent.status === "processing") continue; // not settled yet: look again next pass
          if (intent.status === "requires_capture") {
            // Authorised, but too late to count (after the booking's payment deadline). The try is over;
            // the unpaid-at-the-cut-off job cancels the call and lets this hold go.
            await finishOperation(operation.id, payment.id, params.intentId, async () => undefined);
            continue;
          }
          await giveUp("The saved card could not be used.");
        }
      } else if (operation.kind === "release") {
        const intentId = payment.stripePaymentIntentId!;
        let intent = await stripe().paymentIntents.retrieve(intentId);
        if (intent.status !== "canceled" && intent.status !== "succeeded") {
          // Letting a hold go is always safe to do again.
          intent = await stripe().paymentIntents.cancel(intentId);
        }
        if (intent.status === "canceled") {
          await finishOperation(operation.id, payment.id, intent.id, (p, tx) =>
            applyReleased(p, params.note ?? "The hold was released.", tx),
          );
        } else {
          await giveUp("This payment was charged, so the hold could not be released.");
        }
      } else if (operation.kind === "refund") {
        let refund: { id: string; status: string | null } | undefined;
        if (canRepeat()) {
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
          await giveUp("Stripe shows this refund did not happen.");
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
        let transferId: string | null | undefined;
        if (params.amountCents < 1) {
          transferId = null; // nothing was ever sent to Stripe for this one
        } else if (canRepeat()) {
          transferId = await transferAtStripe(payment, params, operation.label);
        } else {
          const list = await stripe().transfers.list({ transfer_group: params.callId, limit: 100 });
          transferId = list.data.find((t) => t.metadata?.paymentId === payment.id)?.id;
        }
        if (transferId === undefined) {
          await giveUp("Stripe shows this transfer did not happen.");
        } else {
          const found = transferId;
          await finishOperation(operation.id, payment.id, found ?? "nothing-to-send", (p, tx) => applyTransferSent(p, params, found, tx));
        }
      }
      log(`checked unfinished ${operation.kind} on payment ${operation.paymentId}`);
    } catch (error) {
      if (isDefiniteRefusal(error)) {
        // Stripe gave a clear "no" to the repeated request, so it definitely did not happen.
        const params = JSON.parse(operation.params);
        if (operation.kind === "refund") await db.transaction((tx) => markRefundFailed(params.refundId, tx));
        await failOperation(operation.id, operation.paymentId, stripeErrorMessage(error));
        // A refused charge usually means the hold is gone. Record the hold's real state.
        if (operation.kind === "capture") await syncHold(operation.paymentId, now).catch(() => undefined);
        log(`unfinished ${operation.kind} on payment ${operation.paymentId} was refused by Stripe`);
      } else {
        log(`could not check unfinished ${operation.kind} on payment ${operation.paymentId}; will retry`, error);
      }
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
// 2. Handle saved Stripe messages that could not be handled when they arrived
// ---------------------------------------------------------------------------

export async function retrySavedStripeEvents(now: Date): Promise<void> {
  const waiting = await db
    .select()
    .from(schema.stripeEvents)
    .where(and(isNull(schema.stripeEvents.processedAt), lte(schema.stripeEvents.receivedAt, new Date(now.getTime() - RECONCILE_AFTER_MS))))
    .orderBy(schema.stripeEvents.receivedAt)
    .limit(50);
  for (const saved of waiting) {
    try {
      await handleStripeEvent(JSON.parse(saved.payload));
      await db.update(schema.stripeEvents).set({ processedAt: new Date() }).where(eq(schema.stripeEvents.id, saved.id));
    } catch (error) {
      log(`could not handle saved Stripe message ${saved.id}; will retry`, error);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Finish the money side of cancelled calls
// ---------------------------------------------------------------------------

export async function settleCancelledCalls(now: Date = new Date()): Promise<void> {
  const open = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(inArray(schema.payments.status, ["awaiting_payment", "held"]), isNotNull(schema.calls.cancelledAt)));
  for (const { payment, call } of open) {
    try {
      const current = await afterCheckingRefusedCharge(payment, now);
      // Stripe refused the late-cancellation charge a short while ago: wait before trying again.
      if (current.status === "held" && call.cancelledLate && (await recentlyRefused(payment.id, "capture", now))) continue;
      await settleCancelledCall(call, current);
      log(`settled cancelled call ${call.id}`);
    } catch (error) {
      log(`could not settle cancelled call ${call.id}; will retry`, error);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Charge finished calls, or queue them for review
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

/** The seconds a call is charged for, by the rule fixed on the call: the host's time (booked) or the time both were in (instant). */
export function countedSeconds(call: Pick<Call, "billing">, totals: { hostSeconds: number; togetherSeconds: number }): number {
  return call.billing === "together" ? totals.togetherSeconds : totals.hostSeconds;
}

async function settleOne(found: Payment, call: Call, now: Date): Promise<void> {
  // If Stripe made a charge we had written off, it is recorded here and there is nothing left to settle.
  const payment = await afterCheckingRefusedCharge(found, now);
  if (payment.status !== "awaiting_payment" && payment.status !== "held") return;

  if (payment.status === "awaiting_payment") {
    // The customer may have paid in the last moments: ask Stripe before closing.
    const synced = await syncHold(payment.id, now);
    if (synced.status !== "awaiting_payment") return;
    await releasePayment({ paymentId: payment.id, note: "The call ended without a payment." });
    log(`closed unpaid payment ${payment.id}`);
    return;
  }

  // A hold that has run out can no longer be charged. Close it, so the payment is never left hanging.
  if (payment.holdExpiresAt && payment.holdExpiresAt <= now) {
    await releasePayment({ paymentId: payment.id, note: "The hold ran out before a charge could be made." });
    log(`released payment ${payment.id}: the hold ran out`);
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
  // Charge only once the room is confirmed closed and late messages have had time to arrive.
  if (!attendance.final || !call.closedAt) {
    if (now >= deadline) {
      await releasePayment({ paymentId: payment.id, note: "The call's record was not final in time, so the hold was released." });
      log(`released payment ${payment.id}: record not final in time`);
    }
    return;
  }

  if (attendance.result.status === "complete" && attendance.result.totals) {
    const totals = attendance.result.totals;
    const amountCents = attendanceChargeCents({
      pricePer15Cents: payment.pricePer15Cents,
      bookedSeconds: attendance.bookedSeconds,
      countedSeconds: countedSeconds(call, totals),
    });
    if (amountCents === 0) {
      await releasePayment({ paymentId: payment.id, note: "Nothing was owed for this call." });
      log(`released payment ${payment.id}: nothing owed`);
    } else {
      // Stripe refused this charge a short while ago (and it is confirmed above that it did not go through): wait.
      if (await recentlyRefused(payment.id, "capture", now)) return;
      await capturePayment({
        paymentId: payment.id,
        amountCents,
        reason: "attendance",
        frozen: totals,
        callEndsAt: call.endsAt,
        // Remember which messages the amount was based on, so later ones can be noticed.
        pricedThroughEventId: attendance.events.reduce((max, e) => Math.max(max, e.id), 0),
        now,
      });
      log(`charged payment ${payment.id}: ${amountCents} cents`);
    }
    return;
  }

  // The record is incomplete or contradicts itself: never charge on a guess.
  await db.transaction(async (tx) => {
    const locked = await lockPayment(tx, payment.id);
    if (locked.status !== "held" || locked.needsReview) return;
    // If a charge is already on its way, leave it alone. Step 5 will flag the changed record.
    const [inFlight] = await tx
      .select({ id: schema.moneyOperations.id })
      .from(schema.moneyOperations)
      .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started")));
    if (inFlight) return;
    await tx
      .update(schema.payments)
      .set({ needsReview: true, reviewReason: attendance.result.reasons.join(" ") || "The call's record is incomplete.", updatedAt: new Date() })
      .where(eq(schema.payments.id, payment.id));
  });
  log(`payment ${payment.id} needs review`);
}

// ---------------------------------------------------------------------------
// 5. Flag calls whose record changed after they were charged
// ---------------------------------------------------------------------------

export async function flagChangedRecords(now: Date): Promise<void> {
  // Only calls with a message newer than the ones the charge was based on can have changed.
  const candidates = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(
      and(
        eq(schema.payments.status, "charged"),
        eq(schema.payments.chargeReason, "attendance"),
        eq(schema.payments.flaggedAfterCharge, false),
        isNotNull(schema.payments.pricedThroughEventId),
        sql`exists (select 1 from ${schema.attendanceEvents} e where e.call_id = ${schema.calls.id} and e.id > ${schema.payments.pricedThroughEventId})`,
      ),
    );

  for (const { payment, call } of candidates) {
    const attendance = await loadAttendance(call, now);
    const totals = attendance.result.totals;
    const changed = attendance.result.status !== "complete" || !totals || countedSeconds(call, totals) !== countedSeconds(call, { hostSeconds: payment.frozenHostSeconds ?? -1, togetherSeconds: payment.frozenTogetherSeconds ?? -1 });
    if (changed) {
      await db
        .update(schema.payments)
        .set({ flaggedAfterCharge: true, reviewReason: "The call's record changed after it was charged. The charge was not changed.", updatedAt: new Date() })
        .where(eq(schema.payments.id, payment.id));
      log(`payment ${payment.id} flagged: record changed after the charge`);
    } else {
      // New messages, same totals: move the marker forward so they are not looked at again.
      await db
        .update(schema.payments)
        .set({ pricedThroughEventId: attendance.events.reduce((max, e) => Math.max(max, e.id), 0) })
        .where(eq(schema.payments.id, payment.id));
    }
  }
}

// ---------------------------------------------------------------------------
// 6. The weekly payday
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
        isNotNull(schema.hostSettings.stripeAccountId),
      ),
    );
  if (due.length === 0) return;

  // A saved message about a bank dispute that is not handled yet may mean one of these
  // payments must not be paid out. Wait until it is handled.
  const [unhandled] = await db
    .select({ id: schema.stripeEvents.id })
    .from(schema.stripeEvents)
    .where(and(isNull(schema.stripeEvents.processedAt), like(schema.stripeEvents.type, "charge.dispute.%")))
    .limit(1);
  if (unhandled) {
    log(`payday is waiting: Stripe message ${unhandled.id} about a dispute has not been handled yet`);
    return;
  }

  // Never trust the saved "ready" flag for a host who is owed money: ask Stripe, at most once an hour.
  const ready = new Map<string, boolean>();
  for (const { host } of due) {
    if (ready.has(host.userId)) continue;
    const stale = !host.payoutsCheckedAt || now.getTime() - host.payoutsCheckedAt.getTime() > HOST_RECHECK_MS;
    ready.set(host.userId, stale ? await refreshPayoutsReady(host.userId).catch(() => false) : host.payoutsReady);
  }

  for (const { payment, call, host } of due) {
    if (!ready.get(host.userId)) continue;
    if (await recentlyRefused(payment.id, "transfer", now)) continue;
    try {
      await sendHostShare({ paymentId: payment.id, hostId: host.userId, destination: host.stripeAccountId!, callId: call.id, now });
      log(`sent host share for payment ${payment.id}`);
    } catch (error) {
      log(`could not send host share for payment ${payment.id}; will retry`, error);
    }
  }
}

/** Everything the helper does for payments in one pass, in a safe order. */
export async function runPaymentJobs(now: Date): Promise<void> {
  await reconcileOperations(now);
  await retrySavedStripeEvents(now);
  await settleCancelledCalls(now);
  await settleFinishedCalls(now);
  await flagChangedRecords(now);
  await runPayday(now);
}
