/**
 * Blocking: one person cuts off another. It ends every request between the
 * two, cancels their future calls with each other for free, and stops new
 * requests either way. The blocked person is not told.
 */
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lockCalendars } from "@/lib/booking/bookings";
import { cancelCall } from "@/lib/payments/cancel";

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
  await db.transaction(async (tx) => {
    await lockCalendars(tx, [blockerId, blockedId]);
    await tx.insert(schema.blocks).values({ blockerId, blockedId }).onConflictDoNothing();
    // Requests between the two end quietly, whichever way round they were.
    const ended = await tx
      .update(schema.bookings)
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
  });

  // Future calls between the two are cancelled for free. (Settlement and the room are handled as usual.)
  const upcoming = await db
    .select({ call: schema.calls, payment: schema.payments })
    .from(schema.calls)
    .leftJoin(schema.payments, eq(schema.payments.callId, schema.calls.id))
    .where(
      and(
        or(
          and(eq(schema.calls.hostId, blockerId), eq(schema.calls.customerId, blockedId)),
          and(eq(schema.calls.hostId, blockedId), eq(schema.calls.customerId, blockerId)),
        ),
        isNull(schema.calls.cancelledAt),
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
