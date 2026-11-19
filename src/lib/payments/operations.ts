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
 *
 * An action is owned by a payment, by a membership's month (src/lib/membership)
 * or by a contribution's payment (src/lib/contributions). All three go through
 * the same steps below; only the row that is locked differs. The functions with "Money" or "Payment" in their
 * name are the payment's, exactly as they were; the "owned" ones take the owner.
 */
import { and, eq, gt, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import { isDefiniteRefusal, stripeErrorMessage } from "./stripe";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** "transfer" is only ever a payment's: a month's money reaches a host through the payments under it. */
export type OperationKind = "capture" | "release" | "refund" | "transfer" | "hold";

/** An action was refused for a reason a person can read. Nothing was changed. */
export class MoneyError extends Error {}

/**
 * Thrown by an action's `execute` when it decides, at the last moment, not to ask Stripe at all.
 * Nothing was sent by this process, so it is recorded like a refusal from Stripe, but only while the
 * helper cannot have picked the action up (see RECONCILE_AFTER_MS): after that the helper may have
 * sent it itself, so the action is left unanswered and the helper finds out.
 */
export class NotSentError extends Error {}

/** An unfinished action is only checked by the helper once Stripe has had time to finish it. */
export const RECONCILE_AFTER_MS = 60_000;

/** The action may or may not have happened. It will be checked with Stripe before anything else runs. */
export class OutcomeUnknownError extends Error {}

export async function lockPayment(tx: Tx, paymentId: string): Promise<Payment> {
  const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).for("update");
  if (!payment) throw new MoneyError("Payment not found.");
  return payment;
}

/**
 * Who owns an action: a payment, a month or a contribution's payment, and how that owner is locked. The
 * lock is called inside the transaction of every step (starting, finishing,
 * refusing, recovering), so each owner keeps one order of locks everywhere.
 */
export type Owner<Row> = { column: "paymentId" | "monthId" | "contributionPaymentId"; id: string; lock: (tx: Tx) => Promise<Row> };

const paymentOwner = (paymentId: string): Owner<Payment> => ({ column: "paymentId", id: paymentId, lock: (tx) => lockPayment(tx, paymentId) });

const ownedBy = (owner: Pick<Owner<unknown>, "column" | "id">) => eq(schema.moneyOperations[owner.column], owner.id);

/** The steps of one action for an owner of any kind. */
export type OwnedPlan<Row, P, R> = {
  owner: Owner<Row>;
  kind: OperationKind;
  /**
   * One fixed name for this exact action, for example "capture:<payment id>".
   * The label sent to Stripe is this name plus an attempt number, which only
   * goes up after Stripe has definitely refused the previous attempt.
   */
  labelBase: string;
  /**
   * Runs with the owner locked. Checks the action is allowed (throw MoneyError
   * if not) and returns the exact parameters to use. May write preparatory rows.
   */
  prepare: (row: Row, tx: Tx) => Promise<P>;
  /** Asks Stripe. Must pass `label` to Stripe as the idempotency key. Returns Stripe's ID and result. */
  execute: (params: P, label: string) => Promise<{ stripeId: string; result: R }>;
  /** Runs with the owner locked again. Records the outcome. */
  apply: (row: Row, params: P, outcome: { stripeId: string; result: R }, tx: Tx) => Promise<void>;
  /** Optional: runs with the owner locked when Stripe definitely refused. */
  onRefused?: (row: Row, params: P, message: string, tx: Tx) => Promise<void>;
};

export type OperationPlan<P, R> = Omit<OwnedPlan<Payment, P, R>, "owner"> & { paymentId: string };

/** An action that has been written down and not yet asked of Stripe. */
export type StartedOperation<P> = { operationId: string; params: P; label: string };

const owned = <P, R>(plan: Pick<OperationPlan<P, R>, "paymentId">) => paymentOwner(plan.paymentId);

export async function runMoneyOperation<P, R>(plan: OperationPlan<P, R>): Promise<"done" | "already_done"> {
  return runOwnedOperation({ ...plan, owner: owned(plan) });
}

export async function runOwnedOperation<Row, P, R>(plan: OwnedPlan<Row, P, R>): Promise<"done" | "already_done"> {
  const started = await db.transaction((tx) => startOwnedOperation(tx, plan));
  if (started === "already_done") return "already_done";
  await completeOwnedOperation(started, plan);
  return "done";
}

/**
 * Step 1 on its own, inside a transaction the caller owns: lock, check, write
 * down. Called directly only when several actions have to be written down
 * together (a host's collection); the caller then runs completeMoneyOperation
 * for each, after its transaction has been saved.
 */
export async function startMoneyOperation<P>(
  tx: Tx,
  plan: Pick<OperationPlan<P, unknown>, "paymentId" | "kind" | "labelBase" | "prepare">,
): Promise<StartedOperation<P> | "already_done"> {
  return startOwnedOperation(tx, { ...plan, owner: owned(plan) });
}

export async function startOwnedOperation<Row, P>(
  tx: Tx,
  plan: Pick<OwnedPlan<Row, P, unknown>, "owner" | "kind" | "labelBase" | "prepare">,
): Promise<StartedOperation<P> | "already_done"> {
  const row = await plan.owner.lock(tx);

  const earlier = await tx
    .select()
    .from(schema.moneyOperations)
    .where(and(ownedBy(plan.owner), like(schema.moneyOperations.label, `${plan.labelBase}:%`)));
  if (earlier.some((o) => o.status === "succeeded")) return "already_done";

  const [inFlight] = await tx
    .select({ id: schema.moneyOperations.id })
    .from(schema.moneyOperations)
    .where(and(ownedBy(plan.owner), eq(schema.moneyOperations.status, "started")));
  if (inFlight) throw new OutcomeUnknownError("A money action is already in progress here. It is being checked with Stripe.");

  const params = await plan.prepare(row, tx);

  // Every earlier attempt under this name was definitely refused, so a new attempt is safe.
  const label = `${plan.labelBase}:${earlier.length + 1}`;
  const [operation] = await tx
    .insert(schema.moneyOperations)
    .values({ [plan.owner.column]: plan.owner.id, kind: plan.kind, label, params: JSON.stringify(params) })
    .returning({ id: schema.moneyOperations.id });
  return { operationId: operation.id, params, label };
}

/** Steps 2 and 3 for an action that was written down: ask Stripe, then record what happened. */
export async function completeMoneyOperation<P, R>(
  started: StartedOperation<P>,
  plan: Pick<OperationPlan<P, R>, "paymentId" | "execute" | "apply" | "onRefused">,
): Promise<void> {
  return completeOwnedOperation(started, { ...plan, owner: owned(plan) });
}

export async function completeOwnedOperation<Row, P, R>(
  started: StartedOperation<P>,
  plan: Pick<OwnedPlan<Row, P, R>, "owner" | "execute" | "apply" | "onRefused">,
): Promise<void> {
  // 2. Ask Stripe.
  let outcome: { stripeId: string; result: R };
  try {
    outcome = await plan.execute(started.params, started.label);
  } catch (error) {
    const notSent = error instanceof NotSentError;
    if (isDefiniteRefusal(error) || notSent) {
      const message = notSent ? (error as Error).message : stripeErrorMessage(error);
      const marked = await db.transaction(async (tx) => {
        const row = await plan.owner.lock(tx);
        // Only an action that is still unanswered: the helper may have recorded its real outcome meanwhile.
        // And "we did not send it" is only certain while the helper cannot have picked the action up and sent it
        // itself: well inside the time it leaves an unfinished action alone.
        const young = notSent ? gt(schema.moneyOperations.createdAt, new Date(Date.now() - RECONCILE_AFTER_MS / 2)) : undefined;
        const rows = await tx
          .update(schema.moneyOperations)
          .set({ status: "failed", error: message, finishedAt: new Date() })
          .where(and(eq(schema.moneyOperations.id, started.operationId), eq(schema.moneyOperations.status, "started"), young))
          .returning({ id: schema.moneyOperations.id });
        if (rows.length > 0) await plan.onRefused?.(row, started.params, message, tx);
        return rows.length > 0;
      });
      // Not sent by us, but too old to be sure nobody else sent it: left unanswered for the helper.
      if (notSent && !marked) throw new OutcomeUnknownError(message);
      throw new MoneyError(message);
    }
    // No clear answer. Leave the action written down as "started".
    throw new OutcomeUnknownError(stripeErrorMessage(error));
  }

  // 3. Record what happened.
  await finishOwnedOperation(started.operationId, plan.owner, outcome.stripeId, (row, tx) => plan.apply(row, started.params, outcome, tx));
}

/** Marks a written-down action as done and records its outcome, with the payment locked. */
export async function finishOperation(
  operationId: string,
  paymentId: string,
  stripeId: string,
  apply: (payment: Payment, tx: Tx) => Promise<void>,
): Promise<void> {
  return finishOwnedOperation(operationId, paymentOwner(paymentId), stripeId, apply);
}

export async function finishOwnedOperation<Row>(operationId: string, owner: Owner<Row>, stripeId: string, apply: (row: Row, tx: Tx) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await owner.lock(tx);
    const [operation] = await tx.select().from(schema.moneyOperations).where(eq(schema.moneyOperations.id, operationId));
    if (!operation || operation.status !== "started") return; // already recorded by someone else
    await apply(row, tx);
    await tx
      .update(schema.moneyOperations)
      .set({ status: "succeeded", stripeId, finishedAt: new Date() })
      .where(eq(schema.moneyOperations.id, operationId));
  });
}

/** Marks a written-down action as definitely not done. */
export async function failOperation(operationId: string, paymentId: string, message: string): Promise<void> {
  return failOwnedOperation(operationId, paymentOwner(paymentId), message);
}

/** The same for any owner. `onRefused` runs in the same step, and only if this call is the one that marked it. */
export async function failOwnedOperation<Row>(operationId: string, owner: Owner<Row>, message: string, onRefused?: (row: Row, tx: Tx) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await owner.lock(tx);
    const marked = await tx
      .update(schema.moneyOperations)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(and(eq(schema.moneyOperations.id, operationId), eq(schema.moneyOperations.status, "started")))
      .returning({ id: schema.moneyOperations.id });
    if (marked.length > 0) await onRefused?.(row, tx);
  });
}

/** Adds one line to the money record. Lines are never edited or removed. Owned by a payment, by a month or by a contribution's payment. */
export async function addLedgerEntry(
  tx: Tx,
  entry: ({ paymentId: string } | { monthId: string } | { contributionPaymentId: string }) & { kind: string; amountCents: number; stripeRef?: string | null; note?: string },
): Promise<void> {
  if (entry.amountCents === 0) return;
  await tx.insert(schema.ledgerEntries).values({
    ...("paymentId" in entry ? { paymentId: entry.paymentId } : "monthId" in entry ? { monthId: entry.monthId } : { contributionPaymentId: entry.contributionPaymentId }),
    kind: entry.kind,
    amountCents: entry.amountCents,
    stripeRef: entry.stripeRef ?? null,
    note: entry.note,
  });
}

/** After Stripe refuses an action, wait this long before trying it again. */
export const RETRY_AFTER_REFUSAL_MS = 3_600_000;

/**
 * Whether Stripe refused this kind of action on this payment a short while ago.
 * Without this, a charge Stripe keeps refusing would be tried again every few seconds.
 */
export async function refusedRecently(paymentId: string, kind: OperationKind, now: Date, reader: Pick<Tx, "select"> = db): Promise<boolean> {
  const [refused] = await reader
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
