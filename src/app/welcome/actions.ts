"use server";

import { redirect } from "next/navigation";
import { readShown } from "@/legal/accept";
import { safeNext } from "@/lib/safe-next";
import { getSignedIn } from "@/lib/session";
import { finishSigningUp } from "@/lib/welcome";

/**
 * The last step of signing up, and the step a person sees again when the general documents have a
 * new version (plans/46-agreements-live.md, decisions 4 to 6). The tick says "18 or older"; pressing
 * the button accepts the Terms of Service, the Payment Terms and the Community Rules in the
 * versions the page showed, which the form carries. Written by the server only, by the one
 * function the phone app uses too (src/lib/welcome.ts).
 */
export async function finishSignUp(formData: FormData) {
  // Where the person was heading before this step (a booking page, usually). Only a path on this site.
  const next = safeNext(formData.get("next"));
  const carried = next === "/" ? "" : `next=${encodeURIComponent(next)}`;
  const person = await getSignedIn();
  // Someone whose login ran out while the page was open logs in and comes back to where they were going.
  if (!person || person.closed || !person.emailVerified) redirect(`/login${carried && `?${carried}`}`);
  const result = await finishSigningUp(person, {
    adult: formData.get("adult") === "on",
    shown: readShown(formData.get("shown")),
    timeZone: String(formData.get("timeZone") ?? ""),
  });
  if (result === "gone") redirect("/login");
  // "changed": the documents have a new version since the page was opened (or the form named none). The step is shown again, with the versions due now.
  if (result === "boxes" || result === "zone" || result === "changed") redirect(`/welcome?problem=${result}${carried && `&${carried}`}`);
  redirect(next);
}
