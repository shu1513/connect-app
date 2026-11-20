"use server";

import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { getSignedIn } from "@/lib/session";
import { finishSigningUp } from "@/lib/welcome";

/** Records that the person ticked "18 or older" and accepted the terms. Written by the server only. */
export async function finishSignUp(formData: FormData) {
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect("/login");
  // Where the person was heading before this step (a booking page, usually). Only a path on this site.
  const next = safeNext(formData.get("next"));
  const result = await finishSigningUp(person, {
    adult: formData.get("adult") === "on",
    terms: formData.get("terms") === "on",
    timeZone: String(formData.get("timeZone") ?? ""),
  });
  if (result === "boxes" || result === "zone") redirect(`/welcome?problem=${result}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`);
  redirect(next);
}
