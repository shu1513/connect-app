/**
 * The one way the app asks the server anything (plans/45-phone-apps/02-the-frame.md). No screen
 * talks to the server on its own: every request goes through `ask`, which adds what the app says
 * about itself and the sign-in, sends it to our own server only, and reads the door's answer.
 *
 * The app keeps nothing to send later. A request that cannot be sent now is told to the person
 * as such; a booking or a payment is never made "when the connection is back".
 */
import { addressFor, APP_HEADER, appHeader, readAnswer, UNREACHABLE, type Answer } from "./api-rules";
import { APP_VERSION, PLATFORM, SERVER } from "./config";

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
  const address = addressFor(SERVER, path);
  if (!address) return { ok: false, code: "unreachable", message: UNREACHABLE };

  const headers: Record<string, string> = { [APP_HEADER]: appHeader(PLATFORM, APP_VERSION), accept: "application/json" };
  const cookie = await signIn().catch(() => null);
  if (cookie) headers.cookie = cookie;
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
