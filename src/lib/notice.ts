/**
 * Short messages shown after an action ("Your rule was saved."). They travel
 * in the page address, so each one is signed: a link made by someone else
 * cannot put their own words on our pages.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function signature(path: string, text: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set. Check .env.local.");
  // The page is part of what is signed, so a message made for one page cannot be moved to another
  // (for example "the refund was sent" from one call's page to a different call's page).
  return createHmac("sha256", secret).update(`notice:${path}\n${text}`).digest("base64url").slice(0, 22);
}

/** The address of a page, carrying a message to show there. */
export function withNotice(path: string, text: string): string {
  const page = path.split("?")[0];
  return `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}&ns=${signature(page, text)}`;
}

/** The message carried to this page, or null if there is none or it was not made by us for this page. */
export function readNotice(path: string, params: Record<string, string | string[] | undefined>): string | null {
  const { notice, ns } = params;
  if (typeof notice !== "string" || typeof ns !== "string") return null;
  const expected = Buffer.from(signature(path, notice));
  const given = Buffer.from(ns);
  return given.length === expected.length && timingSafeEqual(given, expected) ? notice : null;
}
