/**
 * The locks of a contribution, added to the app's one order (src/lib/membership/locks.ts;
 * plans/25, "locks.ts"). Nothing that exists is reordered:
 *
 *   1. the host's calendar
 *   2. person and host-page lines
 *   3. the host's collection line      then THE PROJECT
 *   4. the membership
 *   5. the month                       then THE PAIR (contributor and host), THE CONTRIBUTION,
 *                                      THE CONTRIBUTION'S PAYMENT
 *   6. calls, lines in `payments`, request and refund records (a contribution's refund lines too)
 *
 * A step takes only the locks it needs, never an earlier one after a later one, and all lines of
 * one kind, sorted, before the next kind.
 */
import { eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Contribution, ContributionPayment } from "@/db/schema";
import { MoneyError, type Owner, type Tx } from "@/lib/payments/operations";

/**
 * One contributor paying one host: the $1,000 rule counts over this pair, so two payments of the
 * pair arriving at the same moment are counted one after the other. Held to the end of the step.
 */
export async function lockPair(tx: Tx, contributorId: string, hostId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pair:${contributorId}:${hostId}`}))`);
}

export async function lockContribution(tx: Tx, contributionId: string): Promise<Contribution> {
  const [contribution] = await tx.select().from(schema.contributions).where(eq(schema.contributions.id, contributionId)).for("update");
  if (!contribution) throw new MoneyError("Contribution not found.");
  return contribution;
}

export async function lockContributionPayment(tx: Tx, paymentId: string): Promise<ContributionPayment> {
  const [payment] = await tx.select().from(schema.contributionPayments).where(eq(schema.contributionPayments.id, paymentId)).for("update");
  if (!payment) throw new MoneyError("Payment not found.");
  return payment;
}

/** A contribution's payment with its contribution, both locked and read under the lock, the pair's lock held. */
export type LockedPayment = { contribution: Contribution; payment: ContributionPayment };

/**
 * Finds the payment's contribution without a lock, then takes the pair, the contribution and the
 * payment, in that order, and reads both again. Every step about a contribution payment's money
 * comes in through here, so they all keep the one order.
 */
export async function lockForPayment(tx: Tx, paymentId: string): Promise<LockedPayment> {
  const [found] = await tx
    .select({ contributionId: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
    .from(schema.contributionPayments)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
    .where(eq(schema.contributionPayments.id, paymentId));
  if (!found) throw new MoneyError("Payment not found.");
  await lockPair(tx, found.contributorId, found.hostId);
  const contribution = await lockContribution(tx, found.contributionId);
  const payment = await lockContributionPayment(tx, paymentId);
  return { contribution, payment };
}

/** A contribution's payment as the owner of a money action (see payments/operations.ts). */
export const paymentOwner = (paymentId: string): Owner<LockedPayment> => ({ column: "contributionPaymentId", id: paymentId, lock: (tx) => lockForPayment(tx, paymentId) });

/** The share's line of a contribution's payment, locked, or null if the money was never taken. It comes after the contribution's payment in the order. */
export async function lockShare(tx: Tx, paymentId: string) {
  const [share] = await tx.select().from(schema.payments).where(eq(schema.payments.contributionPaymentId, paymentId)).for("update");
  return share ?? null;
}
