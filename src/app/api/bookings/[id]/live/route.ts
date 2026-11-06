import { liveForCustomer } from "@/lib/booking/now";
import { getUser } from "@/lib/session";

/** Where a customer's instant request stands; their waiting page asks every couple of seconds. */
export async function GET(_request: Request, ctx: RouteContext<"/api/bookings/[id]/live">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Request not found." }, { status: 404 });
  const live = await liveForCustomer(id, user.id);
  if (!live) return Response.json({ error: "Request not found." }, { status: 404 });
  return Response.json(live, { headers: { "cache-control": "no-store" } });
}
