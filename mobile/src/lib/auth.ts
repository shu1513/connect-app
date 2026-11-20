/**
 * The app's sign-in (plans/45-phone-apps/03-signing-in.md): the login tool's own kit for phones,
 * talking to the login tool's own addresses on Connect's server, as the website's forms do. So
 * every rule of signing in holds here without being written again.
 *
 * The kit keeps the sign-in in the phone's secure store and nowhere else. It is handed to the
 * door by `ask` (src/lib/api.ts), and to the login tool by the kit itself; both only ever talk to
 * the server in the app's settings, over a locked connection outside a test build, and neither
 * follows a redirect.
 *
 * Screens do not use the kit directly. They use the few functions below, which take turns: the
 * kit writes what the server answers into the secure store, so two requests at once (a renewal
 * and a sign-out, say) could leave the older answer standing. One at a time, the last one asked
 * is the last one written.
 */
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { signInComesFrom } from "./api";
import { isLoginToolAddress, isServer } from "./api-rules";
import { codeProblem, emailLinks, NOT_REACHED, passwordProblem, signInOutcome, TOO_MANY, typedCode, type AuthError, type SignInOutcome } from "./auth-rules";
import { PLAIN_HTTP_ALLOWED, SERVER } from "./config";

/** Whether the server in the app's settings is one the app may talk to at all. */
export const SERVER_USABLE = isServer(SERVER, { plain: PLAIN_HTTP_ALLOWED });

/** How long the app waits for the login tool before saying it cannot be reached. */
const WAIT_MS = 15_000;

/**
 * The one sender for everything the kit asks. Only ever to the login tool's own addresses on
 * the server in the app's settings (the kit has already added the sign-in when a request gets
 * here, so anything else is stopped here, before it is sent). Never follows a redirect: it would
 * carry the sign-in along. Gives up after a while, so that a server that never answers cannot
 * leave the app waiting.
 */
const sender = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const address = String(input instanceof Request ? input.url : input);
  if (!SERVER_USABLE || !isLoginToolAddress(SERVER, address)) throw new Error("Not an address of Connect's login tool.");
  const stop = new AbortController();
  const asked = init?.signal ?? null;
  const pass = () => stop.abort();
  if (asked?.aborted) stop.abort();
  else asked?.addEventListener("abort", pass);
  const timer = setTimeout(pass, WAIT_MS);
  try {
    return await expoFetch(address, { ...(init as object), redirect: "error", credentials: "omit", signal: stop.signal } as Parameters<typeof expoFetch>[1]);
  } finally {
    clearTimeout(timer);
    asked?.removeEventListener("abort", pass);
  }
}) as unknown as typeof fetch;

const authClient = createAuthClient({
  // With no usable server the kit is pointed at an address that cannot exist, and the sender above sends nothing.
  baseURL: SERVER_USABLE ? SERVER : "https://connect.invalid",
  fetchOptions: { customFetchImpl: sender },
  plugins: [
    // The phone keeps the sign-in only: who the person is comes from the server each time (no copy of it is kept).
    expoClient({ scheme: "connect", storagePrefix: "connect", storage: SecureStore, disableCache: true }),
    twoFactorClient(),
  ],
});

// Every request to the door carries the kept sign-in, read fresh from the secure store.
signInComesFrom(async () => (await authClient.getCookie()) || null);

/** One request to the login tool at a time, in the order asked. */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const mine = turn.then(work, work);
  turn = mine.catch(() => {});
  return mine;
}

const failed = (error: AuthError): boolean => Boolean(error);
const notReachedError: AuthError = {};

/** Sign in with email and password. Hands over no "where to go afterwards": the app decides that itself. */
export function signIn(email: string, password: string): Promise<SignInOutcome> {
  return inTurn(async () => {
    try {
      return signInOutcome(await authClient.signIn.email({ email, password }));
    } catch {
      return { kind: "problem", words: NOT_REACHED };
    }
  });
}

/** Whether a second-step code is being waited for: the password was right a moment ago and the server asked for the code. */
export async function codeIsPending(): Promise<boolean> {
  try {
    return (await authClient.getCookie()).includes("two_factor");
  } catch {
    return false;
  }
}

/** The second step. Gives back null when the code was taken, else the words to show. This phone is never remembered as trusted. */
export function verifyCode(typed: string): Promise<string | null> {
  return inTurn(async () => {
    const { kind, code } = typedCode(typed);
    try {
      const result = kind === "app" ? await authClient.twoFactor.verifyTotp({ code, trustDevice: false }) : await authClient.twoFactor.verifyBackupCode({ code, trustDevice: false });
      return failed(result.error) ? codeProblem(result.error) : null;
    } catch {
      return codeProblem(notReachedError);
    }
  });
}

/** Create an account. Null when the request was taken (whether or not the address is new), else the words to show. */
export function signUp(name: string, email: string, password: string): Promise<string | null> {
  return inTurn(async () => {
    try {
      const result = await authClient.signUp.email({ name, email, password, callbackURL: emailLinks(SERVER).afterConfirming });
      return failed(result.error) ? passwordProblem(result.error) : null;
    } catch {
      return NOT_REACHED;
    }
  });
}

/** For the two requests that always answer the same, whether or not the address has an account: null, or why it could not be asked. */
function sameAnswer(ask: () => Promise<{ error?: AuthError }>): Promise<string | null> {
  return inTurn(async () => {
    try {
      const { error } = await ask();
      if (error?.status === 429) return TOO_MANY;
      return error && (error.status === undefined || error.status === 0) ? NOT_REACHED : null;
    } catch {
      return NOT_REACHED;
    }
  });
}

/** Send the confirmation link again. The link leads to the website. */
export function sendConfirmationAgain(email: string): Promise<string | null> {
  return sameAnswer(() => authClient.sendVerificationEmail({ email, callbackURL: emailLinks(SERVER).afterConfirming }));
}

/** Ask for a link to choose a new password. The link leads to the website. */
export function askForNewPassword(email: string): Promise<string | null> {
  return sameAnswer(() => authClient.requestPasswordReset({ email, redirectTo: emailLinks(SERVER).newPassword }));
}

const HOUR = 3_600_000;
let renewedAt = 0;

/**
 * Keeps "30 days from last use" true on a phone (part 01, decision 2). The door reads the sign-in
 * without extending it; only this request, the phone's own to the login tool, extends it, and the
 * kit then keeps the renewed sign-in. Asked each time the app opens (`now`), and otherwise at
 * most every few hours. With nobody signed in there is nothing to renew and nothing is sent.
 */
export function renewSignIn(now = false): Promise<void> {
  return inTurn(async () => {
    if (!now && Date.now() - renewedAt < 6 * HOUR) return;
    try {
      if (!(await authClient.getCookie())) return;
      const asked = await authClient.getSession();
      if (!asked.error) renewedAt = Date.now();
    } catch {
      // Not reached: tried again the next time.
    }
  });
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
 * phone handed to someone else never stays signed in. It takes its turn like every other request,
 * so nothing asked earlier can write a sign-in back after it.
 */
export function signOut(): Promise<void> {
  return inTurn(async () => {
    try {
      await authClient.signOut();
    } catch {
      // Not reached: the phone's own copy is gone all the same.
    }
    await forgetStep();
    renewedAt = 0;
  });
}
