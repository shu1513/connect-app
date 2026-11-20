/**
 * Stripe's own card sheet (plans/45-phone-apps/06-asking-for-a-call.md, decisions 3 and 4, and
 * 08-the-calls-page.md, decision 2). The card is typed into Stripe's sheet and goes to Stripe; the
 * app never sees its number. It is used for two steps, each made by the server: saving a card for
 * a request (nothing is held), and placing the hold for a call (the money is held, not taken).
 *
 * Cards only, as on the website: Stripe's own wallet ("Link") is off, payment methods that settle
 * later are off, and no list of earlier cards is offered, since no customer is handed to the sheet
 * (a card belongs to one booking). Apple Pay and Google Pay are not switched on.
 *
 * What the sheet reports is only ever a hint for what to say. Whether the card really was saved
 * is asked of the server afterwards, which asks Stripe.
 */
import { handleURLCallback, initPaymentSheet, initStripe, PaymentSheet, PaymentSheetError, presentPaymentSheet } from "@stripe/stripe-react-native";
import { useEffect } from "react";
import { AppState, Linking } from "react-native";
import type { AppCardStep, AppPayStep } from "../../../src/lib/app-door/types";
import { requestScreen } from "./book-rules";
import { callScreen } from "./call-rules";
import { APP_SCHEME } from "./config";

/** How the sheet ended: it finished, the person closed it, it could not be shown or went wrong, or it was not shown because the person had left. */
export type CardOutcome = "finished" | "given_up" | "failed" | "not_shown";

let open = false;

/**
 * Shows the card sheet for a request and waits until it is gone. `bookingId` names the request's
 * own screen, which is where a bank's approval page hands the person back to the app.
 *
 * `still` says whether the screen that asked is still the one in front. Getting the sheet ready
 * takes a moment; it is asked again at the very last step before the sheet is shown, so a sheet for
 * one request never comes up after the person has left that request, or for somebody else.
 */
export async function enterCard(step: AppCardStep, bookingId: string, button: string, still: () => boolean): Promise<CardOutcome> {
  return sheet({ setupIntentClientSecret: step.clientSecret }, step, requestScreen(APP_SCHEME, bookingId), button, still);
}

/**
 * Shows the card sheet that places the hold for a call, and waits until it is gone. The hold is
 * a payment the server made, to be captured after the call; nothing is charged by the sheet.
 * `callId` names the call's own screen, where a bank's approval page hands the person back.
 */
export async function placeHold(step: AppPayStep, callId: string, button: string, still: () => boolean): Promise<CardOutcome> {
  return sheet({ paymentIntentClientSecret: step.clientSecret }, step, callScreen(APP_SCHEME, callId), button, still);
}

/** The screen that asked is still the one in front, and the app itself is on the phone's screen (not behind another app, not locked). */
const inFront = (still: () => boolean): boolean => still() && AppState.currentState === "active";

/** The sheet itself, for either step: cards only, nothing of Stripe's extras, no list of earlier cards. */
async function sheet(secret: { setupIntentClientSecret: string } | { paymentIntentClientSecret: string }, step: { publishableKey: string; merchant: string }, back: string | null, button: string, still: () => boolean): Promise<CardOutcome> {
  // One sheet at a time, whatever was tapped twice.
  if (open) return "given_up";
  open = true;
  try {
    if (!inFront(still)) return "not_shown";
    await initStripe({ publishableKey: step.publishableKey });
    if (!inFront(still)) return "not_shown";
    const made = await initPaymentSheet({
      ...secret,
      merchantDisplayName: step.merchant,
      ...(back ? { returnURL: back } : {}),
      allowsDelayedPaymentMethods: false,
      link: { display: PaymentSheet.LinkDisplay.NEVER },
      paymentMethodOrder: ["card"],
      primaryButtonLabel: button,
    });
    if (made.error) return "failed";
    // Getting the sheet ready takes a moment: the person may have left the screen, or the app, meanwhile.
    if (!inFront(still)) return "not_shown";
    const shown = await presentPaymentSheet();
    if (!shown.error) return "finished";
    return shown.error.code === PaymentSheetError.Canceled ? "given_up" : "failed";
  } catch {
    return "failed";
  } finally {
    open = false;
  }
}

/**
 * Hands a link that brings the person back from a bank's approval page to Stripe's kit, which
 * closes its own page over the app. (An iPhone needs this; on Android the kit sees it by itself
 * and this does nothing.) Only ever a link to a request's own screen in this app. The screen it
 * leads to asks the server where the request (or the call's hold) stands, whether the app was still open or not.
 */
export function useCardReturns(): void {
  useEffect(() => {
    const hand = (url: string | null | undefined) => {
      if (url?.startsWith(`${APP_SCHEME}://bookings/`) || url?.startsWith(`${APP_SCHEME}://calls/`)) void handleURLCallback(url).catch(() => {});
    };
    void Linking.getInitialURL()
      .then(hand)
      .catch(() => {});
    const listener = Linking.addEventListener("url", (event) => hand(event.url));
    return () => listener.remove();
  }, []);
}
