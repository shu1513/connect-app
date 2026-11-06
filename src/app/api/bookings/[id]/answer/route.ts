import { accept, BookingError, decline } from "@/lib/booking/bookings";
import { tryHoldForAcceptedBooking } from "@/lib/booking/jobs";
import { getUser } from "@/lib/session";

/**
 * The host answers an instant request from their live page: `{ answer: "accept" | "decline" }`.
 * Accepting books the call and tries the customer's saved card at once; the
 * answer carries the call's ID so the page can take the host there.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/bookings/[id]/answer">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Request not found." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { answer?: string };
  const now = new Date();
  try {
    if (body.answer === "decline") {
      await decline({ bookingId: id, hostId: user.id, now });
      return Response.json({ ok: true });
    }
    if (body.answer !== "accept") return Response.json({ error: "Say accept or decline." }, { status: 400 });
    const { callId } = await accept({ bookingId: id, hostId: user.id, now });
    // The customer is waiting: the saved card is tried right away, not at the helper's next pass.
    const hold = await tryHoldForAcceptedBooking(id, now).catch((error) => {
      console.error(`[now] the hold for booking ${id} could not be tried from the page; the helper will`, error);
      return "unknown" as const;
    });
    return Response.json({ ok: true, callId, hold });
  } catch (error) {
    if (error instanceof BookingError) return Response.json({ error: error.message }, { status: 409 });
    console.error("[now] could not answer an instant request", error);
    return Response.json({ error: "Something went wrong. Nothing was changed. Please try again." }, { status: 500 });
  }
}
