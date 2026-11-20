import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { roomFor } from "@/lib/app-door/room";

/**
 * GET /api/app/calls/[id]/room: what the call's own screen in the phone app needs before anyone
 * enters (plans/45-phone-apps/09-the-call.md). For someone who may act: a paused person cannot
 * join calls, and is told so here. A call that does not exist and one that is somebody else's
 * are the same "not found". It only reads.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/calls/[id]/room">) {
  const asked = await appRequest(request, "active");
  if (asked instanceof Response) return asked;
  const { id } = await ctx.params;
  const room = await roomFor(asked.person!, id, new Date());
  return room ? answer(room) : refuse("not_found");
}
