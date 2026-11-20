import { liveFor } from "@/lib/call-page/live";
import { getUser } from "@/lib/session";

/**
 * Where a call stands, from our own record (no call to Stripe). The call page
 * asks every couple of seconds while a hold is being placed, and the call
 * screen does near the end of the call: for the call's end (which moves when
 * time is added) and for a request for more time. The reading itself is
 * `liveFor`, which the phone app's address uses too.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/calls/[id]/live">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const live = await liveFor(user.id, id);
  if (!live) return Response.json({ error: "Call not found." }, { status: 404 });
  return Response.json(live, { headers: { "cache-control": "no-store" } });
}
