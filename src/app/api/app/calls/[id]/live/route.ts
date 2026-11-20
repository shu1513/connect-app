import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import type { AppCallLive } from "@/lib/app-door/types";
import { liveFor } from "@/lib/call-page/live";

/**
 * GET /api/app/calls/[id]/live: where a call stands, from our own record: its end (which moves
 * when time is added) and whether it was cancelled or stopped. The app's call screen asks near
 * the end of the call and after a lost connection, as the website's does
 * (plans/45-phone-apps/09-the-call.md). The same reading as the website's address; the parts
 * about asking for more time are part 09b's.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/calls/[id]/live">) {
  // Also for someone whose account was paused a moment ago: they may still be in the call, and its end is theirs to know.
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const { id } = await ctx.params;
  const live = await liveFor(asked.person!.id, id);
  if (!live) return refuse("not_found");
  const body: AppCallLive = { endsAt: live.endsAt, serverNow: live.serverNow, cancelled: live.cancelled, safetyEnded: live.safetyEnded };
  return answer(body);
}
