import { syncPayment } from "@/lib/contributions/charge";
import { contributionFor } from "@/lib/contributions/start";
import { getUser } from "@/lib/session";

/**
 * Asks Stripe for the real state of a contribution's payment and records it. The card form calls
 * this after Stripe answered in the page, and again when the contributor comes back from their
 * bank's own approval page or reloads. Nothing the browser says is believed: not what the form
 * thinks happened, and nothing in the address the bank sent the person back to.
 *
 * For the contributor of that contribution only, always, also after the card step has closed:
 * someone coming back after the helper finished the payment must still be told what became of it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/contributions/[id]/sync">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { payment?: unknown } | null;
  const found = await contributionFor(user.id, id);
  const payment = found?.payments.find((one) => one.id === (typeof body?.payment === "string" ? body.payment.toLowerCase() : ""));
  // Someone else's payment, one of another contribution and one that does not exist all look the same.
  if (!payment) return Response.json({ error: "Contribution not found." }, { status: 404 });

  try {
    const after = await syncPayment(payment.id, new Date());
    return Response.json({ status: after.status, ended: Boolean(after.endedHow), needsAction: after.needsAction });
  } catch (error) {
    console.error("[contributions] could not check a payment", error);
    return Response.json({ error: "Could not check the payment. Please try again." }, { status: 502 });
  }
}
