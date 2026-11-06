/**
 * Cancelling a call, and what that does to its payment.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { capturePayment, releasePayment } from "./actions";
import { MoneyError } from "./operations";
import { cancellationOutcome } from "./rules";

/**
 * Cancels a call on behalf of its host or its customer.
 * Free before the host's cut-off; after it, the customer is charged the booked price.
 */
export async function cancelCall(input: {
  call: Call;
  payment: Payment | null;
  by: "host" | "customer";
  now: Date;
}): Promise<"free" | "late_charge"> {
  const { call, payment, by, now } = input;
  if (call.cancelledAt) throw new MoneyError("This call was already cancelled.");

  const outcome = cancellationOutcome({
    by,
    now,
    startsAt: call.startsAt,
    freeCancelMinutes: call.freeCancelMinutes,
    held: payment?.status === "held",
  });
  if (outcome === "not_allowed") throw new MoneyError("This call has started, so it can no longer be cancelled.");

  // Mark the call cancelled first, so nobody can join it. Only the first cancel wins.
  const marked = await db
    .update(schema.calls)
    .set({ cancelledAt: now, cancelledBy: by, cancelledLate: outcome === "late_charge" })
    .where(and(eq(schema.calls.id, call.id), isNull(schema.calls.cancelledAt), gt(schema.calls.startsAt, now)))
    .returning({ id: schema.calls.id });
  if (marked.length === 0) throw new MoneyError("This call can no longer be cancelled.");

  if (payment) {
    try {
      await settleCancelledCall({ ...call, cancelledAt: now, cancelledLate: outcome === "late_charge" }, payment);
    } catch (error) {
      // The call is cancelled either way. The always-on helper finishes the money side.
      console.error(`[payments] could not settle cancelled call ${call.id} yet; the helper will retry`, error);
    }
  }
  return outcome;
}

/**
 * The money side of a cancelled call: charge the booked price after a late
 * cancellation, otherwise let the hold go. Safe to run again.
 */
export async function settleCancelledCall(call: Call, payment: Payment): Promise<void> {
  if (payment.status !== "awaiting_payment" && payment.status !== "held") return;
  if (call.cancelledLate && payment.status === "held") {
    await capturePayment({
      paymentId: payment.id,
      amountCents: payment.bookedCents,
      reason: "late_cancel",
      frozen: null,
      callEndsAt: call.endsAt,
    });
  } else {
    await releasePayment({ paymentId: payment.id, note: "The call was cancelled." });
  }
}
