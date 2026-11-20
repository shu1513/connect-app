/**
 * Closing an account, and opening it again.
 */
import { cleanUpEndedMemberships, endMembershipsOf } from "@/lib/membership/state";
import { endContributionsOf, letGoAll } from "@/lib/contributions/ending";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { endWaitingRequestsOf } from "@/lib/booking/bookings";
import { cancelCall } from "@/lib/payments/cancel";
import { removeFromRoom } from "@/lib/video/livekit";
import { deletePhotoInStep, stopTriesInStep } from "./photo-steps";
import { ProfileError } from "./profiles";
import { ownPaymentOn } from "@/lib/payments/own";

/**
 * The founder closes an account: it is logged out everywhere, cannot log in
 * again, and its host profile is suspended. Its waiting requests end, its
 * calls that have not started are cancelled at no charge, and it is put out
 * of any call in progress.
 * Nothing is deleted but their photo (plans/29); records of paid calls must be kept.
 *
 * Returns how many of its calls could not be ended (-1 when its requests or
 * calls could not be dealt with at all), so the founder can be told to check them.
 */
export async function closeAccount(input: { userId: string; by: string }): Promise<{ callsNotEnded: number }> {
  const now = new Date();
  let endedMemberships: string[] = [];
  let givenUpPayments: string[] = [];
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
    // Their memberships, as a host and as a member, end at once and for good, in this same step
    // (after the person and the profile, which is the order of locks everywhere).
    endedMemberships = await endMembershipsOf(tx, input.userId, { by: "connect", reason: "one of the two accounts was closed" }, now);
    // So do their contributions, as a host and as a contributor; what was only held is let go below.
    givenUpPayments = await endContributionsOf(tx, input.userId, "closed", now);
    // Their photo is deleted, and a try at taking one that is under way writes nothing (plans/29). A locked photo is kept.
    await stopTriesInStep(tx, input.userId, now, "the account was closed");
    await deletePhotoInStep(tx, input.userId);
  });
  // The account is closed from here on, whatever happens next. First what keeps people safe (requests and
  // calls), then the money of the memberships that ended with it (the helper repeats that if it does not finish).
  const callsNotEnded = await endRequestsAndCallsOf(input.userId, new Date());
  await cleanUpEndedMemberships(endedMemberships, now);
  await letGoAll(givenUpPayments, now);
  return { callsNotEnded };
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
    .leftJoin(schema.payments, ownPaymentOn(schema.calls.id))
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
      // (A call that was ended with "End call and report" before its start is over already: it cannot be cancelled, and its room is being closed.)
      if (call.startsAt > now && !call.safetyEndedAt) await cancelCall({ call, payment, by: "admin", now });
      else await removeFromRoom(call.roomName, userId);
    } catch (error) {
      // The account is closed or paused either way. The founder is told how many calls need a look.
      notEnded++;
      console.error(`[accounts] could not end call ${call.id} of closed or paused account ${userId}`, error);
    }
  }
  return notEnded;
}

/** How long a pause or a closure is left to finish by itself before the helper looks for what it left. */
const LEFT_ALONE_MS = 2 * 60_000;

/**
 * For the helper, about once a minute. A paused or closed account has no waiting request and no call ahead:
 * pausing and closing end them. They do it after the account is marked, though, and a server that stops in
 * between would leave them there (a customer waiting for a call the paused person may not join). So the helper
 * looks for such leftovers and ends them with the same step. Normally it finds nothing.
 *
 * A call that is under way is found again each time until it ends; putting the person out again is harmless.
 */
export async function finishPausesAndClosures(now: Date): Promise<void> {
  const before = new Date(now.getTime() - LEFT_ALONE_MS);
  // Paused or closed, and not just now: the pause or the closure itself may still be at work.
  const off = or(lt(schema.user.pausedAt, before), lt(schema.user.closedAt, before));
  const withCalls = await db
    .selectDistinct({ id: schema.user.id })
    .from(schema.user)
    .innerJoin(schema.calls, or(eq(schema.calls.hostId, schema.user.id), eq(schema.calls.customerId, schema.user.id)))
    .where(and(off, isNull(schema.calls.cancelledAt), isNull(schema.calls.closedAt), gt(schema.calls.endsAt, now)));
  const withRequests = await db
    .selectDistinct({ id: schema.user.id })
    .from(schema.user)
    .innerJoin(schema.bookings, or(eq(schema.bookings.hostId, schema.user.id), eq(schema.bookings.customerId, schema.user.id)))
    .where(and(off, eq(schema.bookings.stage, "waiting")));
  for (const id of new Set([...withCalls, ...withRequests].map((row) => row.id))) await endRequestsAndCallsOf(id, now);
}

/** Undoes a closure made by mistake. A host profile stays suspended until the founder approves it again. */
export async function reopenAccount(userId: string): Promise<void> {
  await db.update(schema.user).set({ closedAt: null, updatedAt: new Date() }).where(eq(schema.user.id, userId));
}
