/**
 * A customer's report after his own "End call now" (plans/50-end-call-now.md, decisions 14 to 17):
 * whether it lowers the call's charge from the whole booking to the time the call lasted, and the
 * guard against someone who does that again and again.
 *
 * Decided once, inside the report's own database step, and written on the call. The money step
 * (src/lib/payments/take.ts) holds the same row when it works out an amount, so a report comes
 * either before that or after it, never in the middle. Nothing here can raise a charge: the one
 * thing it writes that changes money is "by the minutes" in place of "the whole booking".
 */
import { and, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { END_WORDS } from "@/lib/call-page/end-words";
import { tell } from "@/lib/messages/messages";
import { ordinaryPayments } from "@/lib/payments/take";
import { END_GUARD, endReportEffect, type EndReportEffect } from "./end-guard";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const DAY_MS = 24 * 3_600_000;

/**
 * Whether a report by this person about this call could lower its charge at all: he is its
 * customer, it was he who pressed "End call now", before the booked end, on a paid call that
 * charges the host's time, and no report has decided it yet.
 */
export function reportCouldLower(call: Call, reporterId: string): boolean {
  return (
    call.endedNowBy === "customer" &&
    call.customerId === reporterId &&
    call.safetyEndedBy === reporterId &&
    call.safetyEndedAt !== null &&
    call.safetyEndedAt < call.endsAt &&
    call.billing === "host" &&
    call.pricePer15Cents > 0 &&
    call.cancelledAt === null &&
    call.endReportEffect === null
  );
}

/** Whether any payment of the call is still waiting: held, not under review, and no money step started on it. */
async function moneyStillWaits(reader: Reader, callId: string): Promise<boolean> {
  for (const payment of await ordinaryPayments(reader, callId)) {
    if (payment.status !== "held" || payment.needsReview) continue;
    const [started] = await reader
      .select({ id: schema.moneyOperations.id })
      .from(schema.moneyOperations)
      .where(and(eq(schema.moneyOperations.paymentId, payment.id), eq(schema.moneyOperations.status, "started")))
      .limit(1);
    if (!started) return true;
  }
  return false;
}

/**
 * The video service said this person joined the call. (The call's columns are written with the
 * table's name: inside the inner query a bare "id" would be the attendance line's own.)
 */
const joined = (who: "host_id" | "customer_id") =>
  sql`exists (select 1 from "attendance_events" a where a.call_id = "calls"."id" and a.type = 'participant_joined' and a.participant_identity = ${sql.raw(`"calls"."${who}"`)})`;

/** A call that took place: not cancelled, over, paid, and both people joined it. */
const tookPlace = (now: Date) =>
  and(isNull(schema.calls.cancelledAt), gt(schema.calls.pricePer15Cents, 0), or(isNotNull(schema.calls.safetyEndedAt), lte(schema.calls.endsAt, now)), joined("host_id"), joined("customer_id"));

/**
 * What stands on the customer's calls before this one, newest first: his booked and member calls
 * with any host that took place. "Available now" calls are left out, and so are free ones: a
 * report never lowers their charge, and they cost little or nothing, so counting them would let
 * him push the others out of "his last 5" for free.
 */
async function earlierEffects(reader: Reader, call: Call, now: Date): Promise<Array<string | null>> {
  const rows = await reader
    .select({ effect: schema.calls.endReportEffect })
    .from(schema.calls)
    .where(and(eq(schema.calls.customerId, call.customerId), ne(schema.calls.id, call.id), eq(schema.calls.billing, "host"), tookPlace(now)))
    .orderBy(desc(schema.calls.startsAt))
    .limit(END_GUARD.calls - 1);
  return rows.map((row) => row.effect);
}

/**
 * Whether another person has also reported this host, from a call she hosted that took place, in
 * the last 12 months (open or closed). Only such reports count. Anyone can report a public page,
 * and anyone can report from a call the moment it is booked and then cancel it: a second account
 * doing either would switch the guard off for nothing. A call that took place cost that person a
 * real, paid call with her.
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
        tookPlace(now),
        gt(schema.reports.createdAt, new Date(now.getTime() - END_GUARD.othersWithinDays * DAY_MS)),
      ),
    )
    .limit(1);
  return Boolean(other);
}

/** What the guard would decide for this call right now, read without changing anything. Null when a report could not lower it (any more). */
export async function endReportPreview(call: Call, reporterId: string, now: Date, reader: Reader = db): Promise<EndReportEffect | null> {
  if (!reportCouldLower(call, reporterId) || !(await moneyStillWaits(reader, call.id))) return null;
  return endReportEffect({ earlier: await earlierEffects(reader, call, now), othersReported: await othersReported(reader, call, now) }).effect;
}

/**
 * Called inside the report's own step, after the report is written, for a report made from a call.
 * Gives back what was decided, or null when this report decides nothing about money (it is not
 * the customer's report after his own press, or the money was already taken).
 *
 * The reporter's own lock is held by the caller, so two reports of one person never decide side
 * by side; the call's row is taken here, which is what the money step waits for.
 */
export async function decideEndReport(tx: Tx, input: { callId: string; reporterId: string; now: Date }): Promise<EndReportEffect | null> {
  const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, input.callId)).for("update");
  if (!call || !reportCouldLower(call, input.reporterId)) return null;
  // After the money was taken a report changes nothing by itself: the refund paths that exist remain.
  if (!(await moneyStillWaits(tx, call.id))) return null;

  const { effect, crossesLine } = endReportEffect({ earlier: await earlierEffects(tx, call, input.now), othersReported: await othersReported(tx, call, input.now) });
  await tx.update(schema.calls).set({ endReportAt: input.now, endReportEffect: effect }).where(eq(schema.calls.id, call.id));

  if (crossesLine) {
    // The founder is told once, at the report that makes it 3 of 5: no detail of any report, and no later report sends it again.
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
  return effect;
}
