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
  const state = await endCallForSafety({ call: access.call, by: user.id, now: new Date() });
  // A call that has not opened yet cannot be ended this way (it can be cancelled). One that is already
  // over needs no ending: the person goes on to the report form as usual.
  if (state === "not_open_yet") return Response.json({ error: "This call has not started yet." }, { status: 409 });
  return Response.json({ ok: true });
}
