import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { photoFor } from "@/lib/profiles/photo";
import { getSignedIn, getUser, isAdminSession } from "@/lib/session";

/**
 * A host's photo, as the plain file (plans/29). Who gets it is decided by `photoFor` and nowhere
 * else, afresh for every request: this address never answers "you already have it". Every "no" is
 * the same "not found". A photo that was replaced or removed has no address any more.
 */
export async function GET(_request: Request, ctx: RouteContext<"/host-photos/[id]">) {
  const { id } = await ctx.params;
  const user = await getUser();
  let admin = false;
  if (user) {
    const [row] = await db.select({ userId: schema.admins.userId }).from(schema.admins).where(eq(schema.admins.userId, user.id));
    // An admin login only counts with the second step, as on the founder's pages.
    admin = Boolean(row) && (await isAdminSession(await getSignedIn()));
  }
  const found = await photoFor(user ? { id: user.id, admin } : null, id);
  if (!found) return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      // Always a JPEG (Connect made it), the browser is told not to guess otherwise, and nothing in it may run.
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "inline",
      "content-length": String(found.bytes.length),
      // Only a photo anyone could see without logging in may be kept, by the viewer's own browser, for five minutes.
      "cache-control": found.open ? "private, max-age=300" : "no-store",
    },
  });
}
