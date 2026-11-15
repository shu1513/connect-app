import { receiveNotes } from "@/lib/quality/notes";
import { getUser } from "@/lib/session";

/**
 * The call screen sends its notes about connection quality here, in the
 * background. What is accepted, and from whom, is decided in receiveNotes.
 * The answer never says more than a status: nothing waits for it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/quality">) {
  const { id } = await ctx.params;
  const user = await getUser();
  const text = await request.text().catch(() => "");
  const status = await receiveNotes({ userId: user?.id ?? null, callId: id, headers: request.headers, text, now: new Date() });
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}
