/**
 * Checking the text of a legal document before a screen draws it
 * (plans/45-phone-apps/06-asking-for-a-call.md; the text comes from the website's own reader,
 * plans/46-agreements-live.md), and deciding which of its links the app may open. Plain logic with
 * no phone in it, so it can be tested on its own.
 */
import type { AppIdentityNotice, AppLegalBlock, AppLegalInline } from "../../../src/lib/app-door/types";

const isThing = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";

/** Words inside a block. Bold and links hold words of their own; deeper than a few levels is nothing this app draws. */
function isInline(value: unknown, depth = 0): value is AppLegalInline {
  if (!isThing(value) || depth > 4) return false;
  if (value.t === "text" || value.t === "blank") return isText(value.v);
  if (value.t === "bold") return isInlines(value.c, depth + 1);
  if (value.t === "link") return isText(value.href) && typeof value.outside === "boolean" && isInlines(value.c, depth + 1);
  return false;
}
function isInlines(value: unknown, depth = 0): value is AppLegalInline[] {
  return Array.isArray(value) && value.every((one) => isInline(one, depth));
}
const isRows = (value: unknown): value is AppLegalInline[][] => Array.isArray(value) && value.every((one) => isInlines(one));

function isBlock(value: unknown): value is AppLegalBlock {
  if (!isThing(value)) return false;
  if (value.t === "heading") return (value.level === 1 || value.level === 2 || value.level === 3) && isInlines(value.c) && isText(value.plain);
  if (value.t === "paragraph") return isInlines(value.c);
  if (value.t === "list") return typeof value.ordered === "boolean" && typeof value.start === "number" && Number.isInteger(value.start) && isRows(value.items);
  if (value.t === "table") return isRows(value.head) && Array.isArray(value.rows) && value.rows.every(isRows);
  if (value.t === "quote") return isRows(value.lines);
  return value.t === "line";
}

/** The whole text, every piece of it known: a text with one unknown piece is not drawn at all, so nothing of a legal text is ever silently left out. */
export function isLegalText(value: unknown): value is AppLegalBlock[] {
  return Array.isArray(value) && value.length > 0 && value.every(isBlock);
}

/** The notice above the button that starts an identity check: complete, with its text, or not used. */
export function isIdentityNotice(value: unknown): value is AppIdentityNotice {
  if (!isThing(value)) return false;
  return isText(value.name) && value.name.length > 0 && isText(value.version) && value.version.length > 0 && isText(value.title) && isText(value.href) && isText(value.open) && isText(value.agree) && value.agree.length > 0 && isLegalText(value.blocks);
}

/**
 * Where a link inside a legal text leads, for the app: a page of Connect's website (a path), an
 * address outside (https only), an email address, or nowhere. Anything else is drawn as plain words.
 */
export function legalLink(link: { href: string; outside: boolean }): { kind: "page"; path: string } | { kind: "outside"; url: string } | { kind: "mail"; url: string } | null {
  if (!link.outside) return /^\/[A-Za-z0-9/_?=&.-]*$/.test(link.href) && !link.href.startsWith("//") ? { kind: "page", path: link.href } : null;
  if (/^mailto:[^\s@]+@[^\s@]+$/.test(link.href)) return { kind: "mail", url: link.href };
  try {
    const url = new URL(link.href);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? { kind: "outside", url: link.href } : null;
  } catch {
    return null;
  }
}
