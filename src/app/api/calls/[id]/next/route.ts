import { nextPartOf } from "@/lib/booking/instant";
import { callForParticipant, formatMoney } from "@/lib/payments/access";
import { syncHold } from "@/lib/payments/hold";
import { getUser } from "@/lib/session";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * The part 2 of this call, if more time was agreed: the call page asks every
 * few seconds, so both people see the offer, the payment and the move to the
 * next part without reloading. An unpaid part's hold is checked with Stripe
 * here too, so a card approved on the bank's own page is picked up on return.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/calls/[id]/next">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });

  let next = await nextPartOf(access.call.id);
  if (next?.status === "unpaid") {
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, next.id));
    if (payment?.stripePaymentIntentId) {
      await syncHold(payment.id, new Date()).catch(() => undefined);
      next = await nextPartOf(access.call.id);
    }
  }
  return Response.json({
    // The same shape the call page is first given (NextPartView in call-room.tsx).
    next: next ? { id: next.id, startsAt: next.startsAt.toISOString(), lengthMinutes: next.lengthMinutes, price: next.bookedCents > 0 ? formatMoney(next.bookedCents) : null, status: next.status } : null,
  });
}
