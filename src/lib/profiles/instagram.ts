/**
 * "Connect your Instagram": the parts that are plain logic, so they can be tested on their own.
 * The settings, where the host is sent, reading Meta's answers, and the rule for which of the
 * shared accounts is taken. Meta's name for this sign-in is "Instagram API with Unified Login"
 * (Facebook Login for Business). See plans/28-connect-your-instagram.md.
 */

/** Where Meta sends the host back to. Registered with Meta, so it never changes with the request. */
export const INSTAGRAM_RETURN_PATH = "/api/social/instagram/return";
/** The cookie that remembers who started a sign-in. Sent only to the return address. */
export const INSTAGRAM_COOKIE = "connect_instagram_login";
export const INSTAGRAM_COOKIE_PATH = "/api/social/instagram";
/** How long a host has to finish at Meta. */
export const INSTAGRAM_LOGIN_MINUTES = 10;
/** How many shared accounts are asked for at once. A list that goes on after these is refused whole. */
export const INSTAGRAM_ACCOUNTS_ASKED = 100;

export type InstagramSettings = {
  /** The Meta app's number. Not a secret. */
  appId: string;
  appSecret: string;
  /** The number of the configuration at Meta that says what is asked for. Not a secret. */
  configId: string;
  /** The one return address, built from the site's own setting and never from a request. */
  returnUrl: string;
  /** Signs the cookie that remembers who started. */
  signingSecret: string;
};

/**
 * The settings, or null while "Connect your Instagram" is switched off. It is on only when the
 * Meta app's number, its secret and the configuration's number are there and the site's own
 * address is a plain https address (Meta accepts no other for the return).
 */
export function instagramSettings(): InstagramSettings | null {
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  const configId = process.env.INSTAGRAM_LOGIN_CONFIG_ID?.trim();
  const signingSecret = process.env.BETTER_AUTH_SECRET;
  const site = (process.env.PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "").trim().replace(/\/$/, "");
  // (A signing secret of spaces only is no secret.)
  if (!appId || !appSecret || !configId || !signingSecret?.trim() || !site) return null;
  // Both numbers are Meta's own: digits only.
  if (!/^[0-9]{5,30}$/.test(appId) || !/^[0-9]{5,30}$/.test(configId)) return null;
  let address: URL;
  try {
    address = new URL(site);
  } catch {
    return null;
  }
  // Each part is looked at by itself, so "https://CONNECT.EXAMPLE" or ":443" at the end still count.
  if (address.protocol !== "https:" || address.username || address.password || address.pathname !== "/" || address.search || address.hash) return null;
  // Built from the tidied address. This exact address is the one to register with Meta.
  return { appId, appSecret, configId, returnUrl: `${address.origin}${INSTAGRAM_RETURN_PATH}`, signingSecret };
}

/** True while an Instagram account can also be proven by signing in at Meta. (The code in the bio stays.) */
export function instagramSignInOn(): boolean {
  return instagramSettings() !== null;
}

/** The address at Meta the host is sent to. `state` comes back to us unchanged. */
export function instagramLoginUrl(input: { appId: string; configId: string; returnUrl: string; state: string }): string {
  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("config_id", input.configId);
  url.searchParams.set("redirect_uri", input.returnUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  return url.toString();
}

function parsed(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Why a sign-in was not finished, as one of a fixed list of short reasons. These, and nothing
 * Meta wrote itself, are what is ever written to the log.
 */
export type InstagramProblem = "no answer" | "an answer that could not be read" | "the code was not accepted" | "the list of accounts could not be read" | "the list of accounts goes on";

/**
 * Meta's error numbers that mean our own set-up is the problem, never the host. Both seen for real
 * on 19 November 2026: 101 for an app number Meta does not know (or none), 191 for a return
 * address that is not registered for the app.
 */
const OURS = [101, 191] as const;

export type KeyAnswer =
  | { kind: "key"; accessToken: string }
  /** Meta did not accept our own app's number or return address. Never about the host. */
  | { kind: "refused" }
  | { kind: "failed"; reason: InstagramProblem };

/** Reads Meta's answer to "swap this one-time code for a key". */
export function readKeyAnswer(body: string): KeyAnswer {
  const answer = parsed(body);
  if (!answer) return { kind: "failed", reason: "an answer that could not be read" };
  if (answer.error !== undefined) {
    const code = (answer.error as { code?: unknown } | null)?.code;
    // Anything else (a code Meta will not take, one that was used before) is not about our set-up.
    return OURS.some((ours) => ours === code) ? { kind: "refused" } : { kind: "failed", reason: "the code was not accepted" };
  }
  if (typeof answer.access_token !== "string" || answer.access_token.length === 0) return { kind: "failed", reason: "an answer that could not be read" };
  return { kind: "key", accessToken: answer.access_token };
}

/** One Instagram account as Meta lists it: its lasting number, kept as text, and its name today. */
export type SharedAccount = { accountId: string; username: string };

export type AccountsAnswer = { kind: "accounts"; accounts: SharedAccount[] } | { kind: "failed"; reason: InstagramProblem };

/**
 * Reads Meta's answer to "which Instagram accounts did this host share". Seen for real on
 * 19 November 2026: `{"data":[{"id":"…","username":"…"}],"paging":{"cursors":{…}}}`. The cursors
 * are there also when nothing follows; a `next` address means the list goes on.
 *
 * It is a list or it is not: a line without a number or a name, or the same account twice, makes
 * the whole answer unreadable. Lines are never dropped, so "exactly one shared" is never the
 * result of a damaged list. The number is taken from the text as it came, never as a JavaScript
 * number.
 */
export function readAccountsAnswer(body: string): AccountsAnswer {
  const unreadable = { kind: "failed", reason: "the list of accounts could not be read" } as const;
  const answer = parsed(body);
  if (!answer || answer.error !== undefined || !Array.isArray(answer.data)) return unreadable;
  const paging = answer.paging as { next?: unknown } | undefined;
  if (paging && typeof paging === "object" && paging.next !== undefined && paging.next !== null) return { kind: "failed", reason: "the list of accounts goes on" };
  if (answer.data.length > INSTAGRAM_ACCOUNTS_ASKED) return { kind: "failed", reason: "the list of accounts goes on" };
  const accounts: SharedAccount[] = [];
  for (const line of answer.data as unknown[]) {
    const one = line as { id?: unknown; username?: unknown } | null;
    if (!one || typeof one !== "object") return unreadable;
    // Meta sends the number as text. A bare number would already have lost its last digits on the way in.
    if (typeof one.id !== "string" || !/^[0-9]{5,30}$/.test(one.id)) return unreadable;
    if (typeof one.username !== "string" || !/^[A-Za-z0-9._]{1,30}$/.test(one.username)) return unreadable;
    if (accounts.some((seen) => seen.accountId === one.id || seen.username.toLowerCase() === (one.username as string).toLowerCase())) return unreadable;
    accounts.push({ accountId: one.id, username: one.username });
  }
  return { kind: "accounts", accounts };
}

export type Choice = { kind: "take"; account: SharedAccount } | { kind: "none_shared" } | { kind: "several" };

/**
 * Which of the shared accounts becomes the host's Instagram account (plans/28, "Which account is
 * taken"). Meta's list is the only source: what the host's entry says only helps to pick among
 * several, and never puts a name on the page that Meta did not list.
 *
 *   1. exactly one shared: that one;
 *   2. several, and one has the number already kept on the host's entry: that one, whatever the names say;
 *   3. several, the entry has no number, and exactly one has the entry's name: that one;
 *   4. several, and neither: none.
 */
export function chooseAccount(shared: SharedAccount[], entry: { nameKey: string; providerAccountId: string | null } | null): Choice {
  if (shared.length === 0) return { kind: "none_shared" };
  if (shared.length === 1) return { kind: "take", account: shared[0] };
  if (entry?.providerAccountId) {
    const same = shared.find((account) => account.accountId === entry.providerAccountId);
    return same ? { kind: "take", account: same } : { kind: "several" };
  }
  if (entry) {
    const named = shared.filter((account) => account.username.toLowerCase() === entry.nameKey);
    if (named.length === 1) return { kind: "take", account: named[0] };
  }
  return { kind: "several" };
}

// ---------------------------------------------------------------------------
// The two requests to Meta. Our secret travels in the body of a request and the key in a header,
// never in an address.
// ---------------------------------------------------------------------------

const KEY_URL = "https://graph.facebook.com/v27.0/oauth/access_token";
const ACCOUNTS_URL = `https://graph.facebook.com/v27.0/me/assigned_instagram_accounts?fields=id,username&limit=${INSTAGRAM_ACCOUNTS_ASKED}`;
/** How long a request may take, waiting for the answer and reading it. */
const TIME_LIMIT_MS = 8_000;

/** One request to Meta and the text of its answer, or null when there was none. Never throws. */
export type InstagramSend = (url: string, request: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<string | null>;

/** A fresh request, with a time limit, that follows no redirect and is not tried again. */
const send: InstagramSend = async (url, request) => {
  try {
    const answer = await fetch(url, { ...request, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIME_LIMIT_MS) });
    return await answer.text();
  } catch {
    return null;
  }
};

export type InstagramAccounts =
  | { kind: "accounts"; accounts: SharedAccount[] }
  | { kind: "refused" }
  | { kind: "failed"; reason: InstagramProblem };

export type InstagramLookup = (code: string, settings: InstagramSettings) => Promise<InstagramAccounts>;

/**
 * Swaps the one-time code for a key and asks once which Instagram accounts the host shared. The
 * key stays inside this function and is dropped when it returns: it is never stored, logged or
 * handed on.
 */
export async function instagramAccountsFor(code: string, settings: InstagramSettings, transport: InstagramSend = send): Promise<InstagramAccounts> {
  const swapped = await transport(KEY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: settings.appId, client_secret: settings.appSecret, redirect_uri: settings.returnUrl, code }).toString(),
  });
  if (swapped === null) return { kind: "failed", reason: "no answer" };
  const key = readKeyAnswer(swapped);
  if (key.kind !== "key") return key;
  const asked = await transport(ACCOUNTS_URL, { method: "GET", headers: { authorization: `Bearer ${key.accessToken}` } });
  return asked === null ? { kind: "failed", reason: "no answer" } : readAccountsAnswer(asked);
}
