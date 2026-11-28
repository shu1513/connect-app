/**
 * Finding out what happened to a month's money action whose answer never arrived (the helper's
 * reconcileOperations in payments/jobs.ts hands them here).
 *
 * The rule is the app's own: inside 23 hours the very same request is sent again under the same
 * label, and Stripe returns the first answer or does it now, never twice. After that the label can
 * no longer be trusted, so nothing is sent again and Stripe is asked how things stand.
 *
 * A pay-back is followed up exactly as a call's refund is (payments/jobs.ts, reconcileOperations)
 * and a contribution's refund (contributions/recover.ts), because a pay-back that is called "not
 * made" is sent again as a new try an hour later, and a pay-back is nearly always a part of the
 * month's charge: enough is left of it for that new try to pay the member twice:
 *   - Stripe's answer to a repeat is the FIRST answer, as it was then. What the refund is NOW is
 *     asked by its own number;
 *   - a clear "no" to a repeat proves nothing about the first request. Stripe's complete list of
 *     the charge's refunds settles it: a refund that carries this line and this attempt is booked;
 *   - once nothing can be repeated, "not on Stripe's list" is final only when the search began
 *     24 hours after the try was written down. Until then the try stays open;
 *   - and before anything is repeated for a try after the first, Stripe's list is searched for a
 *     refund of an earlier try (payments/refund-tries.ts, earlierTryAtStripe): that one is booked
 *     instead.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { captureAtStripe } from "@/lib/payments/actions";
import { failOwnedOperation, finishOwnedOperation, SETTLED_AFTER_MS } from "@/lib/payments/operations";
import { earlierTryAtStripe, isTry, refundOnStripesList } from "@/lib/payments/refund-tries";
import { isDefiniteRefusal, lookUp, stripe, stripeErrorMessage } from "@/lib/payments/stripe";
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
  // (Never set for a pay-back: what a "no" to a pay-back's repeat means is found out in its own branch, from Stripe's list.)
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
      let refusal: string | null = null;
      let settled = false;
      // Looked at once more right before a repeat goes out: another helper may have ended this try since it was
      // picked up here (it found the refund, or a clear "no"). Then nothing is sent from this older look.
      const [stillOpen] = await db.select({ status: schema.moneyOperations.status }).from(schema.moneyOperations).where(eq(schema.moneyOperations.id, operation.id));
      if (stillOpen?.status !== "started") return;
      // A try after the first: if Stripe has a refund of an earlier try of this line that is not over, that one is
      // the line's refund. It is booked as this try's outcome, and nothing is repeated.
      refund = await earlierTryAtStripe(params as PayBackParams);
      if (refund) console.error(`[membership] pay-back ${params.refundId}: Stripe already has refund ${refund.id} of an earlier try, which had been recorded as not made. It is booked, and try ${params.attempt} is not repeated.`);
      if (!refund && canRepeat()) {
        try {
          const replayed = await refundAtStripe(params as PayBackParams, operation.label);
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
        // Whether "not found" may be final is decided BEFORE the search begins: only a search that began after the
        // last repeat could no longer be on its way can say that the refund does not exist.
        settled = Date.now() - operation.createdAt.getTime() >= SETTLED_AFTER_MS;
        // Every page, and the line and the attempt together: a month can have many refunds on its one charge.
        // And within a limit of time: a search that is not finished proves nothing, and is made again on the next pass.
        refund = await refundOnStripesList(params.intentId, isTry(params as PayBackParams));
      }
      // Nothing found, and no "no" to a repeat of this look's own: that is only final once no repeat can still be on
      // its way. Another helper may have sent one just before the last moment for repeats; until that one has had
      // its time, the try stays open and is looked at again. (A "no" to this look's own repeat with nothing on the
      // list is final at once, as a call's is: the one who wrote the try down has a last moment for sending it,
      // long past by now. Should another helper's repeat of the same moment still be paid after this "no", the new
      // try finds that refund on Stripe's list an hour from now and books it instead of sending: earlierTryAtStripe.)
      if (!refund && refusal === null && !settled) {
        console.log(`[membership] unfinished pay-back on month ${monthId}: not found at Stripe yet, and a repeat may still be on its way; looked at again`);
        return;
      }
      if (!refund) {
        // Not made: owed again, and the next try is a new one, an hour from now. The line and its action in one step.
        await failOwnedOperation(operation.id, owner, refusal ?? "Stripe shows this pay-back was never made.", (locked, tx) => applyPayBackOutcome(tx, locked, payBack(null, "failed"), now));
      } else {
        // As it stands at Stripe now: paid, still on its way (then asked about by its own number), or failed since.
        const found = refund;
        await finishOwnedOperation(operation.id, owner, found.id, (locked, tx) => applyPayBackOutcome(tx, locked, payBack(found.id, outcomeStatus(found.status)), now));
      }
    }
    console.log(`[membership] checked unfinished ${operation.kind} on month ${monthId}`);
  } catch (error) {
    if (!asked || !isDefiniteRefusal(error)) throw error;
    // Stripe gave a clear "no" to the repeated request, so it definitely did not happen.
    await giveUp(stripeErrorMessage(error));
    // A refused try or taking: record how the payment really stands (a failed try, a hold that is gone).
    if (operation.kind === "hold" || operation.kind === "capture") await syncMonth(monthId, now).catch(() => undefined);
    console.log(`[membership] unfinished ${operation.kind} on month ${monthId} was refused by Stripe`);
  }
}
