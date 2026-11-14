import { askForMoreTime, ExtendError } from "@/lib/extend/extend";
import { getUser } from "@/lib/session";

/** The customer asks for more time, from inside the call. The body is { minutes }. */
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/extend">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Call not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { minutes?: unknown } | null;
  try {
    // Only the call's customer can ask; anyone else gets "Call not found".
    const asked = await askForMoreTime({ callId: id, customerId: user.id, minutes: Number(body?.minutes) });
    return Response.json(asked);
  } catch (error) {
    if (error instanceof ExtendError) return Response.json({ error: error.message }, { status: error.message === "Call not found." ? 404 : 409 });
    console.error(`[more time] asking failed for call ${id}`, error);
    return Response.json({ error: "Something went wrong. Nothing was added. Please try again." }, { status: 500 });
  }
}
