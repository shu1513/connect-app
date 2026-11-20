"use server";

import { redirect } from "next/navigation";
import { askForCall, BookingError, requestWithKey } from "@/lib/booking/bookings";
import { hostForMemberByHandle } from "@/lib/membership/access";
import { bookAsMember } from "@/lib/membership/book";
import { withNotice } from "@/lib/notice";
import { publicProfile } from "@/lib/profiles/profiles";
import { requireUser } from "@/lib/session";

/** A customer sends a request from the summary page. */
export async function sendRequest(formData: FormData) {
  const user = await requireUser();
  const handle = String(formData.get("handle") ?? "");
  const start = String(formData.get("start") ?? "");
  const length = Number(formData.get("length"));
  const profile = await publicProfile(handle);
  if (!profile) redirect("/");

  const requestKey = String(formData.get("requestKey") ?? "");
  let bookingId: string;
  try {
    const { booking } = await askForCall({
      customer: user,
      hostId: profile.userId,
      startsAt: new Date(start),
      lengthMinutes: length,
      note: String(formData.get("note") ?? ""),
      requestKey,
      agreedToCardTerms: formData.get("cardTerms") === "on",
      seen: { pricePer15Cents: Number(formData.get("seenPrice")), freeCancelMinutes: Number(formData.get("seenFreeCancel")), cardTermsVersion: typeof formData.get("cardTermsVersion") === "string" ? String(formData.get("cardTermsVersion")) : null },
      now: new Date(),
    });
    bookingId = booking.id;
  } catch (error) {
    if (!(error instanceof BookingError)) console.error("[bookings] request failed", error);
    // The request may have been written down before the failure (a paid one's card step is made at Stripe after
    // it, and that can fail with a sentence of its own): then it is opened, not denied.
    const made = await requestWithKey(user.id, requestKey).catch(() => null);
    if (made) redirect(`/bookings/${made.id}`);
    // One of the booking's own refusals says why nothing was sent. After anything else it cannot be told from here
    // whether the request was written down (another sending of this same form may be finishing at this moment),
    // so the page does not say that it was not.
    const message = error instanceof BookingError ? error.message : "Something went wrong, and we could not tell whether your request was sent. Please look at your home page for it before you try again.";
    redirect(withNotice(`/h/${profile.handle}/book?length=${length}&start=${encodeURIComponent(start)}`, message));
  }
  redirect(`/bookings/${bookingId}`);
}

/** A member books with their membership time, from the summary page. The call is booked at once (or, at the first booking of a month, as soon as the month's payment is taken). */
export async function bookMember(formData: FormData) {
  const user = await requireUser();
  const handle = String(formData.get("handle") ?? "");
  const start = String(formData.get("start") ?? "");
  const length = Number(formData.get("length"));
  // A member reaches a host whose page is hidden, through the membership's own access rules.
  const host = (await publicProfile(handle)) ?? (await hostForMemberByHandle(user.id, handle));
  if (!host) redirect("/");

  let to: string;
  try {
    const result = await bookAsMember({
      customer: user,
      hostId: host.userId,
      startsAt: new Date(start),
      lengthMinutes: length,
      requestKey: String(formData.get("requestKey") ?? ""),
      seen: { pricePer15Cents: Number(formData.get("seenPrice")), freeCancelMinutes: Number(formData.get("seenFreeCancel")) },
      now: new Date(),
    });
    const page = `/bookings/${result.booking.id}`;
    to = result.outcome === "booked" ? withNotice(page, "Your call is booked.") : result.message ? withNotice(page, result.message) : page;
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "Something went wrong. Nothing was booked. Please try again.";
    if (!(error instanceof BookingError)) console.error("[membership] a member's booking failed", error);
    to = withNotice(`/h/${host.handle}/book?as=member&length=${length}&start=${encodeURIComponent(start)}`, message);
  }
  redirect(to);
}
