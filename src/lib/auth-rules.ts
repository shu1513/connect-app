/**
 * Small login rules that are plain logic, kept apart so they can be tested on their own.
 */

/** The parts of the login tool we do not use. They are switched off so they cannot be called directly. */
export const UNUSED_LOGIN_PATHS = [
  "/update-user",
  "/change-email",
  "/delete-user",
  "/link-social",
  "/unlink-account",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  // The second login step, once set up, cannot be switched off from the app.
  "/two-factor/disable",
];

/**
 * The phone app's own name, as the place its requests say they come from. The app has no web
 * address; this is what the login tool is told to trust for it (plans/45-phone-apps/01-the-door.md).
 */
export const APP_ORIGIN = "connect://";

/**
 * Whether an address the login tool is asked to send someone on to (after confirming an email,
 * after a reset, after an outside login) leads to the website and nowhere else.
 *
 * The login tool itself accepts any address it trusts, and since the phone app is trusted, an
 * address inside the app would pass. But the links for confirming an email address and for a new
 * password carry a login or a reset key to wherever they point, and those must never end up in
 * an app, a copy of the app, or anything else that answers to the app's name. So: a path on this
 * site, or a full address whose site is one of the website's own. Nothing else.
 *
 * `own` is the website's own sites, from the app's settings (see same-site.ts).
 */
export function leadsToTheWebsite(destination: unknown, own: string[]): boolean {
  if (typeof destination !== "string" || destination === "") return false;
  // A path on this site. "//host" and "/\host" are other sites written to look like a path.
  if (destination.startsWith("/")) return !destination.startsWith("//") && !destination.startsWith("/\\");
  try {
    const url = new URL(destination);
    return (url.protocol === "https:" || url.protocol === "http:") && own.includes(url.origin);
  } catch {
    return false;
  }
}

/**
 * Whether a login through Google (or any outside provider) must be refused.
 * We only accept an identity whose email address the provider itself says is
 * confirmed. This is checked before an account is created or joined, and
 * again on every later login, so an unconfirmed identity can never be left
 * attached to someone's account.
 */
export function outsideLoginProblem(
  user: { emailVerified?: unknown },
  source: { method: string; oauth?: { profile?: Record<string, unknown> } },
): { error: string; errorDescription: string } | undefined {
  if (source.method !== "oauth") return undefined;
  const claim = source.oauth?.profile?.email_verified;
  const confirmed = claim === undefined ? user.emailVerified === true : claim === true || claim === "true";
  if (confirmed) return undefined;
  return { error: "email_not_verified", errorDescription: "The email address of that account has not been confirmed." };
}
