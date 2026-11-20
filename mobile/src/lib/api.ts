/**
 * The one way the app asks the server anything (plans/45-phone-apps/02-the-frame.md). No screen
 * talks to the server on its own: every request goes through here, which adds what the app says
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
export function signInComesFrom(source: () => Promise<string | null>): void {
  signIn = source;
}

/** What `send` hands back: the server's answer as it came, or why nothing came. */
type Sent = { response: Awaited<ReturnType<typeof fetch>>; done: () => void } | { failed: string };

/**
 * Sends one request to an address of the door, and nothing anywhere else. The caller reads the
 * answer and then calls `done` (the time limit covers the reading too).
 */
async function send(path: string, options: { method?: "GET" | "POST"; body?: unknown; accept: string }): Promise<Sent> {
  const address = addressFor(SERVER, path, { plain: PLAIN_HTTP_ALLOWED });
  if (!address) return { failed: UNREACHABLE };

  const headers: Record<string, string> = { [APP_HEADER]: appHeader(PLATFORM, APP_VERSION), accept: options.accept };
  // The sign-in goes in the app's own header. The server never reads a cookie at these addresses.
  // If the phone cannot read what it keeps, nothing is sent: asking as nobody would be answered as
  // nobody, and the app would take a signed-in person for signed out.
  let kept: string | null;
  try {
    kept = await signIn();
  } catch {
    return { failed: NOT_READ };
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
    return { response, done: () => clearTimeout(timer) };
  } catch {
    clearTimeout(timer);
    return { failed: UNREACHABLE };
  }
}

export async function ask<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<Answer<T>> {
  const sent = await send(path, { ...options, accept: "application/json" });
  if ("failed" in sent) return { ok: false, code: "unreachable", message: sent.failed };
  try {
    const body: unknown = await sent.response.json().catch(() => null);
    return readAnswer<T>(sent.response.status, body);
  } catch {
    return { ok: false, code: "unreachable", message: UNREACHABLE };
  } finally {
    sent.done();
  }
}

/**
 * A picture from the door (a person's photo), as its bytes, with how long the phone may keep it
 * (0: not at all). Null for every "no", whatever the reason: the door answers them all the same.
 */
export async function askForPicture(path: string): Promise<{ bytes: Uint8Array; keepSeconds: number } | null> {
  const sent = await send(path, { accept: "image/jpeg" });
  if ("failed" in sent) return null;
  try {
    if (sent.response.status !== 200 || !String(sent.response.headers.get("content-type")).startsWith("image/jpeg")) return null;
    const bytes = new Uint8Array(await sent.response.arrayBuffer());
    const kept = /(?:^|,)\s*max-age=(\d+)/.exec(String(sent.response.headers.get("cache-control") ?? ""));
    return { bytes, keepSeconds: kept ? Number(kept[1]) : 0 };
  } catch {
    return null;
  } finally {
    sent.done();
  }
}
