"use server";

import { eq } from "drizzle-orm";
import { RULES } from "@/lib/terms";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { endBookingsOfSuspendedHost } from "@/lib/booking/moderation";
import { momentIn } from "@/lib/booking/calendar";
import { withNotice } from "@/lib/notice";
import { closeAccount, reopenAccount } from "@/lib/profiles/closing";
import { lockPhotoAsFounder, recordPhotoReportMade, removePhotoAsFounder } from "@/lib/profiles/photo";
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
      // The rule and the facts, for "declined" and "suspended": the host is told them (plans/46, decision 11).
      reason: decision === "approved" ? undefined : { ruleKey: String(formData.get("ruleKey") ?? ""), note: String(formData.get("reasonNote") ?? "") },
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

/** The founder removes a host's photo. The host can choose one again. */
export async function removePhotoAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The photo is removed. The host's page shows the letter again.";
  try {
    await removePhotoAsFounder({ adminId: admin.id, photoId: String(formData.get("photoId") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

/** "Remove and report" for a host's photo. Behind a tick box, because it cannot be undone. */
export async function lockPhotoAction(formData: FormData) {
  const admin = await requireAdmin();
  if (formData.get("sure") !== "on") back("Tick the box to remove and report a photo. Nothing was changed.");
  let notice = "The photo is removed and kept for the report. The host can choose no other photo. Now make the report, then write down below when you made it.";
  try {
    await lockPhotoAsFounder({ adminId: admin.id, photoId: String(formData.get("photoId") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

/** "I have made the report" for a host's photo, with the day and time it was really made, typed in the founder's own time zone. */
export async function photoReportMadeAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The time of the report is written down.";
  try {
    const madeAt = momentIn(admin.timeZone ?? "UTC", String(formData.get("madeAt") ?? ""));
    await recordPhotoReportMade({ adminId: admin.id, photoId: String(formData.get("photoId") ?? ""), madeAt: madeAt ?? new Date(Number.NaN), now: new Date() });
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
    // The rule and the facts: the person is told them by email (plans/46, decision 11).
    const rule = RULES.find((r) => r.key === String(formData.get("ruleKey") ?? ""));
    const note = String(formData.get("reasonNote") ?? "").trim();
    if (!rule || !note) throw new ProfileError("Choose the rule, and say in a sentence what happened. The person is told this reason.");
    if (note.length > 500) throw new ProfileError("Please keep the reason under 500 characters.");
    const reason = `${rule.title}. ${note}`;
    const { callsNotEnded } = await closeAccount({ userId: person.id, by: admin.id, reason });
    await recordAdminAction({ adminId: admin.id, action: "account closed", targetUserId: person.id, detail: reason });
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
