/**
 * A host's own note about a customer, to read: before a call, and next to a request (plans/32).
 * Drawn only when there is a note, and only for the host it belongs to; the page or list that
 * draws it has asked the shared check (hostNoteAbout, hostNotesAbout).
 *
 * The text keeps its line breaks and sits in a box of limited height that scrolls, so a long
 * note never pushes the buttons below it out of reach.
 */
export function AboutCustomer({ name, text }: { name: string; text: string }) {
  return (
    <section className="mt-3 rounded border border-neutral-400 p-3 text-sm" aria-label={`About ${name}`} data-host-note>
      {/* Not a heading: this sits inside list items and under headings of different levels. The section is named above. */}
      <p className="font-semibold">About {name}</p>
      <p className="opacity-70">Your private notes. Only you can see them.</p>
      {/* Reachable by keyboard, so it can be scrolled without a mouse. */}
      <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words" tabIndex={0}>
        {text}
      </p>
    </section>
  );
}
