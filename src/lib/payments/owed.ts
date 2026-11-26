/**
 * What the call's record says one payment is owed: the one place that works it out
 * (plans/50-end-call-now.md, decision 12). The helper's first look, the taking of the money, the
 * member's call and the call's own page all ask here, so they can never disagree.
 *
 * For almost every call it is the rule that always held: the seconds that count by the call's own
 * rule, inside the stretch this payment pays for, at the call's price. The one addition is a
 * booked call the customer ended with "End call now": then "the rest of the booking" is charged
 * too, unless a report of his lowered it (the rules are in ended.ts).
 */
import { db } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { countedWindow } from "@/lib/attendance/calc";
import { loadAttendance } from "@/lib/attendance/load";
import { lowers } from "@/lib/safety/end-guard";
import { chargedSeconds, hostThereAt, restIsCharged, type EndedNow } from "./ended";
import { attendanceChargeCents, countedSeconds } from "./pricing";
import { cancellationOutcome } from "./rules";

type Reader = Pick<typeof db, "select">;

export type Owed =
  /** The room is not confirmed closed yet, or late messages may still arrive: nothing is decided on a guess. */
  | { is: "not_final" }
  /** The record is incomplete or contradicts itself: for the founder, as for any call. */
  | { is: "review"; reason: string }
  | {
      is: "amount";
      /** Zero when under the smallest charge there is. */
      cents: number;
      /** "customer_ended" when the amount includes the rest of the booking; "attendance" for everything else. */
      reason: "attendance" | "customer_ended";
      /** The time totals inside this payment's stretch, as the record gives them now. */
      totals: { hostSeconds: number; customerSeconds: number; togetherSeconds: number };
      /** The last message of the video service the amount was worked out from. */
      pricedThroughEventId: number;
    };

/**
 * The facts of a press of "End call now", for the money. Null for a call that was not ended that
 * way (also one ended with the earlier button, which the founder decides).
 */
export async function endedNowOf(call: Call, now: Date, reader: Reader = db): Promise<EndedNow | null> {
  if ((call.endedNowBy !== "host" && call.endedNowBy !== "customer") || !call.safetyEndedAt) return null;
  const pressedAt = call.safetyEndedAt;
  const facts: EndedNow = { by: call.endedNowBy, loweredByReport: lowers(call.endReportEffect), beforeStart: pressedAt < call.startsAt, lateToCancel: false, hostThere: false };
  // Nothing more is needed when the rest of the booking cannot be charged anyway.
  if (facts.by !== "customer" || facts.loweredByReport || call.billing !== "host") return facts;
  if (facts.beforeStart) {
    // As his cancelling at that moment would have been charged (the money was held: this is asked for a payment on hold).
    facts.lateToCancel = cancellationOutcome({ by: "customer", now: pressedAt, startsAt: call.startsAt, freeCancelMinutes: call.freeCancelMinutes, held: true }) === "late_charge";
    return facts;
  }
  // The host's connected periods over the whole call, which end at the press.
  const whole = await loadAttendance(call, now, undefined, reader);
  facts.hostThere = hostThereAt(whole.result.hostIntervals, Math.floor(pressedAt.getTime() / 1000));
  return facts;
}

/** What this payment of this call is owed by the record as it stands now. */
export async function owedFor(call: Call, payment: Pick<Payment, "coversFrom" | "coversUntil" | "pricePer15Cents">, now: Date, reader: Reader = db): Promise<Owed> {
  const stretch = { from: payment.coversFrom, until: payment.coversUntil };
  const attendance = await loadAttendance(call, now, stretch, reader);
  if (!attendance.final || !call.closedAt) return { is: "not_final" };
  const totals = attendance.result.totals;
  if (attendance.result.status !== "complete" || !totals) return { is: "review", reason: attendance.result.reasons.join(" ") || "The call's record is incomplete." };

  const counted = countedSeconds(call, totals);
  const restCharged = restIsCharged(call.billing, await endedNowOf(call, now, reader));
  // The stretch as it was booked, without the cut at the press.
  const full = countedWindow({ startsAt: call.startsAt, endsAt: call.endsAt, safetyEndedAt: null }, stretch);
  const { seconds, outOf } = chargedSeconds({ countedSeconds: counted, countedLength: attendance.bookedSeconds, fullLength: full.end - full.start, restCharged });
  return {
    is: "amount",
    cents: attendanceChargeCents({ pricePer15Cents: payment.pricePer15Cents, bookedSeconds: outOf, countedSeconds: seconds }),
    reason: seconds > counted ? "customer_ended" : "attendance",
    totals,
    pricedThroughEventId: attendance.events.reduce((max, event) => Math.max(max, event.id), 0),
  };
}
