/**
 * How "never twice" is guaranteed.
 *
 * Every action that moves money goes through runMoneyOperation():
 *   1. Lock the payment, check the action is allowed, and write down what we
 *      are about to do, under one fixed label. Only one action can be in
 *      flight on a payment at a time.
 *   2. Ask Stripe, giving it the same label. Stripe refuses to repeat an
 *      action it has already done under that label.
 *   3. Lock the payment again and record what happened.
 *
 * If step 2 ends without a clear answer (a timeout, a crash), the written-down
 * action stays "started". Nothing else can run on that payment until
 * reconcile.ts has asked Stripe what actually happened.
 */
import { and, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import { isDefiniteRefusal, stripeErrorMessage } from "./stripe";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OperationKind = "capture" | "release" | "refund" | "transfer" | "hold";

/** An action was refused for a reason a person can read. Nothing was changed. */
export class MoneyError extends Error {}

/** The action may or may not have happened. It will be checked with Stripe before anything else runs. */
export class OutcomeUnknownError extends Error {}

export async function lockPayment(tx: Tx, paymentId: string): Promise<Payment> {
  const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).for("update");
  if (!payment) throw new MoneyError("Payment not found.");
  return payment;
}

export type OperationPlan<P, R> = {
  paymentId: string;
  kind: OperationKind;
  /**
   * One fixed name for this exact action, for example "capture:<payment id>".
   * The label sent to Stripe is this name plus an attempt number, which only
   * goes up after Stripe has definitely refused the previous attempt.
   */
  labelBase: string;
  /**
   * Runs with the payment locked. Checks the action is allowed (throw MoneyError
   * if not) and returns the exact parameters to use. May write preparatory rows.
   */
  prepare: (payment: Payment, tx: Tx) => Promise<P>;
  /** Asks Stripe. Must pass `label` to Stripe as the idempotency key. Returns Stripe's ID and result. */
  execute: (params: P, label: string) => Promise<{ stripeId: string; result: R }>;
  /** Runs with the payment locked again. Records the outcome. */
  apply: (payment: Payment, params: P, outcome: { stripeId: string; result: R }, tx: Tx) => Promise<void>;
  /** Optional: runs with the payment locked when Stripe definitely refused. */
  onRefused?: (payment: Payment, params: P, message: string, tx: Tx) => Promise<void>;
};

export async function runMoneyOperation<P, R>(plan: OperationPlan<P, R>): Promise<"done" | "already_done"> {
  // 1. Lock, check, write down.
  const started = await db.transaction(async (tx) => {
    const payment = await lockPayment(tx, plan.paymentId);

    const earlier = await tx
      .select()
      .from(schema.moneyOperations)
      .where(
        and(
          eq(schema.moneyOperations.paymentId, plan.paymentId),
          like(schema.moneyOperations.label, `${plan.labelBase}:%`),
        ),
      );
    if (earlier.some((o) => o.status === "succeeded")) return { already: true as const };

    const [inFlight] = await tx
      .select({ id: schema.moneyOperations.id })
      .from(schema.moneyOperations)
      .where(and(eq(schema.moneyOperations.paymentId, plan.paymentId), eq(schema.moneyOperations.status, "started")));
    if (inFlight) throw new OutcomeUnknownError("A money action is already in progress on this payment. It is being checked with Stripe.");

    const params = await plan.prepare(payment, tx);

    // Every earlier attempt under this name was definitely refused, so a new attempt is safe.
    const label = `${plan.labelBase}:${earlier.length + 1}`;
    const [operation] = await tx
      .insert(schema.moneyOperations)
      .values({ paymentId: plan.paymentId, kind: plan.kind, label, params: JSON.stringify(params) })
      .returning({ id: schema.moneyOperations.id });
    return { already: false as const, operationId: operation.id, params, label };
  });
  if (started.already) return "already_done";

  // 2. Ask Stripe.
  let outcome: { stripeId: string; result: R };
  try {
    outcome = await plan.execute(started.params, started.label);
  } catch (error) {
    if (isDefiniteRefusal(error)) {
      const message = stripeErrorMessage(error);
      await db.transaction(async (tx) => {
        const payment = await lockPayment(tx, plan.paymentId);
        await tx
          .update(schema.moneyOperations)
          .set({ status: "failed", error: message, finishedAt: new Date() })
          .where(eq(schema.moneyOperations.id, started.operationId));
        await plan.onRefused?.(payment, started.params, message, tx);
      });
      throw new MoneyError(message);
    }
    // No clear answer. Leave the action written down as "started".
    throw new OutcomeUnknownError(stripeErrorMessage(error));
  }

  // 3. Record what happened.
  await finishOperation(started.operationId, plan.paymentId, outcome.stripeId, (payment, tx) =>
    plan.apply(payment, started.params, outcome, tx),
  );
  return "done";
}

/** Marks a written-down action as done and records its outcome, with the payment locked. */
export async function finishOperation(
  operationId: string,
  paymentId: string,
  stripeId: string,
  apply: (payment: Payment, tx: Tx) => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const payment = await lockPayment(tx, paymentId);
    const [operation] = await tx.select().from(schema.moneyOperations).where(eq(schema.moneyOperations.id, operationId));
    if (!operation || operation.status !== "started") return; // already recorded by someone else
    await apply(payment, tx);
    await tx
      .update(schema.moneyOperations)
      .set({ status: "succeeded", stripeId, finishedAt: new Date() })
      .where(eq(schema.moneyOperations.id, operationId));
  });
}

/** Marks a written-down action as definitely not done. */
export async function failOperation(operationId: string, paymentId: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockPayment(tx, paymentId);
    await tx
      .update(schema.moneyOperations)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(and(eq(schema.moneyOperations.id, operationId), eq(schema.moneyOperations.status, "started")));
  });
}

/** Adds one line to the money record. Lines are never edited or removed. */
export async function addLedgerEntry(
  tx: Tx,
  entry: { paymentId: string; kind: string; amountCents: number; stripeRef?: string | null; note?: string },
): Promise<void> {
  if (entry.amountCents === 0) return;
  await tx.insert(schema.ledgerEntries).values({
    paymentId: entry.paymentId,
    kind: entry.kind,
    amountCents: entry.amountCents,
    stripeRef: entry.stripeRef ?? null,
    note: entry.note,
  });
}
