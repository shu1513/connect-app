/**
 * A host's own note about a customer, to read: before a call, and next to a request (plans/32).
 * Drawn only when there is a note, and only for the host it belongs to; the page or list that
 * draws it has asked the shared check (hostNoteAbout, hostNotesAbout).
 *
 * The text keeps its line breaks and sits in a box of limited height that scrolls, so a long
 * note never pushes the buttons below it out of reach.
 *
 * `folded` is for lists (plans/38): the note is one line, "Your notes about Anna", that opens with
 * a tap. A list is on show longer than the page of one call, and a host may be sharing her screen.
 * The browser keeps "open" itself, so a note she opened stays open while the page is refreshed;
 * whoever draws it gives it a key, so it closes again when it becomes a note about someone else.
 */
export function AboutCustomer({ name, text, folded = false }: { name: string; text: string; folded?: boolean }) {
  const body = (
    // Reachable by keyboard, so it can be scrolled without a mouse.
    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words" tabIndex={0}>
      {text}
    </p>
  );
  if (folded) {
    return (
      <details className="mt-2 rounded border border-neutral-400 px-3 text-sm" data-host-note="folded">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Your notes about {name}</summary>
        <div className="pb-3">
          <p className="opacity-70">Your private notes. Only you can see them.</p>
          {body}
        </div>
      </details>
    );
  }
  return (
    <section className="mt-3 rounded border border-neutral-400 p-3 text-sm" aria-label={`About ${name}`} data-host-note>
      {/* Not a heading: this sits inside list items and under headings of different levels. The section is named above. */}
      <p className="font-semibold">About {name}</p>
      <p className="opacity-70">Your private notes. Only you can see them.</p>
      {body}
    </section>
  );
}
