import { startTest } from "@/lib/connection/tests";
import { fromThisSite } from "@/lib/same-site";
import { switches } from "@/lib/safety/switches";
import { getUser } from "@/lib/session";

const refuse = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

/**
 * Starts a connection check: a private one-person test room and a pass for it. For logged-in
 * people only, from our own pages, not for a paused account, and not while the founder's "stop
 * joining" switch is on. Whatever is refused here, the person simply sees "not measured"; the
 * answer of a test is worked out in their browser and never sent back.
 */
export async function POST(request: Request) {
  if (!fromThisSite(request.headers)) return refuse(403);
  const user = await getUser();
  if (!user) return refuse(401);
  if (user.paused) return refuse(403);
  if ((await switches()).joiningOff) return refuse(503);
  try {
    const started = await startTest(user.id);
    if (!started.ok) return refuse(429);
    return Response.json({ token: started.token, serverUrl: started.serverUrl }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[connection test] could not start a test", error);
    return refuse(503);
  }
}
