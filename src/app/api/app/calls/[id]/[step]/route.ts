import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { callPageFor } from "@/lib/app-door/calls";
import type { AppEnded, AppPass, AppPayStep } from "@/lib/app-door/types";
import { cancelledWords } from "@/lib/call-page/words";
import { callForParticipant } from "@/lib/payments/access";
import { cancelCallWith } from "@/lib/payments/cancel";
import { MoneyError, OutcomeUnknownError } from "@/lib/payments/operations";
import { startPaymentFor, syncPaymentFor, type StepRefused } from "@/lib/payments/steps";
import { endCallForSafetyConfirmed } from "@/lib/safety/calls";
import { enterCall } from "@/lib/video/enter";

/**
 * "It cannot be told just now what became of this step": said as the server not being reached (no answer of the
 * door's at all), never as a refusal. The app then reads the call's page again, which shows where things stand.
 */
function notKnown(): Response {
  return new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } });
}

/** A refusal of one of the shared pay steps, as the door says it: "not found" stays "not found", a refusal carries its sentence. */
function refusalOf(step: StepRefused): Response {
  // Stripe could not be asked: nothing was decided, so nothing is refused.
  if (step.refused.status === 502) return notKnown();
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
 * And of the call itself (plans/45-phone-apps/09-the-call.md):
 *
 *   POST /api/app/calls/[id]/enter           the entry pass to the call's room, by the one join check the website
 *                                            uses: only for a person of this call, only while the room is open and,
 *                                            for a paid call, the money is held
 *   POST /api/app/calls/[id]/end-and-report  "End call and report": the call is ended for both, at once
 *
 * Who is asking comes from the sign-in. A call that does not exist, one that is somebody else's, and a
 * step that is the other person's are the same "not found". What the app says happened in Stripe's
 * sheet is never believed, and nothing here takes money: a hold is a hold.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/app/calls/[id]/[step]">) {
  const { id, step } = await ctx.params;
  if (step !== "pay" && step !== "pay-check" && step !== "cancel" && step !== "enter" && step !== "end-and-report") {
    const anyone = await appRequest(request, "anyone");
    return anyone instanceof Response ? anyone : refuse("not_found");
  }
  // Placing a hold is for someone who may act. Finding out where a hold stands, and cancelling, are also for a
  // paused person, as on the website.
  // Entering a call is for someone who may act too. Ending a call one is in, and reporting, is for everyone.
  const asked = await appRequest(request, step === "pay" || step === "enter" ? "active" : "member");
  if (asked instanceof Response) return asked;
  const me = asked.person!;
  const page = async (notice: string | null = null) => {
    const body = await callPageFor(me, id, new Date(), notice);
    return body ? answer(body) : refuse("not_found");
  };

  if (step === "enter") {
    // (A paused person was turned away at the door, in the door's own sentence. The join check looks once more,
    // holding the person's own line: an account paused or closed in this very moment gets no pass either.)
    const pass = await enterCall({ id: me.id, name: me.name, paused: false }, id);
    if ("refused" in pass) {
      const { why, message } = pass.refused;
      if (why === "not_found") return refuse("not_found");
      if (why === "paused") return refuse("paused");
      if (why === "signed_out") return refuse("not_signed_in");
      if (why === "switched_off") return refuse("switched_off", message);
      // The video service could not be asked: nothing was decided, so nothing is refused.
      if (why === "failed") return notKnown();
      return refuse("not_valid", message);
    }
    const body: AppPass = { token: pass.token, serverUrl: pass.serverUrl, endsAt: pass.endsAt, serverNow: pass.serverNow };
    return answer(body);
  }

  if (step === "end-and-report") {
    const access = await callForParticipant(id, me.id);
    if (!access) return refuse("not_found");
    try {
      const { state, closed } = await endCallForSafetyConfirmed({ call: access.call, by: me.id, now: new Date() });
      // A call that has not opened yet cannot be ended this way (it can be cancelled). One that is already over
      // needs no ending: the person goes on to the report form as usual.
      if (state === "not_open_yet") return refuse("not_valid", "This call has not started yet.");
      // The call is marked as stopped (nobody can enter it again), but there is no proof yet that the other person
      // is out: the video service has not confirmed that the room is closed. "Ended for both" is not said until it
      // has: the app says so and offers to try again, and trying again asks the video service again (also after
      // the call's booked end: the clock is no proof).
      if (!closed) return notKnown();
    } catch (error) {
      // Whether it was ended for both cannot be told: the app says so and offers to try again.
      console.error("[safety] could not end a call for the app", error);
      return notKnown();
    }
    const body: AppEnded = { ended: true };
    return answer(body);
  }

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
    const done = await cancelCallWith({ call: access.call, payment: access.payment, by: access.role, now: new Date(), shown });
    return page(cancelledWords({ member: access.payment?.kind === "member_call", ...done }));
  } catch (error) {
    // One of the money rules said no, in its own sentence: nothing was cancelled.
    if (error instanceof MoneyError) return refuse("not_valid", error.message);
    // Anything else (Stripe's answer not known yet, the database, the unforeseen): whether the call was cancelled
    // cannot be told from here, so it is not said that it was not.
    if (!(error instanceof OutcomeUnknownError)) console.error("[payments] could not cancel a call for the app", error);
    return notKnown();
  }
}
