/**
 * Finding out what happened to a month's money action whose answer never arrived (the helper's
 * reconcileOperations in payments/jobs.ts hands them here).
 *
 * The rule is the app's own: inside 23 hours the very same request is sent again under the same
 * label, and Stripe returns the first answer or does it now, never twice. After that the label can
 * no longer be trusted, so nothing is sent again and Stripe is asked how things stand.
 */
import type { schema } from "@/db";
import { captureAtStripe } from "@/lib/payments/actions";
import { failOwnedOperation, finishOwnedOperation } from "@/lib/payments/operations";
import { isDefiniteRefusal, stripe, stripeErrorMessage } from "@/lib/payments/stripe";
import { applyLetGo, applyTaken, cancelAtStripe, confirmSavedCard, LABEL_SAFE_MS, syncMonth } from "./charge";
import { monthOwner } from "./locks";
import { applyPayBackOutcome, outcomeStatus, refundAtStripe, type PayBackOutcome, type PayBackParams } from "./payback";

export async function recoverMonthOperation(operation: typeof schema.moneyOperations.$inferSelect, now: Date): Promise<void> {
  if (!operation.monthId) return;
  const monthId = operation.monthId;
  const owner = monthOwner(monthId);
  const params = JSON.parse(operation.params);
  // Measured on the real clock, right before acting, so a slow pass can never repeat a request too late.
  const canRepeat = () => Date.now() - operation.createdAt.getTime() < LABEL_SAFE_MS;
  const giveUp = (why: string) => failOwnedOperation(operation.id, owner, why);
  // Set right before a request that changes something at Stripe. A clear "no" to that request means it
  // did not happen. A "no" to a mere look-up (no permission, say) proves nothing: the action stays unanswered.
  let asked = false;
  const payBack = (stripeRefundId: string | null, status: PayBackOutcome["status"]): PayBackOutcome => ({ refundId: params.refundId, attempt: params.attempt, stripeRefundId, status });

  try {
    if (operation.kind === "hold") {
      // A try with the saved card. What it achieved is always read from Stripe by syncMonth.
      if (canRepeat()) {
        asked = true;
        await confirmSavedCard({ intentId: params.intentId, paymentMethodId: params.paymentMethodId }, operation.label);
        await finishOwnedOperation(operation.id, owner, params.intentId, async () => undefined);
      } else {
        const intent = await stripe().paymentIntents.retrieve(params.intentId);
        if (intent.status === "processing") return; // not settled yet: look again next pass
        if (intent.status === "requires_capture" || intent.status === "succeeded") await finishOwnedOperation(operation.id, owner, intent.id, async () => undefined);
        else await giveUp("The saved card could not be used.");
      }
      await syncMonth(monthId, now);
    } else if (operation.kind === "capture") {
      if (canRepeat() && Number.isInteger(params.amountCents)) {
        asked = true;
        const outcome = await captureAtStripe(params.intentId, params.amountCents, operation.label);
        await finishOwnedOperation(operation.id, owner, outcome.stripeId, ({ month }, tx) => applyTaken(tx, month, { cents: outcome.result.amountReceived, chargeId: outcome.result.chargeId }, now));
      } else {
        const intent = await stripe().paymentIntents.retrieve(params.intentId);
        if (intent.status === "processing") return;
        if (intent.status === "succeeded") {
          const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
          await finishOwnedOperation(operation.id, owner, intent.id, ({ month }, tx) => applyTaken(tx, month, { cents: intent.amount_received, chargeId }, now));
        } else {
          await giveUp("Stripe shows this month's money was not taken.");
          await syncMonth(monthId, now); // a hold that is gone is recorded as such
        }
      }
    } else if (operation.kind === "release") {
      // Letting go is always safe to do again. Already cancelled (by another helper a moment ago, say) or taken is an answer too.
      asked = true;
      const outcome = await cancelAtStripe(params.intentId);
      await finishOwnedOperation(operation.id, owner, outcome.stripeId, ({ month }, tx) => applyLetGo(tx, month, outcome.result, now));
    } else if (operation.kind === "refund") {
      let refund: { id: string; status: string | null } | undefined;
      if (canRepeat()) {
        asked = true;
        refund = await refundAtStripe(params as PayBackParams, operation.label);
      } else {
        // Every page, and the line and the attempt together: a month can have many refunds on its one charge.
        for await (const candidate of stripe().refunds.list({ payment_intent: params.intentId, limit: 100 })) {
          if (candidate.metadata?.refundId === params.refundId && candidate.metadata?.attempt === String(params.attempt)) {
            refund = candidate;
            break;
          }
        }
      }
      if (!refund) {
        await failOwnedOperation(operation.id, owner, "Stripe shows this pay-back was never made.", (locked, tx) => applyPayBackOutcome(tx, locked, payBack(null, "failed"), now));
      } else {
        const found = refund;
        await finishOwnedOperation(operation.id, owner, found.id, (locked, tx) => applyPayBackOutcome(tx, locked, payBack(found.id, outcomeStatus(found.status)), now));
      }
    }
    console.log(`[membership] checked unfinished ${operation.kind} on month ${monthId}`);
  } catch (error) {
    if (!asked || !isDefiniteRefusal(error)) throw error;
    // Stripe gave a clear "no" to the repeated request, so it definitely did not happen.
    const message = stripeErrorMessage(error);
    if (operation.kind === "refund") await failOwnedOperation(operation.id, owner, message, (locked, tx) => applyPayBackOutcome(tx, locked, payBack(null, "failed"), now));
    else await giveUp(message);
    // A refused try or taking: record how the payment really stands (a failed try, a hold that is gone).
    if (operation.kind === "hold" || operation.kind === "capture") await syncMonth(monthId, now).catch(() => undefined);
    console.log(`[membership] unfinished ${operation.kind} on month ${monthId} was refused by Stripe`);
  }
}
