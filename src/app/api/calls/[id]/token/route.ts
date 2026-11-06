import { canJoin } from "@/lib/calls";
import { callForParticipant } from "@/lib/payments/access";
import { paymentBlocksJoin } from "@/lib/payments/rules";
import { getUser } from "@/lib/session";
import { createEntryPass, videoServerUrl } from "@/lib/video/livekit";

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
