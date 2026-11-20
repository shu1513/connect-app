"use client";

import { useActionState, useState } from "react";
import { saveNoteAction } from "@/app/contacts/actions";
import type { NoteFormState } from "./note-form-state";

/** From this many characters before the limit, the box says how much room is left. */
const SAY_ROOM_LEFT_FROM = 500;

/**
 * A host's private notepad about one customer: one note, kept from call to call. Only the host
 * ever sees it. Whether this person may keep it is decided on the server (saveHostNote); a page
 * draws this only for a host it has already asked about.
 *
 * It answers in place, whether the save went through or not, and what was typed is never lost
 * over a refusal: the same notepad can be open in several places, and a save from a box that is
 * out of date is refused (plans/32, decisions 9 and 10).
 *
 * `max` is handed in by the page: this file runs in the browser and must not pull in the code
 * that knows the limit, because that code talks to the database.
 */
export function NoteForm({ customerId, name, text, max }: { customerId: string; name: string; text: string | null; max: number }) {
  const [state, formAction, pending] = useActionState<NoteFormState, FormData>(saveNoteAction, { error: null, saved: false, draft: text ?? "", shown: text });
  // How long the text in the box is, once the host has typed since the server's last answer.
  const [typed, setTyped] = useState<{ since: NoteFormState; length: number } | null>(null);
  const touched = typed?.since === state;
  const left = max - (touched ? typed.length : state.draft.length);
  return (
    <form action={formAction} className="mt-3 text-sm">
      <input type="hidden" name="customerId" value={customerId} />
      <label className="block">
        <span className="block text-base font-semibold">About {name}</span>
        <span className="block opacity-70">Your private notes. Only you can see them.</span>
        <textarea
          name="text"
          rows={5}
          maxLength={max}
          defaultValue={state.draft}
          readOnly={pending}
          onChange={(event) => setTyped({ since: state, length: event.target.value.length })}
          className="mt-2 w-full rounded border border-neutral-400 bg-transparent px-3 py-2"
        />
      </label>
      {left <= SAY_ROOM_LEFT_FROM && (
        <p className="opacity-70">
          {Math.max(0, left)} {left === 1 ? "character" : "characters"} left.
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-1 rounded border border-red-600 p-3">
          {state.error} Nothing was saved. What you typed is still in the box.
        </p>
      )}
      <p className="mt-1 flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded border border-neutral-500 px-3 py-1.5">
          {pending ? "Saving…" : "Save"}
        </button>
        {/* Always on the page, filled when there is something to say: a screen reader announces a change inside it. */}
        <span role="status">{state.saved && !touched && !pending ? "Saved." : ""}</span>
      </p>
    </form>
  );
}
