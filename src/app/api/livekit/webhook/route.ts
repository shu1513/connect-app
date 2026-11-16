import { saveAttendance } from "@/lib/attendance/save";
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

  return Response.json({ ok: true, saved: await saveAttendance(event, rawBody) });
}
