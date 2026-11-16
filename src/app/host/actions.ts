"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { setVerifiedOnly } from "@/lib/booking/bookings";
import { withNotice } from "@/lib/notice";
import { collectEarnings } from "@/lib/payments/collect";
import { ensurePayoutAccount, getHostSettings, payoutSetupLink, publicAppUrl } from "@/lib/payments/hosts";
import { MoneyError } from "@/lib/payments/operations";
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
import { requireActiveUser, requireUser } from "@/lib/session";

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

/**
 * The host presses "Collect earnings". The host is the logged-in person and the money goes to their
 * own payout account; nothing about either is taken from the page. A paused host may collect:
 * pausing stops new requests and calls, it does not keep back money already earned.
 */
export async function collectEarningsAction(formData: FormData) {
  const user = await requireUser("/host");
  let notice: string;
  try {
    await collectEarnings({ collectionId: String(formData.get("collectionId") ?? ""), hostId: user.id, startedBy: user.id });
    notice = "Your collection was accepted. What was sent is shown under \"Getting paid\".";
  } catch (error) {
    // A MoneyError is a refusal before anything was accepted. Anything else may have happened after
    // acceptance (even a lost answer from the database), so it must not claim that nothing was sent.
    if (error instanceof MoneyError) notice = `${error.message} Nothing was sent and no charge was taken.`;
    else {
      console.error("[payments] collecting earnings failed", error);
      notice = "We could not confirm what happened. Look under \"Getting paid\": if a collection is shown there, it was made and you do not need to press again.";
    }
  }
  redirect(`${withNotice("/host", notice)}#paid`);
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

/** The host chooses whether only people who have confirmed their ID can ask for a call. Applies to new requests. */
export async function saveVerifiedOnly(formData: FormData) {
  const user = await requireActiveUser();
  const on = formData.get("verifiedOnly") === "on";
  await setVerifiedOnly(user.id, on);
  back(on ? "Saved. From now on, only people who have confirmed their ID can ask you for a call." : "Saved. Anyone can ask you for a call again.");
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
  let notice: string;
  try {
    await removeSocialName(user.id, String(formData.get("id") ?? ""));
    notice = "The account was removed from your profile.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}
