/**
 * A bank dispute over a call's card payment: what keeps its money where it is.
 *
 * While the customer's bank has the charge under dispute, and after a dispute is lost (the money
 * has gone back to the customer), the host cannot collect that money and it cannot be refunded on
 * top. `payments.disputeOpen` says so. A lost dispute stays blocked; the founder settles it by hand.
 * Which of Stripe's statuses block is one rule for every kind of money: `blocksMoney` in
 * src/lib/disputes/status.ts.
 */
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import { anyBlocksMoney, blocksMoney } from "@/lib/disputes/status";
import { lockPayment } from "./operations";
import { stripe } from "./stripe";

/** Every dispute Stripe has on one charge, however many pages that is. */
export async function allDisputesOf(intentId: string): Promise<Stripe.Dispute[]> {
  const found: Stripe.Dispute[] = [];
  for await (const dispute of stripe().disputes.list({ payment_intent: intentId, limit: 100 })) found.push(dispute);
  return found;
}

/** How long Stripe may take to answer while a row is held for it. */
export const LOCKED_READ_MS = 8_000;

/**
 * Waits for an answer from Stripe, but never longer than this: used while a row is held, so that
 * whoever waits for that row never waits long. Stripe's library can still try again by itself
 * (after a broken connection); this deadline holds whatever it does. Giving up throws, which
 * undoes the caller's step and frees the row.
 */
export async function inTime<T>(answer: Promise<T>, ms: number = LOCKED_READ_MS): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (deadline = setTimeout(() => reject(new Error("Stripe did not answer in time while a row was held for it.")), ms)));
  return Promise.race([answer, late]).finally(() => clearTimeout(deadline));
}

/**
 * Asks Stripe where the disputes over a call's card payment stand, ALL of them together, and
 * records whether any of them still blocks the money. A bank can dispute one charge more than
 * once: a win on one must never unfreeze money that another still holds (plans/47, decision 1).
 *
 * Stripe is read with the payment's row held. Messages can arrive out of order, and two can be
 * handled at the same moment; holding the row puts them in a line, and whoever writes after us has
 * read Stripe after us. So an older answer can never be written over a newer one, not even for a
 * moment: a dispute that has just opened is never un-frozen by a reading taken before it existed.
 * (Collecting and refunding take the same row, so they wait for this too, at most for the few
 * seconds `inTime` allows.)
 *
 * `known` is a dispute the caller has just read from Stripe by its id (the one a message was
 * about).
 *   - If that reading shows it holding the money, the money is frozen first, before anything else:
 *     whatever happens to the reading below (Stripe not answering in time, say), a refund or a
 *     collection that was waiting for this row finds the payment frozen. That reading was taken
 *     before the row was held, so it can be the older one; it only ever freezes, and the reading
 *     below, taken with the row held, has the last word.
 *   - If Stripe's list does not show that dispute yet, it is asked for by its id with the row
 *     held, so its status is as fresh as the list.
 * Every dispute on this payment that the app has on record (plans/47) and that the list leaves out
 * counts too: money is never released on a list that omits a dispute we know of.
 */
export async function refreshPaymentDispute(paymentId: string, now: Date = new Date(), known?: { id: string; status: string }): Promise<void> {
  const [payment] = await db.select({ intentId: schema.payments.stripePaymentIntentId }).from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment?.intentId) return;
  const intentId = payment.intentId;
  if (known && blocksMoney(known.status)) await db.update(schema.payments).set({ disputeOpen: true, updatedAt: now }).where(eq(schema.payments.id, paymentId));
  await db.transaction(async (tx) => {
    await lockPayment(tx, paymentId);
    // One deadline for all that is asked of Stripe while the row is held.
    const { disputes, missing } = await inTime(
      (async () => {
        const all = await allDisputesOf(intentId);
        const omitted = known && !all.some((dispute) => dispute.id === known.id) ? await stripe().disputes.retrieve(known.id, {}, { maxNetworkRetries: 0 }) : null;
        return { disputes: all, missing: omitted };
      })(),
    );
    const statuses = disputes.map((dispute) => dispute.status);
    const listed = new Set(disputes.map((dispute) => dispute.id));
    if (missing) statuses.push(missing.status);
    const onRecord = await tx.select({ id: schema.disputes.id, status: schema.disputes.status }).from(schema.disputes).where(eq(schema.disputes.paymentId, paymentId));
    for (const row of onRecord) if (!listed.has(row.id) && row.id !== known?.id) statuses.push(row.status);
    // Stripe shows none: there is nothing to record, and nothing that was recorded is taken back on that word alone.
    if (statuses.length === 0) return;
    await tx.update(schema.payments).set({ disputeOpen: anyBlocksMoney(statuses), updatedAt: now }).where(eq(schema.payments.id, paymentId));
  });
}
