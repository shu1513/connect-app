/**
 * The plain rules of talking to the server (plans/45-phone-apps/02-the-frame.md): what the app
 * says about itself, where its sign-in may be sent, how an answer is read, and where each of the
 * door's refusals leads. Plain logic with no phone in it, so it can be tested on its own.
 */
import type { Refusal, RefusalCode } from "../../../src/lib/app-door/types";

/** The header every request carries: the kind of phone and the app's version ("android 1.0.0"). */
export const APP_HEADER = "x-connect-app";

/**
 * The header in which the app hands over its sign-in to an address of the door. The server reads
 * the sign-in from here and from nowhere else (see SIGN_IN_HEADER in src/lib/app-door/rules.ts on
 * the server; a test keeps the two names the same).
 */
export const SIGN_IN_HEADER = "x-connect-signin";

export function appHeader(platform: "android" | "ios", version: string): string {
  return `${platform} ${version}`;
}

/**
 * Whether the server's address in the app's settings is one the app may talk to: a bare, locked
 * address (`https://name` or `https://name:port`), or a plain `http` one when `plain` is set,
 * which only a test build does. The same rule for every request the app makes, to the door and to
 * the login tool.
 */
export function isServer(server: string, options: { plain?: boolean } = {}): boolean {
  const bare = /^(https?):\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.exec(server);
  return bare !== null && (bare[1] === "https" || options.plain === true);
}

/**
 * Whether a full address is one of the login tool's own on the given server: the only place,
 * besides the door, a request with the sign-in may go.
 */
export function isLoginToolAddress(server: string, address: string): boolean {
  try {
    const url = new URL(address);
    return url.origin === new URL(server).origin && url.pathname.startsWith("/api/auth/") && url.username === "" && url.password === "" && address.startsWith(`${server}/api/auth/`);
  } catch {
    return false;
  }
}

/** Every address of the app on the server starts with this. Nothing else is ever asked for. */
export const DOOR = "/api/app/";

/**
 * The full address for a path of the door, on our own server and nowhere else.
 *
 * The sign-in travels with every request, so this is the one place that decides where it can go:
 * only a path under the door, joined to the server from the app's settings. A screen cannot hand
 * in a full address, another site, or a path that climbs out of the door. Returns null for
 * anything else, and the request is then never sent.
 *
 * The server must be a bare, locked address: `https://name` or `https://name:port`, with no name
 * and password in it and nothing after it. A plain `http` address is taken only when `plain` is
 * set, which only a test build does (the website on this Mac is plain); a build for a store never
 * sends anything over a connection that is not locked.
 *
 * The path, up to a "?", is made of plain steps only: letters, digits, "-" and "_". No "%", so
 * nothing in it can turn into another path if something on the way reads it differently.
 */
export function addressFor(server: string, path: string, options: { plain?: boolean } = {}): string | null {
  if (!isServer(server, options)) return null;
  const cut = path.indexOf("?");
  const steps = cut === -1 ? path : path.slice(0, cut);
  if (!/^\/api\/app\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(steps)) return null;
  // After the "?": anything a question may carry, but no "#", no backslash, no space or unseen character.
  if (cut !== -1 && !/^[\x21\x24-\x5b\x5d-\x7e]*$/.test(path.slice(cut + 1))) return null;
  try {
    const url = new URL(path, server);
    if (url.origin !== new URL(server).origin || url.pathname !== steps || url.username !== "" || url.password !== "") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** What came back, as a screen needs it. */
export type Answer<T> =
  | { ok: true; data: T }
  /** The server refused: a fixed code, and its own sentence to show. */
  | { ok: false; code: RefusalCode; message: string }
  /** The server could not be reached, or answered something that is not the door's. */
  | { ok: false; code: "unreachable"; message: string };

export const UNREACHABLE = "Cannot reach Connect. Check your connection and try again.";

const CODES: readonly RefusalCode[] = ["not_the_app", "update_needed", "not_signed_in", "confirm_email", "welcome_needed", "paused", "switched_off", "not_found", "not_valid"];

function isRefusal(body: unknown): body is Refusal {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return typeof error?.message === "string" && typeof error.code === "string" && (CODES as readonly string[]).includes(error.code);
}

/**
 * Reads what the server sent. A refusal is one of the door's codes with its sentence, whatever
 * number came with it; a success is an answer of the door, which is always one plain thing with
 * named parts, and never has a part called "error". Anything else (a page of some network in
 * between, an error of the server itself, half an answer, a list, a refusal this copy of the app
 * does not know yet) counts as "could not reach Connect": the app never guesses, and never takes
 * something refused for something done.
 *
 * This only tells an answer from a refusal. Whether an answer has the parts a screen needs is
 * for the one who asked to check (see `isStart` in opening-rules.ts).
 */
export function readAnswer<T>(status: number, body: unknown): Answer<T> {
  if (isRefusal(body)) return { ok: false, code: body.error.code, message: body.error.message };
  if (status >= 200 && status < 300 && body !== null && typeof body === "object" && !Array.isArray(body) && !("error" in body)) return { ok: true, data: body as T };
  return { ok: false, code: "unreachable", message: UNREACHABLE };
}

/** Where a refusal of the door sends the person, whatever screen they were on. "stay" means the screen shows the sentence itself. */
export type Leads = "sign-in" | "update" | "welcome" | "confirm-email" | "stay";

export function whereNext(code: RefusalCode | "unreachable"): Leads {
  switch (code) {
    case "not_signed_in":
      return "sign-in";
    case "update_needed":
      return "update";
    case "welcome_needed":
      return "welcome";
    case "confirm_email":
      return "confirm-email";
    default:
      return "stay";
  }
}
