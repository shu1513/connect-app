/**
 * Keeps one genuine message from the video service in the attendance log of
 * the call whose room it is about. A message about any other room (a
 * connection check's private test room, for example) belongs to no call and is
 * not kept: nothing about it can reach a call's record or its charge.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { VideoEvent } from "@/lib/video/livekit";

/** True when the message was kept (or had been kept before). */
export async function saveAttendance(event: VideoEvent, rawBody: string): Promise<boolean> {
  // Only room and participant messages matter for attendance.
  if (!event.roomName || !/^(room_|participant_)/.test(event.type)) return false;

  const [call] = await db.select({ id: schema.calls.id }).from(schema.calls).where(eq(schema.calls.roomName, event.roomName));
  if (!call) return false;

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
  return true;
}
