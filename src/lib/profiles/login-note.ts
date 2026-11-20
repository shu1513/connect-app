/**
 * The signed note that remembers who started a sign-in at a network ("Connect your TikTok",
 * "Connect your Instagram", and a sign-in at TikTok to take a host's photo). It travels in a
 * cookie while the host is away at the network, and is read when they come back. Plain logic, so
 * it can be tested on its own.
 *
 * Each kind of sign-in signs with its own label, so a note written for one is never accepted for
 * another. A note has exactly the parts its label has: one with a part too many or too few is not
 * read at all.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** The label of a kind of sign-in: the text that goes in front of what is signed. */
export type NoteLabel = "tiktok-login" | "instagram-login" | "tiktok-photo";
/** The labels of an ordinary sign-in, whose note has three parts and the signature. */
type OrdinaryLabel = Exclude<NoteLabel, "tiktok-photo">;

function signatureOf(label: NoteLabel, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${label}:${body}`).digest("base64url");
}

const isTryId = (text: string | undefined): text is string => typeof text === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);

function written(label: NoteLabel, parts: string[], secret: string): string {
  const body = parts.join(".");
  return `${body}.${signatureOf(label, body, secret)}`;
}

/** The parts of a note, without its signature, if it was written by us under this label, has exactly `count` parts, and is not out of date. */
function opened(label: NoteLabel, note: string | undefined, count: number, secret: string, now: Date): string[] | null {
  if (!note) return null;
  const parts = note.split(".");
  if (parts.length !== count + 1) return null;
  const signature = parts.pop() ?? "";
  const expected = Buffer.from(signatureOf(label, parts.join("."), secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expires = parts[2];
  if (!/^[0-9]+$/.test(expires) || Number(expires) <= now.getTime()) return null;
  return parts;
}

/**
 * The cookie's value: the random value sent to the network, who started, and until when it counts,
 * signed so that only this server can have written it.
 */
export function writeNote(label: OrdinaryLabel, input: { state: string; userId: string; expiresAt: Date }, secret: string): string {
  return written(label, [input.state, Buffer.from(input.userId).toString("base64url"), String(input.expiresAt.getTime())], secret);
}

/** Reads the cookie's value. Null when it was not written by us for this kind of sign-in, was changed, or is out of date. */
export function readNote(label: OrdinaryLabel, note: string | undefined, secret: string, now: Date): { state: string; userId: string } | null {
  const parts = opened(label, note, 3, secret, now);
  return parts ? { state: parts[0], userId: Buffer.from(parts[1], "base64url").toString() } : null;
}

/**
 * The note of a sign-in at TikTok that a host started to take their photo (plans/32). It carries
 * one more signed part: the id of the try that was written down at the press, so that what comes
 * back continues that try and no other.
 */
export function writePhotoNote(input: { state: string; userId: string; expiresAt: Date; tryId: string }, secret: string): string {
  if (!isTryId(input.tryId)) throw new Error("A photo's note needs the id of its try.");
  return written("tiktok-photo", [input.state, Buffer.from(input.userId).toString("base64url"), String(input.expiresAt.getTime()), input.tryId], secret);
}

/** Reads a photo's note. Null for everything else, an ordinary sign-in's note included. */
export function readPhotoNote(note: string | undefined, secret: string, now: Date): { state: string; userId: string; tryId: string } | null {
  const parts = opened("tiktok-photo", note, 4, secret, now);
  return parts && isTryId(parts[3]) ? { state: parts[0], userId: Buffer.from(parts[1], "base64url").toString(), tryId: parts[3] } : null;
}

/** True when two values are the same, compared without giving away where they differ. */
export function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
