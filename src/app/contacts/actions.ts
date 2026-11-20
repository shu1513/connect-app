"use server";

import { redirect } from "next/navigation";
import { invite, takeBackInvitation } from "@/lib/membership/join";
import { MembershipError } from "@/lib/membership/rules";
import { withNotice } from "@/lib/notice";
import type { NoteFormState } from "@/components/note-form-state";
import { NoteError, saveHostNote } from "@/lib/people/contacts";
import { getUser, requireActiveUser } from "@/lib/session";

/**
 * A host saves their private note about a customer. Who may keep a note about whom is decided in
 * saveHostNote, with the logged-in person as the host.
 *
 * It answers in place and never sends the browser on (note-form.tsx): with the note as it is now
 * stored when the save went through, and with what was typed when it did not. What the box says
 * it was showing (`state.shown`) comes from the browser and is only ever compared with the stored
 * note; a box that lies about it can at worst overwrite its own host's note.
 */
export async function saveNoteAction(state: NoteFormState, formData: FormData): Promise<NoteFormState> {
  // A form sends line breaks as CRLF and the box shows them as LF: the draft goes back the way the box shows it,
  // so the box's count of the room that is left is right after a refusal too. Nothing else about it is changed.
  const draft = String(formData.get("text") ?? "").replace(/\r\n?/g, "\n");
  const shown = typeof state?.shown === "string" ? state.shown : null;
  const refused = (error: string): NoteFormState => ({ error, saved: false, draft, shown });
  // Asked without sending the browser to the login page: someone whose login ran out while they were typing keeps their draft.
  const user = await getUser();
  if (!user) return refused("You are not logged in any more. Copy what you typed, log in again, and then save it.");
  try {
    const stored = await saveHostNote({ hostId: user.id, customerId: String(formData.get("customerId") ?? ""), text: draft, shown, now: new Date() });
    return { error: null, saved: true, draft: stored ?? "", shown: stored };
  } catch (error) {
    if (error instanceof NoteError) return refused(error.message);
    // Never the error itself: a database error carries the statement's values, which here are the note that was
    // typed and the note that was stored. Only what kind of error it was is written down.
    const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    console.error(`[contacts] could not save a note (${error instanceof Error ? error.name : "unknown error"}${typeof code === "string" ? `, database code ${code}` : ""})`);
    return refused("Something went wrong. Please try again.");
  }
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
