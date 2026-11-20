import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { bookSummaryFor } from "@/lib/app-door/booking";
import type { AppBookSent } from "@/lib/app-door/types";
import { askForCall, BookingError, requestWithKey } from "@/lib/booking/bookings";
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

  // A request this person already made with this key is answered as it was made, before anything is looked at
    // as it stands now: the answer to the first sending may have been lost on the way, and since then the host may
    // have changed her price, or hidden her page. The app then opens that request, which shows its own terms.
  const again = await requestWithKey(me.id, given.requestKey);
  if (again) {
    const body: AppBookSent = { id: again.id };
    return answer(body);
  }
  const profile = await publicProfile(handle);
  if (!profile) return refuse("not_found");
  try {
    const { booking } = await askForCall({
      customer: me,
      hostId: profile.userId,
      startsAt: new Date(given.start),
      lengthMinutes: given.length,
      note: given.note ?? "",
      requestKey: given.requestKey,
      // Only the box itself, ticked: nothing else counts as a yes.
      agreedToCardTerms: given.cardTerms === true,
      seen: { pricePer15Cents: seen.price, freeCancelMinutes: seen.freeCancel, cardTermsVersion: given.cardTermsVersion ?? null },
      now: new Date(),
    });
    const body: AppBookSent = { id: booking.id };
    return answer(body);
  } catch (error) {
    if (!(error instanceof BookingError)) console.error("[bookings] request from the app failed", error);
    return refuse("not_valid", error instanceof BookingError ? error.message : "Something went wrong. Nothing was sent. Please try again.");
  }
}
