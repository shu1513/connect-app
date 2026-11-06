import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { readVideoEvent, type VideoEvent } from "@/lib/video/livekit";

/**
 * The attendance log's front door. LiveKit calls this each time someone
 * connects to or disconnects from a room.
 *
 * Order matters: check the message is genuine, save it, and only then reply
 * "ok". If saving fails we reply with an error so LiveKit sends it again.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let event: VideoEvent;
  try {
    event = await readVideoEvent(rawBody, request.headers.get("authorization"));
  } catch {
    return Response.json({ error: "Signature check failed." }, { status: 401 });
  }

  // Only room and participant messages matter for attendance.
  if (!event.roomName || !/^(room_|participant_)/.test(event.type)) {
    return Response.json({ ok: true, saved: false });
  }

  const [call] = await db
    .select({ id: schema.calls.id })
    .from(schema.calls)
    .where(eq(schema.calls.roomName, event.roomName));
  if (!call) return Response.json({ ok: true, saved: false });

  // A repeated message has the same ID and is silently skipped.
  await db
    .insert(schema.attendanceEvents)
    .values({
      provider: event.provider,
      providerEventId: event.id,
      callId: call.id,
      type: event.type,
      roomSessionId: event.roomSessionId,
      participantIdentity: event.participantIdentity,
      participantSessionId: event.participantSessionId,
      providerTime: event.time,
      payload: rawBody,
    })
    .onConflictDoNothing();

  return Response.json({ ok: true, saved: true });
}
