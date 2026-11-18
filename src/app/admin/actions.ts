"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { decideMemberReview } from "@/lib/membership/calls";
import { withNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { capturePayment, releasePayment } from "@/lib/payments/actions";
import { collectForClosedHost, lastCollectionOf } from "@/lib/payments/collect";
import { reviewChargeLimitCents } from "@/lib/payments/pricing";
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
    const maxCents = reviewChargeLimitCents({ pricePer15Cents: payment.pricePer15Cents, coversFrom: payment.coversFrom, coversUntil: payment.coversUntil, callEndsAt: call.endsAt, safetyEndedAt: call.safetyEndedAt });
    if (payment.kind === "member_call") {
      // Booked from a membership: the amount is used from what was set aside in the month, with the same ceilings. Nothing is asked of Stripe.
      await decideMemberReview({ paymentId: payment.id, amountCents: Math.round(dollars * 100), maxCents, frozen: null, now: new Date() });
      notice = "The amount was used from the member's membership time. The rest came back to the member.";
    } else {
      const result = await capturePayment({
        paymentId: payment.id,
        amountCents: Math.round(dollars * 100),
        reason: "admin",
        frozen: null,
        callEndsAt: call.endsAt,
        maxCents,
      });
      notice = result === "already_done" ? "This call had already been charged. Nothing more was charged." : "The charge was made.";
    }
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
    if (payment.kind === "member_call") {
      await decideMemberReview({ paymentId: payment.id, amountCents: null, frozen: null, now: new Date() });
      notice = "Nothing was used. The time set aside came back to the member.";
    } else {
      await releasePayment({ paymentId: payment.id, note: "Released after a review. Nothing was charged." });
      notice = "The hold was released. Nothing was charged.";
    }
  } catch (error) {
    notice = message(error);
  }
  back(notice);
}

/**
 * A host whose account is closed cannot log in to collect. The founder runs a final collection
 * for them: the same rules and the same record as a host's own press, to the host's own payout account.
 */
export async function finalCollection(formData: FormData) {
  const admin = await requireAdmin();
  const hostId = String(formData.get("hostId") ?? "");
  const collectionId = String(formData.get("collectionId") ?? "");
  let notice: string;
  try {
    await recordAdminAction({ adminId: admin.id, action: "final collection for a closed account", targetUserId: hostId, targetId: collectionId });
    await collectForClosedHost({ collectionId, hostId, adminId: admin.id });
    const result = (await lastCollectionOf(hostId))?.last;
    notice = result
      ? `The collection was accepted. Sent to the host's Stripe payout account: ${formatMoney(result.sentCents)}. Being checked: ${formatMoney(result.checkingCents)}. Could not be sent: ${formatMoney(result.refusedCents)}.`
      : "The collection was accepted.";
  } catch (error) {
    // Only a MoneyError means nothing was accepted. Anything else may have happened after acceptance.
    if (error instanceof MoneyError) notice = `${error.message} Nothing was sent.`;
    else {
      console.error("[payments] final collection failed", error);
      notice = "We could not confirm what happened. Look at the list of money not yet collected before trying again.";
    }
  }
  back(notice);
}
