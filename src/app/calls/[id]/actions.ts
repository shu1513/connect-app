"use server";

import { redirect } from "next/navigation";
import { giveTimeBack } from "@/lib/membership/give-back";
import { withNotice } from "@/lib/notice";
import { callForParticipant, paymentToRefund } from "@/lib/payments/access";
import { recordAdminAction } from "@/lib/safety/audit";
import { refundPayment } from "@/lib/payments/actions";
import { refundAnswer, refundOutcome } from "@/lib/payments/founder-refund";
import { CALL_WORDS, cancelledWords } from "@/lib/call-page/words";
import { cancelCallWith, CancelChangedError } from "@/lib/payments/cancel";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { rateCall, RatingError } from "@/lib/ratings/ratings";
import { answerRequest, askForRefund, closeRequest, declineRequest, MESSAGE_MAX, RequestError } from "@/lib/refunds/requests";
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

  // What the page said cancelling would mean. If it has turned from free to charged since, nothing is cancelled.
  const shown = formData.get("shown");
  // A form that does not say what its page showed cancels nothing: the page is shown again, to be confirmed there.
  if (shown !== "free" && shown !== "late_charge") redirect(withNotice(`/calls/${callId}`, CALL_WORDS.cancelAskAgain));
  let notice: string;
  try {
    const done = await cancelCallWith({ call: access.call, payment: access.payment, by: access.role, now: new Date(), shown });
    notice = cancelledWords({ member: access.payment?.kind === "member_call", ...done });
  } catch (error) {
    // Back to the call's own page, which says what cancelling means now, to be confirmed again.
    if (error instanceof CancelChangedError) redirect(withNotice(`/calls/${callId}`, error.message));
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
  // The message to the customer that goes with the refund. They see it beside the refund and in the email about it.
  const reason = String(formData.get("reason") ?? "").replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX) || null;
  // Made when the form was shown. Sending the same form twice cannot refund twice.
  const requestId = String(formData.get("requestId") ?? "");

  // A refund by the founder needs a full admin login (second step included).
  const admin = await isAdminSession(await getSignedIn());
  const access = await callForParticipant(callId, user.id);
  const back = admin && !access ? "/admin" : `/calls/${callId}/results`;

  let notice: string;
  // What the admin record says about it: the amount the form named, until the refund's own line says otherwise.
  let recorded = `$${Number.isFinite(dollars) ? dollars.toFixed(2) : "?"}`;
  try {
    // The host of this very call, or the founder, and only for a payment that belongs to this call.
    const found = await paymentToRefund({ callId, paymentId, userId: user.id, adminLogin: admin });
    if (found === "not_allowed") throw new MoneyError("Only the host of this call can refund it.");
    if (found === "not_found") throw new MoneyError("Payment not found.");
    const { decidedAs } = found;
    if (!Number.isFinite(dollars) || dollars <= 0) throw new MoneyError("Enter an amount to refund.");
    if (found.payment.kind === "member_call") {
      // Paid from a membership: the time goes back into the membership, or its money to the member's card. Nothing is refunded at Stripe by this step.
      const to = await giveTimeBack({ paymentId, amountCents: Math.round(dollars * 100), decidedBy: user.id, decidedAs, reason, requestId });
      notice = to === "free" ? "The time was given back. It is in the member's membership again." : "The time was given back. Its money will be paid back to the member's card.";
    } else {
      await refundPayment({ paymentId, amountCents: Math.round(dollars * 100), decidedBy: user.id, decidedAs, reason, requestId });
      // What really came of it, read from what was written down: sent, still on its way, or refused by Stripe.
      const outcome = await refundOutcome(requestId);
      notice = outcome && outcome.paymentId !== paymentId ? "That form is no longer valid. Reload the page and try again." : refundAnswer(outcome, decidedAs === "admin" ? "founder" : "host");
      // For the admin record: the amount that was written down, and where it stands.
      if (outcome && outcome.paymentId === paymentId) recorded = `$${(outcome.amountCents / 100).toFixed(2)} (${outcome.status === "done" ? "given back" : outcome.status === "in_progress" ? "on its way" : "refused by Stripe"})`;
    }
    if (decidedAs === "admin") {
      await recordAdminAction({ adminId: user.id, action: "refund", targetId: paymentId, detail: recorded }).catch((error) => {
        console.error("[admin] a refund could not be written to the admin record", error);
        // What came of the refund stays as it was said; only this is added.
        notice = `${notice} It could not be written to the admin record: please note it by hand.`;
      });
    }
  } catch (error) {
    notice = message(error);
  }
  redirect(withNotice(back, notice));
}

// ---------------------------------------------------------------------------
// Refund requests
// ---------------------------------------------------------------------------

function requestProblem(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  console.error("[refunds] action failed", error);
  return "We could not confirm what happened. Reload this page to see where the request stands before trying again.";
}

/** The customer asks for a refund. Who they are comes from the login; the call, the reason and their sentence from the form. */
export async function askRefundAction(formData: FormData) {
  const user = await requireUser();
  const callId = String(formData.get("callId") ?? "");
  const page = `/calls/${callId}/results`;
  let to = page;
  let notice: string;
  try {
    const outcome = await askForRefund({
      callId,
      customerId: user.id,
      reason: String(formData.get("reason") ?? ""),
      note: String(formData.get("note") ?? ""),
      seen: formData.get("seen") ? String(formData.get("seen")) : null,
    });
    if (outcome === "changed") {
      // What is sent is what was seen: the record is shown again as it now stands.
      to = `${page}?ask=connection`;
      notice = "The connection record changed while you were looking at it (a late message from the video service). Nothing was sent. Here it is as it stands now: please look again and send your request if you still want to.";
    } else notice = "Your request was sent. The host has been told and decides. You will get an email with the answer.";
  } catch (error) {
    notice = requestProblem(error);
  }
  redirect(`${withNotice(to, notice)}#refund`);
}

/** Who is deciding: the host of this very call, or the founder with a full admin login. */
async function decider(callId: string): Promise<{ userId: string; as: "host" | "admin" } | null> {
  const user = await requireUser();
  const access = await callForParticipant(callId, user.id);
  if (access?.role === "host") return { userId: user.id, as: "host" };
  return (await isAdminSession(await getSignedIn())) ? { userId: user.id, as: "admin" } : null;
}

/** The answer before the money is taken: in full, less or nothing, for each charge. */
export async function answerRequestAction(formData: FormData) {
  const callId = String(formData.get("callId") ?? "");
  const who = await decider(callId);
  let notice: string;
  try {
    if (!who) throw new RequestError("Only the host of this call can answer.");
    const answers = [...formData.keys()]
      .filter((key) => key.startsWith("choice:"))
      .map((key) => {
        const paymentId = key.slice("choice:".length);
        const dollars = Number(formData.get(`max:${paymentId}`));
        return { paymentId, choice: String(formData.get(key)), maxCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : null };
      });
    if (who.as === "admin") await recordAdminAction({ adminId: who.userId, action: "refund request answered in the host's place", targetId: callId });
    await answerRequest({ callId, by: who.userId, as: who.as, answers, message: String(formData.get("message") ?? "") });
    notice = "Your answer was saved and the customer has been told. The payment below shows the amount once it has been applied.";
  } catch (error) {
    notice = requestProblem(error);
  }
  redirect(`${withNotice(`/calls/${callId}/results`, notice)}#refund`);
}

/** "No refund", after the money was taken. */
export async function declineRequestAction(formData: FormData) {
  const callId = String(formData.get("callId") ?? "");
  const who = await decider(callId);
  let notice: string;
  try {
    if (!who) throw new RequestError("Only the host of this call can answer.");
    if (who.as === "admin") await recordAdminAction({ adminId: who.userId, action: "refund request declined in the host's place", targetId: callId });
    await declineRequest({ callId, by: who.userId, as: who.as, message: String(formData.get("message") ?? "") });
    notice = "Your answer was saved and the customer has been told.";
  } catch (error) {
    notice = requestProblem(error);
  }
  redirect(`${withNotice(`/calls/${callId}/results`, notice)}#refund`);
}

/** The founder closes a request that the host never answered. */
export async function closeRequestAction(formData: FormData) {
  const callId = String(formData.get("callId") ?? "");
  const who = await decider(callId);
  let notice: string;
  try {
    if (who?.as !== "admin") throw new RequestError("Only Connect can close a request.");
    await recordAdminAction({ adminId: who.userId, action: "refund request closed", targetId: callId });
    await closeRequest({ callId, adminId: who.userId });
    notice = "The request was closed and the customer has been told.";
  } catch (error) {
    notice = requestProblem(error);
  }
  redirect(`${withNotice(`/calls/${callId}/results`, notice)}#refund`);
}
