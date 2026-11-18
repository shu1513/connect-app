"use server";

import { redirect } from "next/navigation";
import { invite, takeBackInvitation } from "@/lib/membership/join";
import { MembershipError } from "@/lib/membership/rules";
import { withNotice } from "@/lib/notice";
import { NoteError, saveHostNote } from "@/lib/people/contacts";
import { safeNext } from "@/lib/safe-next";
import { requireActiveUser, requireUser } from "@/lib/session";

/** A host saves their private note about a customer. Who may keep a note about whom is decided in saveHostNote. */
export async function saveNoteAction(formData: FormData) {
  const user = await requireUser();
  const back = safeNext(formData.get("back"));
  let notice = "Your note was saved. Only you can see it.";
  try {
    await saveHostNote({ hostId: user.id, customerId: String(formData.get("customerId") ?? ""), text: String(formData.get("text") ?? ""), now: new Date() });
  } catch (error) {
    if (!(error instanceof NoteError)) console.error("[contacts] could not save a note", error);
    notice = error instanceof NoteError ? error.message : "Something went wrong. The note was not saved. Please try again.";
  }
  redirect(withNotice(back === "/" ? "/contacts" : back, notice));
}

function membershipProblem(error: unknown): string {
  if (error instanceof MembershipError) return error.message;
  console.error("[membership] an invitation action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/**
 * A host invites someone she has had a call with to her membership. Who may be invited, the room
 * it needs and everything else is decided in `invite`; the form only names the person.
 */
export async function inviteAction(formData: FormData) {
  const user = await requireActiveUser();
  let notice = "Invited. They have 24 hours to join, and a place is kept for them until then. They got an email, and see the invitation on your page.";
  try {
    await invite({ hostId: user.id, customerId: String(formData.get("customerId") ?? ""), now: new Date() });
  } catch (error) {
    notice = membershipProblem(error);
  }
  redirect(withNotice("/contacts", notice));
}

/** The host takes an invitation back, until it is accepted. Only her own: `takeBackInvitation` checks whose it is. */
export async function takeBackInviteAction(formData: FormData) {
  const user = await requireActiveUser();
  let notice = "The invitation was taken back. Its place is free again, and they were told.";
  try {
    await takeBackInvitation({ hostId: user.id, membershipId: String(formData.get("membershipId") ?? ""), now: new Date() });
  } catch (error) {
    notice = membershipProblem(error);
  }
  redirect(withNotice("/contacts", notice));
}
