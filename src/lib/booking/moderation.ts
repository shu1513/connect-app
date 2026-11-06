/**
 * What suspending a host does to their bookings: their waiting requests end
 * and their calls that have not started are cancelled for free. (Closing an
 * account does the same and more; see profiles/closing.ts.)
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { cancelCall } from "@/lib/payments/cancel";
import { endWaitingRequestsOf } from "./bookings";

/** Returns how many calls could not be cancelled, so the founder can be told. */
export async function endBookingsOfSuspendedHost(hostId: string, now: Date): Promise<number> {
  await endWaitingRequestsOf(hostId, { asHost: true, asCustomer: false }, now);
  const upcoming = await db
    .select({ call: schema.calls, payment: schema.payments })
    .from(schema.calls)
    .leftJoin(schema.payments, eq(schema.payments.callId, schema.calls.id))
    .where(and(eq(schema.calls.hostId, hostId), isNull(schema.calls.cancelledAt), gt(schema.calls.startsAt, now)));
  let failed = 0;
  for (const { call, payment } of upcoming) {
    try {
      await cancelCall({ call, payment, by: "admin", now });
    } catch (error) {
      failed++;
      console.error(`[bookings] could not cancel call ${call.id} of suspended host ${hostId}`, error);
    }
  }
  return failed;
}
