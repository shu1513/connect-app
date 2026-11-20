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

/** Whether an address of the login tool is one of those switched off: the address itself, or anything under it. */
export function isSwitchedOffLoginPath(path: string): boolean {
  return UNUSED_LOGIN_PATHS.some((off) => path === off || path.startsWith(`${off}/`));
}

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
  // Nothing that a browser, the login tool and this check could read three different ways: no
  // backslash (some read it as a slash), no invisible characters.
  if (/[\\\u0000-\u001f\u007f]/.test(destination)) return false;
  if (destination.startsWith("/")) return isPlainPath(destination);
  try {
    const url = new URL(destination);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !own.includes(url.origin) || url.username !== "" || url.password !== "") return false;
    // The path as it was written, not as it reads once tidied: the same rule as for a path alone.
    if (!destination.startsWith(url.origin)) return false;
    const written = destination.slice(url.origin.length);
    return written === "" || isPlainPath(written);
  } catch {
    return false;
  }
}

/**
 * A path that means the same before and after it is tidied. The login tool tidies a path before it
 * uses it (it drops "." and ".." steps and reads %2F as it stands), and what is left over could
 * begin with "//", which a browser reads as another site: "/.//evil.test" is tidied to
 * "//evil.test". So a path is only accepted when tidying changes nothing: it begins with one
 * slash, has no empty step, no "." or ".." step, and no slash, backslash or dot hidden in a % code.
 */
function isPlainPath(path: string): boolean {
  const steps = path.split(/[?#]/)[0];
  if (!steps.startsWith("/") || steps.includes("//")) return false;
  if (/%(2f|5c|2e)/i.test(steps)) return false;
  if (steps.split("/").some((step) => step === "." || step === "..")) return false;
  try {
    const tidied = new URL(path, "https://website.invalid");
    return tidied.origin === "https://website.invalid" && tidied.pathname === steps;
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
