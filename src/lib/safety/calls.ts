/**
 * "End call and report": the call ends for both people at once, nobody can
 * come back in, time after that moment is not counted, and the payment goes
 * to the founder's review list instead of being charged automatically.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { closeRoom } from "@/lib/video/livekit";

export async function endCallForSafety(input: { call: Call; by: string; now: Date }): Promise<void> {
  const { call, by, now } = input;
  await db.transaction(async (tx) => {
    const marked = await tx
      .update(schema.calls)
      .set({ safetyEndedAt: now, safetyEndedBy: by })
      .where(and(eq(schema.calls.id, call.id), isNull(schema.calls.safetyEndedAt), isNull(schema.calls.cancelledAt)))
      .returning({ id: schema.calls.id });
    if (marked.length === 0) return;
    // Never charged automatically: the founder decides the amount after looking at the report.
    const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id)).for("update");
    if (payment && (payment.status === "held" || payment.status === "awaiting_payment")) {
      await tx
        .update(schema.payments)
        .set({ needsReview: true, reviewReason: "The call was ended with \"End call and report\". Decide the amount after reading the report.", updatedAt: new Date() })
        .where(eq(schema.payments.id, payment.id));
    }
  });
  // Put both people out and cancel their entry passes. The always-on helper repeats this until the room is confirmed closed.
  await closeRoom(call.roomName, [call.hostId, call.customerId]).catch((error) => {
    console.error(`[safety] could not close the room of call ${call.id} yet; the helper will retry`, error);
  });
}
