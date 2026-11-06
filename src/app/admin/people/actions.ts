"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { endBookingsOfSuspendedHost } from "@/lib/booking/moderation";
import { withNotice } from "@/lib/notice";
import { closeAccount, reopenAccount } from "@/lib/profiles/closing";
import { confirmSocialName, decideProfile, ProfileError, rejectSocialName } from "@/lib/profiles/profiles";
import { recordAdminAction } from "@/lib/safety/audit";
import { requireAdmin } from "@/lib/session";

function back(text: string): never {
  redirect(withNotice("/admin/people", text));
}

function problem(error: unknown): string {
  if (error instanceof ProfileError) return error.message;
  console.error("[admin] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** Approve, decline or suspend a host profile. */
export async function decideProfileAction(formData: FormData) {
  const admin = await requireAdmin();
  const decision = String(formData.get("decision") ?? "");
  let notice: string;
  try {
    if (decision !== "approved" && decision !== "declined" && decision !== "suspended") throw new ProfileError("Unknown decision.");
    await decideProfile({
      userId: String(formData.get("userId") ?? ""),
      decision,
      by: admin.id,
      // What the founder had on screen when deciding.
      seen: { displayName: String(formData.get("seenName") ?? ""), about: String(formData.get("seenAbout") ?? ""), identityCheckId: String(formData.get("seenIdentity") ?? "") || undefined },
    });
    await recordAdminAction({ adminId: admin.id, action: `profile ${decision}`, targetUserId: String(formData.get("userId") ?? "") });
    notice = { approved: "The profile is approved and public.", declined: "The profile was declined.", suspended: "The profile is suspended and no longer public." }[decision];
    if (decision === "suspended") {
      // The profile is suspended from here on. What happens to its bookings is reported separately.
      try {
        const failed = await endBookingsOfSuspendedHost(String(formData.get("userId") ?? ""), new Date());
        notice +=
          failed === 0
            ? " Their waiting requests have ended and their future calls were cancelled at no charge."
            : ` ${failed} of their future calls could not be cancelled automatically. Please cancel those by hand.`;
      } catch (error) {
        console.error("[admin] could not end the bookings of a suspended host", error);
        notice += " But their waiting requests and future calls could not be ended automatically. Please check them and end them by hand.";
      }
    }
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
      await confirmSocialName({ id, nameKey: String(formData.get("nameKey") ?? ""), code: String(formData.get("code") ?? ""), by: admin.id });
      await recordAdminAction({ adminId: admin.id, action: "social account confirmed", targetId: id, detail: String(formData.get("nameKey") ?? "") });
      notice = "The account is confirmed and now shown on the host's page.";
    } else {
      await rejectSocialName({ id, nameKey: String(formData.get("nameKey") ?? ""), code: String(formData.get("code") ?? "") });
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
    const { callsNotEnded } = await closeAccount({ userId: person.id, by: admin.id });
    await recordAdminAction({ adminId: admin.id, action: "account closed", targetUserId: person.id });
    notice =
      callsNotEnded === 0
        ? "The account is closed. It is logged out everywhere and cannot log in. Its calls that had not started were cancelled at no charge."
        : `The account is closed and cannot log in, but ${callsNotEnded > 0 ? `${callsNotEnded} of its calls` : "its requests and calls"} could not be ended automatically. Please check that person's requests and calls and end them by hand.`;
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function reopenAccountAction(formData: FormData) {
  const admin = await requireAdmin();
  await reopenAccount(String(formData.get("userId") ?? ""));
  await recordAdminAction({ adminId: admin.id, action: "account reopened", targetUserId: String(formData.get("userId") ?? "") });
  back("The account is open again. If it had a host profile, that stays suspended until you approve it.");
}
