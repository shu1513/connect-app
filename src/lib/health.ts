/**
 * Is the money work healthy? Asked by an outside watching service every few
 * minutes, through /api/health. It exists because money is now taken a day or
 * two after a call, close enough to the end of a card hold that a helper which
 * has stopped must be noticed within minutes, by something that does not
 * depend on the helper itself.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import { contributionHealthProblems } from "@/lib/contributions/health";
import { membershipHealthProblems } from "@/lib/membership/health";
import { moneyTiming } from "@/lib/payments/rules";
import { isFrozen } from "@/lib/membership/rules";
import { commonExpiry, heldOrdinary, holdEndFor, isDecided, isMemberCall } from "@/lib/payments/take";

/** The helper's last finished round of payment work may be this old. */
export const BEAT_MAX_AGE_MS = 10 * 60_000;
/** A money action that was started may wait this long for its answer (the helper checks after one minute). */
export const UNFINISHED_MAX_AGE_MS = 6 * 60_000;

/** An ordinary charge may be this far past the moment its money should have been taken. */
export const OVERDUE_MS = 5 * 60_000;

/**
 * Whether the money of some call should have been taken more than 5 minutes
 * ago and has not been: past its planned moment with nobody asking, past the
 * host's time, or 5 minutes after an answer was accepted with nothing started
 * for it. A charge waiting for the founder's review does not count, and
 * neither does one whose action was started (that is watched separately).
 */
export async function moneyOverdue(now: Date): Promise<boolean> {
  // Only calls that ended at least 5 minutes ago can be late at all.
  const calls = await db
    .selectDistinct({ call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(eq(schema.payments.status, "held"), eq(schema.payments.needsReview, false), isNull(schema.calls.cancelledAt), lt(schema.calls.endsAt, new Date(now.getTime() - OVERDUE_MS))));
  for (const { call } of calls) if (await callOverdue(call, now)) return true;
  return false;
}

/**
 * The same question for one call, asked of each of its payments the way settling asks it: is this
 * payment past its own moment? Money set aside in a membership has no hold and is due at the
 * call's moment; a card payment for time added to such a call is due by its own hold; the charges
 * of a call paid by card share the earliest of their holds.
 */
export async function callOverdue(call: Call, now: Date): Promise<boolean> {
  if (call.cancelledAt) return false;
  const held = (await heldOrdinary(db, call.id)).filter((p) => p.kind === "member_call" || (p.holdExpiresAt && p.holdExpiresAt > now));
  if (held.length === 0) return false;
  const memberCall = await isMemberCall(db, call.id);
  const common = memberCall ? null : await commonExpiry(db, call.id);
  if (!memberCall && !common) return false;
  const [request] = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id));
  const answered = isDecided(request) && request.decidedAt ? request.decidedAt : null;
  for (const payment of held) {
    const holdEnd = holdEndFor(payment, memberCall, common);
    if (payment.kind !== "member_call" && !holdEnd) continue;
    const dueAt = answered ?? moneyTiming({ callStartsAt: call.startsAt, requestedAt: request?.askedAt ?? null, holdExpiresAt: holdEnd }).takeAt;
    if (now.getTime() <= dueAt.getTime() + OVERDUE_MS) continue;
    if (payment.kind === "member_call") {
      // Nothing of a month whose charge is disputed moves, so its money is not late.
      const [month] = payment.monthId ? await db.select({ dispute: schema.membershipMonths.dispute }).from(schema.membershipMonths).where(eq(schema.membershipMonths.id, payment.monthId)) : [];
      if (!month || isFrozen(month)) continue;
    }
    const [started] = await db
      .select({ id: schema.moneyOperations.id })
      .from(schema.moneyOperations)
      .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started")))
      .limit(1);
    if (started) continue;
    // An answer was accepted and nothing was started for it within 5 minutes: that is late whatever holds it
    // up, also a room that could not be confirmed closed.
    if (answered) return true;
    // Otherwise only a charge the helper would really take or release now counts: its record is final and adds up.
    const record = await loadAttendance(call, now, { from: payment.coversFrom, until: payment.coversUntil });
    if (record.final && call.closedAt && record.result.status === "complete" && record.result.totals) return true;
  }
  return false;
}

/** Written by the helper each time it finishes a round of payment work. */
export async function recordBeat(name: "payments", at: Date): Promise<void> {
  await db.insert(schema.helperBeats).values({ name, at }).onConflictDoUpdate({ target: schema.helperBeats.name, set: { at } });
}

/** The reasons the money work is not healthy right now. Empty means healthy. For our own logs only. */
export async function healthProblems(now: Date): Promise<string[]> {
  const problems: string[] = [];

  const [beat] = await db.select().from(schema.helperBeats).where(eq(schema.helperBeats.name, "payments"));
  if (!beat || now.getTime() - beat.at.getTime() > BEAT_MAX_AGE_MS) problems.push("the helper has not finished a round of payment work in the last 10 minutes");

  const [stuck] = await db
    .select({ id: schema.moneyOperations.id })
    .from(schema.moneyOperations)
    .where(and(eq(schema.moneyOperations.status, "started"), lt(schema.moneyOperations.createdAt, new Date(now.getTime() - UNFINISHED_MAX_AGE_MS))))
    .limit(1);
  if (stuck) problems.push("a money action that was started has had no answer for more than 5 minutes after the usual check");

  if (await moneyOverdue(now)) problems.push("the money of a call is more than 5 minutes past the moment it should have been taken or released");

  problems.push(...(await membershipHealthProblems(now)));
  problems.push(...(await contributionHealthProblems(now)));

  return problems;
}
