/**
 * "End call and report": the call ends for both people at once, nobody can
 * come back in, time after that moment is not counted, and every payment of
 * the call goes to the founder's review list instead of being charged automatically.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { roomState, type RoomState } from "@/lib/calls";
import { closeRoom } from "@/lib/video/livekit";
import { closeCallIfDue } from "@/lib/video/closing";

/**
 * Only while the room is open (from 5 minutes before the start until the
 * end): that is when there is a call to end. Before that a call is
 * cancelled, with the host's cancelling rule; after it, a person reports from
 * the results page. Returns where the room stood; nothing is changed unless it was "open".
 */
export async function endCallForSafety(input: { call: Call; by: string; now: Date }): Promise<RoomState> {
  const state = await stopCall(input);
  if (state !== "open") return state;
  const { call } = input;
  // Put both people out and cancel their entry passes. The always-on helper repeats this until the room is confirmed closed.
  await closeRoom(call.roomName, [call.hostId, call.customerId]).catch((error) => {
    console.error(`[safety] could not close the room of call ${call.id} yet; the helper will retry`, error);
  });
  return state;
}

/**
 * The same, for the phone app, which does not say "ended for both" on the mark alone: `closed` is
 * true only with proof that the room is closed (both people out, their entry passes cancelled).
 * The proof is the helper's own step (`closeCallIfDue`), which closes the room and writes down
 * that it is closed once the video service has confirmed it; a room written down as closed before
 * counts too. So trying again after a failure, also after the call's booked end, asks the video
 * service again instead of taking the clock's word. For a room that has not opened there is
 * nothing to close.
 */
export async function endCallForSafetyConfirmed(input: { call: Call; by: string; now: Date }): Promise<{ state: RoomState; closed: boolean }> {
  const state = await stopCall(input);
  if (state === "not_open_yet") return { state, closed: true };
  const closed = await closeCallIfDue(input.call.id).then(
    (result) => result === "closed" || result === "already closed",
    (error) => {
      console.error(`[safety] could not close the room of call ${input.call.id} yet; the helper will retry`, error);
      return false;
    },
  );
  return { state, closed };
}

/** Marks an open call as stopped (and its payments for the founder's review). Returns where the room stood; nothing is changed unless it was "open". */
async function stopCall(input: { call: Call; by: string; now: Date }): Promise<RoomState> {
  const { call, by, now } = input;
  const state = roomState(call, now);
  if (state !== "open") return state;
  await db.transaction(async (tx) => {
    const marked = await tx
      .update(schema.calls)
      .set({ safetyEndedAt: now, safetyEndedBy: by })
      .where(and(eq(schema.calls.id, call.id), isNull(schema.calls.safetyEndedAt), isNull(schema.calls.cancelledAt)))
      .returning({ id: schema.calls.id });
    if (marked.length === 0) return;
    // Never charged automatically: the founder decides the amount after looking at the report.
    // That goes for every payment of the call: its own, and the one of each request for more time.
    const payments = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id)).orderBy(schema.payments.createdAt).for("update");
    for (const payment of payments) {
      if (payment.status !== "held" && payment.status !== "awaiting_payment") continue;
      await tx
        .update(schema.payments)
        .set({ needsReview: true, reviewReason: "The call was ended with \"End call and report\". Decide the amount after reading the report.", updatedAt: new Date() })
        .where(eq(schema.payments.id, payment.id));
    }
  });
  return state;
}
