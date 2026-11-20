/**
 * What a note box holds and what its action answers with (note-form.tsx).
 *
 * `draft` is what is in the box. `shown` is the note as this box last knew it to be stored (null:
 * none): it travels with every save, and the save goes through only if the stored note is still
 * that. The two are kept apart on purpose. After a save that went through, both are what was
 * stored; after a refusal, `draft` is what was typed and `shown` stays as it was, so the box
 * never quietly takes over a newer note and then overwrites it.
 */
export type NoteFormState = { error: string | null; saved: boolean; draft: string; shown: string | null };
