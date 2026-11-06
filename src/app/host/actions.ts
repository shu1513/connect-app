"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { withNotice } from "@/lib/notice";
import { ensurePayoutAccount, getHostSettings, payoutSetupLink, publicAppUrl } from "@/lib/payments/hosts";
import { FREE_CANCEL_CHOICES_MINUTES } from "@/lib/payments/rules";
import {
  addSocialName,
  createHostProfile,
  markSocialNameReady,
  ProfileError,
  removeSocialName,
  setProfileHidden,
  updateHostProfile,
} from "@/lib/profiles/profiles";
import { requireActiveUser } from "@/lib/session";

function back(text: string): never {
  redirect(withNotice("/host", text));
}

function problem(error: unknown): string {
  if (error instanceof ProfileError) return error.message;
  console.error("[profiles] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** Sends the host to Stripe's own form to set up (or finish setting up) their payout account. */
export async function startPayoutSetup() {
  const user = await requireActiveUser();
  let url: string;
  try {
    const accountId = await ensurePayoutAccount(user);
    const base = publicAppUrl();
    url = await payoutSetupLink(accountId, {
      returnUrl: `${base}/host/payouts-return`,
      refreshUrl: `${base}/host/payouts-return?again=1`,
    });
  } catch (error) {
    console.error("[payments] could not start payout setup", error);
    back("Payout setup could not be started. Please try again.");
  }
  redirect(url);
}

/** The host chooses how long before the start cancelling is free. Applies to calls created from now on. */
export async function saveCancelRule(formData: FormData) {
  const user = await requireActiveUser();
  const minutes = Number(formData.get("freeCancelMinutes"));
  if (!(FREE_CANCEL_CHOICES_MINUTES as readonly number[]).includes(minutes)) back("Choose one of the listed cancelling rules.");
  await getHostSettings(user.id);
  await db
    .update(schema.hostSettings)
    .set({ freeCancelMinutes: minutes, updatedAt: new Date() })
    .where(eq(schema.hostSettings.userId, user.id));
  back("Your cancelling rule was saved. It applies to calls created from now on.");
}

function priceCents(formData: FormData): number {
  const dollars = Number(formData.get("price") || 0);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : -1;
}

/** A person applies to host. The profile is not public until the founder approves it. */
export async function createProfile(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    await createHostProfile(user.id, {
      handle: String(formData.get("handle") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      about: String(formData.get("about") ?? ""),
      pricePer15Cents: priceCents(formData),
      usConfirmed: formData.get("us") === "on",
    });
    notice = "Your host profile was sent for approval. It becomes public once it is approved.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function saveProfile(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    await updateHostProfile(user.id, {
      displayName: String(formData.get("displayName") ?? ""),
      about: String(formData.get("about") ?? ""),
      pricePer15Cents: priceCents(formData),
    });
    notice = "Your host profile was saved.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function setHidden(formData: FormData) {
  const user = await requireActiveUser();
  const hidden = formData.get("hidden") === "yes";
  await setProfileHidden(user.id, hidden);
  back(hidden ? "Your profile is now hidden. Calls already booked still happen." : "Your profile is no longer hidden.");
}

export async function addSocial(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    await addSocialName(user.id, String(formData.get("network") ?? ""), String(formData.get("name") ?? ""));
    notice = "Added. Now put the code shown below in that account's bio, then press \"I've done it\".";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function socialReady(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    await markSocialNameReady(user.id, String(formData.get("id") ?? ""));
    notice = "Thank you. We will look at the account and confirm it. Keep the code in the bio until then.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function removeSocial(formData: FormData) {
  const user = await requireActiveUser();
  await removeSocialName(user.id, String(formData.get("id") ?? "")).catch(() => undefined);
  back("The account was removed from your profile.");
}
