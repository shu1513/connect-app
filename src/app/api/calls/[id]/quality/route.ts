import { roomClosesAt, roomOpensAt, roomState } from "@/lib/calls";
import { callForParticipant } from "@/lib/payments/access";
import { saveNotes } from "@/lib/quality/notes";
import { readNotes } from "@/lib/quality/rules";
import { fromThisSite } from "@/lib/same-site";
import { getUser } from "@/lib/session";

const done = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

/**
 * The call screen sends its notes about connection quality here, in the
 * background. Accepted only from a logged-in person who is on this call, from
 * our own pages, while the room is open and the call was not cancelled or
 * stopped. The answer never says more than a status: nothing waits for it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/quality">) {
  if (!fromThisSite(request.headers)) return done(403);
  const user = await getUser();
  if (!user) return done(401);
  const { id } = await ctx.params;
  const access = await callForParticipant(id, user.id);
  if (!access) return done(404);
  const { call } = access;

  const now = new Date();
  if (call.cancelledAt || call.safetyEndedAt || roomState(call, now) !== "open") return done(409);

  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > 20_000) return done(400);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done(400);
  }
  const read = readNotes(body, { opensAt: roomOpensAt(call), closesAt: roomClosesAt(call), now });
  if (!read) return done(400);

  const outcome = await saveNotes({ call, reporterId: user.id, connectionId: read.connectionId, notes: read.notes });
  return done(outcome === "saved" ? 204 : 429);
}
