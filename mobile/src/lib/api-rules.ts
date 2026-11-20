/**
 * The plain rules of talking to the server (plans/45-phone-apps/02-the-frame.md): what the app
 * says about itself, where its sign-in may be sent, how an answer is read, and where each of the
 * door's refusals leads. Plain logic with no phone in it, so it can be tested on its own.
 */
import type { Refusal, RefusalCode } from "../../../src/lib/app-door/types";

/** The header every request carries: the kind of phone and the app's version ("android 1.0.0"). */
export const APP_HEADER = "x-connect-app";

export function appHeader(platform: "android" | "ios", version: string): string {
  return `${platform} ${version}`;
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
 */
export function addressFor(server: string, path: string): string | null {
  if (!/^https?:\/\/[^/?#]+$/.test(server)) return null;
  if (!path.startsWith(DOOR) || path.includes("..") || path.includes("\\") || path.includes("//")) return null;
  try {
    const url = new URL(path, server);
    if (url.origin !== new URL(server).origin || !url.pathname.startsWith(DOOR)) return null;
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
 * Reads what the server sent. A success is an answer of the door; a refusal is one of its codes
 * with its sentence. Anything else (a page of some network in between, an error of the server
 * itself, half an answer) counts as "could not reach Connect": the app never guesses.
 */
export function readAnswer<T>(status: number, body: unknown): Answer<T> {
  if (status >= 200 && status < 300 && body !== null && typeof body === "object") return { ok: true, data: body as T };
  if (isRefusal(body)) return { ok: false, code: body.error.code, message: body.error.message };
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
