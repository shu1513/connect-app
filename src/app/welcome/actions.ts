"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getSignedIn, TERMS_VERSION } from "@/lib/session";
import { isTimeZone } from "@/lib/time-zones";

/** Records that the person ticked "18 or older" and accepted the terms. Written by the server only. */
export async function finishSignUp(formData: FormData) {
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect("/login");
  if (person.welcomed) redirect("/");

  if (formData.get("adult") !== "on" || formData.get("terms") !== "on") redirect("/welcome?problem=boxes");
  const timeZone = String(formData.get("timeZone") ?? "");
  if (!isTimeZone(timeZone)) redirect("/welcome?problem=zone");

  const now = new Date();
  await db
    .update(schema.user)
    .set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone, updatedAt: now })
    .where(eq(schema.user.id, person.id));
  redirect("/");
}
