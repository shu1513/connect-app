import { callForParticipant } from "@/lib/payments/access";
import { syncHold } from "@/lib/payments/hold";
import { getUser } from "@/lib/session";

/**
 * Asks Stripe for the real state of this call's hold and records it.
 * The browser calls this after the card form finishes; what the browser
 * claims is never trusted.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/payment/sync">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  if (!access || !access.payment) return Response.json({ error: "Call not found." }, { status: 404 });

  try {
    const payment = await syncHold(access.payment.id, new Date());
    return Response.json({ status: payment.status });
  } catch (error) {
    console.error("[payments] could not check a hold", error);
    return Response.json({ error: "Could not check the payment. Please try again." }, { status: 502 });
  }
}
