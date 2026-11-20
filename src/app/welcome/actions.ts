"use server";

import { redirect } from "next/navigation";
import { acceptGeneralAgreements, AgreementError, readShown } from "@/legal/accept";
import { safeNext } from "@/lib/safe-next";
import { getSignedIn } from "@/lib/session";
import { isTimeZone } from "@/lib/time-zones";

/**
 * The last step of signing up, and the step a person sees again when the general documents have a
 * new version (plans/46-agreements-live.md, decisions 4 to 6). The tick says "18 or older"; pressing
 * the button accepts the Terms of Service, the Payment Terms and the Community Rules in the
 * versions the page showed, which the form carries. Written by the server only.
 */
export async function finishSignUp(formData: FormData) {
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect("/login");
  // Where the person was heading before this step (a booking page, usually). Only a path on this site.
  const next = safeNext(formData.get("next"));
  const again = (problem: string) => `/welcome?problem=${problem}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
  if (person.welcomed) redirect(next);

  if (formData.get("adult") !== "on") redirect(again("boxes"));
  const timeZone = String(formData.get("timeZone") ?? "");
  if (!isTimeZone(timeZone)) redirect(again("zone"));

  let problem: string | null = null;
  try {
    await acceptGeneralAgreements({ userId: person.id, shown: readShown(formData.get("shown")), timeZone, now: new Date() });
  } catch (error) {
    if (!(error instanceof AgreementError)) throw error;
    // The documents changed while the page was open (or the form named none): the step is shown again, with the versions due now.
    problem = "changed";
  }
  redirect(problem ? again(problem) : next);
}
