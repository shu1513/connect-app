import { BookingError } from "@/lib/booking/bookings";
import { offerMoreTime } from "@/lib/booking/instant";
import { callForParticipant } from "@/lib/payments/access";
import { getUser } from "@/lib/session";

/** The host offers more time on a running call: a part 2 that starts when this one ends. */
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/extend">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  if (user.paused) return Response.json({ error: "Your account is paused." }, { status: 403 });
  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });
  if (access.role !== "host") return Response.json({ error: "Only the host can offer more time." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { lengthMinutes?: unknown };
  const lengthMinutes = Number(body.lengthMinutes);
  try {
    const { callId } = await offerMoreTime({ call: access.call, hostId: user.id, lengthMinutes, now: new Date() });
    return Response.json({ callId });
  } catch (error) {
    if (error instanceof BookingError) return Response.json({ error: error.message }, { status: 409 });
    console.error(`[instant] could not offer more time on call ${access.call.id}`, error);
    return Response.json({ error: "Could not offer more time just now. Please try again." }, { status: 502 });
  }
}
