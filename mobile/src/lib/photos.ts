/**
 * People's photos in the app (plans/45-phone-apps/04-the-home-page.md, decision 4). A photo is
 * asked for by its id, from the door, with the sign-in of whoever is signed in; the server
 * decides afresh each time whether this person may see it.
 *
 * Every photo the app shows has an end: five minutes after the server said this person may see
 * it. A photo anyone may see (an approved, visible host's) is kept in the app's memory until
 * then, and whoever shows it shows it only until then. Every other photo is not kept at all; the
 * screen that asked for it shows it until then. After that the server must say yes again. So a
 * photo is never on a screen for long after its owner hid it, whether or not the app could reach
 * the server in between.
 *
 * Nothing is ever written to the phone's storage, by the app or by the phone's own keeping of web
 * answers (the server forbids that). What is kept belongs to one sign-in: the moment who is signed
 * in changes, everything kept is dropped, and an answer still on its way for the person before is
 * neither kept nor shown.
 */
import { askForPicture } from "./api";

/** A picture, and the moment until which it may be shown without asking again. */
export type ShownPhoto = { picture: string; until: number };

const kept = new Map<string, ShownPhoto>();
/** How long a "yes" holds, for the app's memory and for a screen: five minutes. The rule is the plan's. */
const HOLDS_MS = 300_000;
/** Counts up each time who is signed in changes. */
let signIn = 0;

function asText(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** The picture to show and until when, or null when there is none for this person. */
export async function photo(id: string): Promise<ShownPhoto | null> {
  const mine = signIn;
  const now = Date.now();
  // What has run out is thrown away, whichever photo is asked for: nothing waits in memory to be asked for again.
  for (const [key, entry] of kept) if (entry.until <= now) kept.delete(key);
  // A kept photo comes with the end it already has: showing it again does not make it last longer.
  const have = kept.get(id);
  if (have) return have;
  const got = await askForPicture(`/api/app/photos/${id}`);
  // Someone else is signed in by now (or nobody): this answer was for the person before.
  if (!got || mine !== signIn) return null;
  const shown = { picture: asText(got.bytes), until: Date.now() + HOLDS_MS };
  if (got.keepSeconds > 0) kept.set(id, { ...shown, until: Date.now() + Math.min(got.keepSeconds * 1000, HOLDS_MS) });
  return kept.get(id) ?? shown;
}

/** Forgets every kept photo, and every answer still on its way: whenever who is signed in changes. */
export function forgetPhotos(): void {
  signIn++;
  kept.clear();
}
