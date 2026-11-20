/**
 * The identity check for the phone app (plans/45-phone-apps/06-asking-for-a-call.md, decision 6),
 * on the website's own functions. The check itself happens on Stripe's page, in the phone's
 * browser sheet; where it stands is always asked of Stripe by the server, for the person who is
 * signed in to the app, never taken from the sheet.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { acceptIdentityNotice, type Shown } from "@/legal/accept";
import { parse } from "@/legal/parse";
import { currentVersion, linkFor, textOf, versionHref } from "@/legal/registry";
import { publicAppUrl } from "@/lib/payments/hosts";
import { identityState, refreshIdentity, startIdentityCheck } from "@/lib/safety/identity";
import { IDENTITY_TRIES } from "@/lib/safety/identity-rules";
import { IDENTITY_WORDS } from "@/lib/safety/identity-words";
import type { AppIdentity } from "./types";

/**
 * Where Stripe sends the person when the check on its page is over: one fixed page of Connect's
 * that anyone may open. It takes nothing from its address, shows no result and changes nothing.
 */
export const IDENTITY_DONE_PATH = "/identity/done";

/**
 * Where this person's check stands. Asks Stripe first when a check was started, as the website's page does.
 *
 * Null when the account is paused. A result of "under 18" pauses the account, and this may be the very question
 * that read it; as on the website's page, a paused person is told so and is not offered "Start the check".
 */
export async function identityFor(person: { id: string }): Promise<AppIdentity | null> {
  let state = await identityState(person.id);
  if (!state.passed && (state.pending || state.triesLeft < IDENTITY_TRIES)) state = await refreshIdentity(person.id).catch(() => state);
  const [now] = await db.select({ pausedAt: schema.user.pausedAt }).from(schema.user).where(eq(schema.user.id, person.id));
  if (now?.pausedAt) return null;
  const canStart = !state.passed && state.triesLeft > 0;
  // The Identity Check Notice in effect, in full, as the website's page shows it above its button
  // (plans/46-agreements-live.md, decision 9). Only where a check can be started: that button is the agreement.
  const current = canStart ? currentVersion("identity-check-notice", new Date()) : null;
  return {
    passed: state.passed,
    pending: state.pending,
    title: IDENTITY_WORDS.title,
    words: state.passed ? [IDENTITY_WORDS.passed] : [IDENTITY_WORDS.what, ...(state.pending ? [IDENTITY_WORDS.pending] : []), ...(state.triesLeft === 0 ? [IDENTITY_WORDS.noTries] : [])],
    button: canStart ? IDENTITY_WORDS.button(state.pending) : null,
    tries: canStart ? IDENTITY_WORDS.tries(state.triesLeft) : null,
    notice: current
      ? {
          name: "identity-check-notice",
          version: current.version,
          title: IDENTITY_WORDS.noticeTitle(current.draft),
          href: versionHref("identity-check-notice", current.version),
          open: IDENTITY_WORDS.noticeOpen,
          blocks: parse(textOf("identity-check-notice", current.version) ?? "", linkFor).blocks,
          agree: IDENTITY_WORDS.agree,
        }
      : null,
    small: IDENTITY_WORDS.small,
  };
}

/**
 * Starts a check at Stripe for this person and gives back Stripe's page. As on the website: the person's
 * agreement to the Identity Check Notice is written down first, in the version the app showed, and only then is
 * Stripe asked for a check. Throws AgreementError when the notice shown is not the one in effect (nothing is
 * written, nothing is started), and IdentityError with the sentence to show.
 */
export async function startIdentityFor(person: { id: string; email: string }, shown: Shown): Promise<string> {
  const noticeVersion = await acceptIdentityNotice({ userId: person.id, shown, now: new Date() });
  return startIdentityCheck(person, `${publicAppUrl()}${IDENTITY_DONE_PATH}`, noticeVersion);
}
