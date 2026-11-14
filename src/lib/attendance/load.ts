/**
 * Loads a call's attendance log and runs the counting rule on it.
 * Used by the results page and by the charge after the call, so both always
 * see exactly the same numbers.
 */
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AttendanceEvent, Call } from "@/db/schema";
import { roomClosesAt, SETTLE_SECONDS } from "@/lib/calls";
import { calculateAttendance, countedWindow, type AttendanceResult } from "./calc";

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export type LoadedAttendance = {
  result: AttendanceResult;
  events: AttendanceEvent[];
  /** True once the room's closing time has passed and late messages have had time to arrive. */
  final: boolean;
  /** The length of the time that could count: the call (or the stretch asked for), up to where it was stopped. */
  bookedSeconds: number;
};

/** A part of a call: the time one payment pays for. */
export type Stretch = { from: Date; until: Date };

/**
 * With a stretch, only the time inside that part of the call is counted (for
 * the payment that pays for it). The whole log is still read, and whether the
 * record is final and consistent is still judged for the whole call.
 */
export async function loadAttendance(call: Call, now: Date = new Date(), stretch?: Stretch): Promise<LoadedAttendance> {
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
  const { start, end } = countedWindow(call, stretch);
  const result = calculateAttendance(
    { hostId: call.hostId, customerId: call.customerId, start, end },
    events.map((e) => ({
      id: `${e.provider}:${e.providerEventId}`,
      type: e.type,
      identity: e.participantIdentity,
      sessionId: e.participantSessionId,
      time: toSeconds(e.providerTime),
    })),
    { final },
  );

  return { result, events, final, bookedSeconds: end - start };
}
