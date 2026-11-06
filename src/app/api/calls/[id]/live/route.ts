import { callForParticipant } from "@/lib/payments/access";
import { getUser } from "@/lib/session";

/** Where a call's payment stands, from our own record (no call to Stripe): the call page asks every couple of seconds while a hold is being placed. */
export async function GET(_request: Request, ctx: RouteContext<"/api/calls/[id]/live">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Call not found." }, { status: 404 });
  const access = await callForParticipant(id, user.id);
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });
  return Response.json(
    { paymentStatus: access.payment?.status ?? null, cancelled: access.call.cancelledAt !== null, safetyEnded: access.call.safetyEndedAt !== null },
    { headers: { "cache-control": "no-store" } },
  );
}
