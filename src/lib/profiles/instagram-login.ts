/**
 * "Connect your Instagram": starting the sign-in and finishing it. A host logs in at Meta and
 * shares their Instagram account, Meta tells us which account that is, and the account is
 * confirmed for them. Connect never sees the password. The key Meta gives us is used for one
 * question and dropped; our secret travels in the body of a request and the key in a header,
 * never in an address. See plans/28-connect-your-instagram.md.
 *
 * Switched off until the Meta app's number, its secret and the configuration's number are there
 * and the site's address is https: then nothing is asked of Meta and nothing is saved.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { INSTAGRAM_LOGIN_MINUTES, instagramAccountsFor, instagramLoginUrl, type InstagramLookup, type InstagramSettings } from "./instagram";
import { readNote, sameValue, writeNote } from "./login-note";
import { confirmInstagramBySignIn, noteRefusedSignIn, ProfileError } from "./profiles";

export const INSTAGRAM_OFF = "Connecting with Instagram is not switched on yet.";
const NOT_FINISHED = "Instagram was not connected. Nothing was changed. Please try again.";
const TRY_LATER = "We could not connect Instagram right now. Please try again later, or use the code instead.";

/** Where to send the host, and the note to keep in their browser until they come back. */
export function startInstagramLogin(input: { userId: string; now: Date; settings: InstagramSettings }): { url: string; note: string; maxAgeSeconds: number } {
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + INSTAGRAM_LOGIN_MINUTES * 60_000);
  return {
    url: instagramLoginUrl({ appId: input.settings.appId, configId: input.settings.configId, returnUrl: input.settings.returnUrl, state }),
    note: writeNote("instagram-login", { state, userId: input.userId, expiresAt }, input.settings.signingSecret),
    maxAgeSeconds: INSTAGRAM_LOGIN_MINUTES * 60,
  };
}

/**
 * The host is back from Meta. Returns the message to show them on the Hosting page; the account
 * is confirmed only when every check passes. The caller has already removed the cookie. Nothing
 * Meta sent is looked at, a refusal included, before our own note, the value and the person have
 * been checked.
 */
export async function finishInstagramLogin(input: {
  settings: InstagramSettings | null;
  /** What Meta put in the address: a one-time code and our value, or an error. */
  code: string | null;
  state: string | null;
  refused: boolean;
  /** The cookie's value. */
  note: string | undefined;
  /** The person logged in to Connect right now. */
  userId: string;
  now: Date;
  /** Only the check script passes this, to pretend Meta's side. */
  accountsFor?: InstagramLookup;
}): Promise<string> {
  if (!input.settings) return INSTAGRAM_OFF;
  const started = readNote("instagram-login", input.note, input.settings.signingSecret, input.now);
  // The same person who started, with the value we gave them. This is what stops one person's
  // Instagram from being attached to another person's Connect account.
  if (!started || !input.state || !sameValue(started.state, input.state) || started.userId !== input.userId) return NOT_FINISHED;
  // (If the person cannot be read at all, the host still lands on the Hosting page with the plain sentence: nothing was asked of Meta and nothing saved.)
  const [person] = await db
    .select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt })
    .from(schema.user)
    .where(eq(schema.user.id, input.userId))
    .then((rows) => rows, () => []);
  if (!person || person.pausedAt || person.closedAt) return NOT_FINISHED;
  // Only now is anything Meta sent looked at, a refusal included.
  if (input.refused || !input.code) return "You did not connect Instagram. Nothing was changed.";

  const found = await (input.accountsFor ?? instagramAccountsFor)(input.code, input.settings).catch(() => ({ kind: "failed", reason: "no answer" }) as const);
  if (found.kind === "refused") {
    // Meta did not accept our own app's number or return address: the founder's page says so.
    console.error("[instagram] sign-in not finished: our own set-up was refused");
    await noteRefusedSignIn(input.userId, "instagram", input.now).catch(() => undefined);
    return TRY_LATER;
  }
  if (found.kind === "failed") {
    console.error(`[instagram] sign-in not finished: ${found.reason}`);
    return found.reason === "the list of accounts goes on" ? "You shared more Instagram accounts than we can look through. Nothing was changed. Please try again and share only the one for your page." : NOT_FINISHED;
  }
  try {
    const { nameKey } = await confirmInstagramBySignIn({ userId: input.userId, shared: found.accounts, now: input.now });
    return `Instagram @${nameKey} is confirmed.`;
  } catch (error) {
    if (error instanceof ProfileError) return error.message;
    console.error("[instagram] the confirmed account could not be saved");
    return NOT_FINISHED;
  }
}
