import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { callPageFor } from "@/lib/app-door/calls";
import type { AppPayStep } from "@/lib/app-door/types";
import { cancelledWords } from "@/lib/call-page/words";
import { callForParticipant } from "@/lib/payments/access";
import { cancelCall } from "@/lib/payments/cancel";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { startPaymentFor, syncPaymentFor, type StepRefused } from "@/lib/payments/steps";

/** A refusal of one of the shared pay steps, as the door says it: "not found" stays "not found", everything else carries its sentence. */
function refusalOf(step: StepRefused): Response {
  // "Only the customer can pay" is the other person's step: for the one asking there is no such thing here.
  return step.refused.status === 404 || step.refused.status === 403 ? refuse("not_found") : refuse("not_valid", step.refused.message);
}

/**
 * What a person does on a call's page before the call, from the phone app
 * (plans/45-phone-apps/08-the-calls-page.md), on the very functions the website uses:
 *
 *   POST /api/app/calls/[id]/pay         the customer's confirm-and-pay: what Stripe's sheet needs to place the
 *                                        hold, or, when the money is held already, the page as it stands
 *   POST /api/app/calls/[id]/pay-check   the server asks Stripe where the hold stands, and answers with the page
 *   POST /api/app/calls/[id]/cancel      { shown: "free" | "late_charge" }: cancel the call. What the person was
 *                                        shown goes with it: if cancelling has turned from free to charged
 *                                        meanwhile, nothing is cancelled
 *
 * Who is asking comes from the sign-in. A call that does not exist, one that is somebody else's, and a
 * step that is the other person's are the same "not found". What the app says happened in Stripe's
 * sheet is never believed, and nothing here takes money: a hold is a hold.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/app/calls/[id]/[step]">) {
  const { id, step } = await ctx.params;
  if (step !== "pay" && step !== "pay-check" && step !== "cancel") {
    const anyone = await appRequest(request, "anyone");
    return anyone instanceof Response ? anyone : refuse("not_found");
  }
  // Placing a hold is for someone who may act. Finding out where a hold stands, and cancelling, are also for a
  // paused person, as on the website.
  const asked = await appRequest(request, step === "pay" ? "active" : "member");
  if (asked instanceof Response) return asked;
  const me = asked.person!;
  const page = async (notice: string | null = null) => {
    const body = await callPageFor(me, id, new Date(), notice);
    return body ? answer(body) : refuse("not_found");
  };

  if (step === "pay") {
    const started = await startPaymentFor(me, id, new Date());
    if ("refused" in started) return refusalOf(started);
    if ("alreadyHeld" in started) return page();
    const body: AppPayStep = { clientSecret: started.clientSecret, publishableKey: started.publishableKey, merchant: "Connect" };
    return answer(body);
  }

  if (step === "pay-check") {
    const checked = await syncPaymentFor(me.id, id, new Date());
    // A free call has no payment to ask about: its page is simply read.
    if ("refused" in checked && checked.refused.status !== 404) return refusalOf(checked);
    return page();
  }

  const sent: unknown = await request.json().catch(() => null);
  const shown = (sent !== null && typeof sent === "object" ? (sent as { shown?: unknown }).shown : undefined) as unknown;
  // What cancelling was said to mean always comes with the press.
  if (shown !== "free" && shown !== "late_charge") return refuse("not_valid");
  const access = await callForParticipant(id, me.id);
  if (!access) return refuse("not_found");
  try {
    const outcome = await cancelCall({ call: access.call, payment: access.payment, by: access.role, now: new Date(), shown });
    return page(cancelledWords({ member: access.payment?.kind === "member_call", outcome }));
  } catch (error) {
    if (error instanceof MoneyError) return refuse("not_valid", error.message);
    if (error instanceof OutcomeUnknownError) return refuse("not_valid", "That is still being confirmed with Stripe. Please check again in a minute.");
    console.error("[payments] could not cancel a call for the app", error);
    return refuse("not_valid", "Something went wrong. Nothing was changed. Please try again.");
  }
}
