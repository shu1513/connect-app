/**
 * The locks of a membership, always taken in one order (plans/20, "The order of locks"):
 *   1. the host's calendar lock (the same lock a booking takes),
 *   2. person and profile rows,
 *   3. the host's collection row,
 *   4. the membership,
 *   5. the month,
 *   6. calls, then payments, then request and refund records.
 * A step takes only the locks it needs, but never an earlier one after a later one.
 */
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Membership, MembershipMonth } from "@/db/schema";
import { MoneyError, type Owner, type Tx } from "@/lib/payments/operations";

/** The same lock `lockCalendars` in booking/bookings.ts takes for one person. */
export async function lockCalendar(tx: Tx, hostId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`calendar:${hostId}`}))`);
}

export async function lockMembership(tx: Tx, membershipId: string): Promise<Membership> {
  const [membership] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)).for("update");
  if (!membership) throw new MoneyError("Membership not found.");
  return membership;
}

export async function lockMonth(tx: Tx, monthId: string): Promise<MembershipMonth> {
  const [month] = await tx.select().from(schema.membershipMonths).where(eq(schema.membershipMonths.id, monthId)).for("update");
  if (!month) throw new MoneyError("Month not found.");
  return month;
}

/** A month with its membership, both locked and read under the lock. */
export type LockedMonth = { membership: Membership; month: MembershipMonth };

/**
 * Finds the month's membership and host without a lock, then takes the host's calendar lock, the
 * membership and the month, in that order, and reads both again. Every step about a month's money
 * comes in through here, so they all keep the one order.
 */
export async function lockForMonth(tx: Tx, monthId: string): Promise<LockedMonth> {
  const [found] = await tx
    .select({ membershipId: schema.memberships.id, hostId: schema.memberships.hostId })
    .from(schema.membershipMonths)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .where(eq(schema.membershipMonths.id, monthId));
  if (!found) throw new MoneyError("Month not found.");
  await lockCalendar(tx, found.hostId);
  const membership = await lockMembership(tx, found.membershipId);
  const month = await lockMonth(tx, monthId);
  return { membership, month };
}

/**
 * For a step that settles or cancels a call. A month comes before a call in the order of locks, so
 * such a step first reads, without a lock, which months the call's member payments belong to, and
 * locks those memberships and months (each kind in the order of its ids). The caller then locks the
 * call and its payments, and reads everything again. Does nothing for a call paid by card.
 */
export async function lockMonthsOfCall(tx: Tx, callId: string): Promise<void> {
  const rows = await tx
    .select({ monthId: schema.membershipMonths.id, membershipId: schema.membershipMonths.membershipId })
    .from(schema.payments)
    .innerJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.payments.monthId))
    .where(and(eq(schema.payments.callId, callId), eq(schema.payments.kind, "member_call")));
  for (const id of [...new Set(rows.map((row) => row.membershipId))].sort()) await lockMembership(tx, id);
  for (const id of [...new Set(rows.map((row) => row.monthId))].sort()) await lockMonth(tx, id);
}

/** A month as the owner of a money action (see payments/operations.ts). */
export const monthOwner = (monthId: string): Owner<LockedMonth> => ({ column: "monthId", id: monthId, lock: (tx) => lockForMonth(tx, monthId) });

/** Whether this month is the one that may change its membership's state: the current month of the current period. */
export const isCurrent = ({ membership, month }: LockedMonth): boolean => membership.currentMonthId === month.id && membership.period === month.period;
