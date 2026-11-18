/**
 * What follows when a membership is ended at once, and what a bank dispute does.
 *
 * Ending itself is one database step (`endMembership`, state.ts), saved together with whatever
 * caused it. This file is the work after that step: the clean-up, which the helper repeats until
 * all of it is done.
 *
 * Part 1b adds the people who ask for an ending or a pause here (the two stops and their undoing,
 * "Cancel now", the host's own "End membership", the offer of less time).
 */
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { abandonMonth } from "./charge";
import { lockCalendar, lockForMonth, lockMembership, lockMonth, type LockedMonth } from "./locks";
import { finishIfSettled, owePayBack, setDispute } from "./months";
import { isFrozen } from "./rules";
import { endMembership } from "./state";

// Ending at once and pausing (the rulebook's "How the parts connect" hands them over with the clean-up).
export { endMembership, pauseMembership } from "./state";

const months = schema.membershipMonths;

/**
 * THE one place in the clean-up that cancels a membership's upcoming member calls (the rulebook's
 * "How the parts connect"). Part two fills it. In part one there are no member calls, so there is
 * nothing to cancel. Returns whether none is left.
 */
export async function cancelUpcomingMemberCalls(membershipId: string, now: Date): Promise<boolean> {
  void membershipId;
  void now;
  return true;
}

/**
 * A membership that was ended before a month's end: that month's free money is owed back to the
 * card, once, and nothing of it expires. A membership ended only after the month's end changes
 * nothing for that month. The same test is used by the clean-up and by the closing of a month, so
 * the result is the same whichever gets there first. A frozen month is left as it stands.
 */
export async function owedAfterEnding(tx: Tx, locked: LockedMonth): Promise<void> {
  const { membership, month } = locked;
  if (membership.status !== "ended" || !membership.endedAt || !month.endsAt || membership.endedAt >= month.endsAt) return;
  if (month.status !== "running" || isFrozen(month) || month.freeCents < 1) return;
  await owePayBack(tx, month, { amountCents: month.freeCents, sourceKey: `ending:${month.id}`, reason: "Your membership ended, so the time you had not used is paid back." });
}

/**
 * The clean-up after an ending, safe to run as often as needed: an open payment is cancelled or
 * its hold let go; upcoming member calls are cancelled; free money is owed back. A call under way
 * and money still set aside are left to settle in the usual way. Returns whether it is all done.
 */
export async function cleanUpEnding(membershipId: string, now: Date = new Date()): Promise<boolean> {
  const [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId));
  if (!membership || membership.status !== "ended" || membership.cleanupDoneAt) return true;

  const open = await db.select({ id: months.id }).from(months).where(and(eq(months.membershipId, membershipId), inArray(months.status, ["to_pay", "held"])));
  for (const month of open) await abandonMonth(month.id, "ending", now);

  const callsDone = await cancelUpcomingMemberCalls(membershipId, now);

  const running = await db.select({ id: months.id }).from(months).where(and(eq(months.membershipId, membershipId), eq(months.status, "running")));
  for (const month of running) {
    await db.transaction(async (tx) => owedAfterEnding(tx, await lockForMonth(tx, month.id)));
  }

  return db.transaction(async (tx) => {
    const locked = await lockMembership(tx, membershipId);
    if (locked.cleanupDoneAt) return true;
    const [stillOpen] = await tx.select({ id: months.id }).from(months).where(and(eq(months.membershipId, membershipId), inArray(months.status, ["to_pay", "held"]))).limit(1);
    if (stillOpen || !callsDone) return false;
    await tx.update(schema.memberships).set({ cleanupDoneAt: now, updatedAt: now }).where(eq(schema.memberships.id, membershipId));
    return true;
  });
}

/** Ended memberships whose clean-up is not done, for the helper. */
export async function runEndings(now: Date): Promise<void> {
  const waiting = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.status, "ended"), isNull(schema.memberships.cleanupDoneAt)))
    .limit(50);
  for (const membership of waiting) {
    await cleanUpEnding(membership.id, now).catch((error) => console.error(`[membership] could not finish the clean-up of ended membership ${membership.id}; will retry`, error));
  }
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

/**
 * Records where the bank's dispute over a month's charge stands (the rulebook's "Disputes"), in
 * one step with the month:
 *   - open or lost: the month is frozen as it stands;
 *   - won: the month goes on from where it stood, and money that is still free is paid back,
 *     because the membership has ended.
 * Whenever this is the first we record of a dispute on this month, whatever its state already is,
 * the membership the two people have NOW is ended at once, also when the disputed month belongs
 * to an earlier period or to an earlier, ended membership of the same two. It is the one case
 * where an old month changes a membership.
 */
export async function recordMonthDispute(monthId: string, state: "open" | "won" | "lost", now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ membershipId: schema.memberships.id, hostId: schema.memberships.hostId, customerId: schema.memberships.customerId })
      .from(months)
      .innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId))
      .where(eq(months.id, monthId));
    if (!found) return;
    // The calendar lock first: nobody can make a new membership for these two while we look for the live one.
    await lockCalendar(tx, found.hostId);
    const [live] = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.hostId, found.hostId), eq(schema.memberships.customerId, found.customerId), ne(schema.memberships.status, "ended")));
    const locked = new Map<string, Membership>();
    for (const id of [...new Set([found.membershipId, ...(live ? [live.id] : [])])].sort()) locked.set(id, await lockMembership(tx, id));
    const month = await lockMonth(tx, monthId);

    const { month: marked, first } = await setDispute(tx, month, state, now);
    if (first && live) await endMembership(tx, locked.get(live.id)!, { by: "connect", reason: "the member's bank disputed a membership payment" }, now);
    if (state === "won") {
      if (marked.freeCents > 0 && (marked.status === "running" || marked.status === "closed")) {
        await owePayBack(tx, marked, { amountCents: marked.freeCents, sourceKey: `won:${marked.id}`, reason: "Your membership ended, so the time you had not used is paid back." });
      } else {
        await finishIfSettled(tx, marked, now);
      }
    }
  });
}
