/**
 * A bank dispute over a contribution's charge (plans/23, "How the $1,000 is counted"; plans/25,
 * "dispute.ts"). Stripe is asked where every dispute over the payment stands, and the worst is
 * recorded: lost before open before won.
 *
 *   open or lost   the share cannot be collected or refunded, and a monthly contribution ends
 *   won            the share can be collected again; the contribution stays ended
 */
import { and, eq, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { blocksMoney } from "@/lib/disputes/status";
import { stripe } from "@/lib/payments/stripe";
import { endInStep } from "./ending";
import { letGo } from "./charge";
import { lockForPayment } from "./locks";

const pays = schema.contributionPayments;

/**
 * Records where the dispute over a payment stands, with the payment locked. Open or lost ends a
 * monthly contribution, in the same step. `readAtVersion` is the payment's `disputeVersion` as it
 * was before Stripe was asked: if another answer was recorded since, this one may be older than
 * that one, so nothing is recorded and false is returned (the caller asks Stripe again).
 */
export async function recordDispute(paymentId: string, state: "open" | "won" | "lost", now: Date, readAtVersion?: number): Promise<boolean> {
  const toLetGo = await db.transaction(async (tx) => {
    const { contribution, payment } = await lockForPayment(tx, paymentId);
    if (readAtVersion !== undefined && payment.disputeVersion !== readAtVersion) return null;
    await tx.update(pays).set({ dispute: state, disputeVersion: payment.disputeVersion + 1, updatedAt: now }).where(eq(pays.id, payment.id));
    // Winning later does not start it again.
    if (payment.dispute === state || state === "won" || contribution.status === "ended" || contribution.kind !== "monthly") return [];
    return endInStep(tx, contribution, "dispute", now);
  });
  if (!toLetGo) return false;
  for (const id of toLetGo) await letGo(id, now).catch((error) => console.error(`[contributions] could not let go of payment ${id} yet; the helper will retry`, error));
  return true;
}

/**
 * Asks Stripe where the disputes over a payment's charge stand, all of them together, and records
 * it. Stripe is asked once more after recording, so an answer that went stale while we waited is
 * not the last word. Called by Stripe's messages, and by the helper every hour while one is open.
 */
export async function refreshDispute(paymentId: string, now: Date = new Date()): Promise<void> {
  const [payment] = await db.select({ intentId: pays.stripePaymentIntentId }).from(pays).where(eq(pays.id, paymentId));
  if (!payment?.intentId) return;
  let recorded: string | null = null;
  for (let round = 0; round < 5; round++) {
    // Read before Stripe is asked: an answer is only recorded if no other answer was recorded since.
    const [seen] = await db.select({ version: pays.disputeVersion }).from(pays).where(eq(pays.id, paymentId));
    const disputes = await stripe().disputes.list({ payment_intent: payment.intentId, limit: 100 }).autoPagingToArray({ limit: 300 });
    if (disputes.length === 0) break;
    const state = disputes.some((dispute) => dispute.status === "lost") ? "lost" : disputes.some((dispute) => blocksMoney(dispute.status)) ? "open" : "won";
    if (state === recorded) break;
    if (await recordDispute(paymentId, state, now, seen.version)) recorded = state;
  }
  // Marked as looked at, so the helper's hourly look goes round all open disputes in turn.
  await db.update(pays).set({ updatedAt: now }).where(eq(pays.id, paymentId));
}

/** For the helper: every payment whose dispute is open is asked about again once an hour. */
export async function runDisputeLooks(now: Date): Promise<void> {
  const open = await db
    .select({ id: pays.id })
    .from(pays)
    .where(and(eq(pays.dispute, "open"), lte(pays.updatedAt, new Date(now.getTime() - 3_600_000))))
    .orderBy(pays.updatedAt)
    .limit(25);
  for (const { id } of open) {
    await refreshDispute(id, now).catch(async (error) => {
      console.error(`[contributions] could not ask about the dispute over payment ${id}; will retry in an hour`, error);
      await db.update(pays).set({ updatedAt: now }).where(eq(pays.id, id)).catch(() => undefined);
    });
  }
}
