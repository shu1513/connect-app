/**
 * The app's sign-in (plans/45-phone-apps/03-signing-in.md): the login tool's own kit for phones,
 * talking to the login tool's own addresses on Connect's server, as the website's forms do. So
 * every rule of signing in holds here without being written again.
 *
 * The kit keeps the sign-in in the phone's secure store and nowhere else. It is handed to the
 * door by `ask` (src/lib/api.ts), and to the login tool by the kit itself; both only ever talk to
 * the server in the app's settings, over a locked connection outside a test build, and neither
 * follows a redirect.
 */
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { signInComesFrom } from "./api";
import { isServer } from "./api-rules";
import { PLAIN_HTTP_ALLOWED, SERVER } from "./config";

/** Whether the server in the app's settings is one the app may talk to at all. */
export const SERVER_USABLE = isServer(SERVER, { plain: PLAIN_HTTP_ALLOWED });

/** Never followed: a request to the login tool carries the sign-in, and a redirect would carry it on. */
const noRedirects = ((input: RequestInfo | URL, init?: RequestInit) =>
  expoFetch(String(input instanceof Request ? input.url : input), { ...(init as object), redirect: "error", credentials: "omit" } as Parameters<typeof expoFetch>[1])) as unknown as typeof fetch;

export const authClient = createAuthClient({
  // With no usable server the kit is pointed at an address that cannot exist, so nothing is ever sent anywhere.
  baseURL: SERVER_USABLE ? SERVER : "https://connect.invalid",
  fetchOptions: { customFetchImpl: noRedirects },
  plugins: [
    // The phone keeps the sign-in only: who the person is comes from the server each time (no copy of it is kept).
    expoClient({ scheme: "connect", storagePrefix: "connect", storage: SecureStore, disableCache: true }),
    twoFactorClient(),
  ],
});

// Every request to the door carries the kept sign-in, read fresh from the secure store.
signInComesFrom(async () => (await authClient.getCookie()) || null);

const HOUR = 3_600_000;
let renewedAt = 0;

/**
 * Keeps "30 days from last use" true on a phone (part 01, decision 2). The door reads the sign-in
 * without extending it; only this request, the phone's own to the login tool, extends it, and the
 * kit then keeps the renewed sign-in. Asked each time the app opens (`now`), and otherwise at
 * most every few hours. With nobody signed in there is nothing to renew and nothing is sent.
 */
export async function renewSignIn(now = false): Promise<void> {
  if (!now && Date.now() - renewedAt < 6 * HOUR) return;
  try {
    if (!(await authClient.getCookie())) return;
    const asked = await authClient.getSession();
    if (!asked.error) renewedAt = Date.now();
  } catch {
    // Not reached: tried again the next time.
  }
}

/** How often, while the app stays open, it looks whether the sign-in is due to be renewed. */
export const RENEW_LOOK_MS = HOUR;

/** Where the app remembers, on this phone only, that someone is at "check your email". */
const STEP_KEY = "connect_step";

export async function rememberCheckEmail(email: string): Promise<void> {
  await SecureStore.setItemAsync(STEP_KEY, JSON.stringify({ email })).catch(() => {});
}

export async function checkEmailStep(): Promise<string | null> {
  try {
    const kept = await SecureStore.getItemAsync(STEP_KEY);
    const email = kept ? (JSON.parse(kept) as { email?: unknown }).email : null;
    return typeof email === "string" && email ? email : null;
  } catch {
    return null;
  }
}

export async function forgetStep(): Promise<void> {
  await SecureStore.deleteItemAsync(STEP_KEY).catch(() => {});
}

/**
 * Signs out: ends this phone's session on the server and wipes what the phone kept. The phone's
 * side is wiped whether or not the server was reached (the kit does it before it asks), so a
 * phone handed to someone else never stays signed in.
 */
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // Not reached: the phone's own copy is gone all the same.
  }
  await forgetStep();
  renewedAt = 0;
}
