"use server";

import { redirect } from "next/navigation";
import { membershipFor } from "@/lib/membership/access";
import { acceptLessTime, cancelNow, declineLessTime, stopRenewal, undoStop } from "@/lib/membership/ending";
import { MembershipError } from "@/lib/membership/rules";
import { withNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";

/**
 * A member's buttons for their own membership: cancelling (the normal way, and "Cancel now"),
 * "Keep my membership", and the answer to an offer of less time. Every action asks the library,
 * which checks again that the person asking is this membership's member. Cancelling is never
 * refused for a paused account: someone must always be able to stop a payment.
 */

function problem(error: unknown): string {
  if (error instanceof MembershipError) return error.message;
  console.error("[membership] a member's action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** The membership the form is about, as this person's own; anyone else's and one that does not exist go to "Your account". */
async function mine(formData: FormData): Promise<{ userId: string; membershipId: string; currentMonthId: string | null; page: string }> {
  const user = await requireUser();
  const found = await membershipFor(user.id, String(formData.get("membership") ?? ""));
  if (!found) redirect("/account");
  return { userId: user.id, membershipId: found.membership.id, currentMonthId: found.membership.currentMonthId, page: `/memberships/${found.membership.id}` };
}

/** "Cancel membership", the normal way: the renewal is stopped. (With a payment still open there is no month to run out: it is paused at once.) */
export async function cancelAction(formData: FormData) {
  const { userId, membershipId, page } = await mine(formData);
  let notice: string;
  try {
    await stopRenewal({ membershipId, by: "member", actorId: userId, now: new Date() });
    // (Read apart from the save: a failed read never turns a saved cancellation into "nothing was changed".)
    const after = await membershipFor(userId, membershipId).catch(() => null);
    // Said only as far as it is certain. Whether "Keep my membership" is still open (it needs the founder's switch, room,
    // and a month that has not ended) is for the page to show.
    notice =
      after?.membership.status === "paused"
        ? "Your membership is paused now. Nothing more is charged."
        : "Your membership is cancelled: it will not renew. This page shows how it stands now.";
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(page, notice));
}

/** "Cancel now, nothing is charged": while the month's amount is only held. */
export async function cancelNowAction(formData: FormData) {
  const { userId, membershipId, currentMonthId, page } = await mine(formData);
  // (The hold is let go right after the pause is saved; if Stripe cannot be reached at that moment, the helper does it. So: "is being let go".)
  let notice = "Your membership is paused as of now, and nothing is charged for this month. The hold on your card is being let go; your bank may still show it for a few days.";
  try {
    // "Cancel now" is for the month the page showed. If another month is the current one by now (the page was left open across a renewal), nothing is cancelled.
    const shown = String(formData.get("month") ?? "");
    if (shown && shown !== currentMonthId) throw new MembershipError("Your membership has moved on to another month since this page was opened. Nothing was changed. Please look at it again.");
    await cancelNow({ membershipId, memberId: userId, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(page, notice));
}

/** "Keep my membership": takes back the member's own cancelling (and the stop from the host's switch). It never takes back the host's pause, and its sentence never promises a renewal by itself. */
export async function keepAction(formData: FormData) {
  const { userId, membershipId, page } = await mine(formData);
  let notice: string;
  try {
    await undoStop({ membershipId, by: "member", actorId: userId, now: new Date() });
    const after = await membershipFor(userId, membershipId).catch(() => null);
    // What was done is said; a renewal is not promised here. The page knows every condition for one (the host's pause, an
    // offer to answer, the founder's switch), also when this form was an old one from another tab.
    notice =
      after?.membership.status === "active" && after.membership.hostStoppedAt
        ? "Your own cancelling is taken back. Your membership is still set to pause when this month ends; this page says why."
        : "Your own cancelling is taken back, and nothing is charged today. This page shows your next payment, or what still stands in its way.";
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(page, notice));
}

/** The member accepts the smaller time the host offered. The button carries the offer's own id, so an old button answers nothing. */
export async function acceptOfferAction(formData: FormData) {
  const { userId, membershipId, page } = await mine(formData);
  let notice = "You accepted. The smaller time starts with your next month; the month you paid for does not change, and nothing is charged today.";
  try {
    await acceptLessTime({ membershipId, memberId: userId, offerId: String(formData.get("offer") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(page, notice));
}

/** "No thanks": the member keeps the month they paid for and is paused when it ends. */
export async function declineOfferAction(formData: FormData) {
  const { userId, membershipId, page } = await mine(formData);
  let notice = "You said \"No thanks\". You keep the month you paid for, and your membership is paused when it ends. You can resume it later when there is room.";
  try {
    await declineLessTime({ membershipId, memberId: userId, offerId: String(formData.get("offer") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(page, notice));
}
