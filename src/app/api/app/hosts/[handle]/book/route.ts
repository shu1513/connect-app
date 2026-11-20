import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { bookSummaryFor } from "@/lib/app-door/booking";
import type { AppBookSent } from "@/lib/app-door/types";
import { askForCall, BookingError, requestWithKey, requestWithKeySettled } from "@/lib/booking/bookings";
import { publicProfile } from "@/lib/profiles/profiles";

/**
 * Asking a host for a call at a time, from the phone app
 * (plans/45-phone-apps/06-asking-for-a-call.md), on the very functions the website's page uses:
 *
 *   GET  /api/app/hosts/[handle]/book?start=…&length=30   what the customer reads before sending
 *   POST /api/app/hosts/[handle]/book                      send the request
 *        { start, length, note?, requestKey, cardTerms?, cardTermsVersion?, seen: { price, freeCancel } }
 *
 * For someone who may act (not a paused person). Who asks comes from the sign-in, never from what
 * is sent. Sending holds every rule again, whatever the summary said: the time, the limits, a
 * block, the identity check, the price and cancelling rule the person was shown, and, for a paid
 * call, that the box about the card was ticked. Nothing is held or charged by either address.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/hosts/[handle]/book">) {
  const asked = await appRequest(request, "active");
  if (asked instanceof Response) return asked;
  const { handle } = await ctx.params;
  const query = new URL(request.url).searchParams;
  const summary = await bookSummaryFor(asked.person!, handle, { start: query.get("start"), length: query.get("length") }, new Date());
  return summary ? answer(summary) : refuse("not_found");
}

/**
 * "It cannot be told just now what became of this request": said as the server not being reached (no
 * answer of the door's at all), not as a refusal. The app then keeps what was sent exactly as it was, and
 * sends the same again; the key makes that the same one request.
 */
function notKnown(): Response {
  return new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, ctx: RouteContext<"/api/app/hosts/[handle]/book">) {
  const asked = await appRequest(request, "active");
  if (asked instanceof Response) return asked;
  const me = asked.person!;
  const { handle } = await ctx.params;
  const sent: unknown = await request.json().catch(() => null);
  const given = (sent !== null && typeof sent === "object" ? sent : {}) as { start?: unknown; length?: unknown; note?: unknown; requestKey?: unknown; cardTerms?: unknown; cardTermsVersion?: unknown; seen?: unknown };
  const seen = (given.seen !== null && typeof given.seen === "object" ? given.seen : {}) as { price?: unknown; freeCancel?: unknown };
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (typeof given.start !== "string" || !whole(given.length) || typeof given.requestKey !== "string" || !whole(seen.price) || !whole(seen.freeCancel)) return refuse("not_valid");
  if (given.note !== undefined && typeof given.note !== "string") return refuse("not_valid");
  if (given.cardTerms !== undefined && typeof given.cardTerms !== "boolean") return refuse("not_valid");
  if (given.cardTermsVersion !== undefined && given.cardTermsVersion !== null && typeof given.cardTermsVersion !== "string") return refuse("not_valid");
  // A tick always says which words it was given for: a tick without them is no tick.
  if (given.cardTerms === true && typeof given.cardTermsVersion !== "string") return refuse("not_valid");

  return send(me, handle, { start: given.start, length: given.length, note: typeof given.note === "string" ? given.note : "", requestKey: given.requestKey, cardTerms: given.cardTerms === true, cardTermsVersion: typeof given.cardTermsVersion === "string" ? given.cardTermsVersion : null, seen: { price: seen.price, freeCancel: seen.freeCancel } });
}

/**
 * One sending. Two sendings with the same key never decide side by side: the step that makes a request takes
 * the key's place in the queue before it looks at anything (`askForCall`), and before a refusal is answered
 * here the request is looked for once every such step is through (`requestWithKeySettled`). So a sending that
 * is tried again is never told "nothing was sent" while the first is still being written down.
 *
 * And a "no" for good uses the key up, written down in that same place in the queue: a sending with the same key
 * that was held up on its way and only arrives afterwards makes nothing. What the app was told stays true. The
 * app takes a new key for whatever the person sends next.
 */
async function send(
  me: { id: string; name: string; email: string },
  handle: string,
  given: { start: string; length: number; note: string; requestKey: string; cardTerms: boolean; cardTermsVersion: string | null; seen: { price: number; freeCancel: number } },
): Promise<Response> {
  // A request this person already made with this key is answered as it was made, before anything is looked at as it
  // stands now: the answer to the first sending may have been lost on the way, and since then the host may have
  // changed her price, or hidden her page. The app then opens that request, which shows its own terms.
  let again: Awaited<ReturnType<typeof requestWithKey>>;
  try {
    again = await requestWithKey(me.id, given.requestKey);
  } catch (lookup) {
    console.error("[bookings] could not look for a request with its key", lookup);
    return notKnown();
  }
  if (again) return answer<AppBookSent>({ id: again.id });
  const profile = await publicProfile(handle);
  if (!profile) {
    // Her page is not there now. It may have been a moment ago, when an earlier sending with this key was let in:
    // that one is waited for before "not found" is said.
    const settled = await requestWithKeySettled(me.id, given.requestKey, { spend: true }).catch((lookup) => {
      console.error("[bookings] could not look for a request with its key", lookup);
      return "unknown" as const;
    });
    return settled === "unknown" ? notKnown() : settled ? answer<AppBookSent>({ id: settled.id }) : refuse("not_found");
  }
  try {
    const { booking } = await askForCall({
      customer: me,
      hostId: profile.userId,
      startsAt: new Date(given.start),
      lengthMinutes: given.length,
      note: given.note,
      requestKey: given.requestKey,
      // Only the box itself, ticked: nothing else counts as a yes.
      agreedToCardTerms: given.cardTerms,
      seen: { pricePer15Cents: given.seen.price, freeCancelMinutes: given.seen.freeCancel, cardTermsVersion: given.cardTermsVersion },
      boundedKeyWait: true,
      now: new Date(),
    });
    return answer<AppBookSent>({ id: booking.id });
  } catch (error) {
    if (!(error instanceof BookingError)) console.error("[bookings] request from the app failed", error);
    // A paid request is written down first, and its card step is made at Stripe after. If only the second failed
    // (whatever the kind of failure), the request exists: it is answered as made (its own screen makes the card step
    // when it is asked for), never as "nothing was sent".
    let made: Awaited<ReturnType<typeof requestWithKeySettled>>;
    try {
      // After one of the booking's own refusals the answer will be "no request was made", for good: the key is used
      // up in the same look. After anything else nothing is certain, and the key stays good for the next try.
      made = await requestWithKeySettled(me.id, given.requestKey, { spend: error instanceof BookingError });
    } catch (lookup) {
      console.error("[bookings] could not look for a request after a failed sending", lookup);
      return notKnown();
    }
    if (made) return answer<AppBookSent>({ id: made.id });
    // No request with this key was made. After one of the booking's own refusals that is certain, and the sentence
    // says why. After anything else (the database, Stripe, the unforeseen) the answer is "it cannot be told".
    if (!(error instanceof BookingError)) return notKnown();
    return refuse("not_valid", error.message);
  }
}
