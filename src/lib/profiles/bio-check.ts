/**
 * Reading an account's public bio through the network's own service, to look for a host's proof
 * code. Instagram: Meta's "Business Discovery" (professional accounts only). YouTube: the YouTube
 * Data API (the channel's description).
 *
 * Everything that can go wrong in here comes out as one of five plain results. Nothing from a
 * request, its address or an answer is ever passed on in an error or written to the log, because
 * the keys travel in the address.
 */

export type BioNetwork = "instagram" | "youtube";

export type BioAnswer =
  /** The account was read. `text` is its bio (Instagram) or channel description (YouTube), possibly empty. */
  | { kind: "bio"; text: string }
  /** There is no account of that name that we can read (on Instagram also: it is a personal account). */
  | { kind: "no_account" }
  /** The network says we asked too often. */
  | { kind: "too_often"; code?: number }
  /** The network did not accept our own key or permission. Never about the host's account. */
  | { kind: "refused"; code?: number }
  /** Anything else: no connection, too slow, an answer we do not recognise. */
  | { kind: "unavailable"; code?: number };

/** True when the proof code is somewhere in the text. Capital letters do not matter. */
export function bioHasCode(bio: string, code: string): boolean {
  return code.length > 0 && bio.toLowerCase().includes(code.toLowerCase());
}

function parsed(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Meta's own numbers. A failure is told apart by these, never by the kind of HTTP answer.
const META_KEY = [190, 102];
const META_TOO_OFTEN = [4, 17, 32, 613, 341, 80002];
/** "Cannot find User": seen for real on 15 November 2026 for a name that does not exist. */
const META_NO_USER = { code: 110, subcode: 2207013 };

/** Reads Meta's answer to "the bio of the professional account called <nameKey>". */
export function readInstagramAnswer(body: string, nameKey: string): BioAnswer {
  const answer = parsed(body);
  if (!answer) return { kind: "unavailable" };
  const error = answer.error as { code?: unknown; error_subcode?: unknown } | undefined;
  if (error && typeof error === "object") {
    const code = Number.isInteger(error.code) ? (error.code as number) : undefined;
    if (code === undefined) return { kind: "unavailable" };
    if (code === META_NO_USER.code && error.error_subcode === META_NO_USER.subcode) return { kind: "no_account" };
    if (META_KEY.includes(code) || code === 10 || (code >= 200 && code <= 299)) return { kind: "refused", code };
    if (META_TOO_OFTEN.includes(code)) return { kind: "too_often", code };
    return { kind: "unavailable", code };
  }
  const found = answer.business_discovery as { username?: unknown; biography?: unknown } | undefined;
  if (!found || typeof found !== "object" || typeof found.username !== "string") return { kind: "unavailable" };
  // The answer must be about the account we asked for.
  if (found.username.toLowerCase() !== nameKey.toLowerCase()) return { kind: "unavailable" };
  // An account with an empty bio comes back without the field.
  if (found.biography !== undefined && typeof found.biography !== "string") return { kind: "unavailable" };
  return { kind: "bio", text: found.biography ?? "" };
}

const GOOGLE_TOO_OFTEN = ["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"];
const GOOGLE_KEY = ["keyInvalid", "accessNotConfigured", "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "SERVICE_DISABLED"];

/** Reads Google's answer to "the channel whose handle is @<nameKey>". */
export function readYouTubeAnswer(body: string, nameKey: string): BioAnswer {
  const answer = parsed(body);
  if (!answer) return { kind: "unavailable" };
  const error = answer.error as { code?: unknown; errors?: unknown; details?: unknown } | undefined;
  if (error && typeof error === "object") {
    const code = Number.isInteger(error.code) ? (error.code as number) : undefined;
    const reasons = [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])]
      .map((entry) => (entry && typeof entry === "object" ? (entry as { reason?: unknown }).reason : undefined))
      .filter((reason): reason is string => typeof reason === "string");
    if (reasons.some((reason) => GOOGLE_KEY.includes(reason))) return { kind: "refused", code };
    if (reasons.some((reason) => GOOGLE_TOO_OFTEN.includes(reason))) return { kind: "too_often", code };
    return { kind: "unavailable", code };
  }
  if (answer.kind !== "youtube#channelListResponse") return { kind: "unavailable" };
  // A handle that leads nowhere is a good answer with no channel in it.
  if (answer.items === undefined) return { kind: "no_account" };
  if (!Array.isArray(answer.items)) return { kind: "unavailable" };
  if (answer.items.length === 0) return { kind: "no_account" };
  if (answer.items.length !== 1) return { kind: "unavailable" };
  const snippet = (answer.items[0] as { snippet?: { customUrl?: unknown; description?: unknown } } | null)?.snippet;
  if (!snippet || typeof snippet !== "object") return { kind: "unavailable" };
  // The one channel an exact handle leads to is trusted. When the answer names a handle, it must be ours.
  // (The channel's title is a display name and is never compared.)
  if (typeof snippet.customUrl === "string" && snippet.customUrl.toLowerCase() !== `@${nameKey.toLowerCase()}`) return { kind: "unavailable" };
  if (snippet.description !== undefined && typeof snippet.description !== "string") return { kind: "unavailable" };
  return { kind: "bio", text: snippet.description ?? "" };
}

export type BioSettings = {
  /** Meta's key, and the number of our own Instagram account (not a secret), which the request is asked as. */
  instagram: { token: string; accountId: string } | null;
  youtube: { key: string } | null;
};

/** The settings for the automatic check. A network whose settings are missing is confirmed by hand, as before. */
export function bioSettings(): BioSettings {
  const token = process.env.INSTAGRAM_CHECK_TOKEN?.trim();
  const accountId = process.env.INSTAGRAM_CHECK_ACCOUNT_ID?.trim();
  const key = process.env.YOUTUBE_API_KEY?.trim();
  return {
    instagram: token && accountId && /^[0-9]{5,30}$/.test(accountId) ? { token, accountId } : null,
    youtube: key ? { key } : null,
  };
}

/** True when Connect can confirm an account on this network by itself. */
export function isAutomatic(network: string, settings: BioSettings = bioSettings()): network is BioNetwork {
  return (network === "instagram" && settings.instagram !== null) || (network === "youtube" && settings.youtube !== null);
}

/** How long a request may take, waiting for the answer and reading it. */
const TIME_LIMIT_MS = 8_000;

/** One fresh request. Null when it did not get through, took too long or could not be read. */
async function ask(address: URL): Promise<string | null> {
  try {
    const answer = await fetch(address, { cache: "no-store", signal: AbortSignal.timeout(TIME_LIMIT_MS) });
    return await answer.text();
  } catch {
    return null;
  }
}

export type BioReader = (network: BioNetwork, nameKey: string) => Promise<BioAnswer>;

/**
 * Reads the bio of one account. `nameKey` is the cleaned-up name the app stores (see social.ts); it
 * is checked again here, so nothing else can ever be put into a request. One request, no second try.
 */
export const readBio: BioReader = async (network, nameKey) => {
  const settings = bioSettings();
  let answer: BioAnswer = { kind: "unavailable" };
  if (network === "instagram" && settings.instagram && /^[a-z0-9._]{1,30}$/.test(nameKey)) {
    const address = new URL(`https://graph.facebook.com/v27.0/${settings.instagram.accountId}`);
    address.searchParams.set("fields", `business_discovery.username(${nameKey}){username,biography}`);
    address.searchParams.set("access_token", settings.instagram.token);
    const body = await ask(address);
    if (body !== null) answer = readInstagramAnswer(body, nameKey);
  } else if (network === "youtube" && settings.youtube && /^[a-z0-9._-]{3,30}$/.test(nameKey)) {
    const address = new URL("https://www.googleapis.com/youtube/v3/channels");
    address.searchParams.set("part", "snippet");
    address.searchParams.set("forHandle", `@${nameKey}`);
    address.searchParams.set("key", settings.youtube.key);
    const body = await ask(address);
    if (body !== null) answer = readYouTubeAnswer(body, nameKey);
  }
  // Only the network, the result and the network's own number are written down. Never an address or an answer.
  if (answer.kind !== "bio" && answer.kind !== "no_account") {
    console.error(`[bio-check] ${network}: ${answer.kind}${answer.code === undefined ? "" : ` (${answer.code})`}`);
  }
  return answer;
};
