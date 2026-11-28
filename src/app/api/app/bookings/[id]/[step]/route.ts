import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { bookingPageFor, detailsWithheld, mayBlockThrough, mayEnterCard } from "@/lib/app-door/booking";
import { switchesForApps } from "@/lib/app-door/start";
import type { AppCardStep, AppNoteSaved } from "@/lib/app-door/types";
import { accept, BookingError, cardStepOf, decline, finishCardStep, takeBack } from "@/lib/booking/bookings";
import { gatherRequest } from "@/lib/booking/request-page";
import { REQUEST_WORDS } from "@/lib/booking/request-words";
import { cardStepOpen } from "@/lib/booking/rules";
import { WAITING_WORDS } from "@/lib/booking/waiting-words";
import { NoteError, saveHostNote } from "@/lib/people/contacts";
import { stripePublishableKey } from "@/lib/payments/stripe";
import { BLOCK_WORDS } from "@/lib/safety/block-words";
import { block, BlockError } from "@/lib/safety/blocks";

const WRONG = "Something went wrong. Nothing was changed. Please try again.";

/** What the customer of a request does, what its host does, and what either of them can do. */
const FOR_CUSTOMER = ["card", "card-saved", "take-back"];
const FOR_HOST = ["accept", "decline", "note"];
const FOR_EITHER = ["block"];

/**
 * What the two people of a request do with it, from the phone app
 * (plans/45-phone-apps/06-asking-for-a-call.md and 07-a-hosts-requests.md), on the very functions
 * the website uses.
 *
 * The customer who made it:
 *   POST /api/app/bookings/[id]/card         what Stripe's card sheet needs (also when it must be made again)
 *   POST /api/app/bookings/[id]/card-saved   "the sheet is closed": the server asks Stripe whether the card
 *                                            really was saved, checks everything again, and only then sends the request
 *   POST /api/app/bookings/[id]/take-back    take a waiting request back
 * The host it was sent to:
 *   POST /api/app/bookings/[id]/accept       accept it: the call is booked (not for a call asked for "now")
 *   POST /api/app/bookings/[id]/decline      decline it
 *   POST /api/app/bookings/[id]/note         { text, shown }: save her private note about the customer
 * Either of them, once the request was sent:
 *   POST /api/app/bookings/[id]/block        block the other person
 *
 * Who is asking comes from the sign-in, and which of the two they are from the request itself.
 * A request that does not exist, one that is somebody else's, one the host was never sent, and a
 * step that is the other person's are all the same "not found". While the request's two people
 * may no longer act, no card is asked for and the host's note is neither sent nor changed
 * (plans/45-phone-apps/09a-what-is-built-put-right.md, decision 6). What the app says happened in
 * Stripe's sheet is never believed, and nothing here holds or charges money. Every step but
 * "card" and "note" answers with the request's page as it stands afterwards.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/app/bookings/[id]/[step]">) {
  const { id, step } = await ctx.params;
  if (![...FOR_CUSTOMER, ...FOR_HOST, ...FOR_EITHER].includes(step)) {
    const anyone = await appRequest(request, "anyone");
    return anyone instanceof Response ? anyone : refuse("not_found");
  }
  // Entering a card and accepting a request are for someone who may act. Finishing what is under way, taking a
  // request back, declining, the note and blocking are also for a paused person, as on the website.
  const asked = await appRequest(request, step === "card" || step === "accept" ? "active" : "member");
  if (asked instanceof Response) return asked;
  const me = asked.person!;
  const now = new Date();
  // The request as this person may see it: null for somebody else's, and for a host who was never sent it.
  const found = await gatherRequest(me.id, id, now);
  if (!found) return refuse("not_found");
  const { booking, role } = found;
  if ((FOR_CUSTOMER.includes(step) && role !== "customer") || (FOR_HOST.includes(step) && role !== "host")) return refuse("not_found");
  const switches = switchesForApps(asked.switches);
  const page = async (notice: string | null = null, options: { blockAgain?: boolean } = {}) => {
    const body = await bookingPageFor(me, id, switches, new Date(), notice, options);
    return body ? answer(body) : refuse("not_found");
  };

  if (step === "card" || step === "card-saved") {
    // A call asked for "now" (begun on the website) is not sent on from the app while "available now" is switched
    // off for the apps. Reading the request, and taking it back, stay possible.
    if (booking.stage === "card" && !mayEnterCard(booking, switches)) return refuse("switched_off");
    if (step === "card") {
      // No card is asked for on a request that can no longer be sent (the host's account was paused or closed a
      // moment ago, say). The step itself refuses too (`cardStepOf`); here it is said in the page's own sentence.
      if (await detailsWithheld(me, booking)) return refuse("not_valid", REQUEST_WORDS.noLongerAvailable);
      try {
        const card = await cardStepOf({ bookingId: id, customer: me, now });
        // Past its time the request is over, also before the helper has written that down. (Saying "the card is
        // saved" then ends it, and the request's page says why.)
        if (!card) return refuse("not_valid", booking.stage === "card" && !cardStepOpen(booking.createdAt, now) ? REQUEST_WORDS.cardTooLate : REQUEST_WORDS.cardNotNeeded);
        const body: AppCardStep = { clientSecret: card.clientSecret, publishableKey: stripePublishableKey(), merchant: "Connect" };
        return answer(body);
      } catch (error) {
        if (!(error instanceof BookingError)) console.error("[bookings] could not make the card step for the app", error);
        return refuse("not_valid", REQUEST_WORDS.cardNotLoaded);
      }
    }
    try {
      await finishCardStep({ bookingId: id, customerId: me.id, now, live: true });
    } catch (error) {
      if (!(error instanceof BookingError)) console.error("[bookings] could not finish the card step for the app", error);
      return refuse("not_valid", error instanceof BookingError ? error.message : "Could not check your card. Please try again.");
    }
    return page();
  }

  if (step === "take-back" || step === "accept" || step === "decline") {
    // A call asked for right away is answered where such calls arrive: accepting it also tries the saved card at once.
    if (step !== "take-back" && booking.source === "now") return refuse("not_valid", WAITING_WORDS.nowElsewhere);
    try {
      if (step === "take-back") await takeBack({ bookingId: id, customerId: me.id, now });
      else if (step === "accept") await accept({ bookingId: id, hostId: me.id, now, live: true });
      else await decline({ bookingId: id, hostId: me.id, now });
    } catch (error) {
      if (!(error instanceof BookingError)) console.error(`[bookings] the step "${step}" failed for the app`, error);
      return refuse("not_valid", error instanceof BookingError ? error.message : WRONG);
    }
    return page(step === "take-back" ? REQUEST_WORDS.takenBack : step === "accept" ? WAITING_WORDS.accepted : WAITING_WORDS.declined);
  }

  if (step === "note") {
    const sent: unknown = await request.json().catch(() => null);
    const given = (sent !== null && typeof sent === "object" ? sent : {}) as { text?: unknown; shown?: unknown };
    if (typeof given.text !== "string" || (given.shown !== null && typeof given.shown !== "string")) return refuse("not_valid");
    // The note that hangs on a request follows the request: while its details are withheld, this address neither
    // sends the note nor takes a change to it (plans/45-phone-apps/09a, decision 6). Nothing of it is lost.
    if (await detailsWithheld(me, booking)) return refuse("not_valid", `${REQUEST_WORDS.noLongerAvailable} ${WAITING_WORDS.noteNotSaved}`);
    try {
      // Who may keep a note about whom, and that the note is still the one the screen was showing, is decided there.
      const stored = await saveHostNote({ hostId: me.id, customerId: booking.customerId, text: given.text, shown: given.shown, now });
      const body: AppNoteSaved = { text: stored, words: WAITING_WORDS.noteSaved };
      return answer(body);
    } catch (error) {
      if (error instanceof NoteError) return refuse("not_valid", `${error.message} ${WAITING_WORDS.noteNotSaved}`);
      // Never the error itself: a database error carries the note that was typed. Only what kind of error it was.
      console.error(`[contacts] could not save a note from the app (${error instanceof Error ? error.name : "unknown error"})`);
      return refuse("not_valid", `Something went wrong. Please try again. ${WAITING_WORDS.noteNotSaved}`);
    }
  }

  // Block: the other person of the request, once it was really sent (never from one that stopped at its card step).
  if (!mayBlockThrough(booking)) return refuse("not_found");
  try {
    const { callsNotCancelled } = await block({ blockerId: me.id, blockedId: role === "host" ? booking.customerId : booking.hostId, now });
    // When a call between the two could not be cancelled yet, the sentence says to try again: the button stays for that.
    return callsNotCancelled > 0 ? page(BLOCK_WORDS.notCancelled(callsNotCancelled), { blockAgain: true }) : page(BLOCK_WORDS.done);
  } catch (error) {
    if (!(error instanceof BlockError)) console.error("[safety] could not block from the app", error);
    return refuse("not_valid", error instanceof BlockError ? error.message : BLOCK_WORDS.wrong);
  }
}
