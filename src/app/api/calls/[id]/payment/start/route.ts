import { callForParticipant } from "@/lib/payments/access";
import { startHold } from "@/lib/payments/hold";
import { MoneyError } from "@/lib/payments/operations";
import { stripePublishableKey } from "@/lib/payments/stripe";
import { getUser } from "@/lib/session";

/** Starts the customer's confirm-and-pay step. Returns what the browser needs to show Stripe's card form. */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/payment/start">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  if (!access || !access.payment) return Response.json({ error: "Call not found." }, { status: 404 });
  if (access.role !== "customer") return Response.json({ error: "Only the customer can pay for this call." }, { status: 403 });

  try {
    const started = await startHold({ payment: access.payment, call: access.call, customer: user, now: new Date() });
    if ("alreadyHeld" in started) return Response.json({ alreadyHeld: true });
    return Response.json({ clientSecret: started.clientSecret, publishableKey: stripePublishableKey() });
  } catch (error) {
    if (error instanceof MoneyError) return Response.json({ error: error.message }, { status: 409 });
    console.error("[payments] could not start a hold", error);
    return Response.json({ error: "Payment could not be started. Please try again." }, { status: 502 });
  }
}
