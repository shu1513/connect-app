import { callForParticipant } from "@/lib/payments/access";
import { cancelCall } from "@/lib/payments/cancel";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { getUser } from "@/lib/session";

/**
 * Cancelling from inside a call page, without leaving it: a host withdraws the
 * more time they offered, or a customer declines it. The same rules as the
 * cancel button (module 2) apply; a part 2 is free to cancel until it starts.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/cancel">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });
  try {
    const outcome = await cancelCall({ call: access.call, payment: access.payment, by: access.role, now: new Date() });
    return Response.json({ outcome });
  } catch (error) {
    if (error instanceof MoneyError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof OutcomeUnknownError) return Response.json({ error: "That is still being confirmed with Stripe. Please try again in a minute." }, { status: 409 });
    console.error(`[calls] could not cancel call ${access.call.id} from the call page`, error);
    return Response.json({ error: "Could not cancel just now. Please try again." }, { status: 502 });
  }
}
