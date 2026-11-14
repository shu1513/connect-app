import { addTimeChoices, extensionView } from "@/lib/extend/extend";
import { WATCH_SECONDS } from "@/lib/extend/rules";
import { callForParticipant } from "@/lib/payments/access";
import { getUser } from "@/lib/session";

/**
 * Where a call stands, from our own record (no call to Stripe). The call page
 * asks every couple of seconds while a hold is being placed, and the call
 * screen does near the end of the call: for the call's end (which moves when
 * time is added) and for a request for more time.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/calls/[id]/live">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Call not found." }, { status: 404 });
  const access = await callForParticipant(id, user.id);
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });
  const { call, payment, role } = access;

  const now = new Date();
  // Requests for more time only exist near the end of a call, so they are only looked up then.
  const running = !call.cancelledAt && !call.safetyEndedAt && now >= call.startsAt;
  const nearEnd = running && call.endsAt.getTime() - now.getTime() <= (WATCH_SECONDS + 30) * 1000;
  const requests = nearEnd ? await extensionView(call.id) : { open: null, last: null };
  const addTime = nearEnd && role === "customer" && now < call.endsAt ? await addTimeChoices(call) : null;

  return Response.json(
    {
      paymentStatus: payment?.status ?? null,
      cancelled: call.cancelledAt !== null,
      safetyEnded: call.safetyEndedAt !== null,
      endsAt: call.endsAt.toISOString(),
      serverNow: new Date().toISOString(),
      extension: requests.open,
      lastExtension: requests.last,
      addTime,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
