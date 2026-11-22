/**
 * The work the always-on helper does for payments, every few seconds:
 *   - check with Stripe on any action whose outcome is not known,
 *   - handle saved Stripe messages that could not be handled when they arrived,
 *   - finish the money side of cancelled calls,
 *   - close what a finished call leaves behind (an unpaid payment, nothing owed, a record that needs review),
 *     and take the money for its ordinary charges when it is time: about a day after the call (take.ts),
 *   - release holds nobody decided on in time,
 *   - flag calls whose record changed after they were charged.
 *
 * The helper never starts paying a host: that only happens when the host
 * presses "Collect earnings" (collect.ts). What it does do, in the first job,
 * is finish every transfer a collection wrote down that is not confirmed yet.
 *
 * Each job is safe to run again and again, and safe to run on two helpers at once.
 */
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import { settleCancelledMemberCall, settleMemberOne } from "@/lib/membership/calls";
import {
  applyCaptured,
  applyRefundDone,
  applyReleased,
  applyTransferSent,
  captureAtStripe,
  markRefundFailed,
  NoLongerUnpaidError,
  releasePayment,
  transferAtStripe,
  transferGroup,
} from "./actions";
import { settleCancelledCall } from "./cancel";
import { settleEmptyShare } from "./collect";
import { failOperation, failOwnedOperation, finishOperation, lockPayment, MoneyError, OutcomeUnknownError, RECONCILE_AFTER_MS, refusedRecently } from "./operations";
import { attendanceChargeCents, countedSeconds } from "./pricing";
import { confirmWithSavedCard, syncHold } from "./hold";
import { decisionDeadline } from "./rules";
import { settleOrdinaryCharges } from "./take";
import { isDefiniteRefusal, stripe, stripeErrorMessage } from "./stripe";
import { handleStripeEvent } from "./stripe-events";

/**
 * Stripe remembers an action's label for at least 24 hours. Inside this
 * window, sending the same request again is safe: Stripe returns the original
 * result, or does it now if it never arrived.
 */
const LABEL_SAFE_MS = 23 * 3_600_000;
/** How long one search through a list at Stripe may take before it is given up as unfinished. */
const SEARCH_WITHIN_MS = 20_000;
/** From when "Stripe's list does not show it" is final for a request that can no longer be repeated: an hour after the last repeat could have been sent. */
const SETTLED_AFTER_MS = 24 * 3_600_000;
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

/**
 * Asking Stripe what it has is not the action itself. If the asking fails, even with a clear "no"
 * (no permission, say), that proves nothing about the action: it stays unanswered and is looked
 * at again, instead of being recorded as refused.
 */
async function lookUp<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new Error(`Could not look this up at Stripe: ${stripeErrorMessage(error)}`);
  }
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

/** For check scripts: only these unfinished actions and these pending refunds, so a check never acts on another run's money. */
export type OnlyThese = { operationIds: string[]; refundIds?: string[] };

export async function reconcileOperations(now: Date, only?: OnlyThese): Promise<void> {
  const stuck = await db
    .select()
    .from(schema.moneyOperations)
    .where(
      and(
        eq(schema.moneyOperations.status, "started"),
        lte(schema.moneyOperations.createdAt, new Date(now.getTime() - RECONCILE_AFTER_MS)),
        only ? inArray(schema.moneyOperations.id, only.operationIds) : undefined,
      ),
    );

  for (const operation of stuck) {
    // By owner. An action owned by a membership's month is checked by the membership code, with the month's own
    // locks; one owned by a contribution's payment by the contribution code; everything else is a payment's.
    if (operation.monthId) {
      try {
        const { recoverMonthOperation } = await import("@/lib/membership/recover");
        await recoverMonthOperation(operation, now);
      } catch (error) {
        log(`could not check unfinished ${operation.kind} on month ${operation.monthId}; will retry`, error);
      }
      continue;
    }
    if (operation.contributionPaymentId) {
      try {
        const { recoverContributionOperation } = await import("@/lib/contributions/recover");
        await recoverContributionOperation(operation, now);
      } catch (error) {
        log(`could not check unfinished ${operation.kind} on contribution payment ${operation.contributionPaymentId}; will retry`, error);
      }
      continue;
    }
    if (!operation.paymentId) continue;
    const paymentId = operation.paymentId;
    try {
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
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
            applyReleased(p, params.note ?? "The hold was released.", tx, params.lowered),
          );
        } else {
          await giveUp("This payment was charged, so the hold could not be released.");
        }
      } else if (operation.kind === "refund") {
        let refund: { id: string; status: string | null; failure_reason?: string | null } | undefined;
        let refusal: string | null = null;
        let settled = false;
        // Looked at once more right before a repeat goes out: another helper may have ended this action since it
        // was picked up here (it found the refund, or a clear "no"). Then nothing is sent from this older look.
        const [stillOpen] = await db.select({ status: schema.moneyOperations.status }).from(schema.moneyOperations).where(eq(schema.moneyOperations.id, operation.id));
        if (stillOpen?.status !== "started") continue;
        if (canRepeat()) {
          try {
            const replayed = await stripe().refunds.create(
              { payment_intent: params.intentId ?? payment.stripePaymentIntentId!, amount: params.amountCents, metadata: { paymentId: payment.id, refundId: params.refundId } },
              { idempotencyKey: operation.label },
            );
            // Under the same label Stripe gives the FIRST answer back, as it was then. What the refund is now is
            // asked by its own number: one that was paid at first can have failed since.
            refund = await lookUp(() => stripe().refunds.retrieve(replayed.id));
          } catch (error) {
            // A clear "no" to the repeat proves nothing about the first request (it may have gone through before,
            // say, a permission was taken away): Stripe's own list of this charge's refunds settles it, below.
            if (!isDefiniteRefusal(error)) throw error;
            refusal = stripeErrorMessage(error);
          }
        }
        if (!refund) {
          // Every page: a refund that really happened is never called failed because newer ones stand before it.
          // And within a limit of time: a search that is not finished by then proves nothing, and is made again on the
          // next pass, so one long list never holds every other action up.
          // Whether "not found" may be final is decided BEFORE the search begins: only a search that began after the
          // last repeat could no longer be on its way can say that the refund does not exist.
          settled = Date.now() - operation.createdAt.getTime() >= SETTLED_AFTER_MS;
          const until = Date.now() + SEARCH_WITHIN_MS;
          await lookUp(async () => {
            // (Each page has its own limit of time too: a page that does not come is not waited for.)
            for await (const one of stripe().refunds.list({ payment_intent: payment.stripePaymentIntentId!, limit: 100 }, { timeout: SEARCH_WITHIN_MS })) {
              if (one.metadata?.refundId === params.refundId) {
                refund = one;
                break;
              }
              if (Date.now() > until) throw new Error("the search through this charge's refunds took too long");
            }
            // (Also when the last page came late and held nothing: a search that ran past its time proves nothing.)
            if (!refund && Date.now() > until) throw new Error("the search through this charge's refunds took too long");
          });
        }
        // Nothing found, and no "no" to a repeat of this look's own: that is only final once no repeat can still be
        // on its way. Another helper may have sent one just before the last moment for repeats; until that one has
        // had its time, the action stays open and is looked at again.
        if (!refund && refusal === null && !settled) {
          log(`unfinished refund on payment ${operation.paymentId}: not found at Stripe yet, and a repeat may still be on its way; looked at again`);
          continue;
        }
        if (!refund || refund.status === "failed" || refund.status === "canceled") {
          // The refund's line and its action end in one step, with the payment held: never one without the other.
          const why = refund ? (refund.failure_reason ?? `Stripe says: ${refund.status}`) : (refusal ?? "Stripe shows this refund did not happen.");
          await failOwnedOperation(operation.id, { column: "paymentId", id: payment.id, lock: (tx) => lockPayment(tx, payment.id) }, why, (_payment, tx) => markRefundFailed(params.refundId, tx, why));
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
        // A share a host's collection wrote down. Whether Stripe's answer was lost or the request
        // never left, the same request under the same label finishes it without the host pressing again
        // (unless it is too old to repeat: see below).
        if (params.amountCents < 1) {
          // Nothing goes to Stripe for this one; it follows the rest of its collection.
          if (!(await settleEmptyShare({ id: operation.id, paymentId }, params))) continue; // the rest is not known yet: look again next pass
        } else {
          let transferId: string | undefined;
          if (canRepeat()) {
            transferId = (await transferAtStripe(payment, params, operation.label)) ?? undefined;
          } else {
            // Every page: a membership's month can have many transfers in its group.
            await lookUp(async () => {
              for await (const transfer of stripe().transfers.list({ transfer_group: transferGroup(params), limit: 100 })) {
                if (transfer.metadata?.paymentId === payment.id) {
                  transferId = transfer.id;
                  break;
                }
              }
            });
          }
          if (transferId === undefined) {
            // The share was never sent. It is simply ready again for a later collection.
            await giveUp("Stripe shows this transfer did not happen.");
          } else {
            const found = transferId;
            await finishOperation(operation.id, payment.id, found, (p, tx) => applyTransferSent(p, params, found, tx));
          }
        }
      } else if (operation.kind === "take_back") {
        // A share being taken back from a host after a lost bank dispute. Found out by its own code, which also puts
        // its row back when it did not happen.
        const { recoverTakeback } = await import("@/lib/disputes/takeback");
        await recoverTakeback(operation, params, canRepeat());
      }
      log(`checked unfinished ${operation.kind} on payment ${operation.paymentId}`);
    } catch (error) {
      if (isDefiniteRefusal(error)) {
        // Stripe gave a clear "no" to the repeated request, so it definitely did not happen.
        const params = JSON.parse(operation.params);
        if (operation.kind === "take_back") {
          // The action and its take-back's row are settled in one step, so the row never stays "being taken".
          const { refuseTakeback } = await import("@/lib/disputes/takeback");
          await refuseTakeback(operation, params, stripeErrorMessage(error));
        } else if (operation.kind === "refund") {
          // (The repeat's own "no" is settled above by Stripe's list; this is any other clear "no".) The refund's
          // line and its action end in one step.
          const why = stripeErrorMessage(error);
          await failOwnedOperation(operation.id, { column: "paymentId", id: paymentId, lock: (tx) => lockPayment(tx, paymentId) }, why, (_payment, tx) => markRefundFailed(params.refundId, tx, why));
        } else await failOperation(operation.id, paymentId, stripeErrorMessage(error));
        // A refused charge usually means the hold is gone. Record the hold's real state.
        if (operation.kind === "capture") await syncHold(paymentId, now).catch(() => undefined);
        log(`unfinished ${operation.kind} on payment ${paymentId} was refused by Stripe`);
      } else {
        log(`could not check unfinished ${operation.kind} on payment ${operation.paymentId}; will retry`, error);
      }
    }
  }

  // Refunds Stripe accepted but had not finished.
  const pendingRefunds = await db
    .select()
    .from(schema.refunds)
    .where(and(eq(schema.refunds.status, "in_progress"), isNotNull(schema.refunds.stripeRefundId), only ? inArray(schema.refunds.id, only.refundIds ?? []) : undefined));
  for (const refund of pendingRefunds) {
    try {
      const latest = await stripe().refunds.retrieve(refund.stripeRefundId!);
      if (latest.status === "succeeded") {
        await db.transaction(async (tx) => {
          const payment = await lockPayment(tx, refund.paymentId);
          await applyRefundDone(payment, refund.id, latest.id, tx);
        });
      } else if (latest.status === "failed" || latest.status === "canceled") {
        // With the payment held, by what the refund's line says at that moment (it may have been confirmed
        // meanwhile by another look that read "paid" a moment earlier: then it is undone, not left as paid).
        const { refundFailedAtStripe } = await import("@/lib/disputes/takeback");
        await refundFailedAtStripe(refund.id, latest.failure_reason ?? `Stripe says: ${latest.status}`, now);
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
      if (payment.kind === "member_call") {
        // Money set aside in a membership: nothing to ask Stripe. It was settled when the call was cancelled,
        // unless its month was frozen by a dispute then; a frozen month is passed over here too.
        await settleCancelledMemberCall(call.id, now);
        continue;
      }
      const current = await afterCheckingRefusedCharge(payment, now);
      // Stripe refused the late-cancellation charge a short while ago: wait before trying again.
      if (current.status === "held" && call.cancelledLate && (await refusedRecently(payment.id, "capture", now))) continue;
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
    .leftJoin(schema.callExtensions, eq(schema.callExtensions.id, schema.payments.extensionId))
    .where(
      and(
        inArray(schema.payments.status, ["awaiting_payment", "held"]),
        lte(schema.calls.endsAt, now),
        isNull(schema.calls.cancelledAt),
        // The call's own payment, and the payment of each request for more time the host accepted.
        // A request that was not accepted is never settled here: its hold is only ever let go
        // (see closeFinishedExtensions in src/lib/extend/extend.ts).
        or(isNull(schema.payments.extensionId), eq(schema.callExtensions.status, "accepted")),
      ),
    );

  // Calls with an ordinary charge on hold. Their money is taken per call, at the moment the timing rule gives.
  const ordinary = new Set<string>();
  for (const { payment, call } of due) {
    try {
      if ((await settleOne(payment, call, now)) === "ordinary") ordinary.add(call.id);
    } catch (error) {
      log(`could not settle payment ${payment.id}; will retry`, error);
    }
  }
  for (const callId of ordinary) {
    try {
      await settleOrdinaryCharges(callId, now);
    } catch (error) {
      log(`could not take the money for call ${callId}; will retry`, error);
    }
  }
}

/** Gives back "ordinary" for a payment on hold whose record is final and gives an amount: its money is taken by the timing rule, not here. */
async function settleOne(found: Payment, call: Call, now: Date): Promise<"ordinary" | void> {
  // Money set aside in a membership has no hold at Stripe: its own rules, with the month's locks.
  if (found.kind === "member_call") return settleMemberOne(found, call, now);
  // If Stripe made a charge we had written off, it is recorded here and there is nothing left to settle.
  const payment = await afterCheckingRefusedCharge(found, now);
  if (payment.status !== "awaiting_payment" && payment.status !== "held") return;

  if (payment.status === "awaiting_payment") {
    // The customer may have paid in the last moments: ask Stripe before closing. (A card still being confirmed at
    // the bank is not "unpaid": that throws here, and this payment is looked at again on the next round.)
    const synced = await syncHold(payment.id, now, { closing: true });
    if (synced.status !== "awaiting_payment") return;
    // "Unpaid" was Stripe's answer a moment ago. The payment is closed only if, under its lock, it is still
    // waiting on the card step that was asked about: a hold recorded since then is not let go here (on a call
    // stopped for safety it belongs to the review), and is looked at again on the next round.
    try {
      await releasePayment({ paymentId: payment.id, note: "The call ended without a payment.", unpaidWith: synced.stripePaymentIntentId ?? null });
    } catch (error) {
      if (error instanceof NoLongerUnpaidError) return;
      throw error;
    }
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

  // Each payment is charged for the time that counted inside the stretch of the call it pays for.
  const attendance = await loadAttendance(call, now, { from: payment.coversFrom, until: payment.coversUntil });
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
      // Nothing to wait for: nobody is asked about a charge that is nothing.
      await releasePayment({ paymentId: payment.id, note: "Nothing was owed for this call." });
      log(`released payment ${payment.id}: nothing owed`);
      return;
    }
    return "ordinary";
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
    // One record that cannot be checked must not stop the others.
    try {
      const attendance = await loadAttendance(call, now, { from: payment.coversFrom, until: payment.coversUntil });
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
    } catch (error) {
      log(`could not check the record of charged payment ${payment.id}; will retry`, error);
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
}
