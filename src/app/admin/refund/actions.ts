"use server";

import { redirect } from "next/navigation";
import { refundPayment } from "@/lib/payments/actions";
import { formatMoney } from "@/lib/payments/access";
import { isRefundGround, refundOutcome, refundReason, refundSearchFor } from "@/lib/payments/founder-refund";
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
  if (sentence.length < 10) back("Add a sentence of your own about what happened: the host reads it.");
  if (sentence.length > 1000) back("Please keep your sentence under 1,000 characters.");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(typed)) back("Type the amount in dollars, like 12.50.");
  const amountCents = Math.round(Number(typed) * 100);
  // Whatever the call below says or throws, the answer is read from what was written down: a refund that was begun
  // has its line, and the line says whether it was paid back, is on its way, or was refused.
  let said: string | null = null;
  try {
    await refundPayment({ paymentId, amountCents, decidedBy: admin.id, decidedAs: "admin", reason: refundReason(ground as Parameters<typeof refundReason>[0], sentence), afterCollection: true, requestId });
  } catch (error) {
    if (error instanceof MoneyError) said = error.message;
    else if (!(error instanceof OutcomeUnknownError)) console.error("[refunds] the founder's refund failed", error);
  }
  const outcome = await refundOutcome(requestId);
  const amount = formatMoney(amountCents);
  // No line: nothing was begun and nothing was asked of Stripe.
  if (!outcome) back(said ?? "No refund was started: another money action on this payment is still being confirmed with Stripe, or something went wrong before anything was sent. Nothing was given back. Look at the payment again in a minute.");
  else if (outcome.status === "failed") back(`Stripe refused the refund of ${amount}${said ? ` (${said})` : ""}. Nothing was given back. You can try again.`);
  else if (outcome.status === "in_progress") back(`The refund of ${amount} is on its way: Stripe has accepted it and has not confirmed it yet. The app finishes it by itself.${outcome.afterCollection ? " What the host owes is worked out once it is confirmed." : ""}`);
  else if (!outcome.afterCollection) back(`${amount} was given back to the customer. The host had not collected this share, so nobody owes anything.`);
  else back(`${amount} was given back to the customer from Connect's money. The host's share shrank by ${formatMoney(outcome.hostOwesCents)}; within a minute the app works out what the host owes and tells them. It is listed under "Money hosts owe back".`);
}
