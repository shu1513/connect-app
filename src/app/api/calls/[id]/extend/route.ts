import { askForMoreTime, ExtendError, WayChanged } from "@/lib/extend/extend";
import { getUser } from "@/lib/session";

/**
 * The customer asks for more time, from inside the call. The body is { minutes }, and for a call
 * booked with a membership also what the screen showed: { shown: { paidFrom, priceCents } }.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/extend">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Call not found." }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { minutes?: unknown; shown?: { paidFrom?: unknown; priceCents?: unknown } } | null;
  const shown = body?.shown?.paidFrom === "membership" ? ({ paidFrom: "membership" } as const) : body?.shown?.paidFrom === "card" ? ({ paidFrom: "card", priceCents: Number(body.shown.priceCents) } as const) : undefined;
  try {
    // Only the call's customer can ask; anyone else gets "Call not found".
    const asked = await askForMoreTime({ callId: id, customerId: user.id, minutes: Number(body?.minutes), shown });
    return Response.json(asked);
  } catch (error) {
    // Nothing was asked and nothing is held: how it would be paid is no longer what the screen showed. The member presses again.
    if (error instanceof WayChanged) return Response.json({ error: error.message, changed: error.way }, { status: 409 });
    if (error instanceof ExtendError) return Response.json({ error: error.message }, { status: error.message === "Call not found." ? 404 : 409 });
    console.error(`[more time] asking failed for call ${id}`, error);
    return Response.json({ error: "Something went wrong. Nothing was added. Please try again." }, { status: 500 });
  }
}
