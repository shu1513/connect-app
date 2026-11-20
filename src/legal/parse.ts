/**
 * Reads the text of a legal document (plans/46-agreements-live.md, decision 2) and gives back
 * what a page needs to draw it. No package: the documents use only a handful of marks, and all of
 * them are known here.
 *
 *   # Title, ## Section, ### Part      headings
 *   a blank line                       ends a paragraph
 *   - item                             a list; a longer item goes on in the lines below it
 *   1. item                            a numbered list, keeping its own first number
 *   | a | b |                          a table: first row the names, second row |---|---|
 *   > line                             a set-off block (an address, a form); every line is kept as a line
 *   ---                                a line across the page
 *   **bold**, [words](where)           inside any of them
 *   [COMPANY NAME]                     a blank that is not filled in yet; drawn so that it stands out
 *
 * Anything it does not know is not guessed at: it is written down in `problems`, and a test
 * (parse.test.ts) fails when a document of the app has one. So a mark nobody taught this file
 * can never reach a reader as stray stars or brackets.
 */

export type Inline = { t: "text"; v: string } | { t: "bold"; c: Inline[] } | { t: "link"; href: string; outside: boolean; c: Inline[] } | { t: "blank"; v: string };

export type Block =
  | { t: "heading"; level: 1 | 2 | 3; c: Inline[]; plain: string }
  | { t: "paragraph"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; lines: Inline[][] }
  | { t: "line" };

export type Parsed = { blocks: Block[]; problems: string[] };

/** Where a link in a document leads: a path of the site, an address outside, or null for one that is not known. */
export type LinkFor = (target: string) => { href: string; outside: boolean } | null;

/** A blank: square brackets around capital letters, sometimes with a note after a colon ("[PERIOD: we propose 2 years]"), or around a number still to be settled ("[12]"). */
const BLANK = /^\[(?:[A-Z][A-Z0-9 ,'-]+|[0-9]+)(?::[^\]]*)?\]/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/;

export function parseInline(text: string, linkFor: LinkFor, problems: string[]): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ t: "text", v: plain });
    plain = "";
  };
  let at = 0;
  while (at < text.length) {
    if (text.startsWith("**", at)) {
      const end = text.indexOf("**", at + 2);
      if (end === -1) {
        problems.push(`bold that never ends: "${text.slice(at, at + 40)}"`);
        plain += text.slice(at);
        break;
      }
      flush();
      out.push({ t: "bold", c: parseInline(text.slice(at + 2, end), linkFor, problems) });
      at = end + 2;
      continue;
    }
    if (text[at] === "[") {
      const rest = text.slice(at);
      const link = LINK.exec(rest);
      if (link) {
        const where = linkFor(link[2]);
        if (!where) problems.push(`a link that leads nowhere known: "${link[2]}"`);
        flush();
        out.push({ t: "link", href: where?.href ?? "#", outside: where?.outside ?? false, c: parseInline(link[1], linkFor, problems) });
        at += link[0].length;
        continue;
      }
      const blank = BLANK.exec(rest);
      if (blank) {
        flush();
        out.push({ t: "blank", v: blank[0] });
        at += blank[0].length;
        continue;
      }
    }
    if (text[at] === "`") problems.push(`a mark this reader does not know (\`): "${text.slice(at, at + 40)}"`);
    plain += text[at];
    at++;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,6}) +(.*)$/;
const BULLET = /^- +(.*)$/;
const NUMBERED = /^(\d+)\. +(.*)$/;
/**
 * Whether a line begins something new, so that the paragraph or list item above it ends. A line that begins with
 * a number and a full stop does NOT: the text is wrapped, and a sentence can run "...sections 16 to" / "19. Nobody
 * who...". A numbered list begins after an empty line, and goes on only with the next number.
 */
const startsBlock = (line: string) => HEADING.test(line) || BULLET.test(line) || line.startsWith("|") || line.startsWith(">") || line.trim() === "---";

function cells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

/** The words of a piece of text with its marks taken off, for a page's title and for finding a heading. */
export function plainOf(parts: Inline[]): string {
  return parts.map((part) => (part.t === "text" || part.t === "blank" ? part.v : plainOf(part.c))).join("");
}

export function parse(text: string, linkFor: LinkFor): Parsed {
  const problems: string[] = [];
  const blocks: Block[] = [];
  const inline = (words: string) => parseInline(words.replace(/\s+/g, " ").trim(), linkFor, problems);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.trim() === "---") {
      blocks.push({ t: "line" });
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level > 3) problems.push(`a heading deeper than this reader draws: "${line.slice(0, 40)}"`);
      const c = inline(heading[2]);
      blocks.push({ t: "heading", level: Math.min(level, 3) as 1 | 2 | 3, c, plain: plainOf(c) });
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(cells(lines[i++]));
      const [head, rule, ...body] = rows;
      if (!rule || !rule.every((cell) => /^:?-{3,}:?$/.test(cell))) problems.push(`a table without its second row of dashes, under "${head.join(" | ").slice(0, 40)}"`);
      if (body.some((row) => row.length !== head.length)) problems.push(`a table row with a different number of columns, under "${head.join(" | ").slice(0, 40)}"`);
      blocks.push({ t: "table", head: head.map(inline), rows: body.map((row) => row.map(inline)) });
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: Inline[][] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        const words = lines[i++].replace(/^> ?/, "");
        if (words.trim() !== "") quoted.push(inline(words));
      }
      blocks.push({ t: "quote", lines: quoted });
      continue;
    }
    const firstItem = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (firstItem) {
      const ordered = !BULLET.test(line);
      const mark = ordered ? NUMBERED : BULLET;
      const start = ordered ? Number(NUMBERED.exec(line)![1]) : 1;
      const items: Inline[][] = [];
      // In a numbered list only the next number begins the next item.
      const nextItem = (candidate: string | undefined) => {
        if (candidate === undefined) return null;
        const found = mark.exec(candidate);
        return found && (!ordered || Number(found[1]) === start + items.length) ? found : null;
      };
      while (i < lines.length) {
        const item = nextItem(lines[i]);
        if (!item) break;
        let words = item[item.length - 1];
        i++;
        // A longer item goes on in the lines below it, until an empty line, the next item or something new.
        while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) {
          if (ordered && Number(NUMBERED.exec(lines[i])?.[1]) === start + items.length + 1) break;
          words += ` ${lines[i++].trim()}`;
        }
        items.push(inline(words));
        // One empty line between two items of the same list does not end the list.
        if (i + 1 < lines.length && lines[i].trim() === "" && nextItem(lines[i + 1])) i++;
      }
      blocks.push({ t: "list", ordered, start, items });
      continue;
    }
    let words = line.trim();
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) words += ` ${lines[i++].trim()}`;
    blocks.push({ t: "paragraph", c: inline(words) });
  }
  return { blocks, problems };
}
