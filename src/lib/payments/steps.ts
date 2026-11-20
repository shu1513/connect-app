/**
 * The two steps of the customer's confirm-and-pay, each as one function that is handed the person
 * asking (plans/45-phone-apps/08-the-calls-page.md, decision 1). The website's addresses and the
 * phone app's addresses both call them, so there is one copy of the work: who may pay, what is
 * refused and in which words. Nothing here takes money: a hold is placed by Stripe when the
 * customer confirms in Stripe's own form, and what a browser or a phone says happened is never
 * believed.
 */
import { CALL_WORDS } from "@/lib/call-page/words";
import { callForParticipant } from "./access";
import { startHold, syncHold } from "./hold";
import { MoneyError } from "./operations";
import { stripePublishableKey } from "./stripe";

/** A step that was refused: the sentence to show, and how the website's address numbers it. */
export type StepRefused = { refused: { status: 403 | 404 | 409 | 502; message: string } };
const refused = (status: 403 | 404 | 409 | 502, message: string): StepRefused => ({ refused: { status, message } });

/** Starts (or takes up again) the hold for a paid call: what Stripe's card form needs, or that the money is held already. */
export async function startPaymentFor(user: { id: string; name: string; email: string }, callId: string, now: Date): Promise<StepRefused | { alreadyHeld: true } | { clientSecret: string; publishableKey: string }> {
  const access = await callForParticipant(callId, user.id);
  if (!access || !access.payment) return refused(404, CALL_WORDS.notFound);
  if (access.role !== "customer") return refused(403, CALL_WORDS.payOnlyCustomer);
  // A call booked with a membership is paid from the member's month: there is no card step for it.
  if (access.payment.kind === "member_call") return refused(409, CALL_WORDS.payFromMembership);
  try {
    const started = await startHold({ payment: access.payment, call: access.call, customer: user, now });
    if ("alreadyHeld" in started) return { alreadyHeld: true };
    return { clientSecret: started.clientSecret, publishableKey: stripePublishableKey() };
  } catch (error) {
    if (error instanceof MoneyError) return refused(409, error.message);
    console.error("[payments] could not start a hold", error);
    return refused(502, CALL_WORDS.payNotStarted);
  }
}

/** Asks Stripe for the real state of this call's hold and records it. Answers with where the payment stands. */
export async function syncPaymentFor(userId: string, callId: string, now: Date): Promise<StepRefused | { status: string }> {
  const access = await callForParticipant(callId, userId);
  if (!access || !access.payment) return refused(404, CALL_WORDS.notFound);
  // A call booked with a membership has no hold at Stripe to ask about: its money is set aside in the member's month.
  if (access.payment.kind === "member_call") return { status: access.payment.status };
  try {
    const payment = await syncHold(access.payment.id, now);
    return { status: payment.status };
  } catch (error) {
    console.error("[payments] could not check a hold", error);
    return refused(502, CALL_WORDS.payNotChecked);
  }
}
