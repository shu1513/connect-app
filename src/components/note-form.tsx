import { saveNoteAction } from "@/app/contacts/actions";
import { NOTE_MAX } from "@/lib/people/contacts";

/** A host's private note about one customer. Only the host ever sees it. */
export function NoteForm({ customerId, name, text, back }: { customerId: string; name: string; text: string | null; back: string }) {
  return (
    <form action={saveNoteAction} className="mt-2 text-sm">
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="back" value={back} />
      <label className="block">
        Your private note about {name} (only you can see it)
        <textarea name="text" rows={3} maxLength={NOTE_MAX} defaultValue={text ?? ""} className="mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2" />
      </label>
      <button type="submit" className="mt-1 rounded border border-neutral-500 px-3 py-1.5">
        Save note
      </button>
    </form>
  );
}
