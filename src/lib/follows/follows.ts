/**
 * Following a host (plans/30): following and unfollowing, the list "Hosts you follow", and the
 * follow that comes by itself after a call that really took place.
 *
 * Only the follower ever reads their own lines. Nothing here tells a host who follows them, or
 * how many do.
 *
 * One lock, taken last: everything that writes a person's follows first takes the lock named
 * after the follower (`lockFollowers`). A block takes the locks of both people. So the limit
 * holds, and a block and an automatic follow can never pass each other. No step takes another
 * lock after it.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadAttendance } from "@/lib/attendance/load";
import { instantOffer } from "@/lib/booking/bookings";
import { isAvailableNow } from "@/lib/booking/now-rules";
import { SETTLE_SECONDS } from "@/lib/calls";
import { publicProfile } from "@/lib/profiles/profiles";
import { FOLLOW, followsAfterCall, inListOrder } from "./rules";

/** A problem the person can understand. Its message is safe to show them. */
export class FollowError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const DAY = 24 * 3_600_000;

/** The lock every write of these people's follows waits for. Always in the same order, and always the last lock of a step. */
export async function lockFollowers(tx: Tx, followerIds: string[]): Promise<void> {
  for (const id of [...new Set(followerIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`follows:${id}`}))`);
  }
}

/** How many hosts are on this person's list: follows that have not ended, of hosts whose account is open. */
async function listed(reader: Reader, followerId: string): Promise<number> {
  const [row] = await reader
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.follows)
    .innerJoin(schema.user, eq(schema.user.id, schema.follows.hostId))
    .where(and(eq(schema.follows.followerId, followerId), isNull(schema.follows.unfollowedAt), isNull(schema.user.closedAt)));
  return row?.n ?? 0;
}

const pair = (followerId: string, hostId: string) => and(eq(schema.follows.followerId, followerId), eq(schema.follows.hostId, hostId));

/**
 * A person follows the host whose page has this handle. The page must be open to everyone, so a
 * page that cannot be opened and one that does not exist give the same answer. Someone the host
 * has blocked can follow like anyone else: it stays quiet (see `followedHosts`), because a
 * refusal would tell them.
 */
export async function follow(input: { followerId: string; handle: string; now: Date }): Promise<{ hostId: string; displayName: string }> {
  const { followerId, now } = input;
  const profile = await publicProfile(input.handle);
  if (!profile) throw new FollowError("That page cannot be followed at the moment.");
  if (profile.userId === followerId) throw new FollowError("You cannot follow yourself.");
  await db.transaction(async (tx) => {
    await lockFollowers(tx, [followerId]);
    const [me] = await tx.select({ closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt }).from(schema.user).where(eq(schema.user.id, followerId));
    if (!me || me.closedAt || me.pausedAt) throw new FollowError("Your account cannot follow anyone at the moment.");
    // Only their own block stands in the way: they chose to cut contact.
    const [mine] = await tx
      .select({ blockerId: schema.blocks.blockerId })
      .from(schema.blocks)
      .where(and(eq(schema.blocks.blockerId, followerId), eq(schema.blocks.blockedId, profile.userId)));
    if (mine) throw new FollowError("You have blocked this person. To follow them, unblock them on your account page first.");
    const [line] = await tx.select().from(schema.follows).where(pair(followerId, profile.userId));
    if (line && !line.unfollowedAt) return;
    if ((await listed(tx, followerId)) >= FOLLOW.limit) throw new FollowError(`You can follow at most ${FOLLOW.limit} hosts. Unfollow one first.`);
    await tx
      .insert(schema.follows)
      .values({ followerId, hostId: profile.userId, how: "self", createdAt: now })
      .onConflictDoUpdate({ target: [schema.follows.followerId, schema.follows.hostId], set: { unfollowedAt: null, how: "self", callId: null, createdAt: now } });
  });
  return { hostId: profile.userId, displayName: profile.displayName };
}

/**
 * Ends a person's own follow of a host. With no line yet, it writes one that is ended from the
 * start ("Don't follow", said after a call before the automatic follow exists), so that no call
 * ever follows this host for them. Only for someone who has a host profile; anything else is
 * quietly nothing.
 */
export async function unfollow(input: { followerId: string; hostId: string; now: Date }): Promise<void> {
  const { followerId, hostId, now } = input;
  if (followerId === hostId) return;
  await db.transaction(async (tx) => {
    await lockFollowers(tx, [followerId]);
    const [line] = await tx.select().from(schema.follows).where(pair(followerId, hostId));
    if (line) {
      if (!line.unfollowedAt) await tx.update(schema.follows).set({ unfollowedAt: now }).where(pair(followerId, hostId));
      return;
    }
    const [host] = await tx.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
    if (!host) return;
    await tx.insert(schema.follows).values({ followerId, hostId, how: "self", createdAt: now, unfollowedAt: now }).onConflictDoNothing();
  });
}

/** Where this person stands with this host: "following", "ended" (they said no), or "none". Only ever asked about oneself. */
export async function followingOf(followerId: string, hostId: string): Promise<"following" | "ended" | "none"> {
  const [line] = await db.select({ unfollowedAt: schema.follows.unfollowedAt }).from(schema.follows).where(pair(followerId, hostId));
  return !line ? "none" : line.unfollowedAt ? "ended" : "following";
}

/** Whether this person has themselves blocked the other. Their own block is the only one that takes the Follow button away. */
export async function hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const [mine] = await db.select({ blockerId: schema.blocks.blockerId }).from(schema.blocks).where(and(eq(schema.blocks.blockerId, blockerId), eq(schema.blocks.blockedId, blockedId)));
  return Boolean(mine);
}

/** Inside a block's own step, after its other locks: the blocker's follow of the blocked person ends, for good. */
export async function endFollowInBlock(tx: Tx, blockerId: string, blockedId: string, now: Date): Promise<void> {
  // Both people's locks: either may be the follower in something that is being written at this moment.
  await lockFollowers(tx, [blockerId, blockedId]);
  await tx.update(schema.follows).set({ unfollowedAt: now }).where(and(pair(blockerId, blockedId), isNull(schema.follows.unfollowedAt)));
}

export type FollowedHost = {
  hostId: string;
  name: string;
  /** Their page, while it is open to everyone. Null for a host who is hidden or suspended: listed by name only. */
  handle: string | null;
  /** Their own page would show "Available now" at this moment, and nobody has blocked anybody. */
  available: boolean;
  /** This person's next call with them, in either role. */
  nextCall: { id: string; startsAt: Date } | null;
};

/**
 * "Hosts you follow", in the order of the list. A host whose page is not open stays, by name
 * and without a link, so they can be taken off; a host whose account is closed is left out.
 * A host who has blocked this person stays exactly as they were and is never available.
 */
export async function followedHosts(userId: string, now: Date): Promise<FollowedHost[]> {
  const lines = await db
    .select({
      hostId: schema.follows.hostId,
      displayName: schema.hostProfiles.displayName,
      handle: schema.hostProfiles.handle,
      status: schema.hostProfiles.status,
      hidden: schema.hostProfiles.hidden,
    })
    .from(schema.follows)
    .innerJoin(schema.user, eq(schema.user.id, schema.follows.hostId))
    .innerJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.follows.hostId))
    .where(and(eq(schema.follows.followerId, userId), isNull(schema.follows.unfollowedAt), isNull(schema.user.closedAt)));
  if (lines.length === 0) return [];
  const ids = lines.map((line) => line.hostId);
  const open = new Set(lines.filter((line) => line.status === "approved" && !line.hidden).map((line) => line.hostId));

  const [blocks, calendars, calls] = await Promise.all([
    db
      .select({ blockerId: schema.blocks.blockerId, blockedId: schema.blocks.blockedId })
      .from(schema.blocks)
      .where(or(and(eq(schema.blocks.blockerId, userId), inArray(schema.blocks.blockedId, ids)), and(eq(schema.blocks.blockedId, userId), inArray(schema.blocks.blockerId, ids)))),
    // Only the few who say "available" at this moment are asked the full question below.
    db
      .select({ userId: schema.hostCalendars.userId, availableUntil: schema.hostCalendars.availableUntil, availableSeenAt: schema.hostCalendars.availableSeenAt })
      .from(schema.hostCalendars)
      .where(and(inArray(schema.hostCalendars.userId, ids), gt(schema.hostCalendars.availableUntil, now))),
    db
      .select({ id: schema.calls.id, hostId: schema.calls.hostId, customerId: schema.calls.customerId, startsAt: schema.calls.startsAt })
      .from(schema.calls)
      .where(
        and(
          or(and(eq(schema.calls.customerId, userId), inArray(schema.calls.hostId, ids)), and(eq(schema.calls.hostId, userId), inArray(schema.calls.customerId, ids))),
          isNull(schema.calls.cancelledAt),
          isNull(schema.calls.safetyEndedAt),
          gt(schema.calls.endsAt, now),
        ),
      )
      .orderBy(asc(schema.calls.startsAt)),
  ]);
  const blocked = new Set(blocks.map((block) => (block.blockerId === userId ? block.blockedId : block.blockerId)));
  const maybe = calendars.filter((calendar) => open.has(calendar.userId) && !blocked.has(calendar.userId) && isAvailableNow(calendar, now)).map((calendar) => calendar.userId);
  // The question the host's own page asks: there, with room for another request, and a length that fits.
  const available = new Set<string>();
  for (const hostId of maybe) if (await instantOffer(hostId, now)) available.add(hostId);
  const nextCall = new Map<string, { id: string; startsAt: Date }>();
  for (const call of calls) {
    const other = call.hostId === userId ? call.customerId : call.hostId;
    if (!nextCall.has(other)) nextCall.set(other, { id: call.id, startsAt: call.startsAt });
  }

  return inListOrder(
    lines.map((line) => ({
      hostId: line.hostId,
      name: line.displayName,
      handle: open.has(line.hostId) ? line.handle : null,
      available: available.has(line.hostId),
      nextCall: nextCall.get(line.hostId) ?? null,
      nextCallAt: nextCall.get(line.hostId)?.startsAt ?? null,
    })),
  ).map(({ hostId, name, handle, available, nextCall }) => ({ hostId, name, handle, available, nextCall }));
}

/** Whether this person follows anyone at all (for the pages that only then keep themselves fresh). */
export async function followsAnyone(userId: string): Promise<boolean> {
  const [line] = await db.select({ hostId: schema.follows.hostId }).from(schema.follows).where(and(eq(schema.follows.followerId, userId), isNull(schema.follows.unfollowedAt))).limit(1);
  return Boolean(line);
}

// ---------------------------------------------------------------------------
// The follow that comes by itself after a call
// ---------------------------------------------------------------------------

/**
 * Decides one call, in one step with the call's line locked: whether the customer follows the
 * host from it. Returns "follows" or "no" once decided, and "later" when it could not be yet
 * (another helper has the call, or its record is not final).
 */
async function decide(callId: string, now: Date): Promise<"follows" | "no" | "later"> {
  return db.transaction(async (tx) => {
    const [call] = await tx
      .select()
      .from(schema.calls)
      .where(and(eq(schema.calls.id, callId), isNull(schema.calls.followCheckedAt), isNotNull(schema.calls.closedAt)))
      .for("update", { skipLocked: true });
    if (!call) return "later";
    // The record the charge uses, read inside this step.
    const attendance = await loadAttendance(call, now, undefined, tx);
    if (!attendance.final) return "later";

    await lockFollowers(tx, [call.customerId]);
    const [booking] = await tx.select({ source: schema.bookings.source }).from(schema.bookings).where(eq(schema.bookings.callId, call.id));
    // Only the customer's own report and block count. The host's do not: leaving the follow out would tell the customer.
    const report = await tx.select({ id: schema.reports.id }).from(schema.reports).where(and(eq(schema.reports.reporterId, call.customerId), eq(schema.reports.reportedId, call.hostId))).limit(1);
    const block = await tx.select({ blockerId: schema.blocks.blockerId }).from(schema.blocks).where(and(eq(schema.blocks.blockerId, call.customerId), eq(schema.blocks.blockedId, call.hostId))).limit(1);
    const refund = await tx.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id)).limit(1);
    const people = await tx.select({ id: schema.user.id, closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt }).from(schema.user).where(inArray(schema.user.id, [call.hostId, call.customerId]));
    const [profile] = await tx.select({ status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId));
    const [line] = await tx.select({ hostId: schema.follows.hostId }).from(schema.follows).where(pair(call.customerId, call.hostId));

    const yes = followsAfterCall({
      source: booking?.source ?? null,
      cancelled: Boolean(call.cancelledAt),
      safetyEnded: Boolean(call.safetyEndedAt),
      recordComplete: attendance.result.status === "complete",
      togetherSeconds: attendance.result.totals?.togetherSeconds ?? null,
      customerReported: report.length > 0,
      customerBlocked: block.length > 0,
      refundAsked: refund.length > 0,
      hostPageOpen: profile?.status === "approved" && profile.hidden === false,
      eitherClosedOrPaused: people.length < 2 || people.some((person) => person.closedAt || person.pausedAt),
      hasLine: Boolean(line),
      following: await listed(tx, call.customerId),
    });
    // Never over a line that is there: the conflict rule is the last guard, the lock is the first.
    if (yes) await tx.insert(schema.follows).values({ followerId: call.customerId, hostId: call.hostId, how: "call", callId: call.id, createdAt: now }).onConflictDoNothing();
    await tx.update(schema.calls).set({ followCheckedAt: now }).where(eq(schema.calls.id, call.id));
    return yes ? "follows" : "no";
  });
}

/**
 * The helper's job: decides, once per call, whether the customer follows the host after it.
 * Takes the calls whose room is confirmed closed and whose record can be final by now, the
 * oldest first. `onlyCalls` is for the check script, so it never decides anyone else's calls.
 * Returns how many follows began.
 */
export async function followAfterCalls(now: Date, onlyCalls?: string[]): Promise<number> {
  if (onlyCalls && onlyCalls.length === 0) return 0;
  // A record is final two minutes after the room closed (and never before the booked end).
  const settled = new Date(now.getTime() - SETTLE_SECONDS * 1000);
  const due = await db
    .select({ id: schema.calls.id })
    .from(schema.calls)
    .where(
      and(
        isNull(schema.calls.followCheckedAt),
        isNotNull(schema.calls.closedAt),
        lte(schema.calls.closedAt, settled),
        lte(schema.calls.endsAt, settled),
        gt(schema.calls.endsAt, new Date(now.getTime() - FOLLOW.lookBackDays * DAY)),
        onlyCalls ? inArray(schema.calls.id, onlyCalls) : undefined,
      ),
    )
    .orderBy(asc(schema.calls.endsAt))
    .limit(FOLLOW.perRound);
  let began = 0;
  for (const { id } of due) {
    if ((await decide(id, now)) === "follows") began++;
  }
  return began;
}

/**
 * For the results page of a call: whether the automatic follow is still to be decided for it,
 * and could be a yes as far as the call itself goes. Only then is "Don't follow" offered.
 */
export function followStillToCome(call: { followCheckedAt: Date | null; cancelledAt: Date | null; safetyEndedAt: Date | null; startsAt: Date; endsAt: Date }, source: string | null, now: Date): boolean {
  // Not before the call has begun: there is nothing to say no to yet.
  if (call.followCheckedAt || call.cancelledAt || call.safetyEndedAt || call.startsAt > now) return false;
  if (source !== "customer" && source !== "now" && source !== "member") return false;
  return call.endsAt.getTime() > now.getTime() - FOLLOW.lookBackDays * DAY;
}
