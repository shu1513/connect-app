import { describe, expect, it } from "vitest";
import { NOTE_MAX, tidyNote } from "./note-rules";

describe("a host's note, as it is stored", () => {
  it("keeps line breaks, whichever way they were sent", () => {
    expect(tidyNote("one\r\ntwo\rthree\nfour")).toBe("one\ntwo\nthree\nfour");
  });

  it("turns control and invisible characters into spaces, and drops what is at the ends", () => {
    expect(tidyNote("  a\u0000b\tc​d e  \n")).toBe("a b c d e");
  });

  it("changes nothing in a note that is already tidy: an unchanged note always compares equal", () => {
    const samples = ["Likes sailing.\n\nSecond call: moved to Lisbon. 😀", "  x \r\n y\u0000 ", "a\n \nb", `${"a".repeat(2498)}\n😀\n${"b".repeat(2498)}`];
    for (const sample of samples) {
      const stored = tidyNote(sample);
      expect(tidyNote(stored)).toBe(stored);
      // A browser sends a form's line breaks as CRLF.
      expect(tidyNote(stored.replace(/\n/g, "\r\n"))).toBe(stored);
    }
  });

  it("counts an emoji as two, and the limit is 5,000", () => {
    expect(NOTE_MAX).toBe(5000);
    expect(tidyNote(`${"a".repeat(2498)}\n😀\n${"b".repeat(2498)}`)).toHaveLength(NOTE_MAX);
  });
});
