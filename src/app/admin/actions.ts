"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { withNotice } from "@/lib/notice";
import { capturePayment, releasePayment } from "@/lib/payments/actions";
import { bookedTotalCents } from "@/lib/payments/pricing";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { recordAdminAction } from "@/lib/safety/audit";
import { requireAdmin } from "@/lib/session";

function back(notice: string): never {
  redirect(withNotice("/admin", notice));
}

function message(error: unknown): string {
  if (error instanceof MoneyError) return error.message;
  if (error instanceof OutcomeUnknownError) return "That is still being confirmed with Stripe. Please check again in a minute.";
  console.error("[payments] admin action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

async function reviewedPayment(formData: FormData) {
  const admin = await requireAdmin();
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) back("Payment not found.");
  const [row] = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(eq(schema.payments.id, paymentId));
  if (!row) back("Payment not found.");
  return { ...row, admin };
}

/** The founder decides the amount for a call that needed review. */
export async function chargeReviewed(formData: FormData) {
  const { payment, call, admin } = await reviewedPayment(formData);
  const dollars = Number(formData.get("amount"));
  let notice: string;
  try {
    if (!Number.isFinite(dollars) || dollars <= 0) throw new MoneyError("Enter an amount to charge.");
    await recordAdminAction({ adminId: admin.id, action: "payment charged after review", targetUserId: call.customerId, targetId: payment.id, detail: `$${dollars.toFixed(2)}` });
    // A call stopped with "End call and report" can only be charged for the time before the stop,
    // and each payment only for the stretch of the call it pays for.
    const stoppedAt = call.safetyEndedAt && call.safetyEndedAt < call.endsAt ? call.safetyEndedAt : call.endsAt;
    const countedUntil = stoppedAt < payment.coversUntil ? stoppedAt : payment.coversUntil;
    const maxCents = bookedTotalCents(payment.pricePer15Cents, Math.max(0, Math.floor((countedUntil.getTime() - payment.coversFrom.getTime()) / 1000)));
    const result = await capturePayment({
      paymentId: payment.id,
      amountCents: Math.round(dollars * 100),
      reason: "admin",
      frozen: null,
      callEndsAt: call.endsAt,
      maxCents,
    });
    notice = result === "already_done" ? "This call had already been charged. Nothing more was charged." : "The charge was made.";
  } catch (error) {
    notice = message(error);
  }
  back(notice);
}

/** The founder releases the hold for a call that needed review. Nothing is charged. */
export async function releaseReviewed(formData: FormData) {
  const { payment, call, admin } = await reviewedPayment(formData);
  let notice: string;
  try {
    await recordAdminAction({ adminId: admin.id, action: "hold released after review", targetUserId: call.customerId, targetId: payment.id });
    await releasePayment({ paymentId: payment.id, note: "Released after a review. Nothing was charged." });
    notice = "The hold was released. Nothing was charged.";
  } catch (error) {
    notice = message(error);
  }
  back(notice);
}
