import { maySeePayment } from "@/lib/membership/access";
import { syncMonth } from "@/lib/membership/charge";
import { getUser } from "@/lib/session";

/**
 * Asks Stripe for the real state of a membership month's payment and records it. The card form
 * calls this after Stripe answered in the page, and again when the member comes back from their
 * bank's own approval page or reloads. Nothing the browser says is believed: not what the form
 * thinks happened, and nothing in the address the bank sent the member back to.
 *
 * For the member of that month, always, also after the payment step has closed: someone coming
 * back after the helper finished the payment must still be told what became of it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/memberships/[id]/sync">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { month?: unknown } | null;
  const month = await maySeePayment(user.id, typeof body?.month === "string" ? body.month : "");
  // Someone else's month, one of another membership and one that does not exist all look the same.
  if (!month || month.membershipId !== id.toLowerCase()) return Response.json({ error: "Membership not found." }, { status: 404 });

  try {
    const after = await syncMonth(month.id, new Date());
    return Response.json({ status: after.status, ended: Boolean(after.endedHow), needsAction: after.needsAction });
  } catch (error) {
    console.error("[membership] could not check a month's payment", error);
    return Response.json({ error: "Could not check the payment. Please try again." }, { status: 502 });
  }
}
