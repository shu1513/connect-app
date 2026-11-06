/**
 * Loads a call's attendance log and runs the counting rule on it.
 * Used by the results page and by the charge after the call, so both always
 * see exactly the same numbers.
 */
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AttendanceEvent, Call } from "@/db/schema";
import { roomClosesAt, SETTLE_SECONDS } from "@/lib/calls";
import { calculateAttendance, type AttendanceResult } from "./calc";

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export type LoadedAttendance = {
  result: AttendanceResult;
  events: AttendanceEvent[];
  /** True once the room's closing time has passed and late messages have had time to arrive. */
  final: boolean;
  bookedSeconds: number;
};

export async function loadAttendance(call: Call, now: Date = new Date()): Promise<LoadedAttendance> {
  const events = await db
    .select()
    .from(schema.attendanceEvents)
    .where(eq(schema.attendanceEvents.callId, call.id))
    .orderBy(asc(schema.attendanceEvents.providerTime), asc(schema.attendanceEvents.id));

  // If the room was actually closed later than planned, the wait is counted
  // from the real closing moment.
  const settledFrom = Math.max(roomClosesAt(call).getTime(), call.closedAt?.getTime() ?? 0);
  const final = now.getTime() >= settledFrom + SETTLE_SECONDS * 1000;

  // A call ended with "End call and report" stops counting at that moment.
  const countedUntil = call.safetyEndedAt && call.safetyEndedAt < call.endsAt ? call.safetyEndedAt : call.endsAt;
  const result = calculateAttendance(
    { hostId: call.hostId, customerId: call.customerId, start: toSeconds(call.startsAt), end: toSeconds(countedUntil) },
    events.map((e) => ({
      id: `${e.provider}:${e.providerEventId}`,
      type: e.type,
      identity: e.participantIdentity,
      sessionId: e.participantSessionId,
      time: toSeconds(e.providerTime),
    })),
    { final },
  );

  return { result, events, final, bookedSeconds: Math.max(0, toSeconds(countedUntil) - toSeconds(call.startsAt)) };
}
