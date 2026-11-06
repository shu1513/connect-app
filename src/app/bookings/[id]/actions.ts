"use server";

import { redirect } from "next/navigation";
import { accept, BookingError, decline, takeBack } from "@/lib/booking/bookings";
import { withNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";

function problem(error: unknown): string {
  if (error instanceof BookingError) return error.message;
  console.error("[bookings] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** Where to go back to: the page the button was on. Only our own two pages are allowed. */
function origin(formData: FormData, bookingId: string): string {
  return formData.get("from") === "requests" ? "/host/requests" : `/bookings/${bookingId}`;
}

export async function takeBackAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  let notice: string;
  try {
    await takeBack({ bookingId: id, customerId: user.id, now: new Date() });
    notice = "Your request was taken back. Nothing was held or charged.";
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
