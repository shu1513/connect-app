/**
 * The search rules that are plain logic: how what a person typed is cleaned,
 * how it is made safe to match with, and how results are ordered. No database.
 */

export const SEARCH = {
  /** Fewer characters than this finds nothing. */
  min: 2,
  /** What is typed is cut to this length. */
  max: 50,
  /** How many results are shown. There is no total and no further page. */
  results: 20,
} as const;

export type SearchTerms = {
  /** What was typed: small letters, no leading @, single spaces. Matched against names, handles and social names. */
  text: string;
  /** The same without underscores and spaces, so "hana host", "hana_host" and "hanahost" all find the same handle. */
  key: string;
};

/** Cleans what was typed, or null when it is too short to search for. */
export function searchTerms(typed: string): SearchTerms | null {
  const text = typed
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH.max)
    .trim();
  if (text.length < SEARCH.min) return null;
  return { text, key: text.replace(/[_\s]/g, "") };
}

/** True when the loose form is long enough to match with (typing "__" must not match everyone). */
export function keyUsable(terms: SearchTerms): boolean {
  return terms.key.length >= SEARCH.min;
}

/**
 * A pattern for the database's "contains" match in which what was typed is
 * plain text: its %, _ and \ mean themselves, not "anything".
 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A social name without underscores, for the loose match. */
export function looseName(name: string): string {
  return name.replace(/_/g, "");
}

export type Searchable = { displayName: string; handle: string; handleKey: string; socials: string[] };

/**
 * How well a host matches: 0 an exact handle or social name, 1 the same once
 * underscores and spaces are ignored (or the exact display name), 2 a name,
 * handle or social name that starts with what was typed, 3 anything else.
 */
export function matchRank(host: Searchable, terms: SearchTerms): 0 | 1 | 2 | 3 {
  const name = host.displayName.toLowerCase();
  const loose = keyUsable(terms);
  if (host.handle === terms.text || host.socials.includes(terms.text)) return 0;
  if (name === terms.text || (loose && (host.handleKey === terms.key || host.socials.some((s) => looseName(s) === terms.key)))) return 1;
  if (
    name.startsWith(terms.text) ||
    host.handle.startsWith(terms.text) ||
    host.socials.some((s) => s.startsWith(terms.text)) ||
    (loose && (host.handleKey.startsWith(terms.key) || host.socials.some((s) => looseName(s).startsWith(terms.key))))
  ) {
    return 2;
  }
  return 3;
}

/** The results in their fixed order (best match first, then by name and handle), cut to the number shown. */
export function orderResults<T extends Searchable>(hosts: T[], terms: SearchTerms): T[] {
  return [...hosts]
    .sort((a, b) => matchRank(a, terms) - matchRank(b, terms) || a.displayName.localeCompare(b.displayName) || a.handle.localeCompare(b.handle))
    .slice(0, SEARCH.results);
}
