/**
 * Where to send a person after logging in or finishing sign-up. Only a page on
 * this site is accepted: never another site, so a link cannot use our pages to
 * send someone elsewhere, and never one of the app's own machine addresses
 * (/api/...), which do things rather than show things. Anything too long to be
 * a real page address is dropped too.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000 || !/^\/(?![\/\\])[^\s]*$/.test(value)) return "/";
  return /^\/api(?:[\/?#]|$)/i.test(value) ? "/" : value;
}

/**
 * The page to go back to after a side trip (the identity check), or null if there is none worth
 * keeping: not a path on this site, the home page, or too long to carry in an address.
 */
export function returnPath(value: unknown): string | null {
  const path = safeNext(value);
  return path === "/" || path.length > 500 ? null : path;
}
