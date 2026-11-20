import { appRequest, refuse } from "@/lib/app-door/gate";
import { KEEP_HEADER, OPEN_PHOTO_SECONDS } from "@/lib/app-door/rules";
import { photoFor } from "@/lib/profiles/photo";

/**
 * A person's photo for the phone app, as the plain picture
 * (plans/45-phone-apps/04-the-home-page.md, decision 4). Who gets it is decided by the website's
 * own `photoFor` and nowhere else, afresh for every request. It answers a guest too (an approved,
 * visible host's photo is open to anyone) and uses the signed-in person where there is one. The
 * founder's wider view is never given here: the admin pages are not in the apps.
 *
 * Who counts as signed in is what the website's own photo address counts: someone who has done
 * "18 or older and terms" for the terms now in force. Anyone else, signed in or not, is a guest
 * here, and gets only what a guest gets. (A paused person stays who they are, as on the website.)
 *
 * Every "no" is the same "not found". Nothing between the server and the app may keep a photo,
 * and neither may the phone's own storage: every answer says "do not store". For a photo anyone
 * may see, a header of the app's own says how long the app may keep it in its memory (five
 * minutes); every other photo, and every refusal, is never kept at all.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/photos/[id]">) {
  const asked = await appRequest(request, "anyone");
  if (asked instanceof Response) return asked;
  const { id } = await ctx.params;
  const viewer = asked.person?.welcomed ? { id: asked.person.id, admin: false } : null;
  const found = await photoFor(viewer, id);
  if (!found) return refuse("not_found");
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      // Always a JPEG (Connect made it); nothing in it may run.
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-length": String(found.bytes.length),
      "cache-control": "private, no-store",
      ...(found.open ? { [KEEP_HEADER]: String(OPEN_PHOTO_SECONDS) } : {}),
    },
  });
}
