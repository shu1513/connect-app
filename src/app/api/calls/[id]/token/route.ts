import { canJoin } from "@/lib/calls";
import { callForParticipant } from "@/lib/payments/access";
import { paymentBlocksJoin } from "@/lib/payments/rules";
import { getUser } from "@/lib/session";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { roomState } from "@/lib/calls";
import { createEntryPass, removeFromRoom, videoServerUrl } from "@/lib/video/livekit";

/**
 * With short breaks between calls, the room of the next call opens while the
 * previous one may still be going. Nobody should be on camera in two calls at
 * once, so entering one room takes the person out of every other open room.
 */
async function leaveOtherCalls(userId: string, thisCallId: string, now: Date): Promise<void> {
  const others = await db
    .select()
    .from(schema.calls)
    .where(
      and(
        or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)),
        ne(schema.calls.id, thisCallId),
        isNull(schema.calls.cancelledAt),
        isNull(schema.calls.closedAt),
      ),
    );
  for (const other of others) {
    if (roomState(other, now) !== "open") continue;
    await removeFromRoom(other.roomName, userId).catch((error) => {
      console.error(`[calls] could not take ${userId} out of call ${other.id}`, error);
    });
  }
}

const MESSAGES = {
  not_open_yet: "This room is not open yet.",
  closed: "This call has ended.",
  not_paid: "This call has not been paid for yet.",
  hold_ended: "The payment hold for this call is no longer valid.",
} as const;

/**
 * The join check. Hands out an entry pass only to a logged-in person who is
 * on this call, only while the room is open, and for a paid call only while
 * the money is held.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/token">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  // A stranger gets the same answer whether or not the call exists.
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });
  const { call, payment } = access;

  if (call.cancelledAt) return Response.json({ error: "This call was cancelled." }, { status: 409 });

  const now = new Date();
  const decision = canJoin(call, user.id, now);
  if (!decision.allowed) {
    if (decision.reason === "not_on_call") return Response.json({ error: "Call not found." }, { status: 404 });
    return Response.json({ error: MESSAGES[decision.reason] }, { status: 409 });
  }

  const blocked = paymentBlocksJoin({ payment, callEndsAt: call.endsAt, now });
  if (blocked) return Response.json({ error: MESSAGES[blocked] }, { status: 409 });

  // One call at a time: joining this one puts the person out of any other call whose room is open.
  await leaveOtherCalls(user.id, call.id, now);

  const token = await createEntryPass({
    roomName: call.roomName,
    userId: user.id,
    displayName: user.name,
  });

  return Response.json({
    token,
    serverUrl: videoServerUrl(),
    role: decision.role,
    endsAt: call.endsAt.toISOString(),
    serverNow: new Date().toISOString(),
  });
}
