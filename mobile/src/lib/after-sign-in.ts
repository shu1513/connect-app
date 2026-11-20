/**
 * Where someone who was only looking wanted to go on (plans/45-phone-apps/06-asking-for-a-call.md).
 * A visitor who picks a time on a host's page is sent to sign in; once they are in, the app opens
 * that host's page again, so they need not look for her a second time.
 *
 * Only ever a host's page, which anyone may open; never a booking or anything of a person's own.
 * Kept in the app's memory only, for a short while, and used once.
 */
const KEEP_MS = 30 * 60_000;

let wanted: { handle: string; at: number } | null = null;

export function rememberHostPage(handle: string, now = Date.now()): void {
  wanted = /^[A-Za-z0-9_-]+$/.test(handle) ? { handle, at: now } : null;
}

/** The host's page to open, once; null when there is none, or it was noted too long ago. */
export function takeHostPage(now = Date.now()): string | null {
  const found = wanted;
  wanted = null;
  return found && now - found.at >= 0 && now - found.at < KEEP_MS ? found.handle : null;
}
