/**
 * "Connect your TikTok": starting the sign-in and finishing it. A host logs in at TikTok, TikTok
 * tells us which account that is, and the account is confirmed for them. Connect never sees the
 * TikTok password. The key TikTok gives us is used once, handed back to be cancelled, and never
 * kept; our secret travels in the body of a request and the key in a header, never in an address.
 *
 * Switched off until TikTok's two keys are there and the site's address is https: then nothing is
 * asked of TikTok and nothing is saved.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { confirmSocialByLogin, noteRefusedSignIn, ProfileError } from "./profiles";
import { hasBothScopes, readLoginNote, sameValue, TIKTOK_LOGIN_MINUTES, tiktokAccountFor, tiktokLoginUrl, writeLoginNote, type TikTokLookup, type TikTokSettings } from "./tiktok";

export const TIKTOK_OFF = "Connecting with TikTok is not switched on yet.";
const NOT_FINISHED = "TikTok was not connected. Nothing was changed. Please try again.";
const TRY_LATER = "We could not connect TikTok right now. Please try again later.";

/** Where to send the host, and the note to keep in their browser until they come back. */
export function startTikTokLogin(input: { userId: string; now: Date; settings: TikTokSettings }): { url: string; note: string; maxAgeSeconds: number } {
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + TIKTOK_LOGIN_MINUTES * 60_000);
  return {
    url: tiktokLoginUrl({ clientKey: input.settings.clientKey, returnUrl: input.settings.returnUrl, state }),
    note: writeLoginNote({ state, userId: input.userId, expiresAt }, input.settings.signingSecret),
    maxAgeSeconds: TIKTOK_LOGIN_MINUTES * 60,
  };
}

/**
 * The host is back from TikTok. Returns the message to show them on the Hosting page; the account
 * is confirmed only when every check passes. The caller has already removed the cookie. Nothing
 * TikTok sent is looked at before our own note, the value and the person have been checked.
 */
export async function finishTikTokLogin(input: {
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
  /** Only the check script passes this, to pretend TikTok's side. */
  accountFor?: TikTokLookup;
}): Promise<string> {
  if (!input.settings) return TIKTOK_OFF;
  const started = readLoginNote(input.note, input.settings.signingSecret, input.now);
  // The same person who started, with the value we gave them. This is what stops one person's
  // TikTok from being attached to another person's Connect account.
  if (!started || !input.state || !sameValue(started.state, input.state) || started.userId !== input.userId) return NOT_FINISHED;
  if (input.refused || !input.code) return "You did not connect TikTok. Nothing was changed.";
  if (!hasBothScopes(input.scopes)) return "TikTok did not share your account's name with us. Nothing was changed. Please try again and leave both switches on at TikTok.";

  const [person] = await db.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, input.userId));
  if (!person || person.pausedAt || person.closedAt) return NOT_FINISHED;

  const found = await (input.accountFor ?? tiktokAccountFor)(input.code, input.settings).catch(() => ({ kind: "failed", reason: "no answer" }) as const);
  if (found.kind === "refused") {
    // TikTok did not accept our own keys or the permissions we ask for: the founder's page says so.
    console.error(`[tiktok] sign-in not finished: our keys or permissions were refused (${found.reason})`);
    await noteRefusedSignIn(input.userId, "tiktok", input.now).catch(() => undefined);
    return TRY_LATER;
  }
  if (found.kind === "failed") {
    console.error(`[tiktok] sign-in not finished: ${found.reason}`);
    return NOT_FINISHED;
  }
  try {
    const { nameKey } = await confirmSocialByLogin({ userId: input.userId, network: "tiktok", accountId: found.openId, username: found.username, now: input.now });
    return `TikTok @${nameKey} is confirmed.`;
  } catch (error) {
    if (error instanceof ProfileError) return error.message;
    console.error("[tiktok] the confirmed account could not be saved");
    return NOT_FINISHED;
  }
}
