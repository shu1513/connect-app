"use server";

import { redirect } from "next/navigation";
import { callForParticipant, isAdmin } from "@/lib/payments/access";
import { refundPayment } from "@/lib/payments/actions";
import { cancelCall } from "@/lib/payments/cancel";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { requireUser } from "@/lib/session";

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
  redirect(`/calls/${callId}/results?notice=${encodeURIComponent(notice)}`);
}

/** The host refunds all or part of a charge on their own call. An admin can do the same on any call. */
export async function refundAction(formData: FormData) {
  const user = await requireUser();
  const callId = String(formData.get("callId") ?? "");
  const dollars = Number(formData.get("amount"));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const admin = await isAdmin(user.id);
  const access = await callForParticipant(callId, user.id);
  const back = admin && !access ? "/admin" : `/calls/${callId}/results`;

  let notice: string;
  try {
    let paymentId: string;
    let decidedAs: "host" | "admin";
    if (access?.role === "host" && access.payment) {
      paymentId = access.payment.id;
      decidedAs = "host";
    } else if (admin) {
      const { db, schema } = await import("@/db");
      const { eq } = await import("drizzle-orm");
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, callId));
      if (!payment) throw new MoneyError("Payment not found.");
      paymentId = payment.id;
      decidedAs = "admin";
    } else {
      throw new MoneyError("Only the host of this call can refund it.");
    }
    if (!Number.isFinite(dollars) || dollars <= 0) throw new MoneyError("Enter an amount to refund.");
    await refundPayment({ paymentId, amountCents: Math.round(dollars * 100), decidedBy: user.id, decidedAs, reason });
    notice = "The refund was sent.";
  } catch (error) {
    notice = message(error);
  }
  redirect(`${back}?notice=${encodeURIComponent(notice)}`);
}
