"use server";

import { redirect } from "next/navigation";
import { accept, bookingFor, BookingError, decline, takeBack } from "@/lib/booking/bookings";
import { REQUEST_WORDS } from "@/lib/booking/request-words";
import { bookAsMember } from "@/lib/membership/book";
import { withNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { backTo } from "./back-to";

function problem(error: unknown): string {
  if (error instanceof BookingError) return error.message;
  console.error("[bookings] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** Where to go back to: the page the button was on (see back-to.ts). */
function origin(formData: FormData, bookingId: string): string {
  return backTo(formData.get("from"), bookingId);
}

export async function takeBackAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  let notice: string;
  try {
    await takeBack({ bookingId: id, customerId: user.id, now: new Date() });
    notice = REQUEST_WORDS.takenBack;
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(`/bookings/${id}`, notice));
}

export async function acceptAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  let notice: string;
  try {
    await accept({ bookingId: id, hostId: user.id, now: new Date() });
    notice = "Accepted. The call is booked, and anyone else who asked for that time has been told.";
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(origin(formData, id), notice));
}

export async function declineAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  let notice: string;
  try {
    await decline({ bookingId: id, hostId: user.id, now: new Date() });
    notice = "Declined. The customer has been told.";
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(origin(formData, id), notice));
}

/**
 * A member's booking that is waiting for its month's payment: the same press again, with the
 * booking's own key and terms, continues from wherever it stopped.
 */
export async function continueMemberAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const found = await bookingFor(id, user.id);
  if (!found || found.role !== "customer" || found.booking.source !== "member") redirect("/");
  const { booking } = found;
  let notice: string;
  try {
    const result = await bookAsMember({
      customer: user,
      hostId: booking.hostId,
      startsAt: booking.startsAt,
      lengthMinutes: booking.lengthMinutes,
      requestKey: booking.requestKey,
      seen: { pricePer15Cents: booking.pricePer15Cents, freeCancelMinutes: booking.freeCancelMinutes },
      now: new Date(),
    });
    notice = result.outcome === "booked" ? "Your call is booked." : (result.message ?? "This booking could not be made.");
  } catch (error) {
    notice = error instanceof BookingError ? error.message : "Something went wrong. Please try again in a moment.";
    if (!(error instanceof BookingError)) console.error("[membership] could not continue a member's booking", error);
  }
  redirect(withNotice(`/bookings/${id}`, notice));
}
