"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { isTimeZone } from "@/lib/time-zones";

export async function saveReminders(formData: FormData) {
  const user = await requireUser();
  await db.update(schema.user).set({ reminderEmails: formData.get("reminders") === "on", updatedAt: new Date() }).where(eq(schema.user.id, user.id));
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
