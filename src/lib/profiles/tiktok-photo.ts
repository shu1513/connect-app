/**
 * "Use my TikTok photo" (plans/33): starting the sign-in and finishing it. Connect keeps no key
 * from TikTok, so a host's profile picture can only be had when the host signs in there. The try
 * is written down at the press and carried through the sign-in inside the signed note; what
 * comes back continues that try and no other.
 *
 * A sign-in for the photo never changes the account on the host's page: nothing here calls the
 * function that confirms an account. The key TikTok gives is used for one question and handed
 * back, as for "Connect your TikTok".
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { readPhotoNote, sameValue, writePhotoNote } from "./login-note";
import { abandonTry, endTakenUpTry, finishTikTokTry, startPhotoTry, takeUpTry, type PhotoOptions, type PhotoOutcome } from "./photo";
import { photoNotice } from "./photo-words";
import { noteRefusedSignIn } from "./profiles";
import { hasBothScopes, TIKTOK_LOGIN_MINUTES, tiktokAccountFor, tiktokLoginUrl, type TikTokLookup, type TikTokSettings } from "./tiktok";
import { TIKTOK_OFF } from "./tiktok-login";

const NOT_FINISHED = "Your photo was not taken from TikTok. Nothing was changed. Please try again.";

/**
 * The press. Starts the try (with every refusal a press can meet) and, if it started, says where
 * to send the host and which note to keep in their browser until they come back.
 */
export async function startTikTokPhoto(input: { userId: string; now: Date; settings: TikTokSettings }, options: Pick<PhotoOptions, "services" | "clock" | "diaryHosts"> = {}): Promise<{ url: string; note: string; maxAgeSeconds: number; tryId: string } | { refused: Exclude<PhotoOutcome, "shown"> }> {
  const started = await startPhotoTry({ userId: input.userId, network: "tiktok" }, options);
  if (typeof started === "string") return { refused: started };
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + TIKTOK_LOGIN_MINUTES * 60_000);
  return {
    url: tiktokLoginUrl({ clientKey: input.settings.clientKey, returnUrl: input.settings.returnUrl, state }),
    note: writePhotoNote({ state, userId: input.userId, expiresAt, tryId: started.tryId }, input.settings.signingSecret),
    maxAgeSeconds: TIKTOK_LOGIN_MINUTES * 60,
    tryId: started.tryId,
  };
}

/** The press wrote its try, but the note could not be put in the host's browser: the try is ended, so the host is not told to "finish at TikTok" when they were never sent there. */
export async function giveUpTikTokPhoto(input: { userId: string; tryId: string; now: Date }): Promise<void> {
  await abandonTry({ userId: input.userId, tryId: input.tryId }, input.now);
}

/** Whether the cookie holds the note of a sign-in for a photo. The return address asks this to know which of the two kinds of return it has. */
export function isPhotoReturn(note: string | undefined, settings: TikTokSettings | null, now: Date): boolean {
  return settings !== null && readPhotoNote(note, settings.signingSecret, now) !== null;
}

/**
 * The host is back from TikTok after "Use my TikTok photo". Returns the sentence to show them on
 * the Hosting page. The caller has already removed the cookie. In this order:
 *
 *   1. our own note, the value TikTok sent along, and the same person. If any does not fit,
 *      nothing is touched: a note can be genuine and still belong to another tab's sign-in.
 *   2. the try named in the note is taken up. If it cannot be (the same return a second time, or
 *      the try has ended), nothing more happens.
 *   3. only now, as the one return that owns the try: the host did not finish at TikTok, a
 *      permission is missing, or the person may not go on. Each ends the try there and then.
 *   4. TikTok is asked, with the picture, and the answer goes to finishTikTokTry.
 */
export async function finishTikTokPhoto(input: {
  settings: TikTokSettings | null;
  /** What TikTok put in the address: a one-time code, our value and the permissions given, or an error. */
  code: string | null;
  state: string | null;
  scopes: string | null;
  refused: boolean;
  /** The cookie's value. */
  note: string | undefined;
  /** The person logged in to Connect right now. */
  userId: string;
  now: Date;
  /** Only the check script passes these, to pretend TikTok's side, the picture server and the checking services. */
  accountFor?: TikTokLookup;
  photo?: PhotoOptions;
}): Promise<string> {
  if (!input.settings) return TIKTOK_OFF;
  const settings = input.settings;
  const started = readPhotoNote(input.note, settings.signingSecret, input.now);
  if (!started || !input.state || !sameValue(started.state, input.state) || started.userId !== input.userId) return NOT_FINISHED;

  // If taking the try up fails, nobody knows whether this return owns the try: nothing is ended, and the host is told
  // that something of ours went wrong.
  const took = await takeUpTry({ userId: input.userId, tryId: started.tryId }, input.now).catch(() => null);
  if (took === null) return photoNotice({ outcome: "failed" }, "tiktok");
  if (!took) return photoNotice({ outcome: "already_returned" }, "tiktok");
  const tryId = started.tryId;

  // From here on this return owns the try. Whatever of our own breaks before the try has its result, the try is ended
  // if it still can be (so it is not left taken up and running), and the host is told plainly.
  try {
    return await ownedReturn({ ...input, settings }, tryId);
  } catch (error) {
    console.error("[tiktok] a photo's return failed", error instanceof Error ? error.name : "error");
    await endTakenUpTry(tryId, "stopped", "the return failed", input.now).catch(() => undefined);
    return photoNotice({ outcome: "failed" }, "tiktok");
  }
}

/** Steps 3 and 4 of a photo's return, for the one return that has taken the try up. */
async function ownedReturn(input: Parameters<typeof finishTikTokPhoto>[0] & { settings: TikTokSettings }, tryId: string): Promise<string> {
  const settings = input.settings;
  if (input.refused || !input.code) {
    await endTakenUpTry(tryId, "stopped", "the host did not finish at TikTok", input.now);
    return "You did not finish at TikTok. Nothing was changed.";
  }
  if (!hasBothScopes(input.scopes)) {
    await endTakenUpTry(tryId, "stopped", "a permission was not given at TikTok", input.now);
    return "TikTok did not share your account's name with us. Nothing was changed. Please try again and leave both switches on at TikTok.";
  }
  const [person] = await db.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, input.userId));
  if (!person || person.pausedAt || person.closedAt) {
    await endTakenUpTry(tryId, "stopped", "the account could no longer do this", input.now);
    return photoNotice({ outcome: "cannot" }, "tiktok");
  }

  const withPicture: TikTokLookup = (code, tiktok) => tiktokAccountFor(code, tiktok, undefined, { withPicture: true });
  const found = await (input.accountFor ?? withPicture)(input.code, settings).catch(() => ({ kind: "failed", reason: "no answer" }) as const);
  if (found.kind === "refused") {
    // TikTok did not accept our own keys or the permissions we ask for: the founder's page says so.
    console.error(`[tiktok] a photo's sign-in was not finished: our keys or permissions were refused (${found.reason})`);
    await noteRefusedSignIn(input.userId, "tiktok", input.now).catch(() => undefined);
    await endTakenUpTry(tryId, "not_fetched", "tiktok refused our keys or permissions", input.now);
    return photoNotice({ outcome: "not_fetched" }, "tiktok");
  }
  if (found.kind === "failed") {
    console.error(`[tiktok] a photo's sign-in was not finished: ${found.reason}`);
    await endTakenUpTry(tryId, "not_fetched", `tiktok: ${found.reason}`, input.now);
    return photoNotice({ outcome: "not_fetched" }, "tiktok");
  }
  return photoNotice(await finishTikTokTry({ userId: input.userId, tryId, account: found }, input.photo), "tiktok");
}
