/**
 * Where TikTok sends a host back after "Connect your TikTok", and after "Use my TikTok photo"
 * (plans/32). This one address is registered with TikTok. Which of the two it is, is read from the
 * signed note the host's browser kept, never from the address. Whatever happens, the host ends on
 * the Hosting page with a message.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { withNotice } from "@/lib/notice";
import { TIKTOK_COOKIE, TIKTOK_COOKIE_PATH, tiktokSettings } from "@/lib/profiles/tiktok";
import { finishTikTokLogin } from "@/lib/profiles/tiktok-login";
import { finishTikTokPhoto, isPhotoReturn } from "@/lib/profiles/tiktok-photo";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const note = jar.get(TIKTOK_COOKIE)?.value;
  // Removed first, before the login check, the settings or any request: a second visit to this
  // address finds no note. (Two requests that both left the browser with it are from the same
  // person for the same account, and saving the same account twice gives the same result.)
  jar.delete({ name: TIKTOK_COOKIE, path: TIKTOK_COOKIE_PATH });

  // Someone who is not logged in is sent to log in, and has to start again from the Hosting page.
  const user = await requireUser("/host");
  const query = request.nextUrl.searchParams;
  const settings = tiktokSettings();
  const now = new Date();
  const back = { settings, code: query.get("code"), state: query.get("state"), scopes: query.get("scopes"), refused: query.has("error"), note, userId: user.id, now };
  // A sign-in for the host's photo carries its own kind of note. Everything else is handled as an ordinary sign-in,
  // which checks an ordinary note by itself: a photo's note is never read as one.
  if (isPhotoReturn(note, settings, now)) redirect(`${withNotice("/host", await finishTikTokPhoto(back))}#photo`);
  redirect(`${withNotice("/host", await finishTikTokLogin(back))}#social`);
}
