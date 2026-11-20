import { getUser } from "@/lib/session";
import { enterCall } from "@/lib/video/enter";

/**
 * The join check. Hands out an entry pass only to a logged-in person who is
 * on this call, only while the room is open, and for a paid call only while
 * the money is held. The check itself is `enterCall`, which the phone app's
 * address uses too.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/token">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const pass = await enterCall(user, id);
  if ("refused" in pass) return Response.json({ error: pass.refused.message }, { status: pass.refused.status });
  return Response.json(pass);
}
