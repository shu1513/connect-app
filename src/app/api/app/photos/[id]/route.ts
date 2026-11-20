import { appRequest, refuse } from "@/lib/app-door/gate";
import { photoFor } from "@/lib/profiles/photo";

/**
 * A person's photo for the phone app, as the plain picture
 * (plans/45-phone-apps/04-the-home-page.md, decision 4). Who gets it is decided by the website's
 * own `photoFor` and nowhere else, afresh for every request. It answers a guest too (an approved,
 * visible host's photo is open to anyone) and uses the signed-in person where there is one. The
 * founder's wider view is never given here: the admin pages are not in the apps.
 *
 * Every "no" is the same "not found". An open photo may be kept by that person's phone for five
 * minutes and by nothing in between; every other photo, and every refusal, is never kept.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/photos/[id]">) {
  const asked = await appRequest(request, "anyone");
  if (asked instanceof Response) return asked;
  const { id } = await ctx.params;
  const found = await photoFor(asked.person ? { id: asked.person.id, admin: false } : null, id);
  if (!found) return refuse("not_found");
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      // Always a JPEG (Connect made it); nothing in it may run.
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-length": String(found.bytes.length),
      "cache-control": found.open ? "private, max-age=300" : "private, no-store",
    },
  });
}
