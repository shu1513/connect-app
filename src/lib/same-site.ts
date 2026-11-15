/**
 * Whether a request was sent by one of our own pages. Used by the small
 * addresses the call screen talks to in the background, so that another
 * website cannot make a logged-in person's browser send things to them.
 */

/** The app's own addresses, from its settings: never from anything a request says about itself. */
export function ownOrigins(): string[] {
  const origins: string[] = [];
  for (const address of [process.env.BETTER_AUTH_URL, process.env.PUBLIC_APP_URL]) {
    try {
      if (address) origins.push(new URL(address).origin);
    } catch {
      // A setting that is not an address names no origin.
    }
  }
  return origins;
}

export function fromThisSite(headers: { get(name: string): string | null }, own: string[] = ownOrigins()): boolean {
  // Every current browser says where a request comes from, and a page cannot change what it says.
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  // An older browser: the page's address must be one of ours. It is compared with the app's own settings,
  // not with a "host" or "forwarded host" header, which whoever sends the request can write.
  const origin = headers.get("origin");
  return Boolean(origin) && own.includes(origin!);
}
