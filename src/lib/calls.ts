/**
 * The timing and access rules for a call. Plain functions, no database or
 * video service, so they can be tested directly.
 */

/** The room can be entered this long before the booked start. */
export const OPEN_EARLY_SECONDS = 5 * 60;
/** The room stays usable this long after the booked end. */
export const CLOSE_LATE_SECONDS = 60;
/** After closing, wait this long for late messages before calling totals final. */
export const SETTLE_SECONDS = 120;

/** `continuesCallId` is set on a "part 2": more time agreed during a call, as a call of its own that starts when the first ends. */
export type CallTimes = { startsAt: Date; endsAt: Date; continuesCallId?: string | null };
export type CallPeople = { hostId: string; customerId: string };

export function roomOpensAt(call: CallTimes): Date {
  // A part 2 opens at its start, not early: entering it would pull a person out of part 1 while that is still being counted.
  if (call.continuesCallId) return call.startsAt;
  return new Date(call.startsAt.getTime() - OPEN_EARLY_SECONDS * 1000);
}

export function roomClosesAt(call: CallTimes): Date {
  return new Date(call.endsAt.getTime() + CLOSE_LATE_SECONDS * 1000);
}

export type RoomState = "not_open_yet" | "open" | "closed";

/** Whether the room can be entered at the given moment. */
export function roomState(call: CallTimes, now: Date): RoomState {
  if (now < roomOpensAt(call)) return "not_open_yet";
  if (now >= roomClosesAt(call)) return "closed";
  return "open";
}

/** This person's role on this call, or null if they are not part of it. */
export function roleOnCall(call: CallPeople, userId: string): "host" | "customer" | null {
  if (userId === call.hostId) return "host";
  if (userId === call.customerId) return "customer";
  return null;
}

export type JoinDecision =
  | { allowed: true; role: "host" | "customer" }
  | { allowed: false; reason: "not_on_call" | "not_open_yet" | "closed" };

/** The single rule that decides whether someone may enter a call right now. */
export function canJoin(call: CallTimes & CallPeople, userId: string, now: Date): JoinDecision {
  const role = roleOnCall(call, userId);
  if (!role) return { allowed: false, reason: "not_on_call" };
  const state = roomState(call, now);
  if (state !== "open") return { allowed: false, reason: state };
  return { allowed: true, role };
}
