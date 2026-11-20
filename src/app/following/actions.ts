"use server";

import { redirect } from "next/navigation";
import { follow, FollowError, unfollow } from "@/lib/follows/follows";
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
