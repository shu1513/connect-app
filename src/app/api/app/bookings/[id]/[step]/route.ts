import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { bookingPageFor, mayEnterCard } from "@/lib/app-door/booking";
import { switchesForApps } from "@/lib/app-door/start";
import type { AppCardStep } from "@/lib/app-door/types";
import { bookingFor, BookingError, cardStepOf, finishCardStep, takeBack } from "@/lib/booking/bookings";
import { REQUEST_WORDS } from "@/lib/booking/request-words";
import { cardStepOpen } from "@/lib/booking/rules";
import { stripePublishableKey } from "@/lib/payments/stripe";

/**
 * What a customer does with a request of their own, from the phone app
 * (plans/45-phone-apps/06-asking-for-a-call.md), on the very functions the website uses:
 *
 *   POST /api/app/bookings/[id]/card         what Stripe's card sheet needs (also when it must be made again)
 *   POST /api/app/bookings/[id]/card-saved   "the sheet is closed": the server asks Stripe whether the card
 *                                            really was saved, checks everything again, and only then sends the request
 *   POST /api/app/bookings/[id]/take-back    take a waiting request back
 *
 * Whose request it is comes from the sign-in. What the app says happened in Stripe's sheet is
 * never believed, and nothing here holds or charges money. The last two answer with the
 * request's page as it stands afterwards.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/app/bookings/[id]/[step]">) {
  const { id, step } = await ctx.params;
  if (step !== "card" && step !== "card-saved" && step !== "take-back") {
    const anyone = await appRequest(request, "anyone");
    return anyone instanceof Response ? anyone : refuse("not_found");
  }
  // Entering a card is for someone who may act. Finishing what is under way and taking a request back are also
  // for a paused person, as on the website: the booking's own rules then decide what becomes of it.
  const asked = await appRequest(request, step === "card" ? "active" : "member");
  if (asked instanceof Response) return asked;
  const me = asked.person!;
  const now = new Date();
  // Somebody else's request, a host's side of one, and one that does not exist: the same "not found".
  const found = await bookingFor(id, me.id);
  if (!found || found.role !== "customer") return refuse("not_found");
  const switches = switchesForApps(asked.switches);
  // A call asked for "now" (begun on the website) is not sent on from the app while "available now" is switched
  // off for the apps. Reading the request, and taking it back, stay possible.
  if (step !== "take-back" && found.booking.stage === "card" && !mayEnterCard(found.booking, switches)) return refuse("switched_off");

  if (step === "card") {
    try {
      const card = await cardStepOf({ bookingId: id, customer: me, now });
      // Past its time the request is over, also before the helper has written that down. (Saying "the card is
      // saved" then ends it, and the request's page says why.)
      if (!card) return refuse("not_valid", found.booking.stage === "card" && !cardStepOpen(found.booking.createdAt, now) ? REQUEST_WORDS.cardTooLate : REQUEST_WORDS.cardNotNeeded);
      const body: AppCardStep = { clientSecret: card.clientSecret, publishableKey: stripePublishableKey(), merchant: "Connect" };
      return answer(body);
    } catch (error) {
      if (!(error instanceof BookingError)) console.error("[bookings] could not make the card step for the app", error);
      return refuse("not_valid", REQUEST_WORDS.cardNotLoaded);
    }
  }

  if (step === "card-saved") {
    try {
      await finishCardStep({ bookingId: id, customerId: me.id, now, live: true });
    } catch (error) {
      if (!(error instanceof BookingError)) console.error("[bookings] could not finish the card step for the app", error);
      return refuse("not_valid", error instanceof BookingError ? error.message : "Could not check your card. Please try again.");
    }
    const page = await bookingPageFor(me, id, switches, now);
    return page ? answer(page) : refuse("not_found");
  }

  try {
    await takeBack({ bookingId: id, customerId: me.id, now });
  } catch (error) {
    if (!(error instanceof BookingError)) console.error("[bookings] could not take a request back for the app", error);
    return refuse("not_valid", error instanceof BookingError ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  }
  const page = await bookingPageFor(me, id, switches, now, REQUEST_WORDS.takenBack);
  return page ? answer(page) : refuse("not_found");
}
