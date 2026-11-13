"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { NoteError, saveHostNote } from "@/lib/people/contacts";
import { safeNext } from "@/lib/safe-next";
import { requireUser } from "@/lib/session";

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
