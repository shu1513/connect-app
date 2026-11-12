"use server";

import { redirect } from "next/navigation";
import { BookingError } from "@/lib/booking/bookings";
import { startInstantCall } from "@/lib/booking/instant";
import { withNotice } from "@/lib/notice";
import { publicProfile } from "@/lib/profiles/profiles";
import { requireUser } from "@/lib/session";

/** A customer starts a call with a host who is available now. */
export async function startNow(formData: FormData) {
  const user = await requireUser();
  const handle = String(formData.get("handle") ?? "");
  const length = Number(formData.get("length"));
  const profile = await publicProfile(handle);
  if (!profile) redirect("/");

  let callId: string;
  try {
    ({ callId } = await startInstantCall({ customer: user, hostId: profile.userId, lengthMinutes: length, requestKey: String(formData.get("requestKey") ?? ""), now: new Date() }));
  } catch (error) {
    const message = error instanceof BookingError ? error.message : "Something went wrong. No call was started. Please try again.";
    if (!(error instanceof BookingError)) console.error("[instant] could not start a call", error);
    redirect(withNotice(`/h/${profile.handle}/now?length=${length}`, message));
  }
  redirect(`/calls/${callId}`);
}
