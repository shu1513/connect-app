/**
 * Where to send a person after logging in or finishing sign-up. Only a path on
 * this site is accepted, never another site, so a link cannot use our pages
 * to send someone elsewhere.
 */
export function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/(?![\/\\])[^\s]*$/.test(value) ? value : "/";
}
