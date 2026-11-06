"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { safeNext } from "@/lib/safe-next";
import { getSignedIn, TERMS_VERSION } from "@/lib/session";
import { isTimeZone } from "@/lib/time-zones";

/** Records that the person ticked "18 or older" and accepted the terms. Written by the server only. */
export async function finishSignUp(formData: FormData) {
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect("/login");
  // Where the person was heading before this step (a booking page, usually). Only a path on this site.
  const next = safeNext(formData.get("next"));
  const again = (problem: string) => `/welcome?problem=${problem}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
  if (person.welcomed) redirect(next);

  if (formData.get("adult") !== "on" || formData.get("terms") !== "on") redirect(again("boxes"));
  const timeZone = String(formData.get("timeZone") ?? "");
  if (!isTimeZone(timeZone)) redirect(again("zone"));

  const now = new Date();
  await db
    .update(schema.user)
    .set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone, updatedAt: now })
    .where(eq(schema.user.id, person.id));
  redirect(next);
}
