/**
 * A call ended with "End call now" (plans/51-end-call-now.md): what that does to the charge.
 *
 * Time stops counting at the press for every call (`countedWindow` in attendance/calc.ts). What
 * this file adds is the one case where more than the counted time is charged: the customer
 * pressed, on a booked call, and so pays for "the rest of the booking" as well.
 *
 * Plain facts in, an answer out. No database and no clock, so every edge can be tested.
 */
import type { Interval } from "@/lib/attendance/calc";

/**
 * The host counts as "in the call when he pressed" when her latest connection reached the press or
 * ended at most this long before it: a connection that dropped a moment earlier, or the video
 * service's clock and ours differing by a second.
 */
export const HOST_THERE_LEEWAY_SECONDS = 60;

/** What is known about a press of "End call now", for the money. */
export type EndedNow = {
  /** Who pressed, as written on the call. */
  by: "host" | "customer";
  /**
   * For a customer's press: the rule "you pay for your whole booked time" holds for him. His booking was made
   * under words that say it (the call carries "customer", not "customer_untold").
   */
  wholeSaid: boolean;
  /** The customer reported the host after his own press, and that lowered the charge to the minutes. */
  loweredByReport: boolean;
  /** The press came before the booked start (the room opens a little early). */
  beforeStart: boolean;
  /** Cancelling at the moment of the press would have been a late cancellation under the host's rule. Read only when `beforeStart`. */
  lateToCancel: boolean;
  /** The host was in the call at the press. Read only when not `beforeStart`. */
  hostThere: boolean;
};

/**
 * Whether "the rest of the booking" (the booked time after the press) is charged on top of the
 * time that counted before it. Only ever when the customer pressed, having been told that it costs
 * his whole booked time, on a call that charges the host's time, and no report of his lowered it. Then:
 *   - pressed during the call: only if the host was in the call at that moment (a customer who
 *     waited for a host who never came does not pay for time she would not have given either);
 *   - pressed before the booked start: as his cancelling at that moment would be charged, so the
 *     button is no way round the host's cancelling rule.
 * Everything else is charged by the time that counted: the host pressed, an "available now" call,
 * a call ended with the old button, a call that simply ran to its end.
 */
export function restIsCharged(billing: string, ended: EndedNow | null): boolean {
  if (!ended || billing !== "host") return false;
  if (ended.by !== "customer" || !ended.wholeSaid || ended.loweredByReport) return false;
  return ended.beforeStart ? ended.lateToCancel : ended.hostThere;
}

/**
 * A customer ended the call before its booked start and the rest of the booking is not charged
 * (cancelling was still free, or he was never told that it costs the whole booking): nothing is
 * owed, and that is his own choice, not the host's doing. (For a call paid from a membership
 * this decides how the time that comes back is counted: as it was booked, like a cancellation in
 * time, and not as time returned because of the host.)
 */
export function customerLeftFree(ended: EndedNow | null): boolean {
  return ended !== null && ended.by === "customer" && ended.beforeStart && !ended.loweredByReport && !(ended.wholeSaid && ended.lateToCancel);
}

/**
 * Whether the host was in the call at the press. `hostIntervals` are her connected periods inside
 * the call's counted time, which ends at the press: a connection that was still open then ends
 * exactly there.
 */
export function hostThereAt(hostIntervals: Interval[], pressedAtSeconds: number): boolean {
  let latest = Number.NEGATIVE_INFINITY;
  for (const interval of hostIntervals) latest = Math.max(latest, interval.end);
  return latest >= pressedAtSeconds - HOST_THERE_LEEWAY_SECONDS;
}

/**
 * The seconds one payment is charged for and the length they are measured against.
 *   - `countedSeconds`: what counted by the call's rule inside this payment's stretch, up to the press
 *   - `countedLength`: the length of that part of the stretch (the stretch up to the press)
 *   - `fullLength`: the length of the whole stretch as booked
 * With the rest charged, the seconds after the press are added and the whole stretch is the measure.
 */
export function chargedSeconds(input: { countedSeconds: number; countedLength: number; fullLength: number; restCharged: boolean }): { seconds: number; outOf: number } {
  if (!input.restCharged) return { seconds: input.countedSeconds, outOf: input.countedLength };
  const rest = Math.max(0, input.fullLength - input.countedLength);
  return { seconds: input.countedSeconds + rest, outOf: input.fullLength };
}
