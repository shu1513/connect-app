/**
 * Closing one call's room, used by the always-on helper.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { roomClosesAt } from "@/lib/calls";
import { closeRoom } from "./livekit";

/**
 * Closes a call's room if the call is over (past its end, cancelled or stopped).
 *
 * It happens with the call locked, after looking at the call again: the host
 * may have added time a moment ago, and adding time takes the same lock. So a
 * call that was just made longer is never closed, and a call that is being
 * closed can no longer be made longer.
 */
export async function closeCallIfDue(callId: string, now: Date = new Date()): Promise<"closed" | "not empty" | "not over" | "already closed"> {
  return db.transaction(async (tx) => {
    const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, callId)).for("update");
    if (!call || call.closedAt) return "already closed";
    if (!call.cancelledAt && !call.safetyEndedAt && roomClosesAt(call) > now) return "not over";
    const empty = await closeRoom(call.roomName, [call.hostId, call.customerId]);
    if (!empty) return "not empty";
    await tx.update(schema.calls).set({ closedAt: new Date() }).where(and(eq(schema.calls.id, call.id), isNull(schema.calls.closedAt)));
    return "closed";
  });
}
