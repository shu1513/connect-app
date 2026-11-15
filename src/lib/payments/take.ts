/**
 * Taking the money for a call's ordinary charges: about a day after the call,
 * or when a refund request has been answered (see moneyTiming in rules.ts).
 *
 * Everything is decided in one locked step for the call. With the call's row
 * locked, the request and its answer are read, the call's record is looked at
 * once more, and the charge (or the release) of each payment is written down
 * before Stripe is asked. An answer to a request is saved under the same lock
 * (src/lib/refunds/requests.ts), so whichever was written down first is what
 * happens: an answer is never replaced by "in full", and a charge that was
 * already written down is carried out as written.
 *
 * The order of locks is the same everywhere: a host's collection, then the
 * call, then its payments, then request and refund records.
 */
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment, RefundRequest } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import { capturePlan, releasePlan, type Lowered } from "./actions";
import {
  completeMoneyOperation,
  lockPayment,
  MoneyError,
  OutcomeUnknownError,
  refusedRecently,
  startMoneyOperation,
  type OperationPlan,
  type Tx,
} from "./operations";
import { attendanceChargeCents, countedSeconds, MIN_CHARGE_CENTS } from "./pricing";
import { moneyTiming, takeDecision } from "./rules";

type Reader = Pick<Tx, "select">;

/**
 * The call's ordinary charges that are still on hold: the call's own payment
 * and the payment of each accepted request for more time, not under the
 * founder's review. In a fixed order, which is also the order they are locked in.
 */
export async function heldOrdinary(reader: Reader, callId: string): Promise<Payment[]> {
  const rows = await reader
    .select({ payment: schema.payments })
    .from(schema.payments)
    .leftJoin(schema.callExtensions, eq(schema.callExtensions.id, schema.payments.extensionId))
    .where(
      and(
        eq(schema.payments.callId, callId),
        eq(schema.payments.status, "held"),
        eq(schema.payments.needsReview, false),
        or(isNull(schema.payments.extensionId), eq(schema.callExtensions.status, "accepted")),
      ),
    )
    .orderBy(asc(schema.payments.id));
  return rows.map((row) => row.payment);
}

/** The earliest end among these holds. They share one moment for taking the money. */
export function earliestExpiry(payments: Payment[]): Date | null {
  const ends = payments.flatMap((p) => (p.holdExpiresAt ? [p.holdExpiresAt.getTime()] : []));
  return ends.length > 0 ? new Date(Math.min(...ends)) : null;
}

/** A request that needs no more waiting: answered before the money was taken, or closed by the founder. */
export const isDecided = (request: Pick<RefundRequest, "status"> | null | undefined) => request?.status === "answered" || request?.status === "closed";

/** Where the money of a call stands, for the pages: the charges still on hold and the moments that apply to them. */
export async function moneyPlan(call: { id: string; endsAt: Date }): Promise<{
  request: RefundRequest | null;
  held: Payment[];
  timing: ReturnType<typeof moneyTiming> | null;
}> {
  const [request] = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id));
  const held = await heldOrdinary(db, call.id);
  const expiry = earliestExpiry(held);
  return {
    request: request ?? null,
    held,
    timing: expiry ? moneyTiming({ callEndsAt: call.endsAt, requestedAt: request?.askedAt ?? null, holdExpiresAt: expiry }) : null,
  };
}

/** Writes one money action down inside the locked step. Gives back the rest of it (asking Stripe), to run after the step. */
async function writeDown<P, R>(tx: Tx, plan: OperationPlan<P, R>): Promise<(() => Promise<void>) | null> {
  try {
    const started = await startMoneyOperation(tx, plan);
    return started === "already_done" ? null : () => completeMoneyOperation(started, plan);
  } catch (error) {
    // Not allowed on this payment right now (another action is unfinished, or it is no longer held): leave it.
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) return null;
    throw error;
  }
}

/**
 * Takes the money for a call's ordinary charges if it is time: nobody asked
 * and the day has passed, a request was answered, or the host's time is up.
 * Safe to call at any moment and as often as wanted; it does nothing when it
 * is not time, and never acts twice on a payment.
 */
export async function settleOrdinaryCharges(callId: string, now: Date): Promise<void> {
  const rest = await db.transaction(async (tx) => {
    const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, callId)).for("update");
    if (!call || call.cancelledAt) return [];

    const held: Payment[] = [];
    for (const { id } of await heldOrdinary(tx, callId)) {
      const payment = await lockPayment(tx, id);
      if (payment.status === "held" && !payment.needsReview) held.push(payment);
    }
    const expiry = earliestExpiry(held);
    if (!expiry) return [];

    const [request] = await tx.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, callId));
    const decided = isDecided(request);
    if (takeDecision({ now, callEndsAt: call.endsAt, requestedAt: request?.askedAt ?? null, decided, holdExpiresAt: expiry }) !== "take") return [];
    const answers = request?.status === "answered" ? await tx.select().from(schema.refundRequestAnswers).where(eq(schema.refundRequestAnswers.requestId, request.id)) : [];

    const steps: Array<() => Promise<void>> = [];
    for (const payment of held) {
      // A hold that has run out can no longer be charged; the job that closes such payments does that.
      if (!payment.holdExpiresAt || payment.holdExpiresAt <= now) continue;

      // Before any money is taken, the record is looked at again.
      const attendance = await loadAttendance(call, now, { from: payment.coversFrom, until: payment.coversUntil });
      if (!attendance.final || !call.closedAt) continue; // never charged on a guess
      const totals = attendance.result.totals;
      if (attendance.result.status !== "complete" || !totals) {
        // It was fine after the call and no longer adds up: the founder reviews it. An answer already given cannot override that.
        await tx
          .update(schema.payments)
          .set({ needsReview: true, reviewReason: attendance.result.reasons.join(" ") || "The call's record is incomplete.", updatedAt: new Date() })
          .where(eq(schema.payments.id, payment.id));
        continue;
      }

      const recordCents = attendanceChargeCents({
        pricePer15Cents: payment.pricePer15Cents,
        bookedSeconds: attendance.bookedSeconds,
        countedSeconds: countedSeconds(call, totals),
      });
      // "In full" is what the record gives now, never the larger amount that was held.
      // "Less" is the most the customer pays: if the record gives less, the lower amount is taken.
      const answer = answers.find((a) => a.paymentId === payment.id);
      const amountCents = !answer || answer.choice === "full" ? recordCents : answer.choice === "less" ? Math.min(answer.maxCents ?? 0, recordCents) : 0;
      const lowered: Lowered | undefined = answer && amountCents < recordCents ? { recordCents, by: request?.decidedAs === "admin" ? "admin" : "host" } : undefined;

      if (amountCents < MIN_CHARGE_CENTS) {
        // Under 50 cents nothing is taken and the hold is let go: the rule for every call.
        const note = lowered ? `Nothing is charged: ${lowered.by === "admin" ? "Connect" : "the host"} answered the refund request.` : "Nothing was owed for this call.";
        const step = await writeDown(tx, releasePlan({ paymentId: payment.id, note, lowered }));
        if (step) steps.push(step);
        continue;
      }
      // Stripe refused this charge a short while ago: wait before trying it again.
      if (await refusedRecently(payment.id, "capture", now, tx)) continue;
      const step = await writeDown(
        tx,
        capturePlan({
          paymentId: payment.id,
          amountCents,
          reason: "attendance",
          frozen: totals,
          callEndsAt: call.endsAt,
          // Remember which messages the amount was based on, so later ones can be noticed.
          pricedThroughEventId: attendance.events.reduce((max, e) => Math.max(max, e.id), 0),
          now,
          lowered,
        }),
      );
      if (step) steps.push(step);
    }
    return steps;
  });

  // Stripe is only asked after the locked step has ended. Whatever fails here is finished by the helper.
  for (const step of rest) {
    try {
      await step();
    } catch (error) {
      if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[payments] a charge of call ${callId} did not go through yet: ${error.message}`);
      else console.error(`[payments] a charge of call ${callId} failed; will retry`, error);
    }
  }
}
