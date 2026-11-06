/**
 * Rules for a host's handle: the short address of their page, /h/<handle>.
 * Plain logic only, so it can be tested on its own.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/** Handles nobody can take: they could be mistaken for the site itself. Compared without underscores. */
const BLOCKED = new Set(
  [
    "about", "abuse", "account", "accounts", "admin", "administrator", "api", "app", "billing", "booking", "bookings",
    "call", "calls", "careers", "connect", "connectapp", "contact", "customer", "customers", "founder", "google",
    "help", "helpdesk", "home", "host", "hosts", "info", "instagram", "jobs", "legal", "livekit", "login", "logout",
    "me", "mod", "moderator", "news", "null", "official", "owner", "pay", "payment", "payments", "payout", "payouts",
    "press", "privacy", "refund", "refunds", "root", "safety", "security", "settings", "signin", "signup", "staff",
    "status", "stripe", "support", "system", "team", "terms", "test", "tiktok", "trust", "twitter", "undefined",
    "user", "users", "verified", "verify", "welcome", "www", "youtube",
  ],
);

/** What the person typed, tidied: no spaces around it, no leading @, small letters. */
export function tidyHandle(typed: string): string {
  return typed.trim().replace(/^@/, "").toLowerCase();
}

/**
 * The handle without underscores. Two handles with the same key count as the
 * same handle, so "kim_k" cannot sit next to "kimk".
 */
export function handleKey(handle: string): string {
  return handle.replace(/_/g, "");
}

/** Says what is wrong with a tidied handle, or null when it is fine. Does not check whether it is taken. */
export function handleProblem(handle: string): string | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return `A handle must be ${HANDLE_MIN} to ${HANDLE_MAX} characters long.`;
  }
  // Plain English letters and numbers, with single underscores between them. No other alphabets,
  // no look-alike or invisible characters.
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(handle)) {
    return "A handle can only use the letters a to z, numbers, and single underscores between them.";
  }
  if (handleKey(handle).length < HANDLE_MIN) return `A handle needs at least ${HANDLE_MIN} letters or numbers.`;
  if (BLOCKED.has(handleKey(handle))) return "That handle is not available.";
  return null;
}
