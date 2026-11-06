import { callForParticipant } from "@/lib/payments/access";
import { endCallForSafety } from "@/lib/safety/calls";
import { getUser } from "@/lib/session";

/** "End call and report", pressed inside the call by either person. */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/end-for-safety">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });
  await endCallForSafety({ call: access.call, by: user.id, now: new Date() });
  return Response.json({ ok: true });
}
