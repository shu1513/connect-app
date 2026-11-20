/**
 * The rules of a host's note that need no database: how long it may be, and how its text is
 * stored. Who may keep a note about whom, and saving one, is in contacts.ts.
 */

/** About two pages: one note is kept per customer and grows from call to call (plans/32). */
export const NOTE_MAX = 5000;

/**
 * A note as it is stored. Plain text: no control or invisible characters; line breaks are kept;
 * nothing at the ends.
 *
 * A save goes through only if the stored note is still what the page showed, and what the page
 * showed is tidied with this before it is compared. So tidying a tidied note must change nothing.
 */
export function tidyNote(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n]/gu, " ")
    .replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .trim();
}
