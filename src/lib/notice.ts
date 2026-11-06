/**
 * Short messages shown after an action ("Your rule was saved."). They travel
 * in the page address, so each one is signed: a link made by someone else
 * cannot put their own words on our pages.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function signature(text: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set. Check .env.local.");
  return createHmac("sha256", secret).update(`notice:${text}`).digest("base64url").slice(0, 22);
}

/** The address of a page, carrying a message to show there. */
export function withNotice(path: string, text: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}&ns=${signature(text)}`;
}

/** The message carried by a page address, or null if there is none or it was not made by us. */
export function readNotice(params: Record<string, string | string[] | undefined>): string | null {
  const { notice, ns } = params;
  if (typeof notice !== "string" || typeof ns !== "string") return null;
  const expected = Buffer.from(signature(notice));
  const given = Buffer.from(ns);
  return given.length === expected.length && timingSafeEqual(given, expected) ? notice : null;
}
