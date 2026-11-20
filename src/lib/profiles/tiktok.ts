/**
 * "Connect your TikTok": the parts that are plain logic, so they can be tested on their own.
 * Where the host is sent, the signed note that remembers who started, the settings, and reading
 * TikTok's answers. TikTok's name for this sign-in is "Login Kit for Web".
 */
import { readNote, sameValue as sameNoteValue, writeNote } from "./login-note";

/** Where TikTok sends the host back to. Registered with TikTok, so it never changes with the request. */
export const TIKTOK_RETURN_PATH = "/api/social/tiktok/return";
/** The cookie that remembers who started a sign-in. Sent only to the return address. */
export const TIKTOK_COOKIE = "connect_tiktok_login";
export const TIKTOK_COOKIE_PATH = "/api/social/tiktok";
/** How long a host has to finish at TikTok. */
export const TIKTOK_LOGIN_MINUTES = 10;

/** The two permissions asked for: the account's own number ("basic") and its name ("profile"). */
export const TIKTOK_SCOPES = ["user.info.basic", "user.info.profile"] as const;

export type TikTokSettings = {
  clientKey: string;
  clientSecret: string;
  /** The one return address, built from the site's own setting and never from a request. */
  returnUrl: string;
  /** Signs the cookie that remembers who started. */
  signingSecret: string;
};

/**
 * The settings, or null while "Connect your TikTok" is switched off. It is on only when both of
 * TikTok's keys are there and the site's own address is a plain https address (TikTok accepts no
 * other for the return).
 */
export function tiktokSettings(): TikTokSettings | null {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  const signingSecret = process.env.BETTER_AUTH_SECRET;
  const site = (process.env.PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "").trim().replace(/\/$/, "");
  if (!clientKey || !clientSecret || !signingSecret || !site) return null;
  let address: URL;
  try {
    address = new URL(site);
  } catch {
    return null;
  }
  // Each part is looked at by itself, so "https://CONNECT.EXAMPLE" or ":443" at the end still count.
  if (address.protocol !== "https:" || address.username || address.password || address.pathname !== "/" || address.search || address.hash) return null;
  // Built from the tidied address. This exact address is the one to register with TikTok.
  return { clientKey, clientSecret, returnUrl: `${address.origin}${TIKTOK_RETURN_PATH}`, signingSecret };
}

/** True while a TikTok account is proven by signing in at TikTok (and no longer with a code). */
export function tiktokSignInOn(): boolean {
  return tiktokSettings() !== null;
}

/** The address at TikTok the host is sent to. `state` comes back to us unchanged. */
export function tiktokLoginUrl(input: { clientKey: string; returnUrl: string; state: string }): string {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", input.clientKey);
  url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.returnUrl);
  url.searchParams.set("state", input.state);
  return url.toString();
}

/**
 * The cookie's value: the random value sent to TikTok, who started, and until when it counts,
 * signed so that only this server can have written it. (The signing itself is shared with the
 * other sign-ins, in login-note.ts; TikTok's notes carry TikTok's own label.)
 */
export function writeLoginNote(input: { state: string; userId: string; expiresAt: Date }, secret: string): string {
  return writeNote("tiktok-login", input, secret);
}

/** Reads the cookie's value. Null when it was not written by us, was changed, or is out of date. */
export function readLoginNote(note: string | undefined, secret: string, now: Date): { state: string; userId: string } | null {
  return readNote("tiktok-login", note, secret, now);
}

/** True when two values are the same, compared without giving away where they differ. */
export const sameValue = sameNoteValue;

/** True when both permissions are among those TikTok says were given. More are allowed, fewer are not. */
export function hasBothScopes(given: unknown): boolean {
  if (typeof given !== "string") return false;
  const granted = new Set(given.split(",").map((scope) => scope.trim()));
  return TIKTOK_SCOPES.every((scope) => granted.has(scope));
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
 * TikTok wrote itself, are what is ever written to the log.
 */
export type TikTokProblem =
  | "no answer"
  | "an answer that could not be read"
  | "the code was not accepted"
  | "permissions missing"
  | "no account number"
  | "account numbers differ"
  | "no account name";

/** TikTok's answers that mean our own keys, or the permissions we ask for, are the problem. Nothing else is. */
const OURS = ["invalid_client", "unauthorized_client", "invalid_scope"] as const;
export type TikTokRefusal = (typeof OURS)[number];

export type TokenAnswer =
  | { kind: "key"; accessToken: string; openId: string }
  /** TikTok did not accept our own keys or permissions. Never about the host. */
  | { kind: "refused"; reason: TikTokRefusal }
  | { kind: "failed"; reason: TikTokProblem };

/** The key in TikTok's answer, if it issued one at all, whatever else is wrong with the answer. Only to hand it back. */
export function issuedKey(body: string): string | null {
  const key = parsed(body)?.access_token;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/** Reads TikTok's answer to "swap this one-time code for a key". */
export function readTokenAnswer(body: string): TokenAnswer {
  const answer = parsed(body);
  if (!answer) return { kind: "failed", reason: "an answer that could not be read" };
  if (answer.error !== undefined) {
    const ours = OURS.find((reason) => reason === answer.error);
    // Anything else (a code TikTok will not take, a return address that does not match) is not about our keys.
    return ours ? { kind: "refused", reason: ours } : { kind: "failed", reason: "the code was not accepted" };
  }
  if (typeof answer.access_token !== "string" || answer.access_token.length === 0) return { kind: "failed", reason: "an answer that could not be read" };
  if (typeof answer.open_id !== "string" || answer.open_id.length === 0) return { kind: "failed", reason: "no account number" };
  if (!hasBothScopes(answer.scope)) return { kind: "failed", reason: "permissions missing" };
  return { kind: "key", accessToken: answer.access_token, openId: answer.open_id };
}

/** `pictureAddress`: where the account's large profile picture is, when TikTok was asked for it and sent one (plans/32). */
export type AccountAnswer = { kind: "account"; openId: string; username: string; pictureAddress?: string } | { kind: "failed"; reason: TikTokProblem };

/**
 * Reads TikTok's answer to "which account is this key for". `openId` is the account's number from
 * the token answer: the two must be the same text. The display name is never used as the name.
 *
 * A picture's address is handed on when TikTok sent one as text. A missing one, or one that is not
 * text, is no reason to fail: the account is what was asked about. Whether the address may be
 * fetched is decided in photo-rules.ts.
 */
export function readAccountAnswer(body: string, openId: string): AccountAnswer {
  const answer = parsed(body);
  const error = answer?.error as { code?: unknown } | undefined;
  if (!answer || !error || typeof error !== "object" || error.code !== "ok") return { kind: "failed", reason: "an answer that could not be read" };
  const user = (answer.data as { user?: { open_id?: unknown; username?: unknown } } | undefined)?.user;
  if (!user || typeof user !== "object") return { kind: "failed", reason: "an answer that could not be read" };
  if (typeof user.open_id !== "string" || user.open_id.length === 0) return { kind: "failed", reason: "no account number" };
  if (user.open_id !== openId) return { kind: "failed", reason: "account numbers differ" };
  if (typeof user.username !== "string" || !/^[A-Za-z0-9._]{2,24}$/.test(user.username)) return { kind: "failed", reason: "no account name" };
  const picture = (user as { avatar_large_url?: unknown }).avatar_large_url;
  const account = { kind: "account" as const, openId: user.open_id, username: user.username };
  return typeof picture === "string" && picture.length > 0 && picture.length <= 2000 ? { ...account, pictureAddress: picture } : account;
}

// ---------------------------------------------------------------------------
// The requests to TikTok. Our secret travels in the body of a request and the key in a header,
// never in an address.
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const ACCOUNT_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,username";
/** The same question, also asking where the account's large profile picture is. Only for a host's photo (plans/32); it needs no further permission. */
const ACCOUNT_WITH_PICTURE_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,avatar_large_url";
const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
/** How long a request may take, waiting for the answer and reading it. */
const TIME_LIMIT_MS = 8_000;

/** One request to TikTok and the text of its answer, or null when there was none. Never throws. */
export type TikTokSend = (url: string, request: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<string | null>;

/**
 * A form for TikTok: the fields as text, labelled exactly "application/x-www-form-urlencoded".
 * Seen for real on 16 November 2026: TikTok answers "The request parameters are malformed" when the
 * label also carries ";charset=UTF-8", which is what happens when the fields are handed over as they
 * are and the label is left to be added by itself.
 */
function form(fields: Record<string, string>): { headers: Record<string, string>; body: string } {
  return { headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() };
}

/** A fresh request, with a time limit, that follows no redirect and is not tried again. */
const send: TikTokSend = async (url, request) => {
  try {
    const answer = await fetch(url, { ...request, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIME_LIMIT_MS) });
    return await answer.text();
  } catch {
    return null;
  }
};

export type TikTokAccount =
  | { kind: "account"; openId: string; username: string; pictureAddress?: string }
  | { kind: "refused"; reason: TikTokRefusal }
  | { kind: "failed"; reason: TikTokProblem };

export type TikTokLookup = (code: string, settings: TikTokSettings) => Promise<TikTokAccount>;

/**
 * Swaps the one-time code for a short-lived key, asks once which account it belongs to, and then
 * tries to hand the key back to TikTok, whatever happened in between. The key stays inside this
 * function.
 *
 * `withPicture`: the one question also asks where the account's profile picture is. Only a
 * sign-in a host started to take their photo asks that; an ordinary "Connect your TikTok" reads
 * the number and the name and nothing else.
 */
export async function tiktokAccountFor(code: string, settings: TikTokSettings, transport: TikTokSend = send, options: { withPicture?: boolean } = {}): Promise<TikTokAccount> {
  const swapped = await transport(TOKEN_URL, {
    method: "POST",
    ...form({
      client_key: settings.clientKey,
      client_secret: settings.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: settings.returnUrl,
    }),
  });
  if (swapped === null) return { kind: "failed", reason: "no answer" };
  // A key that was issued is handed back whatever follows, also when its own answer is not good enough to use.
  const issued = issuedKey(swapped);
  try {
    const token = readTokenAnswer(swapped);
    if (token.kind !== "key") return token;
    const asked = await transport(options.withPicture ? ACCOUNT_WITH_PICTURE_URL : ACCOUNT_URL, { method: "GET", headers: { authorization: `Bearer ${token.accessToken}` } });
    return asked === null ? { kind: "failed", reason: "no answer" } : readAccountAnswer(asked, token.openId);
  } finally {
    // Tried, not promised: if TikTok cannot be reached now, the key simply runs out by itself.
    if (issued !== null) {
      await transport(REVOKE_URL, {
        method: "POST",
        ...form({ client_key: settings.clientKey, client_secret: settings.clientSecret, token: issued }),
      }).catch(() => null);
    }
  }
}
