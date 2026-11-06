"use server";

import { redirect } from "next/navigation";
import { askNow, BookingError } from "@/lib/booking/bookings";
import { withNotice } from "@/lib/notice";
import { publicProfile } from "@/lib/profiles/profiles";
import { requireUser } from "@/lib/session";

/** A customer asks a host who is available now for a call right away. */
export async function sendNowRequest(formData: FormData) {
  const user = await requireUser();
  const handle = String(formData.get("handle") ?? "");
  const length = Number(formData.get("length"));
  const profile = await publicProfile(handle);
  if (!profile) redirect("/");

  let bookingId: string;
  try {
    const { booking } = await askNow({
      customer: user,
      hostId: profile.userId,
      lengthMinutes: length,
      requestKey: String(formData.get("requestKey") ?? ""),
      agreedToCardTerms: formData.get("cardTerms") === "on",
      seen: { pricePer15Cents: Number(formData.get("seenPrice")) },
      now: new Date(),
    });
    bookingId = booking.id;
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "Something went wrong. Nothing was sent. Please try again.";
    if (!(error instanceof BookingError)) console.error("[bookings] instant request failed", error);
    redirect(withNotice(`/h/${profile.handle}/now?length=${length}`, message));
  }
  redirect(`/bookings/${bookingId}`);
}
