/**
 * What happens to a membership itself: paused, ended, or put back after a card step that was not
 * finished. No Stripe here. Each function runs inside the caller's database step with the
 * membership locked (locks.ts).
 *
 * Paused and ended are two different things and are never mixed (the rulebook's "A paused
 * membership, and resuming"): a paused membership has no month and no payment, and its member can
 * resume by themselves; an ended one is over for good.
 */
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { schema } from "@/db";
import type { Membership } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { retireCard } from "./cards";
import { ACCOUNT_PAUSE, queueEndedEmail, queuePausedEmail } from "./emails";
import { isCurrent, lockMembership, type LockedMonth } from "./locks";

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
    .set({ status: "paused", pausedAt: now, pausedReason: reason, currentMonthId: null, memberStoppedAt: null, hostStoppedAt: null, offerStoppedAt: null, ...noOffer, updatedAt: now })
    .where(eq(schema.memberships.id, membership.id))
    .returning();
  await retireCard(tx, membership.id, now);
  if (!quiet) await queuePausedEmail(tx, paused, reason);
}

/**
 * One of the membership's two accounts was paused (plans/53): the membership is paused, not ended.
 * In this one step: it is paused with that reason, its clean-up is marked as not done, its card
 * is used for nothing new, and a month that is not paid yet is marked as being given up, so that
 * no payment and no booking can start any more. The clean-up (ending.ts) comes after, exactly as
 * after an ending: the hold is let go, coming member calls are cancelled, and the unused time of
 * a month that was paid for is paid back.
 *
 * Where nobody is a member yet (an open invitation, a first joining that never got its payment)
 * there is nothing to keep: that ends, as it always did. Returns what was done, or null for a
 * membership that was paused or ended already.
 */
export async function pauseForAccount(tx: Tx, membership: Membership, now: Date): Promise<"paused" | "ended" | null> {
  if (membership.status === "ended" || membership.status === "paused") return null;
  if (!membership.since) return (await endMembership(tx, membership, { by: "connect", reason: "one of the two accounts was paused" }, now)) ? "ended" : null;
  const [paused] = await tx
    .update(schema.memberships)
    .set({ status: "paused", pausedAt: now, pausedReason: ACCOUNT_PAUSE, cleanupDoneAt: null, currentMonthId: null, memberStoppedAt: null, hostStoppedAt: null, offerStoppedAt: null, ...noOffer, updatedAt: now })
    .where(eq(schema.memberships.id, membership.id))
    .returning();
  await retireCard(tx, membership.id, now);
  await tx
    .update(schema.membershipMonths)
    .set({ endedHow: "account_paused", updatedAt: now })
    .where(and(eq(schema.membershipMonths.membershipId, membership.id), inArray(schema.membershipMonths.status, ["to_pay", "held"]), isNull(schema.membershipMonths.endedHow)));
  await queuePausedEmail(tx, paused, ACCOUNT_PAUSE);
  return "paused";
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
export async function endMembership(tx: Tx, membership: Membership, input: { by: string; reason: string; /** More for the member's email alone: a cancellation within 14 days says what goes back and what stays paid for. */ memberNote?: string }, now: Date): Promise<boolean> {
  if (membership.status === "ended") return false;
  const [ended] = await tx
    .update(schema.memberships)
    .set({ status: "ended", endedAt: now, endedBy: input.by, endedReason: input.reason, cleanupDoneAt: null, currentMonthId: null, memberStoppedAt: null, hostStoppedAt: null, offerStoppedAt: null, ...noOffer, updatedAt: now })
    .where(eq(schema.memberships.id, membership.id))
    .returning();
  await retireCard(tx, membership.id, now);
  // A month that is not paid for yet is given up; the clean-up cancels its payment or lets its hold go.
  await tx
    .update(schema.membershipMonths)
    .set({ endedHow: "ending", updatedAt: now })
    .where(and(eq(schema.membershipMonths.membershipId, membership.id), inArray(schema.membershipMonths.status, ["to_pay", "held"]), isNull(schema.membershipMonths.endedHow)));
  // Someone who was only invited, or at the card step for the first time, was never a member: nothing to announce.
  if (membership.since) await queueEndedEmail(tx, ended, input.reason, input.memberNote);
  return true;
}

/**
 * A month ends without ever becoming money (`how` says why). If it is the membership's current
 * month, the membership is settled: paused, or, when a first joining was not finished, put back to
 * "invited" while the invitation still stands. An old month changes nothing here.
 */
export async function settleAfterGivenUp(tx: Tx, locked: LockedMonth, how: string, now: Date, why?: string): Promise<void> {
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
      // The invitation stands again, so its own line says "open" again (it said "accepted" from the moment "Join" was pressed).
      if (membership.inviteId) await tx.update(schema.membershipInvitations).set({ outcome: "open" }).where(and(eq(schema.membershipInvitations.inviteId, membership.inviteId), eq(schema.membershipInvitations.outcome, "accepted")));
    } else {
      await endMembership(tx, membership, { by: "connect", reason: "the invitation ran out before joining was finished" }, now);
    }
    return;
  }
  // `why` is the reason the member is told when it is not the payment itself (the host paused them, or switched her membership off).
  const reason = why ?? (how === "given_up" || how === "cancelled_at_stripe" ? "payment" : how);
  await pauseMembership(tx, membership, reason, now);
}

/** Ends these memberships: all of them locked first, in id order, and only then their months (plans/20, "The order of locks"). Returns the ones that were ended. */
async function endAll(tx: Tx, ids: string[], input: { by: string; reason: string }, now: Date): Promise<string[]> {
  const locked: Membership[] = [];
  for (const id of [...ids].sort()) locked.push(await lockMembership(tx, id));
  // The moment of the ending is taken now that the locks are held, not from before the wait for them: whether a
  // month's unused money is paid back or has expired depends on which side of the month's end the ending falls.
  const at = new Date(Math.max(now.getTime(), Date.now()));
  const ended: string[] = [];
  for (const membership of locked) if (await endMembership(tx, membership, input, at)) ended.push(membership.id);
  return ended;
}

/**
 * Ends every live membership between a host and a customer (there is at most one), inside the
 * step that saves whatever causes it: a block. The caller holds both calendar locks.
 */
export async function endMembershipsBetween(tx: Tx, a: string, b: string, input: { by: string; reason: string }, now: Date): Promise<string[]> {
  const live = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(ne(schema.memberships.status, "ended"), inArray(schema.memberships.hostId, [a, b]), inArray(schema.memberships.customerId, [a, b])));
  return endAll(tx, live.map((row) => row.id), input, now);
}

/**
 * Ends every live membership a person has, as a host and as a member, inside the step that saves
 * whatever causes it: their account paused or closed. `asHostOnly` is for a suspended host, whose
 * own memberships with other hosts go on.
 */
export async function endMembershipsOf(tx: Tx, userId: string, input: { by: string; reason: string; asHostOnly?: boolean }, now: Date): Promise<string[]> {
  const mine = input.asHostOnly ? eq(schema.memberships.hostId, userId) : or(eq(schema.memberships.hostId, userId), eq(schema.memberships.customerId, userId));
  const live = await tx.select({ id: schema.memberships.id }).from(schema.memberships).where(and(ne(schema.memberships.status, "ended"), mine));
  return endAll(tx, live.map((row) => row.id), input, now);
}

/**
 * Pauses every live membership a person has, as a host and as a member, inside the step that
 * pauses their account (plans/53). All of them locked first, in id order, as an ending does it.
 * Returns the ones that were paused or (where nobody was a member yet) ended: their clean-up is
 * the same.
 */
export async function pauseMembershipsOf(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const live = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(ne(schema.memberships.status, "ended"), or(eq(schema.memberships.hostId, userId), eq(schema.memberships.customerId, userId))));
  const locked: Membership[] = [];
  for (const id of live.map((row) => row.id).sort()) locked.push(await lockMembership(tx, id));
  // The moment is taken now that the locks are held: whether a month's unused money is paid back depends on which side of the month's end it falls.
  const at = new Date(Math.max(now.getTime(), Date.now()));
  const changed: string[] = [];
  for (const membership of locked) if (await pauseForAccount(tx, membership, at)) changed.push(membership.id);
  return changed;
}

/**
 * Runs the clean-up of the memberships a step has just ended (or paused with an account), and of those only. Never throws: the
 * ending is already saved, and the helper repeats the clean-up until it is done.
 */
export async function cleanUpEndedMemberships(membershipIds: string[], now: Date): Promise<void> {
  if (membershipIds.length === 0) return;
  // Loaded here, not at the top: the clean-up talks to Stripe, and this file must stay free of that.
  const ending = await import("./ending").catch(() => null);
  for (const id of membershipIds) {
    // One that fails is left to the helper; the others are still done now.
    await ending?.cleanUpEnding(id, new Date(Math.max(now.getTime(), Date.now()))).catch((error) => console.error(`[membership] the clean-up of ended membership ${id} did not finish; the helper will retry`, error));
  }
}
