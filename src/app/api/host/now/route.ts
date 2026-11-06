import { BookingError } from "@/lib/booking/bookings";
import { liveForHost, setAvailableNow, stillHere } from "@/lib/booking/now";
import { getUser } from "@/lib/session";

/** What the host's "Available now" page shows; it asks every few seconds. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  return Response.json(await liveForHost(user.id, new Date()), { headers: { "cache-control": "no-store" } });
}

/**
 * Switching "available now" on (`{ minutes }`) or off (`{ minutes: null }`),
 * or the page saying it is still open (`{ heartbeat: true }`).
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  if (user.paused) return Response.json({ error: "Your account is paused." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { minutes?: number | null; heartbeat?: boolean };
  const now = new Date();
  try {
    if (body.heartbeat) return Response.json(await stillHere(user.id, now));
    const minutes = body.minutes === null ? null : Number(body.minutes);
    if (minutes !== null && !Number.isInteger(minutes)) return Response.json({ error: "Choose one of the offered durations." }, { status: 400 });
    return Response.json(await setAvailableNow({ hostId: user.id, minutes, now }));
  } catch (error) {
    if (error instanceof BookingError) return Response.json({ error: error.message }, { status: 409 });
    console.error("[now] could not change availability", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
