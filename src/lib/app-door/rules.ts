/**
 * The plain rules of the door for the phone app (plans/45-phone-apps/01-the-door.md): is this
 * request the app's, is this copy of the app too old, and may this person ask this address.
 * Plain logic with no database and no framework, so it can be tested on its own.
 */
import type { RefusalCode } from "./types";

/** Every request of the app carries this header: the kind of phone and the app's version. */
export const APP_HEADER = "x-connect-app";

export type AppClient = { platform: "android" | "ios"; version: string };

type HeaderReader = { get(name: string): string | null };

/** Three numbers with dots, such as 1.0.0 or 12.4.31. Nothing else counts as a version. */
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/**
 * What the app says about itself, or null when the header is missing or not in the app's form
 * ("android 1.2.0"). It is only the app's word: it is used for "please update", never to decide
 * what somebody may do.
 */
export function readAppHeader(value: string | null): AppClient | null {
  if (!value) return null;
  const [platform, version, ...more] = value.trim().split(" ");
  if (more.length > 0 || (platform !== "android" && platform !== "ios") || !VERSION.test(version ?? "")) return null;
  return { platform, version };
}

/**
 * Whether a request came in the app's way.
 *
 * The protection is the header itself: a form or a link on another website cannot add a header,
 * and a script on another website may only add one if this server allows it first, which it
 * never does for these addresses. As a second lock, a request that carries a browser's own marks
 * is refused: every current browser adds them, a page cannot remove them, and an app sends none.
 * (A browser's marks can be missing, an old browser's for one, so they are never the only lock.)
 */
export function comesTheAppsWay(headers: HeaderReader): AppClient | null {
  if (headers.get("sec-fetch-site") !== null || headers.get("sec-fetch-mode") !== null || headers.get("sec-fetch-dest") !== null) return null;
  return readAppHeader(headers.get(APP_HEADER));
}

/**
 * Whether a copy of the app is older than the oldest one still allowed. With no oldest version
 * set, or one that is not a version, nothing is too old: a slip of the founder's hand in that
 * field must never lock every phone out.
 */
export function isTooOld(version: string, oldestAllowed: string): boolean {
  if (!VERSION.test(oldestAllowed) || !VERSION.test(version)) return false;
  const have = version.split(".").map(Number);
  const need = oldestAllowed.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] < need[i];
  }
  return false;
}

/**
 * Whom an address is for, as its page on the website decides it:
 * - "anyone": logged in or not (the opening question; search; a host's public page);
 * - "confirmed": logged in with a confirmed email address, even before "18 and terms"
 *   (only the address that records "18 and terms" itself);
 * - "member": the full gate of the website's getUser(): everything private;
 * - "active": the full gate, and not paused: anything that starts or joins something.
 */
export type Who = "anyone" | "confirmed" | "member" | "active";

/** Where an account stands. A closed account has no login left, so it never gets this far as a person. */
export type Standing = { emailVerified: boolean; welcomed: boolean; closed: boolean; paused: boolean };

/** Why this person may not ask an address meant for `who`; null when they may. */
export function whyNot(who: Who, person: Standing | null): RefusalCode | null {
  if (who === "anyone") return null;
  // A closed account is answered exactly like nobody: the app never learns that an account was closed.
  if (!person || person.closed) return "not_signed_in";
  if (!person.emailVerified) return "confirm_email";
  if (who === "confirmed") return null;
  if (!person.welcomed) return "welcome_needed";
  if (who === "active" && person.paused) return "paused";
  return null;
}
