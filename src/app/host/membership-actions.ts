"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { endByHost, stopRenewal, takeBackLessTime, undoStop } from "@/lib/membership/ending";
import { saveOffer } from "@/lib/membership/offers";
import { MembershipError } from "@/lib/membership/rules";
import { withNotice } from "@/lib/notice";
import { requireActiveUser } from "@/lib/session";

/**
 * What the host's "Membership" part does. Every action asks the library, which checks again who
 * is asking and whether it may be done: a form is never trusted because the page that drew it was
 * allowed. The library takes the host's own id from the login, never from the form.
 */

/** Back to the "Membership" part of Hosting, with a sentence to show there. (The notice is signed for the page; the part is only where the browser scrolls to.) */
const toPart = (text: string): string => withNotice("/host", text) + "#membership";

function problem(error: unknown): string {
  if (error instanceof MembershipError) return error.message;
  console.error("[membership] a host's action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** Where the page that shows a change before it is saved lives, with the values it was asked about. */
function previewPath(input: { on: boolean; priceCents: number; minutes: number }): string {
  return `/host/membership?${input.on ? "on=1&" : ""}price=${(input.priceCents / 100).toFixed(2)}&minutes=${input.minutes}`;
}

/**
 * "Save this change": the proposed values and the short mark of what the page showed. If anything
 * about the membership or the members changed meanwhile, nothing is saved and the page is shown
 * again with the state as it is now.
 */
export async function saveMembershipAction(formData: FormData) {
  const user = await requireActiveUser();
  const input = { on: formData.get("on") === "1", pricePer15Cents: Number(formData.get("priceCents")), includedMinutes: Number(formData.get("minutes")) };
  let to: string;
  try {
    const change = await saveOffer(user.id, input, String(formData.get("mark") ?? ""));
    to = toPart(change.switchingOff ? "Your membership is switched off. Nothing new can start; months that have started go on to their end." : input.on ? "Your membership was saved." : "Saved.");
  } catch (error) {
    // Shown again, with the numbers as they are now.
    to = withNotice(previewPath({ on: input.on, priceCents: input.pricePer15Cents, minutes: input.includedMinutes }), problem(error));
  }
  redirect(to);
}

/** "Pause after this month" for one member (at once, if they have no month that has started). */
export async function pauseMemberAction(formData: FormData) {
  const user = await requireActiveUser();
  let notice = "Done. They keep the month they paid for and are paused when it ends. They were told by email. You can undo this until then.";
  try {
    const membershipId = String(formData.get("membershipId") ?? "");
    await stopRenewal({ membershipId, by: "host", actorId: user.id, now: new Date() });
    // A member with no month that has started (their payment was still open) is paused at once: said as it happened.
    const [after] = await db.select({ status: schema.memberships.status }).from(schema.memberships).where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.hostId, user.id)));
    if (after?.status === "paused") notice = "Done. They had no month that had started, so their open payment was cancelled and they are paused now. They were told by email. They can resume when there is room.";
  } catch (error) {
    notice = problem(error);
  }
  redirect(toPart(notice));
}

/** The host undoes her own pause. It needs room; it never undoes a member's own cancelling or a "No thanks". */
export async function undoPauseAction(formData: FormData) {
  const user = await requireActiveUser();
  let notice = "Your pause was undone. They were told by email.";
  try {
    await undoStop({ membershipId: String(formData.get("membershipId") ?? ""), by: "host", actorId: user.id, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  redirect(toPart(notice));
}

/** "End membership": at once and for good. The tick box is checked here too, not only in the browser. */
export async function endMemberAction(formData: FormData) {
  const user = await requireActiveUser();
  let notice = "The membership has ended. Their upcoming member calls are cancelled and the time they had not used is paid back to their card. They were told by email.";
  try {
    if (formData.get("sure") !== "1") throw new MembershipError("Tick \"End it for good\" first. Ending cannot be undone; only a new invitation brings a member back.");
    await endByHost({ membershipId: String(formData.get("membershipId") ?? ""), hostId: user.id, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  redirect(toPart(notice));
}

/** The host takes an unanswered offer of less time back: keeping the member at their time (which needs room), or pausing them after this month. */
export async function takeBackOfferAction(formData: FormData) {
  const user = await requireActiveUser();
  const keep = formData.get("keep") === "1";
  let notice = keep ? "The offer was taken back. They go on with the time they had. They were told by email." : "The offer was taken back. They are paused when this month ends. They were told by email.";
  try {
    await takeBackLessTime({ membershipId: String(formData.get("membershipId") ?? ""), hostId: user.id, offerId: String(formData.get("offerId") ?? ""), keep, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  redirect(toPart(notice));
}
