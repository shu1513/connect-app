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
];

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
