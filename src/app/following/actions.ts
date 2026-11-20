"use server";

import { redirect } from "next/navigation";
import { saveChoices } from "@/lib/follows/emails";
import { follow, FollowError, unfollow } from "@/lib/follows/follows";
import { EMAILS, readHours } from "@/lib/follows/rules";
import { withNotice } from "@/lib/notice";
import { safeNext } from "@/lib/safe-next";
import { requireActiveUser, requireUser } from "@/lib/session";

/** Where to go back to: the page the button was on, or the list. */
function backTo(formData: FormData): string {
  const back = safeNext(formData.get("back"));
  return back === "/" ? "/following" : back;
}

/**
 * Follows the host whose page has the handle in the form. Who follows comes from the login,
 * never from the form; who may be followed is decided in `follow`.
 */
export async function followAction(formData: FormData) {
  const user = await requireActiveUser();
  let notice: string;
  try {
    const host = await follow({ followerId: user.id, handle: String(formData.get("handle") ?? ""), now: new Date() });
    notice = `You follow ${host.displayName}. When they are available now, you see it on your home page.`;
  } catch (error) {
    if (!(error instanceof FollowError)) console.error("[follows] could not follow", error);
    notice = error instanceof FollowError ? error.message : "Something went wrong. Nothing was changed. Please try again.";
  }
  redirect(withNotice(backTo(formData), notice));
}

/** Ends the person's own follow of a host, or says "Don't follow" before there is one. A paused person can do this too. */
export async function unfollowAction(formData: FormData) {
  const user = await requireUser();
  let notice = "Done. You do not follow them, and a call will not change that. You can follow them again from their page.";
  try {
    await unfollow({ followerId: user.id, hostId: String(formData.get("hostId") ?? ""), now: new Date() });
  } catch (error) {
    console.error("[follows] could not unfollow", error);
    notice = "Something went wrong. Nothing was changed. Please try again.";
  }
  redirect(withNotice(backTo(formData), notice));
}

function problem(error: unknown): string {
  if (error instanceof FollowError) return error.message;
  console.error("[follows] could not save the choice of emails", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/**
 * Saves the person's choice of emails about one host they follow (plans/31): the two ticks and
 * the hours. Whose choices they are comes from the login. A paused person can switch off, not on;
 * that is decided in `saveChoices`.
 */
export async function saveChoicesAction(formData: FormData) {
  const user = await requireUser();
  const hours = readHours(String(formData.get("from") ?? ""), String(formData.get("to") ?? ""));
  let notice = "Your choice of emails was saved.";
  if (hours === false) notice = "Choose both hours, and two different ones, or leave both on \"any time\". Nothing was changed.";
  else {
    try {
      await saveChoices({ followerId: user.id, hostId: String(formData.get("hostId") ?? ""), tellOnline: formData.get("online") === "on", tellPosts: formData.get("posts") === "on", hours, now: new Date() });
    } catch (error) {
      notice = problem(error);
    }
  }
  redirect(withNotice("/following", notice));
}

/** The one question on the results of a call: "Email you when Anna is available now?" Only that tick is set; the rest stays. */
export async function askOnlineAction(formData: FormData) {
  const user = await requireActiveUser();
  let notice = `Done. You get an email when they are available now, at most one in ${EMAILS.perHostHours} hours. You can choose hours, or switch it off, under "Hosts you follow".`;
  try {
    await saveChoices({ followerId: user.id, hostId: String(formData.get("hostId") ?? ""), tellOnline: true, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(backTo(formData), notice));
}
