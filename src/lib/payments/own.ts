/**
 * A call has one payment of its own, and one more for each paid request for
 * more time. Code that means "the payment of this call" must say so, or it
 * could pick up the payment of a request for more time by mistake. These are
 * the only ways the rest of the code looks a call's payments up.
 */
import { and, asc, eq, isNull, type SQLWrapper } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import { MoneyError } from "./operations";

/** A payment with its own hold and charge at Stripe, for a call. Every payment was one of these before memberships. */
export type CardPayment = Payment & { kind: "card"; callId: string };

/**
 * The way into every piece of code that holds, charges, lets go or refunds a card. A payment that
 * belongs to a membership's month ("member_call", "member_expired") has no hold and no charge of its
 * own at Stripe, and must never be treated as if it had. Throws MoneyError for one, before anything
 * is asked of Stripe.
 */
export function cardPayment(payment: Payment): CardPayment {
  if (payment.kind !== "card" || payment.callId === null) throw new MoneyError("This payment is part of a membership, not a card payment.");
  return payment as CardPayment;
}

/**
 * The condition for joining the payments table as "this call's own payment".
 * It goes in the join itself, never in a where() that a later where() could replace.
 */
export function ownPaymentOn(callId: SQLWrapper) {
  return and(eq(schema.payments.callId, callId), isNull(schema.payments.extensionId))!;
}

/** The call's own payment, or null for a free call. */
export async function ownPaymentOf(callId: string, reader: Pick<typeof db, "select"> = db): Promise<Payment | null> {
  const [payment] = await reader
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.callId, callId), isNull(schema.payments.extensionId)));
  return payment ?? null;
}

/** Every payment of a call, in the order of the time they pay for: the call's own first, then each request for more time. */
export async function paymentsOfCall(callId: string): Promise<Payment[]> {
  return db.select().from(schema.payments).where(eq(schema.payments.callId, callId)).orderBy(asc(schema.payments.coversFrom), asc(schema.payments.createdAt));
}
