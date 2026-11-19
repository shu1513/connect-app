/**
 * Reading an account's public bio through the network's own service, to look for a host's proof
 * code. Instagram: Meta's "Business Discovery" (professional accounts only). YouTube: the YouTube
 * Data API (the channel's description).
 *
 * Everything that can go wrong in here comes out as one of five plain results. The keys travel in
 * a header of the request, never in its address, so nothing that writes an address down (this
 * app's framework does, in some failures) can ever hold a key. Nothing from an answer is passed on
 * in an error or written to the log either.
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

type Failure = Exclude<BioAnswer, { kind: "bio" }>;

/** What Meta's answer says went wrong, or null when it does not carry an error. The same for every question asked of Business Discovery. */
function metaFailure(answer: Record<string, unknown>): Failure | null {
  const error = answer.error as { code?: unknown; error_subcode?: unknown } | undefined;
  if (!error || typeof error !== "object") return null;
  const code = Number.isInteger(error.code) ? (error.code as number) : undefined;
  if (code === undefined) return { kind: "unavailable" };
  if (code === META_NO_USER.code && error.error_subcode === META_NO_USER.subcode) return { kind: "no_account" };
  if (META_KEY.includes(code) || code === 10 || (code >= 200 && code <= 299)) return { kind: "refused", code };
  if (META_TOO_OFTEN.includes(code)) return { kind: "too_often", code };
  return { kind: "unavailable", code };
}

/** Reads Meta's answer to "the bio of the professional account called <nameKey>". */
export function readInstagramAnswer(body: string, nameKey: string): BioAnswer {
  const answer = parsed(body);
  if (!answer) return { kind: "unavailable" };
  const failure = metaFailure(answer);
  if (failure) return failure;
  const found = answer.business_discovery as { username?: unknown; biography?: unknown } | undefined;
  if (!found || typeof found !== "object" || typeof found.username !== "string") return { kind: "unavailable" };
  // The answer must be about the account we asked for.
  if (found.username.toLowerCase() !== nameKey.toLowerCase()) return { kind: "unavailable" };
  // An account with an empty bio comes back without the field.
  if (found.biography !== undefined && typeof found.biography !== "string") return { kind: "unavailable" };
  return { kind: "bio", text: found.biography ?? "" };
}

export type PhotoAnswer =
  /** The account was read and has a picture. `accountId` is Meta's own number for the account, `address` where its picture is, both from the same answer. */
  | { kind: "picture"; accountId: string; address: string }
  /** The account was read and shows no picture. */
  | { kind: "no_picture" }
  | Failure;

/**
 * Reads Meta's answer to "the number and the profile picture of the professional account called
 * <nameKey>" (plans/29). The number is kept as text, exactly as it came. The address is only
 * handed on here; whether it may be fetched is decided in photo-fetch.ts.
 */
export function readInstagramPhotoAnswer(body: string, nameKey: string): PhotoAnswer {
  const answer = parsed(body);
  if (!answer) return { kind: "unavailable" };
  const failure = metaFailure(answer);
  if (failure) return failure;
  const found = answer.business_discovery as { id?: unknown; username?: unknown; profile_picture_url?: unknown } | undefined;
  if (!found || typeof found !== "object" || typeof found.username !== "string") return { kind: "unavailable" };
  // The answer must be about the account we asked for.
  if (found.username.toLowerCase() !== nameKey.toLowerCase()) return { kind: "unavailable" };
  // The account's own number, from inside the same answer as the picture. (The number beside it, outside, is ours.)
  if (typeof found.id !== "string" || !/^[0-9]{5,30}$/.test(found.id)) return { kind: "unavailable" };
  if (found.profile_picture_url === undefined) return { kind: "no_picture" };
  if (typeof found.profile_picture_url !== "string" || found.profile_picture_url.length === 0 || found.profile_picture_url.length > 2000) return { kind: "unavailable" };
  return { kind: "picture", accountId: found.id, address: found.profile_picture_url };
}

const GOOGLE_TOO_OFTEN = ["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"];
const GOOGLE_KEY = [
  "keyInvalid",
  "keyExpired",
  "accessNotConfigured",
  "API_KEY_INVALID",
  "API_KEY_SERVICE_BLOCKED",
  "API_KEY_IP_ADDRESS_BLOCKED",
  "API_KEY_HTTP_REFERRER_BLOCKED",
  "SERVICE_DISABLED",
];

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
/** The longest answer that is read. A bio or a picture's address is a few thousand characters at most. */
const ANSWER_MAX_BYTES = 256 * 1024;

/**
 * One fresh request, with our key in a header. It never follows a redirect, so the key only ever
 * goes to the address written here. Null when it did not get through, took too long, was longer than any
 * real answer, or could not be read. It is read piece by piece and dropped the moment it is too long.
 */
async function ask(address: URL, keyHeader: Record<string, string>): Promise<string | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const answer = await fetch(address, { headers: keyHeader, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIME_LIMIT_MS) });
    reader = answer.body?.getReader();
    if (!reader) return "";
    const pieces: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > ANSWER_MAX_BYTES) return null;
      pieces.push(next.value);
    }
    return Buffer.concat(pieces).toString("utf8");
  } catch {
    return null;
  } finally {
    // Whatever was not read is let go of.
    void reader?.cancel().catch(() => undefined);
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
    const body = await ask(address, { authorization: `Bearer ${settings.instagram.token}` });
    if (body !== null) answer = readInstagramAnswer(body, nameKey);
  } else if (network === "youtube" && settings.youtube && /^[a-z0-9._-]{3,30}$/.test(nameKey)) {
    const address = new URL("https://www.googleapis.com/youtube/v3/channels");
    address.searchParams.set("part", "snippet");
    address.searchParams.set("forHandle", `@${nameKey}`);
    const body = await ask(address, { "x-goog-api-key": settings.youtube.key });
    if (body !== null) answer = readYouTubeAnswer(body, nameKey);
  }
  // Only the network, the result and the network's own number are written down. Never an answer.
  if (answer.kind !== "bio" && answer.kind !== "no_account") {
    console.error(`[bio-check] ${network}: ${answer.kind}${answer.code === undefined ? "" : ` (${answer.code})`}`);
  }
  return answer;
};

export type PhotoReader = (nameKey: string) => Promise<PhotoAnswer>;

/**
 * Asks Meta for the number and the profile picture of one Instagram account, with the same key,
 * in the same way and under the same care as a bio (plans/29). One request, no second try.
 */
export const readInstagramPhoto: PhotoReader = async (nameKey) => {
  const settings = bioSettings();
  let answer: PhotoAnswer = { kind: "unavailable" };
  if (settings.instagram && /^[a-z0-9._]{1,30}$/.test(nameKey)) {
    const address = new URL(`https://graph.facebook.com/v27.0/${settings.instagram.accountId}`);
    address.searchParams.set("fields", `business_discovery.username(${nameKey}){id,username,profile_picture_url}`);
    const body = await ask(address, { authorization: `Bearer ${settings.instagram.token}` });
    if (body !== null) answer = readInstagramPhotoAnswer(body, nameKey);
  }
  if (answer.kind === "too_often" || answer.kind === "refused" || answer.kind === "unavailable") {
    console.error(`[host-photo] instagram: ${answer.kind}${answer.code === undefined ? "" : ` (${answer.code})`}`);
  }
  return answer;
};
