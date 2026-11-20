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
import { codeProblem, emailLinks, NOT_REACHED, passwordProblem, signInOutcome, TOO_MANY, typedCode, type AuthError, type CodeProblem, type SignInOutcome } from "./auth-rules";
import { PLAIN_HTTP_ALLOWED, SERVER } from "./config";

/** Whether the server in the app's settings is one the app may talk to at all. */
export const SERVER_USABLE = isServer(SERVER, { plain: PLAIN_HTTP_ALLOWED });

/** How long the app waits for the login tool before saying it cannot be reached. */
const WAIT_MS = 15_000;

/**
 * The one sender for everything the kit asks. Only ever to the login tool's own addresses on
 * the server in the app's settings (the kit has already added the sign-in when a request gets
 * here, so anything else is stopped here, before it is sent). Never follows a redirect: it would
 * carry the sign-in along. Gives up after a while, so that a server that never answers, or
 * stops half-way through its answer, cannot leave the app (and every request waiting its turn
 * behind this one) waiting: the whole answer is read here, inside the time allowed, and handed
 * on complete.
 */
const sender = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const address = String(input instanceof Request ? input.url : input);
  if (!SERVER_USABLE || !isLoginToolAddress(SERVER, address)) throw new Error("Not an address of Connect's login tool.");
  const path = new URL(address).pathname;
  // "Who is signed in?" renews the sign-in and writes it to the phone. Only the app's own renewal, in its turn, may
  // ask it: the kit also asks it by itself, out of turn, and such an answer could write a sign-in back after a sign-out.
  if (path.endsWith("/get-session") && !renewing) throw new Error("Not asked for by the app.");
  // While a sign-out is being finished, nothing but the sign-out itself goes to the login tool.
  if (leaving !== "no" && !path.endsWith("/sign-out")) throw new Error("A sign-out is under way.");
  const stop = new AbortController();
  const asked = init?.signal ?? null;
  const pass = () => stop.abort();
  if (asked?.aborted) stop.abort();
  else asked?.addEventListener("abort", pass);
  const timer = setTimeout(pass, WAIT_MS);
  try {
    const answer = await expoFetch(address, { ...(init as object), redirect: "error", credentials: "omit", signal: stop.signal } as Parameters<typeof expoFetch>[1]);
    const words = await answer.text();
    // Given up on while it was being read: on some phones the reading then ends quietly with what had arrived.
    // Half an answer is no answer.
    if (stop.signal.aborted) throw new Error("The answer did not arrive in time.");
    // Handed on whole, with the same number and the same headers (the kit reads the sign-in from them).
    const empty = answer.status === 204 || answer.status === 205 || answer.status === 304;
    return new Response(empty ? null : words, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
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

/** Where the kit keeps the sign-in (its own name for it: the storage prefix, then "_cookie"). */
const KEPT_KEY = "connect_cookie";
/** Set on the phone while a sign-out is under way, until the phone's side is seen to be empty. */
const LEAVING_KEY = "connect_leaving";

/**
 * True from the moment someone presses "Sign out" until the phone's kept sign-in is seen to be
 * gone. While it is true the app asks the door as nobody, and no request to the login tool is made
 * before the wiping is finished. It is kept on the phone too, so that closing the app in that
 * moment cannot bring the person back when it is opened again.
 */
let leaving: "yes" | "no" | "unknown" = "unknown";
/** True only while the app's own renewal is asking the login tool who is signed in (see the sender). */
let renewing = false;

/**
 * Finds out, from the phone's store, whether a sign-out was left unfinished. Until the store has
 * answered, it is not known, and nothing is done as anybody: it is asked again each time. Throws
 * when the store cannot be read.
 */
async function knowLeaving(): Promise<void> {
  if (leaving !== "unknown") return;
  const kept = await SecureStore.getItemAsync(LEAVING_KEY);
  if (leaving === "unknown") leaving = kept === "1" ? "yes" : "no";
}

// Every request to the door carries the kept sign-in, read fresh from the secure store. If the
// store cannot say whether a sign-out is under way, this throws, and nothing is sent (src/lib/api.ts).
signInComesFrom(async () => {
  await knowLeaving();
  if (leaving !== "no") return null;
  return (await authClient.getCookie()) || null;
});

/** Makes the phone's kept sign-in empty and looks that it is. Whatever the kit did or could not do. */
async function wipeKept(): Promise<boolean> {
  try {
    if ((await authClient.getCookie()) === "") return true;
  } catch {
    // Not readable: it is overwritten below all the same.
  }
  try {
    await SecureStore.setItemAsync(KEPT_KEY, "{}");
    return (await authClient.getCookie()) === "";
  } catch {
    return false;
  }
}

/** One request to the login tool at a time, in the order asked. */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const mine = turn.then(work, work);
  turn = mine.catch(() => {});
  return mine;
}

/**
 * Finishes a sign-out: tells the server, wipes the phone's side, and looks that it is really
 * empty before the mark is taken away. Run in turn, never beside another request. Gives back
 * whether the phone is now clean.
 */
async function finishLeaving(): Promise<boolean> {
  try {
    await authClient.signOut();
  } catch {
    // The server was not reached, or the phone's store did not answer: what follows makes sure of the phone's side.
  }
  await forgetStep();
  renewedAt = 0;
  if (!(await wipeKept())) return false;
  try {
    await SecureStore.deleteItemAsync(LEAVING_KEY);
    leaving = "no";
    return true;
  } catch {
    // The mark could not be taken away: the phone stays signed out, and the next request tries again.
    return false;
  }
}

/**
 * Before anything is asked of the login tool: a sign-out left unfinished (the app was closed in
 * that moment) is finished first. False when the phone's store would not say, or the wiping could
 * not be finished: then nothing is asked as anybody.
 */
async function cleanFirst(): Promise<boolean> {
  try {
    await knowLeaving();
  } catch {
    return false;
  }
  return leaving === "yes" ? finishLeaving() : leaving === "no";
}

// When the app opens: an unfinished sign-out takes the first turn, before any renewal.
void inTurn(cleanFirst);

/** Said when the phone could not finish wiping an earlier sign-in. */
const PHONE_PROBLEM = "Something went wrong on this phone. Please close the app, open it again, and try once more.";

const failed = (error: AuthError): boolean => Boolean(error);
const notReachedError: AuthError = {};

/** Sign in with email and password. Hands over no "where to go afterwards": the app decides that itself. */
export function signIn(email: string, password: string): Promise<SignInOutcome> {
  return inTurn(async () => {
    if (!(await cleanFirst())) return { kind: "problem", words: PHONE_PROBLEM };
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
    await knowLeaving();
    return leaving === "no" && (await authClient.getCookie()).includes("two_factor");
  } catch {
    return false;
  }
}

/**
 * The second step. Gives back null when the code was taken; else the words to show, and whether
 * the person has to sign in afresh (the wait for the code ran out, or too many were wrong). This
 * phone is never remembered as trusted.
 */
export function verifyCode(typed: string): Promise<CodeProblem | null> {
  return inTurn(async () => {
    if (!(await cleanFirst())) return { words: PHONE_PROBLEM, startOver: false };
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
    if (!(await cleanFirst())) return PHONE_PROBLEM;
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
    if (!(await cleanFirst())) return PHONE_PROBLEM;
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
    if (!(await cleanFirst())) return;
    if (!now && Date.now() - renewedAt < 6 * HOUR) return;
    try {
      if (!(await authClient.getCookie())) return;
      renewing = true;
      const asked = await authClient.getSession();
      if (!asked.error) renewedAt = Date.now();
    } catch {
      // Not reached: tried again the next time.
    } finally {
      renewing = false;
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
 * The first half of signing out, done at once, before the screen changes: from now on the app
 * asks as nobody, and the phone remembers that a sign-out is under way.
 */
export async function startLeaving(): Promise<void> {
  leaving = "yes";
  try {
    await SecureStore.setItemAsync(LEAVING_KEY, "1");
  } catch {
    // The phone could not note it. Then the kept sign-in is wiped here and now, before the screen changes, so that
    // closing the app in the next moment cannot bring the person back. (The server is still told, in turn.)
    await wipeKept();
  }
}

/**
 * The second half: ends this phone's session on the server and wipes what the phone kept. The
 * phone's side is wiped whether or not the server was reached, so a phone handed to someone else
 * never stays signed in. It takes its turn like every other request, so nothing asked earlier can
 * write a sign-in back after it; and until the phone's side is seen to be empty the app goes on
 * asking as nobody, also after it was closed and opened again.
 */
export function signOut(): Promise<void> {
  return inTurn(async () => {
    leaving = "yes";
    await finishLeaving();
  });
}
