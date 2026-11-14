/**
 * Closing an account, and opening it again.
 */
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { endWaitingRequestsOf } from "@/lib/booking/bookings";
import { cancelCall } from "@/lib/payments/cancel";
import { removeFromRoom } from "@/lib/video/livekit";
import { ProfileError } from "./profiles";

/**
 * The founder closes an account: it is logged out everywhere, cannot log in
 * again, and its host profile is suspended. Its waiting requests end, its
 * calls that have not started are cancelled at no charge, and it is put out
 * of any call in progress.
 * Nothing is deleted; records of paid calls must be kept.
 *
 * Returns how many of its calls could not be ended (-1 when its requests or
 * calls could not be dealt with at all), so the founder can be told to check them.
 */
export async function closeAccount(input: { userId: string; by: string }): Promise<{ callsNotEnded: number }> {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [admin] = await tx.select().from(schema.admins).where(eq(schema.admins.userId, input.userId));
    if (admin) throw new ProfileError("An admin account cannot be closed here.");
    const closed = await tx
      .update(schema.user)
      .set({ closedAt: now, updatedAt: now })
      .where(and(eq(schema.user.id, input.userId), isNull(schema.user.closedAt)))
      .returning({ id: schema.user.id });
    if (closed.length === 0) throw new ProfileError("That account was not found, or is already closed.");
    await tx.delete(schema.session).where(eq(schema.session.userId, input.userId));
    await tx
      .update(schema.hostProfiles)
      .set({ status: "suspended", decidedBy: input.by, decidedAt: now, updatedAt: now })
      .where(eq(schema.hostProfiles.userId, input.userId));
  });
  // The account is closed from here on, whatever happens next.
  return { callsNotEnded: await endRequestsAndCallsOf(input.userId, now) };
}

/**
 * Ends the waiting requests and the calls of a person whose account was just closed or paused.
 * The two are tried separately: a problem with the requests must not leave the person in a call.
 * Never throws. Returns how many calls could not be ended, or -1 when the requests or the calls
 * could not be dealt with at all.
 */
export async function endRequestsAndCallsOf(userId: string, now: Date): Promise<number> {
  let requestsEnded = true;
  try {
    await endWaitingRequestsOf(userId, { asHost: true, asCustomer: true }, now);
  } catch (error) {
    requestsEnded = false;
    console.error(`[accounts] could not end the waiting requests of closed or paused account ${userId}`, error);
  }
  try {
    const callsNotEnded = await endCallsOf(userId, now);
    return requestsEnded ? callsNotEnded : -1;
  } catch (error) {
    console.error(`[accounts] could not look up the calls of closed or paused account ${userId}`, error);
    return -1;
  }
}

/**
 * The calls of a person whose account was closed or paused. One that has not started is cancelled for free,
 * so the other person is never charged for it. In one that is under way, the
 * closed person is put out and their entry pass stops working; the call is
 * then settled by the usual rule for the time that counted.
 */
async function endCallsOf(userId: string, now: Date): Promise<number> {
  const open = await db
    .select({ call: schema.calls, payment: schema.payments })
    .from(schema.calls)
    .leftJoin(schema.payments, eq(schema.payments.callId, schema.calls.id))
    .where(
      and(
        or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)),
        isNull(schema.calls.cancelledAt),
        isNull(schema.calls.closedAt),
        gt(schema.calls.endsAt, now),
      ),
    );
  let notEnded = 0;
  for (const { call, payment } of open) {
    try {
      if (call.startsAt > now) await cancelCall({ call, payment, by: "admin", now });
      else await removeFromRoom(call.roomName, userId);
    } catch (error) {
      // The account is closed or paused either way. The founder is told how many calls need a look.
      notEnded++;
      console.error(`[accounts] could not end call ${call.id} of closed or paused account ${userId}`, error);
    }
  }
  return notEnded;
}

/** Undoes a closure made by mistake. A host profile stays suspended until the founder approves it again. */
export async function reopenAccount(userId: string): Promise<void> {
  await db.update(schema.user).set({ closedAt: null, updatedAt: new Date() }).where(eq(schema.user.id, userId));
}
