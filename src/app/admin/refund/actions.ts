"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { giveTimeBack } from "@/lib/membership/give-back";
import { refundPayment } from "@/lib/payments/actions";
import { isRefundGround, refundAnswer, refundOutcome, refundReason, refundSearchFor } from "@/lib/payments/founder-refund";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { withNotice } from "@/lib/notice";
import { requireAdmin } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds the payments for what the founder typed, and shows them at an address that holds no email address. */
export async function findForRefundAction(formData: FormData) {
  await requireAdmin();
  const search = await refundSearchFor(String(formData.get("q") ?? ""));
  if (!search) redirect(withNotice("/admin/refund", "No call and no account was found for that. Type a call's id, or the email address of the customer's account."));
  redirect("callId" in search ? `/admin/refund?call=${encodeURIComponent(search.callId)}` : `/admin/refund?customer=${encodeURIComponent(search.customerId)}`);
}

/**
 * The founder refunds a call's payment, in full or in part, also after the host has collected (plans/46-part-3,
 * decisions 9 to 11). Always as the founder, with one of the grounds the Host Agreement names and a sentence. The
 * answer says what really came of it at Stripe; what the host owes is written by the helper once the refund is
 * confirmed, and the host is told then.
 */
export async function refundAsFounderAction(formData: FormData) {
  const admin = await requireAdmin();
  // Back to the same result: only the two addresses the page itself makes.
  const where = String(formData.get("where") ?? "");
  const back = (notice: string): never => redirect(withNotice(/^(call|customer)=[A-Za-z0-9_%.-]{1,100}$/.test(where) ? `/admin/refund?${where}` : "/admin/refund", notice));
  const paymentId = String(formData.get("payment") ?? "");
  const requestId = String(formData.get("request") ?? "");
  const ground = String(formData.get("ground") ?? "");
  const sentence = String(formData.get("sentence") ?? "").trim();
  const typed = String(formData.get("amount") ?? "").trim();
  if (!UUID.test(paymentId) || !UUID.test(requestId)) back("That form is no longer valid. Reload the page and try again.");
  if (!isRefundGround(ground)) back("Choose why Connect decides this refund.");
  if (sentence.length < 10) back("Add a sentence of your own about what happened: the customer and the host read it.");
  if (sentence.length > 1000) back("Please keep your sentence under 1,000 characters.");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(typed)) back("Type the amount in dollars, like 12.50.");
  const amountCents = Math.round(Number(typed) * 100);
  // Whatever the call below says or throws, the answer is read from what was written down: a refund that was begun
  // has its line, and the line says whether it was paid back, is on its way, or was refused.
  let said: string | null = null;
  try {
    const reason = refundReason(ground as Parameters<typeof refundReason>[0], sentence);
    // What kind of payment it is decides the way, never the form: a member's call is paid from a membership's month,
    // and what is given back is its time (plans/50-part-2-member-time-owed-back.md).
    const [found] = await db.select({ kind: schema.payments.kind }).from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (found?.kind === "member_call") {
      // The form says whether the host had collected when it was drawn: a press never has an outcome its form did not show.
      const shown = formData.get("collected");
      if (shown !== "yes" && shown !== "no") throw new MoneyError("That form is no longer valid. Reload the page and try again.");
      await giveTimeBack({ paymentId, amountCents, decidedBy: admin.id, decidedAs: "admin", reason, requestId, afterCollection: true, shownCollected: shown === "yes" });
    } else {
      await refundPayment({ paymentId, amountCents, decidedBy: admin.id, decidedAs: "admin", reason, afterCollection: true, requestId });
    }
  } catch (error) {
    if (error instanceof MoneyError) said = error.message;
    else if (!(error instanceof OutcomeUnknownError)) console.error("[refunds] the founder's refund failed", error);
  }
  // Once the request was begun, "nothing happened" is never said without reading what was written down. If that
  // cannot be read just now, the answer is that it is not known: look before trying again.
  const outcome = await refundOutcome(requestId).catch((error) => {
    console.error("[refunds] what came of a refund could not be read", error);
    return back("The refund was asked for, and what came of it could not be read just now. Look at the payment before you try again: it may have gone through.");
  });
  // A request's number belongs to one payment: a form sent again with another payment's number is not answered with
  // that other refund's outcome.
  if (outcome && outcome.paymentId !== paymentId) back("That form is no longer valid. Reload the page and try again.");
  back(refundAnswer(outcome, "founder", said));
}
