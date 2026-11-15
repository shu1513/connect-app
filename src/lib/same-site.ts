/**
 * Whether a request was sent by one of our own pages. Used by the small
 * addresses the call screen talks to in the background, so that another
 * website cannot make a logged-in person's browser send things to them.
 */
export function fromThisSite(headers: { get(name: string): string | null }): boolean {
  // Every current browser says where a request comes from.
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  // An older browser: compare the page's address with ours.
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
