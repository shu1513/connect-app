import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { canJoin } from "@/lib/calls";
import { getUser } from "@/lib/session";
import { createEntryPass, videoServerUrl } from "@/lib/video/livekit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES = {
  not_open_yet: "This room is not open yet.",
  closed: "This call has ended.",
} as const;

/**
 * The join check. Hands out an entry pass only to a logged-in person who is
 * on this call, and only while the room is open.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/token">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

  const { id } = await ctx.params;
  const [call] = UUID.test(id) ? await db.select().from(schema.calls).where(eq(schema.calls.id, id)) : [];

  // A stranger gets the same answer whether or not the call exists.
  const decision = call ? canJoin(call, user.id, new Date()) : ({ allowed: false, reason: "not_on_call" } as const);
  if (!decision.allowed) {
    if (decision.reason === "not_on_call") {
      return Response.json({ error: "Call not found." }, { status: 404 });
    }
    return Response.json({ error: MESSAGES[decision.reason] }, { status: 409 });
  }

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
