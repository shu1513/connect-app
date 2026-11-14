import { canJoin } from "@/lib/calls";
import { callForParticipant } from "@/lib/payments/access";
import { paymentBlocksJoin } from "@/lib/payments/rules";
import { getUser } from "@/lib/session";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { roomState } from "@/lib/calls";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { switches } from "@/lib/safety/switches";
import { createEntryPass, removeFromRoom, videoServerUrl } from "@/lib/video/livekit";

/**
 * With short breaks between calls, the room of the next call opens while the
 * previous one may still be going. Nobody should be on camera in two calls at
 * once, so entering one room takes the person out of every other room they
 * could still be in: any call of theirs whose room has opened and is not yet
 * confirmed closed, including one that was cancelled or has just run out.
 * Throws if the video service cannot confirm it.
 */
async function leaveOtherCalls(userId: string, thisCallId: string, now: Date): Promise<void> {
  const others = await db
    .select()
    .from(schema.calls)
    .where(and(or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)), ne(schema.calls.id, thisCallId), isNull(schema.calls.closedAt)));
  for (const other of others) {
    if (roomState(other, now) === "not_open_yet") continue;
    await removeFromRoom(other.roomName, userId);
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
  if (call.safetyEndedAt) return Response.json({ error: MESSAGES.closed }, { status: 409 });
  if (user.paused) return Response.json({ error: "Your account is paused, so you cannot join calls." }, { status: 403 });
  if ((await switches()).joiningOff) return Response.json({ error: "Calls are paused across Connect right now. Please try again shortly." }, { status: 503 });
  if (await isBlockedEitherWay(call.hostId, call.customerId)) return Response.json({ error: MESSAGES.closed }, { status: 409 });

  const now = new Date();
  const decision = canJoin(call, user.id, now);
  if (!decision.allowed) {
    if (decision.reason === "not_on_call") return Response.json({ error: "Call not found." }, { status: 404 });
    return Response.json({ error: MESSAGES[decision.reason] }, { status: 409 });
  }

  // The call's own hold is compared with the stretch it pays for, not with the call's end: the end
  // moves when time is added, and that extra time has a hold of its own (checked when the host accepted).
  const blocked = paymentBlocksJoin({ payment, callEndsAt: payment?.coversUntil ?? call.endsAt, now });
  if (blocked) return Response.json({ error: MESSAGES[blocked] }, { status: 409 });

  // The name the other person sees on the video: a host's display name, as on their page, not their account name.
  const [hostProfile] = decision.role === "host" ? await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id)) : [];
  const shownName = hostProfile?.displayName ?? user.name;

  // One call at a time. Taking the person out of other rooms and handing out this pass happen one
  // after the other per person (also across servers), so two joins at once cannot both get through.
  let token: string;
  try {
    token = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`join:${user.id}`}))`);
      // Read the call again under the lock: it may have been stopped or cancelled a moment ago.
      const [fresh] = await tx.select({ safetyEndedAt: schema.calls.safetyEndedAt, cancelledAt: schema.calls.cancelledAt }).from(schema.calls).where(eq(schema.calls.id, call.id));
      if (!fresh || fresh.safetyEndedAt || fresh.cancelledAt) throw new Error("ended");
      await leaveOtherCalls(user.id, call.id, now);
      return createEntryPass({ roomName: call.roomName, userId: user.id, displayName: shownName });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ended") return Response.json({ error: MESSAGES.closed }, { status: 409 });
    console.error(`[calls] could not hand out an entry pass for call ${call.id}`, error);
    return Response.json({ error: "Could not connect you just now. Please try again." }, { status: 503 });
  }

  return Response.json({
    token,
    serverUrl: videoServerUrl(),
    role: decision.role,
    endsAt: call.endsAt.toISOString(),
    serverNow: new Date().toISOString(),
  });
}
