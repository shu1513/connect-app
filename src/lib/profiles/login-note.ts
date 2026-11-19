/**
 * The signed note that remembers who started a sign-in at a network ("Connect your TikTok",
 * "Connect your Instagram"). It travels in a cookie while the host is away at the network, and is
 * read when they come back. Plain logic, so it can be tested on its own.
 *
 * Each network signs with its own label, so a note written for one is never accepted for another.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** The label of a network's notes: the text that goes in front of what is signed. */
export type NoteLabel = "tiktok-login" | "instagram-login";

function signatureOf(label: NoteLabel, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${label}:${body}`).digest("base64url");
}

/**
 * The cookie's value: the random value sent to the network, who started, and until when it counts,
 * signed so that only this server can have written it.
 */
export function writeNote(label: NoteLabel, input: { state: string; userId: string; expiresAt: Date }, secret: string): string {
  const body = [input.state, Buffer.from(input.userId).toString("base64url"), String(input.expiresAt.getTime())].join(".");
  return `${body}.${signatureOf(label, body, secret)}`;
}

/** Reads the cookie's value. Null when it was not written by us for this network, was changed, or is out of date. */
export function readNote(label: NoteLabel, note: string | undefined, secret: string, now: Date): { state: string; userId: string } | null {
  if (!note) return null;
  const parts = note.split(".");
  if (parts.length !== 4) return null;
  const [state, user, expires, signature] = parts;
  const expected = Buffer.from(signatureOf(label, [state, user, expires].join("."), secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!/^[0-9]+$/.test(expires) || Number(expires) <= now.getTime()) return null;
  return { state, userId: Buffer.from(user, "base64url").toString() };
}

/** True when two values are the same, compared without giving away where they differ. */
export function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
