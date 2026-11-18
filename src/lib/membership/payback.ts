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
 */
import { and, eq, inArray, isNull, lte, notInArray, or } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import type { MembershipRefund } from "@/db/schema";
import { MoneyError, OutcomeUnknownError, RETRY_AFTER_REFUSAL_MS, runOwnedOperation, type Tx } from "@/lib/payments/operations";
import { stripe } from "@/lib/payments/stripe";
import { queuePayBackEmail } from "./emails";
import { lockForMonth, monthOwner, type LockedMonth } from "./locks";
import { finishIfSettled, payBackDone } from "./months";
import { isFrozen } from "./rules";

// Owing a pay-back once under a source key (the rulebook's "How the parts connect" hands it over from this file).
export { owePayBack } from "./months";

const lines = schema.membershipRefunds;

export type PayBackParams = { intentId: string; amountCents: number; monthId: string; refundId: string; attempt: number };
export type PayBackOutcome = { refundId: string; attempt: number; stripeRefundId: string | null; status: "done" | "on_its_way" | "failed" };

/** What Stripe's word for a refund means here. */
export function outcomeStatus(status: string | null): PayBackOutcome["status"] {
  if (status === "succeeded") return "done";
  if (status === "failed" || status === "canceled") return "failed";
  return "on_its_way"; // "pending", or waiting for something at Stripe
}

/** The request of one try. Recovery sends exactly the same one again under the same label. */
export function refundAtStripe(params: PayBackParams, label: string): Promise<Stripe.Refund> {
  return stripe().refunds.create(
    { payment_intent: params.intentId, amount: params.amountCents, metadata: { monthId: params.monthId, refundId: params.refundId, attempt: String(params.attempt) } },
    { idempotencyKey: label },
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
    await tx.update(lines).set({ status: "owed", stripeRefundId: null, attempt: line.attempt + 1, lastFailedAt: now }).where(eq(lines.id, line.id));
  }
}

/** One try to send a pay-back that is owed. Does nothing unless the line is owed and nothing is in flight on its month. */
export async function sendPayBack(refundId: string, now: Date = new Date()): Promise<void> {
  const [line] = await db.select().from(lines).where(eq(lines.id, refundId));
  if (!line || line.status !== "owed") return;
  const outcome = (params: PayBackParams, stripeRefundId: string | null, status: PayBackOutcome["status"]): PayBackOutcome => ({ refundId: params.refundId, attempt: params.attempt, stripeRefundId, status });
  try {
    await runOwnedOperation<LockedMonth, PayBackParams, { status: string | null }>({
      owner: monthOwner(line.monthId),
      kind: "refund",
      labelBase: `monthrefund:${line.id}:${line.attempt}`,
      prepare: async ({ month }, tx) => {
        const [fresh] = await tx.select().from(lines).where(eq(lines.id, line.id)).for("update");
        if (!fresh || fresh.status !== "owed" || fresh.attempt !== line.attempt) throw new MoneyError("This pay-back is not waiting to be sent.");
        // A dispute stops new steps. A try that was written down before it is still followed to its answer.
        if (isFrozen(month)) throw new MoneyError("This month's charge is disputed at the member's bank, so nothing is paid back from it now.");
        if (!month.stripePaymentIntentId) throw new MoneyError("This month has no payment to pay back from.");
        return { intentId: month.stripePaymentIntentId, amountCents: fresh.amountCents, monthId: month.id, refundId: fresh.id, attempt: fresh.attempt };
      },
      execute: async (params, label) => {
        const refund = await refundAtStripe(params, label);
        return { stripeId: refund.id, result: { status: refund.status } };
      },
      apply: (locked, params, result, tx) => applyPayBackOutcome(tx, locked, outcome(params, result.stripeId, outcomeStatus(result.result.status)), now),
      onRefused: (locked, params, _message, tx) => applyPayBackOutcome(tx, locked, outcome(params, null, "failed"), now),
    });
  } catch (error) {
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[membership] pay-back ${refundId}: ${error.message}`);
    else throw error;
  }
}

/** A pay-back Stripe accepted but had not finished: asked about by its own id. */
async function askAboutPayBack(line: MembershipRefund, now: Date): Promise<void> {
  if (!line.stripeRefundId) return;
  const refund = await stripe().refunds.retrieve(line.stripeRefundId);
  const attempt = Number(refund.metadata?.attempt ?? line.attempt);
  await db.transaction(async (tx) => {
    const locked = await lockForMonth(tx, line.monthId);
    await applyPayBackOutcome(tx, locked, { refundId: line.id, attempt, stripeRefundId: refund.id, status: outcomeStatus(refund.status) }, now);
  });
}

/**
 * The helper's part: ask about pay-backs that are on their way, and start a try for every line
 * that is owed: at once the first time, and an hour after a failure. Never while the month's
 * charge is disputed.
 */
export async function runPayBacks(now: Date): Promise<void> {
  const onTheirWay = await db.select().from(lines).where(eq(lines.status, "at_stripe")).limit(50);
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
      ),
    )
    .orderBy(lines.createdAt)
    .limit(50);
  for (const line of owed) {
    await sendPayBack(line.id, now).catch((error) => console.error(`[membership] could not send pay-back ${line.id}; will retry`, error));
  }
}
