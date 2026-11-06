"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { withNotice } from "@/lib/notice";
import { isAdmin } from "@/lib/payments/access";
import {
  closeAccount,
  confirmSocialName,
  decideProfile,
  ProfileError,
  rejectSocialName,
  reopenAccount,
} from "@/lib/profiles/profiles";
import { requireUser } from "@/lib/session";

function back(text: string): never {
  redirect(withNotice("/admin/people", text));
}

function problem(error: unknown): string {
  if (error instanceof ProfileError) return error.message;
  console.error("[admin] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

async function requireAdmin() {
  const user = await requireUser();
  if (!(await isAdmin(user.id))) redirect("/");
  return user;
}

/** Approve, decline or suspend a host profile. */
export async function decideProfileAction(formData: FormData) {
  const admin = await requireAdmin();
  const decision = String(formData.get("decision") ?? "");
  let notice: string;
  try {
    if (decision !== "approved" && decision !== "declined" && decision !== "suspended") throw new ProfileError("Unknown decision.");
    await decideProfile({ userId: String(formData.get("userId") ?? ""), decision, by: admin.id });
    notice = { approved: "The profile is approved and public.", declined: "The profile was declined.", suspended: "The profile is suspended and no longer public." }[decision];
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

/** The founder has looked at the account's bio and found (or not found) the code. */
export async function decideSocialAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  let notice: string;
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ProfileError("Request not found.");
    if (formData.get("found") === "yes") {
      await confirmSocialName({ id, nameKey: String(formData.get("nameKey") ?? ""), by: admin.id });
      notice = "The account is confirmed and now shown on the host's page.";
    } else {
      await rejectSocialName(id);
      notice = "Not confirmed. The host can try again.";
    }
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function closeAccountAction(formData: FormData) {
  const admin = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  let notice: string;
  try {
    const [person] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
    if (!person) throw new ProfileError("No account has that email address.");
    await closeAccount({ userId: person.id, by: admin.id });
    notice = "The account is closed. It is logged out everywhere and cannot log in.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function reopenAccountAction(formData: FormData) {
  await requireAdmin();
  await reopenAccount(String(formData.get("userId") ?? ""));
  back("The account is open again. If it had a host profile, that stays suspended until you approve it.");
}
