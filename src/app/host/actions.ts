"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { setVerifiedOnly } from "@/lib/booking/bookings";
import { withNotice } from "@/lib/notice";
import { collectEarnings } from "@/lib/payments/collect";
import { ensurePayoutAccount, getHostSettings, payoutSetupLink, PayoutSetupError, publicAppUrl } from "@/lib/payments/hosts";
import { MoneyError } from "@/lib/payments/operations";
import { FREE_CANCEL_CHOICES_MINUTES } from "@/lib/payments/rules";
import { isAutomatic } from "@/lib/profiles/bio-check";
import {
  addSocialName,
  createHostProfile,
  ProfileError,
  removeSocialName,
  setProfileHidden,
  socialNameReady,
  updateHostProfile,
} from "@/lib/profiles/profiles";
import { removePhoto, takePhoto } from "@/lib/profiles/photo";
import { photoNotice } from "@/lib/profiles/photo-words";
import { startTikTokPhoto } from "@/lib/profiles/tiktok-photo";
import { INSTAGRAM_COOKIE, INSTAGRAM_COOKIE_PATH, instagramSettings } from "@/lib/profiles/instagram";
import { INSTAGRAM_OFF, startInstagramLogin } from "@/lib/profiles/instagram-login";
import { TIKTOK_COOKIE, TIKTOK_COOKIE_PATH, tiktokSettings } from "@/lib/profiles/tiktok";
import { startTikTokLogin, TIKTOK_OFF } from "@/lib/profiles/tiktok-login";
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
    // A reason the host can read (no profile yet, or an account in another country than their profile's).
    if (error instanceof PayoutSetupError) back(error.message);
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
      country: String(formData.get("country") ?? ""),
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
    const network = String(formData.get("network") ?? "");
    await addSocialName(user.id, network, String(formData.get("name") ?? ""));
    notice = `Added. Now put the code shown below in ${network === "youtube" ? "that channel's description" : "that account's bio"}, then press "${isAutomatic(network) ? "Check now" : "I've done it"}".`;
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

/**
 * The host says the code is in place ("Check now" or "I've done it"). Whether Connect looks itself
 * or the founder is asked is decided on the server from the entry, never from the button pressed.
 */
export async function socialReady(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    const { outcome, network, nameKey } = await socialNameReady(user.id, String(formData.get("id") ?? ""));
    const tryLater = "We could not check right now. Please try again in a few minutes.";
    notice = {
      waiting: `Thank you. We will look at the account and confirm it. Keep the code in ${network === "youtube" ? "the channel's description" : "the bio"} until then.`,
      confirmed: "Account confirmed. You can remove the code.",
      not_found: `We looked at @${nameKey} and did not find the code. Save it, wait a minute, and press Check now again.`,
      no_account: `We could not read @${nameKey}. Check the name.${network === "instagram" ? " On Instagram it must be a Creator or Business account, which is free to switch to in Instagram's settings." : ""}`,
      unavailable: tryLater,
      busy: "Many people are checking right now. Please try again in a little while.",
      too_soon: "Please wait a moment before checking again.",
      limit: "You have checked many times. Please try again in an hour.",
      gone: "This check made no change. Look at the account below to see where it stands.",
      taken: "That account is already confirmed for another host. If it is yours, write to us.",
    }[outcome];
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
    notice = "That account is no longer on your profile.";
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

/**
 * "Use my Instagram photo" and "Update" (plans/29). The host is the logged-in person, never taken
 * from the form; the network's name is checked here. Everything else is decided in takePhoto.
 */
export async function usePhoto(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    if (formData.get("network") !== "instagram") throw new ProfileError("Choose one of your confirmed accounts.");
    notice = photoNotice(await takePhoto({ userId: user.id, network: "instagram" }), "instagram");
  } catch (error) {
    notice = problem(error);
  }
  redirect(`${withNotice("/host", notice)}#photo`);
}

/** The host removes their photo. Their page shows the letter again. */
export async function removeOwnPhoto() {
  const user = await requireActiveUser();
  let notice: string;
  try {
    notice = (await removePhoto({ userId: user.id, now: new Date() })) ? "Your photo was removed." : "You have no photo to remove.";
  } catch (error) {
    notice = problem(error);
  }
  redirect(`${withNotice("/host", notice)}#photo`);
}

/**
 * "Connect your Instagram": sends the host to Meta to log in there and share their Instagram
 * account. A note of who started is kept in a cookie only this server can read and that is sent
 * only to the return address.
 */
export async function connectInstagram() {
  const user = await requireActiveUser();
  const settings = instagramSettings();
  if (!settings) back(INSTAGRAM_OFF);
  const [profile] = await db.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id));
  if (!profile) back("Fill in your host profile first.");
  const login = startInstagramLogin({ userId: user.id, now: new Date(), settings });
  (await cookies()).set(INSTAGRAM_COOKIE, login.note, {
    httpOnly: true,
    secure: true,
    // "lax" is what lets the cookie come back when Meta returns the host to us.
    sameSite: "lax",
    path: INSTAGRAM_COOKIE_PATH,
    maxAge: login.maxAgeSeconds,
  });
  redirect(login.url);
}

/**
 * "Use my TikTok photo" and "Update" for a photo that came from TikTok (plans/30). Connect keeps no
 * key from TikTok, so this sends the host to TikTok's sign-in; the picture comes back with it. The
 * try is written down first, and every refusal a press can meet is told here, before the host is
 * sent anywhere. The host is the logged-in person, never taken from the form.
 */
export async function useTikTokPhoto() {
  const user = await requireActiveUser();
  const settings = tiktokSettings();
  if (!settings) redirect(`${withNotice("/host", TIKTOK_OFF)}#photo`);
  let login: Awaited<ReturnType<typeof startTikTokPhoto>>;
  try {
    login = await startTikTokPhoto({ userId: user.id, now: new Date(), settings });
  } catch (error) {
    redirect(`${withNotice("/host", problem(error))}#photo`);
  }
  if ("refused" in login) redirect(`${withNotice("/host", photoNotice({ outcome: login.refused }, "tiktok"))}#photo`);
  (await cookies()).set(TIKTOK_COOKIE, login.note, {
    httpOnly: true,
    secure: true,
    // "lax" is what lets the cookie come back when TikTok returns the host to us.
    sameSite: "lax",
    path: TIKTOK_COOKIE_PATH,
    maxAge: login.maxAgeSeconds,
  });
  redirect(login.url);
}

/**
 * "Connect your TikTok": sends the host to TikTok to log in there. A note of who started is kept
 * in a cookie only this server can read and that is sent only to the return address.
 */
export async function connectTikTok() {
  const user = await requireActiveUser();
  const settings = tiktokSettings();
  if (!settings) back(TIKTOK_OFF);
  const [profile] = await db.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id));
  if (!profile) back("Fill in your host profile first.");
  const login = startTikTokLogin({ userId: user.id, now: new Date(), settings });
  (await cookies()).set(TIKTOK_COOKIE, login.note, {
    httpOnly: true,
    secure: true,
    // "lax" is what lets the cookie come back when TikTok returns the host to us.
    sameSite: "lax",
    path: TIKTOK_COOKIE_PATH,
    maxAge: login.maxAgeSeconds,
  });
  redirect(login.url);
}
