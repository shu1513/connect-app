"use server";

import { redirect } from "next/navigation";
import { askForCall, BookingError } from "@/lib/booking/bookings";
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
