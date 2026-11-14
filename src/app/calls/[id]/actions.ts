"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { callForParticipant, paymentToRefund } from "@/lib/payments/access";
import { recordAdminAction } from "@/lib/safety/audit";
import { refundPayment } from "@/lib/payments/actions";
import { cancelCall } from "@/lib/payments/cancel";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { rateCall, RatingError } from "@/lib/ratings/ratings";
import { getSignedIn, isAdminSession, requireUser } from "@/lib/session";

function message(error: unknown): string {
  if (error instanceof MoneyError) return error.message;
  if (error instanceof OutcomeUnknownError) return "That is still being confirmed with Stripe. Please check again in a minute.";
  console.error("[payments] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** The host or the customer cancels a call. */
export async function cancelCallAction(formData: FormData) {
  const user = await requireUser();
  const callId = String(formData.get("callId") ?? "");
  const access = await callForParticipant(callId, user.id);
  if (!access) redirect("/");

  let notice: string;
  try {
    const outcome = await cancelCall({ call: access.call, payment: access.payment, by: access.role, now: new Date() });
    notice =
      outcome === "late_charge"
        ? "The call was cancelled after the free period, so the booked price is charged."
        : "The call was cancelled. Nothing is charged.";
  } catch (error) {
    notice = message(error);
  }
  redirect(withNotice(`/calls/${callId}/results`, notice));
}

/** One person rates the other after a call. Only the call and the stars come from the browser; the rest is worked out on the server. */
export async function rateCallAction(formData: FormData) {
  const user = await requireUser();
  const callId = String(formData.get("callId") ?? "");
  let notice = "Thank you. Your rating was saved. The other person never sees what you gave.";
  try {
    await rateCall({ callId, raterId: user.id, stars: Number(formData.get("stars")), now: new Date() });
  } catch (error) {
    if (!(error instanceof RatingError)) console.error("[ratings] could not save a rating", error);
    notice = error instanceof RatingError ? error.message : "Something went wrong. Your rating was not saved. Please try again.";
  }
  redirect(withNotice(`/calls/${callId}/results`, notice));
}

/**
 * The host refunds all or part of a charge on their own call. An admin can do the same on any call.
 * A call can have more than one payment (its own, and one for each time more time was added), so the
 * form names the payment, and the server checks that it belongs to this call.
 */
export async function refundAction(formData: FormData) {
  const user = await requireUser();
  const callId = String(formData.get("callId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const dollars = Number(formData.get("amount"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  // Made when the form was shown. Sending the same form twice cannot refund twice.
  const requestId = String(formData.get("requestId") ?? "");

  // A refund by the founder needs a full admin login (second step included).
  const admin = await isAdminSession(await getSignedIn());
  const access = await callForParticipant(callId, user.id);
  const back = admin && !access ? "/admin" : `/calls/${callId}/results`;

  let notice: string;
  try {
    // The host of this very call, or the founder, and only for a payment that belongs to this call.
    const found = await paymentToRefund({ callId, paymentId, userId: user.id, adminLogin: admin });
    if (found === "not_allowed") throw new MoneyError("Only the host of this call can refund it.");
    if (found === "not_found") throw new MoneyError("Payment not found.");
    const { decidedAs } = found;
    if (!Number.isFinite(dollars) || dollars <= 0) throw new MoneyError("Enter an amount to refund.");
    await refundPayment({ paymentId, amountCents: Math.round(dollars * 100), decidedBy: user.id, decidedAs, reason, requestId });
    notice = "The refund was sent.";
    if (decidedAs === "admin") {
      await recordAdminAction({ adminId: user.id, action: "refund", targetId: paymentId, detail: `$${dollars.toFixed(2)}` }).catch((error) => {
        console.error("[admin] the refund went through but could not be written to the admin record", error);
        notice = "The refund was sent, but it could not be written to the admin record. Please note it by hand.";
      });
    }
  } catch (error) {
    notice = message(error);
  }
  redirect(withNotice(back, notice));
}
