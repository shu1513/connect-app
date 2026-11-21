import { startPaymentFor } from "@/lib/payments/steps";
import { getUser } from "@/lib/session";

/** Starts the customer's confirm-and-pay step. Returns what the browser needs to show Stripe's card form. */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/payment/start">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  // The work is in one function, which the phone app's address calls too (src/lib/payments/steps.ts).
  const started = await startPaymentFor(user, id, new Date());
  if ("refused" in started) return Response.json({ error: started.refused.message }, { status: started.refused.status });
  return Response.json(started);
}
