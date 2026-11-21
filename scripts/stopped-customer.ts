/**
 * For the check scripts: a customer whose bank has an open dispute, for as long as one step runs
 * (plans/47-bank-disputes.md, decision 9: such a customer cannot make a new agreement to pay).
 *
 * The dispute's row is written straight into the local database (there is no dispute at Stripe),
 * on a finished call of long ago and a payment made for this alone. All three are taken away
 * again when the step is over, whatever became of it.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

export async function whileDisputed<T>(customerId: string, hostId: string, work: () => Promise<T>): Promise<T> {
  const { db, schema } = await import("../src/db");
  const { createPaymentForCall } = await import("../src/lib/payments/hold");
  const startsAt = new Date("2020-01-01T12:00:00Z");
  const endsAt = new Date(startsAt.getTime() + 15 * 60_000);
  const disputeId = `du_check_${randomUUID().replace(/-/g, "")}`;
  const callId = await db.transaction(async (tx) => {
    const [call] = await tx.insert(schema.calls).values({ hostId, customerId, startsAt, endsAt, closedAt: endsAt, roomName: `stoppedcheck-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
    await createPaymentForCall(tx, call);
    const [payment] = await tx.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.callId, call.id));
    await tx.insert(schema.disputes).values({ id: disputeId, paymentId: payment.id, hostId, customerId, amountCents: 2000, reason: "fraudulent", stage: "chargeback", status: "needs_response", openedAt: new Date(), stageBeganAt: new Date() });
    return call.id;
  });
  try {
    return await work();
  } finally {
    await db.delete(schema.disputes).where(eq(schema.disputes.id, disputeId));
    await db.delete(schema.payments).where(eq(schema.payments.callId, callId));
    await db.delete(schema.calls).where(eq(schema.calls.id, callId));
  }
}

/** The sentence a step is refused with while its customer has an open chargeback, or null when it went through. */
export const refusalWhileDisputed = (customerId: string, hostId: string, work: () => Promise<unknown>): Promise<string | null> =>
  whileDisputed(customerId, hostId, () => work().then(() => null, (error: unknown) => (error instanceof Error ? error.message : String(error))));
