/**
 * The end of a month, and the renewal (the rulebook's "Step by step", 5 and 6, and "The monthly
 * payment"; plans/20, "The end of a month, and the renewal").
 *
 * Closing a month and deciding about the next one are ONE database step, with the host's
 * calendar, the membership and the old month locked. So a month can never be closed without its
 * renewal being either written down or refused, and two helpers can never both renew it.
 */
import { and, eq, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { membershipsOnFor } from "@/lib/safety/switches";
import { tryHold, writeDownMonth } from "./charge";
import { owedAfterEnding } from "./ending";
import { isCurrent, lockForMonth } from "./locks";
import { closeAtEnd, finishIfSettled } from "./months";
import { keepsPlace } from "./room";
import { pauseMembership } from "./state";

const months = schema.membershipMonths;

/**
 * Why this member gets no next month, as a reason for the pause (the keys of emails.ts), or null
 * when a renewal is allowed. The caller holds the host's calendar lock and the membership's lock.
 */
async function whyNoRenewal(tx: Tx, membership: Membership): Promise<{ pause: string } | { pricePer15Cents: number; includedMinutes: number; agreementId: string }> {
  if (membership.memberStoppedAt) return { pause: "member" };
  // (A member who said "No thanks" to an offer of less time is stopped with that as the reason.)
  if (membership.hostStoppedAt) return { pause: membership.pausedReason === "offer" ? "offer" : "host" };
  // The host switched her membership off during this month, and the member has not kept theirs since.
  if (membership.offerStoppedAt) return { pause: "offer_off" };
  // An offer of less time that was not accepted before the month ended.
  if (membership.offerId) return { pause: "offer" };
  const [offer] = await tx.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, membership.hostId));
  if (!offer || !offer.on || !membership.ownPricePer15Cents || !membership.ownMinutes || !membership.agreementId) return { pause: "offer_off" };
  if (!(await membershipsOnFor(membership.hostId, tx))) return { pause: "switch" };
  if (!(await keepsPlace(tx, membership))) return { pause: "no_room" };
  // The time the member agreed to, at the lower of two prices: their own, and the membership's member price now.
  return { pricePer15Cents: Math.min(membership.ownPricePer15Cents, offer.pricePer15Cents), includedMinutes: membership.ownMinutes, agreementId: membership.agreementId };
}

/**
 * Closes a month that is past its end, once. Its free money is split as the rulebook says (but a
 * membership ended before the month's end gets it paid back first, so nothing of it expires).
 * Then, only for the month that is its membership's current one: the next month is written down
 * under "renewal:<this month>" and its saved card tried, or the membership is paused.
 */
export async function closeMonth(monthId: string, now: Date = new Date()): Promise<void> {
  const renewalId = await db.transaction(async (tx) => {
    const locked = await lockForMonth(tx, monthId);
    const { membership } = locked;
    if (locked.month.status !== "running" || !locked.month.endsAt || locked.month.endsAt > now) return null;

    await owedAfterEnding(tx, locked);
    const [month] = await tx.select().from(months).where(eq(months.id, monthId));
    const closed = await closeAtEnd(tx, month, now);
    await finishIfSettled(tx, closed, now);

    // A month from before a pause, or of an ended membership, is closed like any other and renews nothing.
    if (!isCurrent(locked) || membership.status !== "active") return null;
    const next = await whyNoRenewal(tx, membership);
    if ("pause" in next) {
      await pauseMembership(tx, membership, next.pause, now);
      return null;
    }
    const renewal = await writeDownMonth(tx, membership, { originKey: `renewal:${monthId}`, ...next, tryNow: true }, now);
    return renewal.id;
  });
  if (renewalId) await tryHold(renewalId, now).catch((error) => console.error(`[membership] the first try for renewal month ${renewalId} did not finish; the helper will retry`, error));
}

/** For the helper: months past their end, and closed months that have nothing left open. */
export async function runClosings(now: Date): Promise<void> {
  const due = await db.select({ id: months.id }).from(months).where(and(eq(months.status, "running"), lte(months.endsAt, now))).orderBy(months.endsAt).limit(50);
  for (const month of due) {
    await closeMonth(month.id, now).catch((error) => console.error(`[membership] could not close month ${month.id}; will retry`, error));
  }
  const settled = await db
    .select({ id: months.id })
    .from(months)
    .where(and(eq(months.status, "closed"), eq(months.freeCents, 0), eq(months.setAsideCents, 0), eq(months.toPayBackCents, 0), inArray(months.dispute, ["none", "won"])))
    .limit(50);
  for (const { id } of settled) {
    await db
      .transaction(async (tx) => {
        const { month } = await lockForMonth(tx, id);
        await finishIfSettled(tx, month, now);
      })
      .catch((error) => console.error(`[membership] could not finish month ${id}; will retry`, error));
  }
}
