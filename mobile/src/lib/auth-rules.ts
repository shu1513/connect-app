/**
 * The plain rules of signing in and signing up in the app (plans/45-phone-apps/03-signing-in.md):
 * the website's own sentences for each thing that can go wrong, what a typed code is, and where
 * the links in the emails must lead. Plain logic with no phone in it, tested on its own.
 *
 * The sentences are the website's (src/components/auth-forms.tsx), word for word, so the app and
 * the website never say different things about the same mistake. None of them says whether an
 * address has an account.
 */

export const TOO_MANY = "Too many attempts. Please wait a while and try again.";
export const GENERIC = "Something went wrong. Please try again.";
export const NO_MATCH = "That email and password did not match.";
export const CODE_WRONG = "That code did not work. Check the app and try again.";
export const NOT_REACHED = "Cannot reach Connect. Check your connection and try again.";

/** What the login tool hands back when something is wrong. `status` is missing when it could not be reached at all. */
export type AuthError = { code?: string; message?: string; status?: number } | null | undefined;

/** True when the request never got an answer from Connect's login tool. */
export function notReached(error: AuthError): boolean {
  return Boolean(error) && (error?.status === undefined || error.status === 0);
}

/** Words for a problem with a new password or a new account. */
export function passwordProblem(error: AuthError): string {
  if (notReached(error)) return NOT_REACHED;
  if (error?.status === 429) return TOO_MANY;
  switch (error?.code) {
    case "PASSWORD_TOO_SHORT":
      return "Use a password of at least 12 characters.";
    case "PASSWORD_TOO_LONG":
      return "That password is too long.";
    case "PASSWORD_COMPROMISED":
      return error.message ?? "This password has appeared in a data leak. Please choose a different one.";
    case "INVALID_EMAIL":
      return "That email address does not look right.";
    default:
      return GENERIC;
  }
}

/** What signing in led to. */
export type SignInOutcome =
  /** Signed in. */
  | { kind: "in" }
  /** The password was right; a two-step code is asked next. */
  | { kind: "code" }
  /** The password was right, but the address is not confirmed yet. A new link has been sent. */
  | { kind: "confirm" }
  | { kind: "problem"; words: string };

export function signInOutcome(result: { data?: unknown; error?: AuthError }): SignInOutcome {
  const error = result.error;
  if (error) {
    if (notReached(error)) return { kind: "problem", words: NOT_REACHED };
    if (error.status === 429) return { kind: "problem", words: TOO_MANY };
    if (error.code === "EMAIL_NOT_VERIFIED") return { kind: "confirm" };
    // A wrong password, an address with no account and a closed account all get this one sentence.
    return { kind: "problem", words: NO_MATCH };
  }
  if ((result.data as { twoFactorRedirect?: boolean } | null | undefined)?.twoFactorRedirect) return { kind: "code" };
  return { kind: "in" };
}

/** A typed second-step code: six digits are from the authenticator app; anything else is a backup code (which keeps its hyphen). */
export function typedCode(typed: string): { kind: "app" | "backup"; code: string } {
  const code = typed.replace(/\s/g, "");
  return { kind: /^\d{6}$/.test(code) ? "app" : "backup", code };
}

/** Words for a second-step code that was not taken. */
export function codeProblem(error: AuthError): string {
  if (notReached(error)) return NOT_REACHED;
  return error?.status === 429 ? TOO_MANY : CODE_WRONG;
}

/**
 * Where the links in the emails lead: always to the website, by its full address. A short one
 * ("/welcome") would be turned into a link to the app by the login tool's kit, and the server
 * refuses any other destination anyway (part 01).
 */
export function emailLinks(server: string): { afterConfirming: string; newPassword: string } {
  return { afterConfirming: `${server}/welcome`, newPassword: `${server}/reset-password` };
}

/** What is checked on the phone before a new account is sent. The server still decides. */
export function signUpProblem(given: { name: string; email: string; password: string }): string | null {
  const name = given.name.trim();
  if (name.length < 2 || name.length > 50) return "Please enter your name (2 to 50 characters).";
  if (!given.email.trim()) return "Please enter your email address.";
  if (given.password.length < 12) return "Use a password of at least 12 characters.";
  if (given.password.length > 128) return "That password is too long.";
  return null;
}
