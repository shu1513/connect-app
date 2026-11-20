/**
 * The one way the app asks the server anything (plans/45-phone-apps/02-the-frame.md). No screen
 * talks to the server on its own: every request goes through `ask`, which adds what the app says
 * about itself and the sign-in, sends it to our own server only, and reads the door's answer.
 *
 * The app keeps nothing to send later. A request that cannot be sent now is told to the person
 * as such; a booking or a payment is never made "when the connection is back".
 */
// Expo's own fetch, named outright: it is the one that can be told not to follow a redirect, on both kinds of phone.
import { fetch } from "expo/fetch";
import { addressFor, APP_HEADER, appHeader, readAnswer, SIGN_IN_HEADER, UNREACHABLE, type Answer } from "./api-rules";
import { APP_VERSION, PLAIN_HTTP_ALLOWED, PLATFORM, SERVER } from "./config";

/** Said when the phone could not read its own kept sign-in. Nothing was sent. */
const NOT_READ = "Something went wrong on this phone. Please try again.";

/** How long the app waits for the server before saying it cannot be reached. */
const WAIT_MS = 15_000;

/**
 * Where the kept sign-in comes from. The sign-in itself is part 03's (better-auth's kit keeps it in
 * the phone's secure store); until it is set, the app asks as nobody.
 */
let signIn: () => Promise<string | null> = async () => null;
export function useSignInFrom(source: () => Promise<string | null>): void {
  signIn = source;
}

export async function ask<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<Answer<T>> {
  const address = addressFor(SERVER, path, { plain: PLAIN_HTTP_ALLOWED });
  if (!address) return { ok: false, code: "unreachable", message: UNREACHABLE };

  const headers: Record<string, string> = { [APP_HEADER]: appHeader(PLATFORM, APP_VERSION), accept: "application/json" };
  // The sign-in goes in the app's own header. The server never reads a cookie at these addresses.
  // If the phone cannot read what it keeps, nothing is sent: asking as nobody would be answered as
  // nobody, and the app would take a signed-in person for signed out.
  let kept: string | null;
  try {
    kept = await signIn();
  } catch {
    return { ok: false, code: "unreachable", message: NOT_READ };
  }
  if (kept) headers[SIGN_IN_HEADER] = kept;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), WAIT_MS);
  try {
    const response = await fetch(address, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      // The sign-in is handed over above, by this code alone. Nothing the phone keeps by itself is added.
      credentials: "omit",
      // The door never sends the app on to another address. If something on the way does, the
      // request stops there: followed, it would carry the sign-in to wherever it pointed.
      redirect: "error",
      signal: stop.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return readAnswer<T>(response.status, body);
  } catch {
    return { ok: false, code: "unreachable", message: UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }
}
