/**
 * A customer's report after his own "End call now" (plans/51-end-call-now.md, decisions 14 to 17):
 * whether it lowers the call's charge from the whole booking to the time the call lasted, and the
 * guard against someone who does that again and again.
 *
 * Decided once, inside the report's own database step, and written on the call. The money step
 * (src/lib/payments/take.ts) holds the same row when it works out an amount, so a report comes
 * either before that or after it, never in the middle. Nothing here can raise a charge: the one
 * thing it writes that changes money is "by the minutes" in place of "the whole booking".
 */
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { END_WORDS } from "@/lib/call-page/end-words";
import { tell } from "@/lib/messages/messages";
import { cancellationOutcome } from "@/lib/payments/rules";
import { ordinaryPayments } from "@/lib/payments/take";
import { END_GUARD, endReportEffect, type EndReportEffect } from "./end-guard";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const DAY_MS = 24 * 3_600_000;

/**
 * Whether a report by this person about this call could lower its charge at all: he is its
 * customer, it was he who pressed "End call now" (told that it costs his whole booked time),
 * before the booked end, on a paid call that charges the host's time, and no report has decided
 * it yet. Not a press before the booked start while cancelling was still free: nothing is
 * charged for that anyway, so there is nothing to lower and nothing to count.
 */
export function reportCouldLower(call: Call, reporterId: string): boolean {
  if (call.endedNowBy !== "customer" || call.customerId !== reporterId || call.safetyEndedBy !== reporterId) return false;
  if (call.safetyEndedAt === null || call.safetyEndedAt >= call.endsAt) return false;
  if (call.billing !== "host" || call.pricePer15Cents <= 0 || call.cancelledAt !== null || call.endReportEffect !== null) return false;
  if (call.safetyEndedAt < call.startsAt && cancellationOutcome({ by: "customer", now: call.safetyEndedAt, startsAt: call.startsAt, freeCancelMinutes: call.freeCancelMinutes, held: true }) !== "late_charge") return false;
  return true;
}

/**
 * Where the call's money stands. `waits`: at least one of its charges can still change. That is a
 * live hold (not run out, not under review), or a card step that was begun before the press and
 * whose hold may yet be recorded; and no charge or release of it is written down. (A payment
 * whose card step was never begun cannot be paid any more once the call is ended, and a hold
 * that has run out can only be let go: neither is a charge a report could lower.)
 * `partly`: at least one is already charged, or has its charge written down, so a report cannot
 * change that one.
 * With `lock`, each payment's row is held while it is read (after the call's, in the one order
 * of locks), so a step that only holds a payment cannot slip in between.
 */
async function moneyOf(reader: Reader | Tx, callId: string, now: Date, lock: boolean): Promise<{ waits: boolean; partly: boolean }> {
  let waits = false;
  let partly = false;
  for (const seen of await ordinaryPayments(reader, callId)) {
    const [payment] = lock ? await (reader as Tx).select().from(schema.payments).where(eq(schema.payments.id, seen.id)).for("update") : [seen];
    if (!payment) continue;
    if (payment.status === "charged") partly = true;
    if (payment.needsReview) continue;
    const live =
      payment.status === "held"
        ? payment.kind === "member_call" || (payment.holdExpiresAt !== null && payment.holdExpiresAt > now)
        : payment.status === "awaiting_payment" && payment.stripePaymentIntentId !== null;
    if (!live) continue;
    // A charge that is written down has its amount; a release lets the hold go. (A card step still under way fixes nothing.)
    const [fixed] = await reader
      .select({ kind: schema.moneyOperations.kind })
      .from(schema.moneyOperations)
      .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started"), inArray(schema.moneyOperations.kind, ["capture", "release"])))
      .limit(1);
    if (fixed?.kind === "capture") partly = true;
    if (!fixed) waits = true;
  }
  return { waits, partly };
}

/** Something of this call was really paid for and kept: its own payment, or time that was added to it, after anything given back. */
const reallyCharged = sql`exists (select 1 from "payments" p where p.call_id = "calls"."id" and p.status = 'charged' and coalesce(p.charged_cents, 0) - coalesce(p.refunded_cents, 0) > 0)`;
/**
 * When a call came into his history: when his report about it was taken, or else when it was charged. His calls
 * are read in that order, newest first, and not by their start: so each report he makes is the newest thing in
 * his history for the next one, in whatever order he reports and whenever the calls themselves settle.
 */
const cameIntoHistory = sql`coalesce("calls"."end_report_at", (select max(p.charged_at) from "payments" p where p.call_id = "calls"."id" and p.status = 'charged'))`;

/**
 * A call of his that belongs to "his last 5": a booked or member call (never "available now"),
 * not cancelled, that either carries a report of his that lowered its charge, or was really
 * charged. A call that cost nothing is not one of them, whatever happened in it: nobody came, a
 * few seconds, a free one, or a report that was not lowered on a call that then cost nothing.
 * Such calls would let him push the others out for nothing. Read from the calls and their
 * payments alone, so it does not depend on messages of the video service that may still arrive.
 */
const inHisHistory = and(eq(schema.calls.billing, "host"), isNull(schema.calls.cancelledAt), or(inArray(schema.calls.endReportEffect, ["minutes", "minutes_uncounted"]), reallyCharged));

/** What stands on the 4 calls that came into his history last (see `cameIntoHistory`), newest first. */
async function earlierEffects(reader: Reader, call: Call): Promise<Array<string | null>> {
  const rows = await reader
    .select({ effect: schema.calls.endReportEffect })
    .from(schema.calls)
    .where(and(eq(schema.calls.customerId, call.customerId), ne(schema.calls.id, call.id), inHisHistory))
    .orderBy(sql`${cameIntoHistory} desc nulls last`, desc(schema.calls.startsAt), desc(schema.calls.id))
    .limit(END_GUARD.calls - 1);
  return rows.map((row) => row.effect);
}

/**
 * Whether another person has also reported this host, as her customer, from a call with her that
 * was really paid for, in the last 12 months (open or closed). Only such reports count. Anyone
 * can report a public page, anyone can report from a call the moment it is booked and then
 * cancel it, and two people can join a room for a moment and leave: a second account doing any
 * of these would switch the guard off for nothing. A call that was charged cost that person
 * real money.
 */
async function othersReported(reader: Reader, call: Call, now: Date): Promise<boolean> {
  const [other] = await reader
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .innerJoin(schema.calls, sql`${schema.calls.id}::text = ${schema.reports.contextId}`)
    .where(
      and(
        eq(schema.reports.context, "call"),
        eq(schema.reports.reportedId, call.hostId),
        ne(schema.reports.reporterId, call.customerId),
        eq(schema.calls.hostId, call.hostId),
        eq(schema.calls.customerId, schema.reports.reporterId),
        isNull(schema.calls.cancelledAt),
        reallyCharged,
        gt(schema.reports.createdAt, new Date(now.getTime() - END_GUARD.othersWithinDays * DAY_MS)),
      ),
    )
    .limit(1);
  return Boolean(other);
}

/** What a report decided: the effect, and whether a part of the call's money was already taken (or on its way) and stays as it is. */
export type EndReportDecision = { effect: EndReportEffect; partly: boolean };

/**
 * What the guard would decide for this call right now, read without changing anything. Null when
 * a report could not lower it (any more). The screens tell apart only "lowered" and "not
 * lowered", and say so when a part of the money is already taken.
 */
export async function endReportPreview(call: Call, reporterId: string, now: Date, reader: Reader = db): Promise<EndReportDecision | null> {
  if (!reportCouldLower(call, reporterId)) return null;
  const money = await moneyOf(reader, call.id, now, false);
  if (!money.waits) return null;
  return { effect: endReportEffect({ earlier: await earlierEffects(reader, call), othersReported: await othersReported(reader, call, now) }).effect, partly: money.partly };
}

/**
 * Called inside the report's own step, after the report is written, for a report made from a call.
 * Gives back what was decided; "too_late" when it is the customer's report after his own press
 * but all of the money was already taken; or null when this report has nothing to do with the
 * call's money.
 *
 * The reporter's own lock is held by the caller, so two reports of one person never decide side
 * by side; the call's row is taken here, which is what the money step waits for, and then the
 * call's payments. Nothing is said here about the block: it follows this step and can fail by
 * itself, and the thank-you says what became of it.
 */
export async function decideEndReport(tx: Tx, input: { callId: string; reporterId: string; now: Date }): Promise<EndReportDecision | "too_late" | null> {
  const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, input.callId)).for("update");
  if (!call || !reportCouldLower(call, input.reporterId)) return null;
  // After the money was taken a report changes nothing by itself: the refund paths that exist remain. That is said
  // to him ("too_late"), so that nobody who was just shown "a report lowers this charge" is left without an answer.
  const money = await moneyOf(tx, call.id, input.now, true);
  // (Nothing waits and nothing was taken either: an unpaid call, say. Then there is nothing to tell him about money.)
  if (!money.waits) return money.partly ? "too_late" : null;

  const { effect, crossesLine } = endReportEffect({ earlier: await earlierEffects(tx, call), othersReported: await othersReported(tx, call, input.now) });
  await tx.update(schema.calls).set({ endReportAt: input.now, endReportEffect: effect }).where(eq(schema.calls.id, call.id));

  if (crossesLine) {
    // The founder is told at the report that makes it 3 of 5: no detail of any report, and no later report sends it again.
    const [customer] = await tx.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, call.customerId));
    const admins = await tx.select({ id: schema.user.id, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
    for (const admin of admins) {
      await tell(tx, { to: admin, key: `end-guard:${call.customerId}:${call.id}:${admin.id}`, subject: END_WORDS.founderSubject, text: END_WORDS.founderText(customer ?? { name: "A customer", email: "" }), path: "/admin/reports" });
    }
  }
  if (effect === "whole") {
    // The customer is told plainly, long before the money is taken, by the name he knows the host by.
    const [customer] = await tx.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, call.customerId));
    const [host] = await tx.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId));
    if (customer) {
      await tell(tx, { to: customer, key: `end-report-whole:${call.id}`, subject: END_WORDS.customerSubject, text: END_WORDS.customerText(host?.displayName ?? "the host"), path: `/calls/${call.id}/results` });
    }
  }
  return { effect, partly: money.partly };
}
