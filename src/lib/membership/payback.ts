/**
 * Paying money back to the member's card (plans/20, "owed once, tried as often as needed").
 *
 * A pay-back is two things, kept apart:
 *   - the line that says it is OWED. Written once, under the name of the one event that owes it
 *     (`owePayBack`, in months.ts), in the same step that moves the money to "to be paid back";
 *   - the TRIES to send it. Each is a money action of the month, named
 *     "monthrefund:<line>:<attempt>", and Stripe is told the line and the attempt.
 * An outcome is applied only to the try it belongs to, so a late answer about an older try can
 * neither undo a newer one nor reopen a pay-back that is done.
 *
 * A try whose answer never arrived is followed up as a call's refund and a contribution's refund
 * are (recover.ts; plans/20, "The pay-back's follow-up, hardened"), so that a pay-back is never
 * paid to the member twice.
 */
import { and, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import type { MembershipRefund } from "@/db/schema";
import { REFUND_SEND_TIMEOUT_MS, REFUND_SEND_WITHIN_MS } from "@/lib/payments/actions";
import { MoneyError, NotSentError, OutcomeUnknownError, RETRY_AFTER_REFUSAL_MS, runOwnedOperation, type OwnedPlan, type Tx } from "@/lib/payments/operations";
import { earlierTryAtStripe } from "@/lib/payments/refund-tries";
import { stripe } from "@/lib/payments/stripe";
import { queuePayBackEmail } from "./emails";
import { lockForMonth, monthOwner, type LockedMonth } from "./locks";
import { finishIfSettled, payBackDone } from "./months";
import { isFrozen } from "./rules";

// Owing a pay-back once under a source key (the rulebook's "How the parts connect" hands it over from this file).
export { owePayBack } from "./months";

const lines = schema.membershipRefunds;

/** `sendByMs`: the last moment the one who wrote the try down may first send it to Stripe (see payBackTry). A try written down before 28 November 2026 has none. */
export type PayBackParams = { intentId: string; amountCents: number; monthId: string; refundId: string; attempt: number; sendByMs?: number };
export type PayBackOutcome = { refundId: string; attempt: number; stripeRefundId: string | null; status: "done" | "on_its_way" | "failed" };

/** What Stripe's word for a refund means here. */
export function outcomeStatus(status: string | null): PayBackOutcome["status"] {
  if (status === "succeeded") return "done";
  if (status === "failed" || status === "canceled") return "failed";
  return "on_its_way"; // "pending", or waiting for something at Stripe
}

/**
 * The request of one try. Recovery sends exactly the same one again under the same label. (`how` is only how long
 * the request may take and whether the library may try a broken connection again: nothing of what is asked.)
 */
export function refundAtStripe(params: PayBackParams, label: string, how: { maxNetworkRetries?: number; timeout?: number } = {}): Promise<Stripe.Refund> {
  return stripe().refunds.create(
    { payment_intent: params.intentId, amount: params.amountCents, metadata: { monthId: params.monthId, refundId: params.refundId, attempt: String(params.attempt) } },
    { idempotencyKey: label, ...how },
  );
}

/**
 * Records what became of one try, whoever learned it, with the month locked. Does nothing unless
 * the line's attempt is the outcome's and the line is not done.
 */
export async function applyPayBackOutcome(tx: Tx, locked: LockedMonth, outcome: PayBackOutcome, now: Date): Promise<void> {
  const [line] = await tx.select().from(lines).where(eq(lines.id, outcome.refundId)).for("update");
  if (!line || line.monthId !== locked.month.id || line.attempt !== outcome.attempt || line.status === "done") return;
  if (outcome.status === "done" && outcome.stripeRefundId) {
    if (!(await payBackDone(tx, line, outcome.stripeRefundId, now))) return;
    await queuePayBackEmail(tx, locked.membership, line);
    const [month] = await tx.select().from(schema.membershipMonths).where(eq(schema.membershipMonths.id, line.monthId));
    await finishIfSettled(tx, month, now);
  } else if (outcome.status === "on_its_way" && outcome.stripeRefundId) {
    await tx.update(lines).set({ status: "at_stripe", stripeRefundId: outcome.stripeRefundId }).where(eq(lines.id, line.id));
  } else {
    // Failed or cancelled at Stripe, or refused: owed again, and the next try is a new one.
    // (The hour before that next try is counted from the moment this is written, not from the start of a helper's
    // round that may have begun long before: `now` only counts where it lies ahead, as a check script's does.)
    await tx.update(lines).set({ status: "owed", stripeRefundId: null, attempt: line.attempt + 1, lastFailedAt: new Date(Math.max(now.getTime(), Date.now())) }).where(eq(lines.id, line.id));
  }
}

/**
 * The steps of one try to send a pay-back that is owed, as a money action: written down, asked of Stripe, recorded.
 * (Exported so that a check can stop between the steps, as a helper that dies does.)
 *
 * The one who writes the try down sends it at once, and keeps the same times a call's refund keeps
 * (payments/actions.ts, refundPlan): the request is begun no later than REFUND_SEND_WITHIN_MS after the try was
 * written down, counted on the database's clock from the moment the helper counts from, with the clock read as the
 * very last thing before the request leaves. Each sending is given up after REFUND_SEND_TIMEOUT_MS; the Stripe
 * library sends a request once more by itself when the connection was closed under it, so two are allowed for. All
 * of it together (30 + 10 + 10 seconds) is shorter than the time before the helper first looks at an unanswered
 * try. So when the helper looks, this request has either reached Stripe or will never be sent, and a clear "no" to
 * the helper's own repeat, with nothing on Stripe's complete list of the charge's refunds, means that this try did
 * not happen (recover.ts). A writer that is too late sends nothing and leaves the try to the helper, which sends it
 * under the same label.
 *
 * A try after the first is only sent when Stripe's list shows no refund of an earlier try (earlierTryAtStripe).
 */
export function payBackTry(line: Pick<MembershipRefund, "id" | "monthId" | "attempt">, now: Date): OwnedPlan<LockedMonth, PayBackParams, { status: string | null }> {
  const outcome = (params: PayBackParams, stripeRefundId: string | null, status: PayBackOutcome["status"]): PayBackOutcome => ({ refundId: params.refundId, attempt: params.attempt, stripeRefundId, status });
  return {
    owner: monthOwner(line.monthId),
    kind: "refund",
    labelBase: `monthrefund:${line.id}:${line.attempt}`,
    prepare: async ({ month }, tx) => {
      const [fresh] = await tx.select().from(lines).where(eq(lines.id, line.id)).for("update");
      if (!fresh || fresh.status !== "owed" || fresh.attempt !== line.attempt) throw new MoneyError("This pay-back is not waiting to be sent.");
      // Checked here, under the lock, so two helpers at once cannot send a second try right after the first failed.
      if (fresh.lastFailedAt && fresh.lastFailedAt.getTime() > now.getTime() - RETRY_AFTER_REFUSAL_MS) throw new MoneyError("The last try failed less than an hour ago.");
      // A dispute stops new steps. A try that was written down before it is still followed to its answer.
      if (isFrozen(month)) throw new MoneyError("This month's charge is disputed at the member's bank, so nothing is paid back from it now.");
      if (!month.stripePaymentIntentId) throw new MoneyError("This month has no payment to pay back from.");
      // The database's time for this step: the very moment the action's own line will carry as "written down at".
      const [{ writtenAt }] = await tx.select({ writtenAt: sql<string>`(extract(epoch from now()) * 1000)::bigint` }).from(schema.membershipMonths).where(eq(schema.membershipMonths.id, month.id));
      return { intentId: month.stripePaymentIntentId, amountCents: fresh.amountCents, monthId: month.id, refundId: fresh.id, attempt: fresh.attempt, sendByMs: Number(writtenAt) + REFUND_SEND_WITHIN_MS };
    },
    execute: async (params, label) => {
      const earlier = await earlierTryAtStripe(params);
      if (earlier) {
        console.error(`[membership] pay-back ${params.refundId}: try ${params.attempt} was not sent, because Stripe already has refund ${earlier.id} of an earlier try, which had been recorded as not made. That one is booked instead.`);
        return { stripeId: earlier.id, result: { status: earlier.status } };
      }
      if (params.sendByMs !== undefined && Date.now() > params.sendByMs) throw new NotSentError("The pay-back was not sent to Stripe in time, so this one did not send it.");
      // With a limit of time, and no later repeats: it never goes out again after the helper has begun to look.
      const refund = await refundAtStripe(params, label, { maxNetworkRetries: 0, timeout: REFUND_SEND_TIMEOUT_MS });
      return { stripeId: refund.id, result: { status: refund.status } };
    },
    apply: (locked, params, result, tx) => applyPayBackOutcome(tx, locked, outcome(params, result.stripeId, outcomeStatus(result.result.status)), now),
    // (Stripe's clear "no" to the first request, or "not sent at all" while the helper cannot have sent it either.)
    onRefused: (locked, params, _message, tx) => applyPayBackOutcome(tx, locked, outcome(params, null, "failed"), now),
  };
}

/** One try to send a pay-back that is owed. Does nothing unless the line is owed and nothing is in flight on its month. */
export async function sendPayBack(refundId: string, now: Date = new Date()): Promise<void> {
  const [line] = await db.select().from(lines).where(eq(lines.id, refundId));
  if (!line || line.status !== "owed") return;
  try {
    await runOwnedOperation(payBackTry(line, now));
  } catch (error) {
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[membership] pay-back ${refundId}: ${error.message}`);
    else throw error;
  }
}

/** A pay-back Stripe accepted but had not finished: asked about by its own id. */
async function askAboutPayBack(line: MembershipRefund, now: Date): Promise<void> {
  if (!line.stripeRefundId) return;
  const refund = await stripe().refunds.retrieve(line.stripeRefundId);
  // For the try the line was on when it was read here: if the line has moved on since, this answer changes nothing.
  // (Not the try the refund itself names: a refund of an earlier try that was found and booked later is asked
  // about here too, see earlierTryAtStripe.)
  await db.transaction(async (tx) => {
    const locked = await lockForMonth(tx, line.monthId);
    await applyPayBackOutcome(tx, locked, { refundId: line.id, attempt: line.attempt, stripeRefundId: refund.id, status: outcomeStatus(refund.status) }, now);
  });
}

/**
 * The helper's part: ask about pay-backs that are on their way, and start a try for every line
 * that is owed: at once the first time, and an hour after a failure. Never while the month's
 * charge is disputed.
 */
export async function runPayBacks(now: Date): Promise<void> {
  // In no fixed order, so that many pay-backs waiting at Stripe can never keep a later one from being asked about.
  const onTheirWay = await db.select().from(lines).where(eq(lines.status, "at_stripe")).orderBy(sql`random()`).limit(50);
  for (const line of onTheirWay) {
    await askAboutPayBack(line, now).catch((error) => console.error(`[membership] could not ask about pay-back ${line.id}; will retry`, error));
  }
  const owed = await db
    .select({ id: lines.id })
    .from(lines)
    .innerJoin(schema.membershipMonths, eq(schema.membershipMonths.id, lines.monthId))
    .where(
      and(
        eq(lines.status, "owed"),
        or(isNull(lines.lastFailedAt), lte(lines.lastFailedAt, new Date(now.getTime() - RETRY_AFTER_REFUSAL_MS))),
        notInArray(schema.membershipMonths.dispute, ["open", "lost"]),
        inArray(schema.membershipMonths.status, ["running", "closed"]),
        // A month with an action under way cannot start a pay-back now (sendPayBack is refused under the lock), so
        // its lines never fill the batch and keep a pay-back of another month waiting. A try can stay unanswered
        // for up to a day (recover.ts).
        sql`not exists (select 1 from ${schema.moneyOperations} where ${schema.moneyOperations.monthId} = ${schema.membershipMonths.id} and ${schema.moneyOperations.status} = 'started')`,
      ),
    )
    .orderBy(lines.createdAt)
    .limit(50);
  for (const line of owed) {
    await sendPayBack(line.id, now).catch((error) => console.error(`[membership] could not send pay-back ${line.id}; will retry`, error));
  }
}
