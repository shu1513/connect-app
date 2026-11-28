/**
 * Finding out what happened to an action of a contribution's payment whose answer never arrived
 * (the helper's reconcileOperations in payments/jobs.ts hands them here).
 *
 * The app's own rule: inside 23 hours the very same request is sent again under the same label,
 * and Stripe returns the first answer or does it now, never twice. After that the label can no
 * longer be trusted, so nothing is sent again and Stripe is asked how things stand.
 *
 * A refund is followed up exactly as a call's refund is (payments/jobs.ts, reconcileOperations),
 * because a refund that is called "not made" is sent again as a new try an hour later, and on a
 * part refund enough of the charge can be left for that new try to pay the contributor twice:
 *   - Stripe's answer to a repeat is the FIRST answer, as it was then. What the refund is NOW is
 *     asked by its own number;
 *   - a clear "no" to a repeat proves nothing about the first request. Stripe's complete list of
 *     the charge's refunds settles it: a refund that carries this line and this attempt is booked;
 *   - once nothing can be repeated, "not on Stripe's list" is final only when the search began
 *     24 hours after the try was written down. Until then the try stays open;
 *   - and before anything is repeated for a try after the first, Stripe's list is searched for a
 *     refund of an earlier try (refund.ts, earlierTryAtStripe): that one is booked instead;
 *   - a repeat only leaves from a look at the try that is a moment old, so a helper that stood
 *     still sends nothing (payments/refund-tries.ts, repeatFromFreshLook); and a refund that is
 *     alive at Stripe although the books do not have it is said out loud (sayIfRefundNotInBooks).
 *
 * It always finds out what became of the action, also for a payment that was given up meanwhile:
 * a taking that went through is recorded (and owed back if it should not have happened), and a
 * hold that is still there is let go. What it never does: send a taking again once `mayTake` says
 * no, or start anything new for a payment that was given up.
 */
import type { schema } from "@/db";
import { cancelAtStripe, confirmSavedCard, LABEL_SAFE_MS } from "@/lib/membership/charge";
import { captureAtStripe } from "@/lib/payments/actions";
import { failOwnedOperation, finishOwnedOperation, SETTLED_AFTER_MS } from "@/lib/payments/operations";
import { isDefiniteRefusal, lookUp, stripe, stripeErrorMessage } from "@/lib/payments/stripe";
import { eq } from "drizzle-orm";
import { db, schema as tables } from "@/db";
import { takingOnFor } from "@/lib/safety/switches";
import { applyLetGo, applyTaken, freshNow, giveUp, paymentById, syncPayment } from "./charge";
import { paymentOwner } from "./locks";
import { formatMoney } from "@/lib/payments/access";
import { repeatFromFreshLook, sayIfRefundNotInBooks, WHY_NOT_REPEATED } from "@/lib/payments/refund-tries";
import { applyRefundOutcome, earlierTryAtStripe, isTry, outcomeStatus, refundAtStripe, refundOnStripesList, type RefundOutcome, type RefundParams } from "./refund";
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
  // not happen. A "no" to a mere look-up proves nothing: the action stays unanswered. (Never set for a refund:
  // what a "no" to a refund's repeat means is found out in its own branch, from Stripe's list.)
  let asked = false;
  const refunded = (stripeRefundId: string | null, status: RefundOutcome["status"]): RefundOutcome => ({ refundId: params.refundId, attempt: params.attempt, stripeRefundId, status });
  /** Whether new money work may still be done for this payment's host: asked right before a request that could place a hold or take money. */
  const covered = async () => {
    const [owner] = await db.select({ kind: tables.contributions.kind, hostId: tables.contributions.hostId }).from(tables.contributionPayments).innerJoin(tables.contributions, eq(tables.contributions.id, tables.contributionPayments.contributionId)).where(eq(tables.contributionPayments.id, paymentId));
    return Boolean(owner) && (await takingOnFor(owner));
  };

  try {
    if (operation.kind === "hold") {
      // A try is only made again for a payment that is still waiting for one. For a payment given up meanwhile, Stripe is only asked.
      // And only while the founder's switch covers the host: no new hold is placed after a stop. The payment is
      // read last of all: the next thing that happens is the request to Stripe.
      const mayStill = canRepeat() && (await covered());
      const payment = mayStill ? await paymentById(paymentId) : undefined;
      if (payment?.status === "to_pay" && !payment.endedHow && !payment.problem) {
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
      let refusal: string | null = null;
      let settled = false;
      // Looked at once more right before a repeat goes out: another helper may have ended this try since it was
      // picked up here (it found the refund, or a clear "no"). Then nothing is sent from this older look.
      const [stillOpen] = await db.select({ status: tables.moneyOperations.status }).from(tables.moneyOperations).where(eq(tables.moneyOperations.id, operation.id));
      if (stillOpen?.status !== "started") return;
      // A try after the first: if Stripe has a refund of an earlier try of this line that is not over, that one is
      // the line's refund. It is booked as this try's outcome, and nothing is repeated.
      refund = await earlierTryAtStripe(params as RefundParams);
      if (refund) console.error(`[contributions] refund ${params.refundId}: Stripe already has refund ${refund.id} of an earlier try, which had been recorded as not made. It is booked, and try ${params.attempt} is not repeated.`);
      // For a refund this helper holds, alive at Stripe: if the line does not carry it once the try has an outcome
      // (the try was written down as "not made" meanwhile, or the line was booked with another refund), nothing is
      // changed and the founders are told.
      const sayIfNotInBooks = (alive: { id: string; status: string | null }) =>
        sayIfRefundNotInBooks({
          operationId: operation.id,
          refund: alive,
          booked: async () => (await db.select({ stripeRefundId: tables.contributionRefunds.stripeRefundId }).from(tables.contributionRefunds).where(eq(tables.contributionRefunds.id, params.refundId)))[0]?.stripeRefundId ?? null,
          about: `a tip's or a contribution's refund of ${formatMoney(params.amountCents)} to the contributor's card (refund ${params.refundId}, try ${params.attempt}, contribution payment ${paymentId})`,
          next: "if this refund is still waiting to be sent again, its next try (an hour after the last one failed at the earliest, and not while the charge is disputed) finds this refund at Stripe and counts it instead of sending. If a later try has already been sent, the contributor may have been paid twice, and Connect does nothing more about it.",
        });
      if (!refund && canRepeat()) {
        try {
          // Sent only from a look at the try that is a moment old, with a limit of time and no later repeats
          // (payments/refund-tries.ts, repeatFromFreshLook): a helper that stood still sends nothing.
          const repeat = await repeatFromFreshLook(operation.id, canRepeat, (how) => refundAtStripe(params as RefundParams, operation.label, how));
          if (!repeat.sent && repeat.why !== "too_late") {
            console.log(`[contributions] unfinished refund on contribution payment ${paymentId}: not repeated (${WHY_NOT_REPEATED[repeat.why]})`);
            return;
          }
          if (repeat.sent) {
            // Under the same label Stripe gives the FIRST answer back, as it was then. What the refund is now is
            // asked by its own number: one that was paid at first can have failed since. (If that asking fails, the
            // try may not be looked at again, so a refund the books do not have is said at once, from the answer.)
            const answer = repeat.answer;
            refund = await lookUp(() => stripe().refunds.retrieve(answer.id)).catch(async (error) => {
              await sayIfNotInBooks(answer);
              throw error;
            });
          }
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
        // Every page, and the line and the attempt together: a payment can have several refunds on its one charge.
        // And within a limit of time: a search that is not finished proves nothing, and is made again on the next pass.
        refund = await refundOnStripesList(params.intentId, isTry(params as RefundParams));
      }
      // Nothing found, and no "no" to a repeat of this look's own: that is only final once no repeat can still be on
      // its way. Another helper may have sent one just before the last moment for repeats; until that one has had
      // its time, the try stays open and is looked at again. (A "no" to this look's own repeat with nothing on the
      // list is final at once, as a call's is: the one who wrote the try down has a last moment for sending it,
      // long past by now. Should another helper's repeat of the same moment still be paid after this "no", the new
      // try finds that refund on Stripe's list an hour from now and books it instead of sending: earlierTryAtStripe.)
      if (!refund && refusal === null && !settled) {
        console.log(`[contributions] unfinished refund on contribution payment ${paymentId}: not found at Stripe yet, and a repeat may still be on its way; looked at again`);
        return;
      }
      if (!refund) {
        // Not made: owed again, and the next try is a new one, an hour from now. The line and its action in one step.
        await failOwnedOperation(operation.id, owner, refusal ?? "Stripe shows this refund was never made.", (locked, tx) => applyRefundOutcome(tx, locked, refunded(null, "failed"), now));
      } else {
        // As it stands at Stripe now: paid, still on its way (then asked about by its own number), or failed since.
        const found = refund;
        await finishOwnedOperation(operation.id, owner, found.id, (locked, tx) => applyRefundOutcome(tx, locked, refunded(found.id, outcomeStatus(found.status)), now));
        // (If another helper ended this try meanwhile, the write above changed nothing.)
        await sayIfNotInBooks(found);
      }
    }
    console.log(`[contributions] checked unfinished ${operation.kind} on contribution payment ${paymentId}`);
  } catch (error) {
    if (!asked || !isDefiniteRefusal(error)) throw error;
    // Stripe gave a clear "no" to the repeated request, so it definitely did not happen.
    await giveUpOn(stripeErrorMessage(error));
    if (operation.kind === "hold" || operation.kind === "capture") await syncPayment(paymentId, now).catch(() => undefined);
    console.log(`[contributions] unfinished ${operation.kind} on contribution payment ${paymentId} was refused by Stripe`);
  }
}
