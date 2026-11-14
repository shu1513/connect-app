/**
 * A call has one payment of its own, and one more for each paid request for
 * more time. Code that means "the payment of this call" must say so, or it
 * could pick up the payment of a request for more time by mistake. These are
 * the only ways the rest of the code looks a call's payments up.
 */
import { and, asc, eq, isNull, type SQLWrapper } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";

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
