import { bookingFor, BookingError, finishCardStep } from "@/lib/booking/bookings";
import { getUser } from "@/lib/session";

/**
 * The browser calls this after Stripe's card form finishes. What the browser
 * says is never trusted: the server asks Stripe whether the card was really
 * saved, checks everything again, and only then sends the request to the host.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/bookings/[id]/card-saved">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const found = await bookingFor(id, user.id);
  if (!found || found.role !== "customer") return Response.json({ error: "Request not found." }, { status: 404 });
  try {
    const booking = await finishCardStep({ bookingId: id, customerId: user.id, now: new Date() });
    return Response.json({ stage: booking.stage });
  } catch (error) {
    if (error instanceof BookingError) return Response.json({ error: error.message }, { status: 409 });
    console.error("[bookings] could not finish the card step", error);
    return Response.json({ error: "Could not check your card. Please try again." }, { status: 502 });
  }
}
