/**
 * Where Meta sends a host back after "Connect your Instagram". This address is registered with
 * Meta. Whatever happens, the host ends on the Hosting page with a message.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { withNotice } from "@/lib/notice";
import { INSTAGRAM_COOKIE, INSTAGRAM_COOKIE_PATH, instagramSettings } from "@/lib/profiles/instagram";
import { finishInstagramLogin } from "@/lib/profiles/instagram-login";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const note = jar.get(INSTAGRAM_COOKIE)?.value;
  // Removed first, before the login check, the settings or any request: an ordinary second visit to
  // this address finds no note. (That is not "once only": a return that is sent twice stays tied to
  // the person who started, and goes through the same rules again as they stand then.)
  jar.delete({ name: INSTAGRAM_COOKIE, path: INSTAGRAM_COOKIE_PATH });

  // Someone who is not logged in is sent to log in, and has to start again from the Hosting page.
  const user = await requireUser("/host");
  const query = request.nextUrl.searchParams;
  const notice = await finishInstagramLogin({
    settings: instagramSettings(),
    code: query.get("code"),
    state: query.get("state"),
    refused: query.has("error"),
    note,
    userId: user.id,
    now: new Date(),
  });
  redirect(`${withNotice("/host", notice)}#social`);
}
