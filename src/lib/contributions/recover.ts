/**
 * Finding out what happened to an action of a contribution's payment whose answer never arrived
 * (the helper's reconcileOperations in payments/jobs.ts hands them here).
 *
 * The app's own rule: inside 23 hours the very same request is sent again under the same label,
 * and Stripe returns the first answer or does it now, never twice. After that the label can no
 * longer be trusted, so nothing is sent again and Stripe is asked how things stand.
 *
 * It always finds out what became of the action, also for a payment that was given up meanwhile:
 * a taking that went through is recorded (and owed back if it should not have happened), and a
 * hold that is still there is let go. What it never does: send a taking again once `mayTake` says
 * no, or start anything new for a payment that was given up.
 */
import type { schema } from "@/db";
import { cancelAtStripe, confirmSavedCard, LABEL_SAFE_MS } from "@/lib/membership/charge";
import { captureAtStripe } from "@/lib/payments/actions";
import { failOwnedOperation, finishOwnedOperation } from "@/lib/payments/operations";
import { isDefiniteRefusal, stripe, stripeErrorMessage } from "@/lib/payments/stripe";
import { eq } from "drizzle-orm";
import { db, schema as tables } from "@/db";
import { projectsOnFor } from "@/lib/safety/switches";
import { applyLetGo, applyTaken, freshNow, giveUp, paymentById, syncPayment } from "./charge";
import { paymentOwner } from "./locks";
import { applyRefundOutcome, outcomeStatus, refundAtStripe, type RefundOutcome, type RefundParams } from "./refund";
import { mayTake } from "./rules";

export async function recoverContributionOperation(operation: typeof schema.moneyOperations.$inferSelect, now: Date): Promise<void> {
  if (!operation.contributionPaymentId) return;
  const paymentId = operation.contributionPaymentId;
  const owner = paymentOwner(paymentId);
  const params = JSON.parse(operation.params);
  // Measured on the real clock, right before acting, so a slow pass can never repeat a request too late.
  const canRepeat = () => Date.now() - operation.createdAt.getTime() < LABEL_SAFE_MS;
  const giveUpOn = (why: string) => failOwnedOperation(operation.id, owner, why);
  // Set right before a request that changes something at Stripe. A clear "no" to that request means it did
  // not happen. A "no" to a mere look-up proves nothing: the action stays unanswered.
  let asked = false;
  const refunded = (stripeRefundId: string | null, status: RefundOutcome["status"]): RefundOutcome => ({ refundId: params.refundId, attempt: params.attempt, stripeRefundId, status });
  /** Whether new money work may still be done for this payment's host: asked right before a request that could place a hold or take money. */
  const covered = async () => {
    const [owner] = await db.select({ hostId: tables.contributions.hostId }).from(tables.contributionPayments).innerJoin(tables.contributions, eq(tables.contributions.id, tables.contributionPayments.contributionId)).where(eq(tables.contributionPayments.id, paymentId));
    return Boolean(owner) && (await projectsOnFor(owner.hostId));
  };

  try {
    if (operation.kind === "hold") {
      const payment = await paymentById(paymentId);
      // A try is only made again for a payment that is still waiting for one. For a payment given up meanwhile, Stripe is only asked.
      // And only while the founder's switch covers the host: no new hold is placed after a stop.
      if (canRepeat() && payment?.status === "to_pay" && !payment.endedHow && !payment.problem && (await covered())) {
        asked = true;
        await confirmSavedCard({ intentId: params.intentId, paymentMethodId: params.paymentMethodId }, operation.label);
        await finishOwnedOperation(operation.id, owner, params.intentId, async () => undefined);
      } else {
        const intent = await stripe().paymentIntents.retrieve(params.intentId);
        if (intent.status === "processing") return; // not settled yet: look again next pass
        if (intent.status === "requires_capture" || intent.status === "succeeded") await finishOwnedOperation(operation.id, owner, intent.id, async () => undefined);
        else await giveUpOn("The saved card could not be used.");
      }
      await syncPayment(paymentId, now);
    } else if (operation.kind === "capture") {
      // A taking is only sent again while it may still be made: not after a stop, not while the switch does not
      // cover the host, and not after the last moment. The payment is read, and the clock looked at, last of all:
      // the next thing that happens is the request to Stripe.
      const mayStill = canRepeat() && Number.isInteger(params.amountCents) && (await covered());
      const payment = mayStill ? await paymentById(paymentId) : undefined;
      if (payment && mayTake(payment, freshNow(now))) {
        asked = true;
        const outcome = await captureAtStripe(params.intentId, params.amountCents, operation.label);
        await finishOwnedOperation(operation.id, owner, outcome.stripeId, (locked, tx) => applyTaken(tx, locked, { cents: outcome.result.amountReceived, chargeId: outcome.result.chargeId }, freshNow(now)));
      } else {
        const intent = await stripe().paymentIntents.retrieve(params.intentId);
        if (intent.status === "processing") return;
        if (intent.status === "succeeded") {
          const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
          // It went through. Recorded as it is: taken rightly, or taken although the payment was given up (then owed back in full).
          await finishOwnedOperation(operation.id, owner, intent.id, (locked, tx) => applyTaken(tx, locked, { cents: intent.amount_received, chargeId }, freshNow(now)));
        } else {
          // Not taken, and it will not be asked for again. If the first request were still to land, the letting-go
          // that follows finds the money taken (Stripe either cancels a payment or has taken it, never both) and
          // records it as owed back.
          await giveUpOn("Stripe shows this payment's money was not taken.");
          const after = await syncPayment(paymentId, now); // a hold that is gone is recorded as such
          // A hold that is still there and whose last moment has passed is given up here and now, and let go: it
          // does not wait for the hour the helper leaves between two tries of a taking.
          if (after.status === "held" && !after.endedHow && after.takeBy && freshNow(now) > after.takeBy) await giveUp(paymentId, "not_taken_in_time", freshNow(now));
        }
      }
    } else if (operation.kind === "release") {
      // Letting go is always safe to do again. Already cancelled or taken is an answer too.
      asked = true;
      const outcome = await cancelAtStripe(params.intentId);
      await finishOwnedOperation(operation.id, owner, outcome.stripeId, (locked, tx) => applyLetGo(tx, locked, outcome.result, freshNow(now)));
    } else if (operation.kind === "refund") {
      let refund: { id: string; status: string | null } | undefined;
      if (canRepeat()) {
        asked = true;
        refund = await refundAtStripe(params as RefundParams, operation.label);
      } else {
        // Every page, and the line and the attempt together: a payment can have several refunds on its one charge.
        for await (const candidate of stripe().refunds.list({ payment_intent: params.intentId, limit: 100 })) {
          if (candidate.metadata?.refundId === params.refundId && candidate.metadata?.attempt === String(params.attempt)) {
            refund = candidate;
            break;
          }
        }
      }
      if (!refund) {
        await failOwnedOperation(operation.id, owner, "Stripe shows this refund was never made.", (locked, tx) => applyRefundOutcome(tx, locked, refunded(null, "failed"), now));
      } else {
        const found = refund;
        await finishOwnedOperation(operation.id, owner, found.id, (locked, tx) => applyRefundOutcome(tx, locked, refunded(found.id, outcomeStatus(found.status)), now));
      }
    }
    console.log(`[contributions] checked unfinished ${operation.kind} on contribution payment ${paymentId}`);
  } catch (error) {
    if (!asked || !isDefiniteRefusal(error)) throw error;
    // Stripe gave a clear "no" to the repeated request, so it definitely did not happen.
    const message = stripeErrorMessage(error);
    if (operation.kind === "refund") await failOwnedOperation(operation.id, owner, message, (locked, tx) => applyRefundOutcome(tx, locked, refunded(null, "failed"), now));
    else await giveUpOn(message);
    if (operation.kind === "hold" || operation.kind === "capture") await syncPayment(paymentId, now).catch(() => undefined);
    console.log(`[contributions] unfinished ${operation.kind} on contribution payment ${paymentId} was refused by Stripe`);
  }
}
