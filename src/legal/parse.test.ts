import { describe, expect, it } from "vitest";
import { parse, type LinkFor } from "./parse";

const linkFor: LinkFor = (target) => {
  if (target === "payment-terms.md") return { href: "/payment-terms", outside: false };
  if (target.startsWith("https://")) return { href: target, outside: true };
  return null;
};
const read = (text: string) => parse(text, linkFor);

describe("reading a legal document", () => {
  it("reads headings of three depths, and their plain words", () => {
    const { blocks, problems } = read("# The title\n\n## 1. A **section**\n\n### 1.1 A part");
    expect(problems).toEqual([]);
    expect(blocks.map((b) => (b.t === "heading" ? [b.level, b.plain] : null))).toEqual([
      [1, "The title"],
      [2, "1. A section"],
      [3, "1.1 A part"],
    ]);
  });

  it("joins the lines of a paragraph, and an empty line ends it", () => {
    const { blocks } = read("1.1 First line\nand its second.\n\n1.2 Another.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ t: "paragraph", c: [{ t: "text", v: "1.1 First line and its second." }] });
  });

  it("does not take a numbered clause for a numbered list", () => {
    expect(read("20.1 Who this applies to.").blocks[0].t).toBe("paragraph");
    expect(read("1. First\n2. Second").blocks[0]).toMatchObject({ t: "list", ordered: true, start: 1 });
  });

  it("reads bold that runs over two lines, and bold inside a list", () => {
    const { blocks, problems } = read("**16.1 WE PROVIDE THE SERVICE\n\"AS IS\".**\n\n- **A LIMIT;**\n- plain");
    expect(problems).toEqual([]);
    expect(blocks[0]).toEqual({ t: "paragraph", c: [{ t: "bold", c: [{ t: "text", v: '16.1 WE PROVIDE THE SERVICE "AS IS".' }] }] });
    expect(blocks[1]).toMatchObject({ t: "list", ordered: false, items: [[{ t: "bold", c: [{ t: "text", v: "A LIMIT;" }] }], [{ t: "text", v: "plain" }]] });
  });

  it("lets a list item go on in the lines below it, and keeps one list across a single empty line", () => {
    const { blocks } = read("- first item\n  goes on here\n- second\n\n- third\n\nA paragraph.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ t: "list", items: [[{ t: "text", v: "first item goes on here" }], [{ t: "text", v: "second" }], [{ t: "text", v: "third" }]] });
  });

  it("a wrapped line that begins with a number and a full stop stays part of its paragraph or its item", () => {
    const paragraph = read("**EACH MAY RELY ON SECTIONS 16 TO\n19. NOBODY GIVES A PERSONAL PROMISE.** This does\nnot protect anyone.");
    expect(paragraph.problems).toEqual([]);
    expect(paragraph.blocks).toHaveLength(1);
    expect(paragraph.blocks[0]).toMatchObject({ t: "paragraph", c: [{ t: "bold" }, { t: "text", v: " This does not protect anyone." }] });
    const list = read("- see sections 3 to\n  5. More words.\n- next");
    expect(list.blocks).toHaveLength(1);
    expect((list.blocks[0] as { items: unknown[] }).items).toHaveLength(2);
    const numbered = read("1. first, as section\n  7. says\n2. second");
    expect((numbered.blocks[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("keeps the first number of a numbered list", () => {
    expect(read("3. third\n4. fourth").blocks[0]).toMatchObject({ t: "list", ordered: true, start: 3 });
  });

  it("reads links to another document and to an address outside, and says so when one leads nowhere", () => {
    const { blocks, problems } = read("See the [Payment Terms](payment-terms.md) and [Stripe](https://stripe.com).");
    expect(problems).toEqual([]);
    expect(blocks[0]).toMatchObject({ c: [{ t: "text", v: "See the " }, { t: "link", href: "/payment-terms", outside: false }, { t: "text", v: " and " }, { t: "link", href: "https://stripe.com", outside: true }, { t: "text", v: "." }] });
    expect(read("[gone](nowhere.md)").problems).toHaveLength(1);
  });

  it("knows a blank from a link, also a blank with a note", () => {
    const { blocks, problems } = read("Run by [COMPANY NAME] at [ADDRESS]. Kept for [PERIOD: we propose 2 years].");
    expect(problems).toEqual([]);
    expect(blocks[0]).toMatchObject({ c: [{ t: "text", v: "Run by " }, { t: "blank", v: "[COMPANY NAME]" }, { t: "text", v: " at " }, { t: "blank", v: "[ADDRESS]" }, { t: "text", v: ". Kept for " }, { t: "blank", v: "[PERIOD: we propose 2 years]" }, { t: "text", v: "." }] });
    // Words in square brackets that are not a blank stay as they are.
    expect(read("An option [as shown] here.").blocks[0]).toEqual({ t: "paragraph", c: [{ t: "text", v: "An option [as shown] here." }] });
  });

  it("reads a table, and says so when a row has too few columns", () => {
    const { blocks, problems } = read("| What | How long |\n|---|---|\n| Emails | **2 years** |\n| Logins | 12 months |");
    expect(problems).toEqual([]);
    expect(blocks[0]).toMatchObject({ t: "table", head: [[{ t: "text", v: "What" }], [{ t: "text", v: "How long" }]] });
    expect((blocks[0] as { rows: unknown[][] }).rows).toHaveLength(2);
    expect(read("| a | b |\n|---|---|\n| only one |").problems).toHaveLength(1);
    expect(read("| a | b |\n| c | d |").problems).toHaveLength(1);
  });

  it("keeps every line of a set-off block as a line, and reads a line across the page", () => {
    const { blocks } = read("> [COPYRIGHT AGENT NAME]\n> Email: [COPYRIGHT EMAIL]\n\n---\n\nAfter.");
    expect(blocks[0]).toMatchObject({ t: "quote", lines: [[{ t: "blank", v: "[COPYRIGHT AGENT NAME]" }], [{ t: "text", v: "Email: " }, { t: "blank", v: "[COPYRIGHT EMAIL]" }]] });
    expect(blocks[1]).toEqual({ t: "line" });
  });

  it("writes down what it does not know, and guesses nothing", () => {
    expect(read("Some **bold that never ends.").problems).toHaveLength(1);
    expect(read("A `code` word.").problems.length).toBeGreaterThan(0);
    expect(read("#### Too deep").problems).toHaveLength(1);
  });
});
