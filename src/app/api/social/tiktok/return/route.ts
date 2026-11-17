/**
 * Where TikTok sends a host back after "Connect your TikTok". This address is registered with
 * TikTok. Whatever happens, the host ends on the Hosting page with a message.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { withNotice } from "@/lib/notice";
import { TIKTOK_COOKIE, TIKTOK_COOKIE_PATH, tiktokSettings } from "@/lib/profiles/tiktok";
import { finishTikTokLogin } from "@/lib/profiles/tiktok-login";
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
  const notice = await finishTikTokLogin({
    settings: tiktokSettings(),
    code: query.get("code"),
    state: query.get("state"),
    scopes: query.get("scopes"),
    refused: query.has("error"),
    note,
    userId: user.id,
    now: new Date(),
  });
  redirect(`${withNotice("/host", notice)}#social`);
}
