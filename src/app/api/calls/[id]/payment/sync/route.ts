import { syncPaymentFor } from "@/lib/payments/steps";
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
  // The work is in one function, which the phone app's address calls too (src/lib/payments/steps.ts).
  const checked = await syncPaymentFor(user.id, id, new Date());
  if ("refused" in checked) return Response.json({ error: checked.refused.message }, { status: checked.refused.status });
  return Response.json(checked);
}
