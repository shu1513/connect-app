/**
 * Where to send a person after logging in or finishing sign-up. Only a path on
 * this site is accepted, never another site, so a link cannot use our pages
 * to send someone elsewhere.
 */
export function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/(?![\/\\])[^\s]*$/.test(value) ? value : "/";
}

/**
 * The page to go back to after a side trip (the identity check), or null if there is none worth
 * keeping: not a path on this site, the home page, or too long to carry in an address.
 */
export function returnPath(value: unknown): string | null {
  const path = safeNext(value);
  return path === "/" || path.length > 500 ? null : path;
}
