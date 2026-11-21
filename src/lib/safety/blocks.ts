/**
 * Blocking: one person cuts off another. It ends every request between the
 * two, cancels their future calls with each other for free, and stops new
 * requests either way. The blocked person is not told.
 */
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lockCalendars } from "@/lib/booking/bookings";
import { cancelCall } from "@/lib/payments/cancel";
import { ownPaymentOn } from "@/lib/payments/own";
import { cleanUpEndedMemberships, endMembershipsBetween } from "@/lib/membership/state";
import { endContributionsBetween, letGoAll } from "@/lib/contributions/ending";
import { endFollowInBlock } from "@/lib/follows/follows";

export class BlockError extends Error {}

/** Returns how many future calls between the two could not be cancelled yet (the helper keeps trying through the usual settlement). */
export async function block(input: { blockerId: string; blockedId: string; now: Date }): Promise<{ callsNotCancelled: number }> {
  const { blockerId, blockedId, now } = input;
  if (blockerId === blockedId) throw new BlockError("You cannot block yourself.");
  const [other] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, blockedId));
  if (!other) throw new BlockError("Person not found.");

  const pair = or(
    and(eq(schema.bookings.hostId, blockerId), eq(schema.bookings.customerId, blockedId)),
    and(eq(schema.bookings.hostId, blockedId), eq(schema.bookings.customerId, blockerId)),
  );
  let endedMemberships: string[] = [];
  let givenUpPayments: string[] = [];
  await db.transaction(async (tx) => {
    await lockCalendars(tx, [blockerId, blockedId]);
    await tx.insert(schema.blocks).values({ blockerId, blockedId }).onConflictDoNothing();
    // A membership between the two ends at once and for good, in this same step. Its clean-up follows below.
    endedMemberships = await endMembershipsBetween(tx, blockerId, blockedId, { by: "connect", reason: "it can no longer go on" }, now);
    // So does every contribution between the two, whichever of them is the host; what was only held is let go below.
    givenUpPayments = await endContributionsBetween(tx, blockerId, blockedId, "blocked", now);
    // Requests between the two end quietly, whichever way round they were.
    const ended = await tx
      .update(schema.bookings)
      // (These very words are what the request's page goes by to say "this request has ended": COULD_NOT_GO_AHEAD in booking/request-words.ts.)
      .set({ stage: "ran_out", endedReason: "the request could not go ahead", endedAt: now })
      .where(and(pair, inArray(schema.bookings.stage, ["card", "waiting"])))
      .returning({ id: schema.bookings.id });
    if (ended.length > 0) {
      await tx.delete(schema.busyEntries).where(
        inArray(
          schema.busyEntries.bookingId,
          ended.map((b) => b.id),
        ),
      );
    }
    // The blocker no longer follows the blocked person (plans/30). The other direction is left as it is: removing it
    // would tell them. Last in this step, because it takes the followers' locks, after which no other lock is taken.
    await endFollowInBlock(tx, blockerId, blockedId, now);
  });

  // Future calls between the two are cancelled for free. (Settlement and the room are handled as usual.)
  const upcoming = await db
    .select({ call: schema.calls, payment: schema.payments })
    .from(schema.calls)
    .leftJoin(schema.payments, ownPaymentOn(schema.calls.id))
    .where(
      and(
        or(
          and(eq(schema.calls.hostId, blockerId), eq(schema.calls.customerId, blockedId)),
          and(eq(schema.calls.hostId, blockedId), eq(schema.calls.customerId, blockerId)),
        ),
        isNull(schema.calls.cancelledAt),
        // A call that was ended with "End call and report" is over and cannot be cancelled; its money waits for the founder.
        isNull(schema.calls.safetyEndedAt),
        gt(schema.calls.startsAt, now),
      ),
    );
  let callsNotCancelled = 0;
  for (const { call, payment } of upcoming) {
    await cancelCall({ call, payment, by: "admin", now }).catch((error) => {
      callsNotCancelled++;
      console.error(`[safety] could not cancel call ${call.id} after a block`, error);
    });
  }
  // Last, the money of a membership that ended with the block (the helper repeats this if it does not finish).
  await cleanUpEndedMemberships(endedMemberships, now);
  // And the holds of the contributions that ended with it (the helper repeats this too).
  await letGoAll(givenUpPayments, now);
  return { callsNotCancelled };
}

/** Allows new requests again. It does not bring back what the block ended. */
export async function unblock(blockerId: string, blockedId: string): Promise<void> {
  await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, blockerId), eq(schema.blocks.blockedId, blockedId)));
}

/**
 * The people this person has blocked, for their account page. Each under the name this person knew
 * them by: someone they asked for a call, or whose host page they reported, by their host display
 * name (never the host's account name); anyone else by their own name.
 */
export async function blockedBy(blockerId: string) {
  const knownAsHost = sql<boolean>`(
    exists (select 1 from ${schema.bookings} b where b.host_id = ${schema.blocks.blockedId} and b.customer_id = ${blockerId})
    or exists (select 1 from ${schema.reports} r where r.reporter_id = ${blockerId} and r.reported_id = ${schema.blocks.blockedId} and r.context = 'profile')
  )`;
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name, displayName: schema.hostProfiles.displayName, knownAsHost, since: schema.blocks.createdAt })
    .from(schema.blocks)
    .innerJoin(schema.user, eq(schema.user.id, schema.blocks.blockedId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.blocks.blockedId))
    .where(eq(schema.blocks.blockerId, blockerId));
  return rows.map((row) => ({ id: row.id, name: row.knownAsHost && row.displayName ? row.displayName : row.name, since: row.since }));
}
