"use server";

import { redirect } from "next/navigation";
import { askForCall, BookingError } from "@/lib/booking/bookings";
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

  let bookingId: string;
  try {
    const { booking } = await askForCall({
      customer: user,
      hostId: profile.userId,
      startsAt: new Date(start),
      lengthMinutes: length,
      note: String(formData.get("note") ?? ""),
      requestKey: String(formData.get("requestKey") ?? ""),
      agreedToCardTerms: formData.get("cardTerms") === "on",
      seen: { pricePer15Cents: Number(formData.get("seenPrice")), freeCancelMinutes: Number(formData.get("seenFreeCancel")) },
      now: new Date(),
    });
    bookingId = booking.id;
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "Something went wrong. Nothing was sent. Please try again.";
    if (!(error instanceof BookingError)) console.error("[bookings] request failed", error);
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
