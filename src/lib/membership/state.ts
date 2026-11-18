/**
 * What happens to a membership itself: paused, ended, or put back after a card step that was not
 * finished. No Stripe here. Each function runs inside the caller's database step with the
 * membership locked (locks.ts).
 *
 * Paused and ended are two different things and are never mixed (the rulebook's "A paused
 * membership, and resuming"): a paused membership has no month and no payment, and its member can
 * resume by themselves; an ended one is over for good.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@/db";
import type { Membership } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { retireCard } from "./cards";
import { queueEndedEmail, queuePausedEmail } from "./emails";
import { isCurrent, type LockedMonth } from "./locks";

const noOffer = { offerId: null, offerMonthId: null, offeredMinutes: null, offeredAt: null } as const;

/**
 * Pauses a membership: no current month, no stops left, no open offer, and its card is used for
 * nothing new. `reason` is one of the keys in emails.ts. Does nothing for a membership that is
 * already paused or ended. `quiet` is for putting a resuming that was not finished back as it was.
 */
export async function pauseMembership(tx: Tx, membership: Membership, reason: string, now: Date, quiet = false): Promise<void> {
  if (membership.status === "paused" || membership.status === "ended") return;
  const [paused] = await tx
    .update(schema.memberships)
    .set({ status: "paused", pausedAt: now, pausedReason: reason, currentMonthId: null, memberStoppedAt: null, hostStoppedAt: null, ...noOffer, updatedAt: now })
    .where(eq(schema.memberships.id, membership.id))
    .returning();
  await retireCard(tx, membership.id, now);
  if (!quiet) await queuePausedEmail(tx, paused, reason);
}

/**
 * Ends a membership at once and for good. In this one step: it is marked ended with who and why,
 * its clean-up is marked as not done, its card is used for nothing new, and an open month that is
 * not paid yet is marked as being given up, so that no payment and no booking can start any more.
 * The clean-up itself (ending.ts) comes after, and is repeated by the helper until it is done.
 *
 * Called inside the step that saves whatever causes the ending (a block, a paused or closed
 * account, a suspension, a dispute), so the two cannot come apart. Returns false if it was already ended.
 */
export async function endMembership(tx: Tx, membership: Membership, input: { by: string; reason: string }, now: Date): Promise<boolean> {
  if (membership.status === "ended") return false;
  const [ended] = await tx
    .update(schema.memberships)
    .set({ status: "ended", endedAt: now, endedBy: input.by, endedReason: input.reason, cleanupDoneAt: null, currentMonthId: null, memberStoppedAt: null, hostStoppedAt: null, ...noOffer, updatedAt: now })
    .where(eq(schema.memberships.id, membership.id))
    .returning();
  await retireCard(tx, membership.id, now);
  // A month that is not paid for yet is given up; the clean-up cancels its payment or lets its hold go.
  await tx
    .update(schema.membershipMonths)
    .set({ endedHow: "ending", updatedAt: now })
    .where(and(eq(schema.membershipMonths.membershipId, membership.id), inArray(schema.membershipMonths.status, ["to_pay", "held"]), isNull(schema.membershipMonths.endedHow)));
  // Someone who was only invited, or at the card step for the first time, was never a member: nothing to announce.
  if (membership.since) await queueEndedEmail(tx, ended, input.reason);
  return true;
}

/**
 * A month ends without ever becoming money (`how` says why). If it is the membership's current
 * month, the membership is settled: paused, or, when a first joining was not finished, put back to
 * "invited" while the invitation still stands. An old month changes nothing here.
 */
export async function settleAfterGivenUp(tx: Tx, locked: LockedMonth, how: string, now: Date): Promise<void> {
  const { membership } = locked;
  if (!isCurrent(locked) || membership.status === "ended" || membership.status === "paused") return;
  if (how === "ending") return;
  if (membership.status === "joining") {
    // A joining or resuming that did not get its hold is undone, whatever stopped it.
    if (membership.since) {
      // A resuming that was not finished: paused again, as it was.
      await pauseMembership(tx, membership, membership.pausedReason ?? how, now, true);
    } else if (membership.inviteExpiresAt && membership.inviteExpiresAt > now) {
      await tx.update(schema.memberships).set({ status: "invited", currentMonthId: null, updatedAt: now }).where(eq(schema.memberships.id, membership.id));
    } else {
      await endMembership(tx, membership, { by: "connect", reason: "the invitation ran out before joining was finished" }, now);
    }
    return;
  }
  const reason = how === "given_up" || how === "cancelled_at_stripe" ? "payment" : how;
  await pauseMembership(tx, membership, reason, now);
}
