/**
 * People's photos in the app (plans/45-phone-apps/04-the-home-page.md, decision 4). A photo is
 * asked for by its id, from the door, with the sign-in of whoever is signed in; the server
 * decides afresh each time whether this person may see it.
 *
 * A photo anyone may see (an approved, visible host's) is kept in the app's memory for as long as
 * the server allows: five minutes. Every other photo is never kept: it lives only on the screen
 * that asked for it, and is asked for again next time. Nothing is ever written to the phone's
 * storage, by the app or by the phone's own keeping of web answers (the server forbids that).
 *
 * What is kept belongs to one sign-in. The moment who is signed in changes, everything kept is
 * dropped, and an answer still on its way for the person before is neither kept nor shown.
 */
import { askForPicture } from "./api";

const kept = new Map<string, { picture: string; until: number }>();
/** At most five minutes, whatever is said: the rule is the plan's. */
const MOST_SECONDS = 300;
/** Counts up each time who is signed in changes. */
let signIn = 0;

function asText(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** The picture to show, or null when there is none for this person. */
export async function photo(id: string): Promise<string | null> {
  const mine = signIn;
  const now = Date.now();
  // What has run out is thrown away, whichever photo is asked for: nothing waits in memory to be asked for again.
  for (const [key, entry] of kept) if (entry.until <= now) kept.delete(key);
  const have = kept.get(id);
  if (have) return have.picture;
  const got = await askForPicture(`/api/app/photos/${id}`);
  // Someone else is signed in by now (or nobody): this answer was for the person before.
  if (!got || mine !== signIn) return null;
  const picture = asText(got.bytes);
  if (got.keepSeconds > 0) kept.set(id, { picture, until: Date.now() + Math.min(got.keepSeconds, MOST_SECONDS) * 1000 });
  return picture;
}

/** Forgets every kept photo, and every answer still on its way: whenever who is signed in changes. */
export function forgetPhotos(): void {
  signIn++;
  kept.clear();
}
