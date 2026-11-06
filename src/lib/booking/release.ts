/**
 * What cancelling a call does to the booking it came from: the booking ends
 * and the two people's time is free again, in the same database step as the
 * cancellation. Kept apart from the rest of the booking code so the payment
 * code can use it without the two depending on each other in a circle.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueBookingEmails, type BookingEvent } from "./emails";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function releaseBookingOfCall(tx: Tx, callId: string, by: "host" | "customer" | "admin", reason?: string): Promise<void> {
  const [booking] = await tx
    .update(schema.bookings)
    .set({ stage: "cancelled", endedReason: reason ?? `cancelled by ${by === "admin" ? "Connect" : `the ${by}`}`, endedAt: new Date() })
    .where(and(eq(schema.bookings.callId, callId), eq(schema.bookings.stage, "accepted")))
    .returning();
  if (!booking) return; // a call made before bookings existed, or by a test tool
  await tx.delete(schema.busyEntries).where(eq(schema.busyEntries.bookingId, booking.id));
  const event: BookingEvent =
    reason === "unpaid" ? "cancelled_unpaid" : by === "host" ? "cancelled_by_host" : by === "customer" ? "cancelled_by_customer" : "cancelled_by_connect";
  await queueBookingEmails(tx, booking, event);
}
