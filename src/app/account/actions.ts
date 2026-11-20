"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { setFollowEmails } from "@/lib/follows/emails";
import { withNotice } from "@/lib/notice";
import { removePhoto } from "@/lib/profiles/photo";
import { requireActiveUser, requireUser } from "@/lib/session";
import { isTimeZone } from "@/lib/time-zones";

export async function saveReminders(formData: FormData) {
  const user = await requireUser();
  await db.update(schema.user).set({ reminderEmails: formData.get("reminders") === "on", updatedAt: new Date() }).where(eq(schema.user.id, user.id));
  redirect("/account?notice=reminders");
}

/** The account's switch for emails about hosts the person follows (plans/31). Off also drops the ones still waiting. */
export async function saveFollowEmails(formData: FormData) {
  const user = await requireUser();
  await setFollowEmails(user.id, formData.get("follows") === "on");
  redirect("/account?notice=reminders");
}

export async function saveAccount(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const timeZone = String(formData.get("timeZone") ?? "");
  if (name.length < 2 || name.length > 50) redirect("/account?notice=name");
  if (!isTimeZone(timeZone)) redirect("/account?notice=zone");
  await db.update(schema.user).set({ name, timeZone, updatedAt: new Date() }).where(eq(schema.user.id, user.id));
  redirect("/account?notice=saved");
}

/** The person removes their own photo, from the Account page (plans/35). A host does this on the Hosting page. */
export async function removeOwnPhoto() {
  const user = await requireActiveUser("/account");
  let notice: string;
  try {
    notice = (await removePhoto({ userId: user.id, now: new Date() })) ? "Your photo was removed." : "You have no photo to remove.";
  } catch {
    notice = "Something went wrong. Your photo was not changed. Please try again.";
  }
  redirect(`${withNotice("/account", notice)}#photo`);
}
