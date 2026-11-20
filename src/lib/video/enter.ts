/**
 * The join check: the one place that hands out an entry pass to a call's room. Used by the
 * website's address (/api/calls/[id]/token) and by the phone app's
 * (plans/45-phone-apps/09-the-call.md), so the two can never differ in who may enter.
 */
import "server-only";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { canJoin, roomState } from "@/lib/calls";
import { callForParticipant } from "@/lib/payments/access";
import { paymentBlocksJoin } from "@/lib/payments/rules";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { switches } from "@/lib/safety/switches";
import { createEntryPass, removeFromRoom, videoServerUrl } from "./livekit";

/**
 * With short breaks between calls, the room of the next call opens while the
 * previous one may still be going. Nobody should be on camera in two calls at
 * once, so entering one room takes the person out of every other room they
 * could still be in: any call of theirs whose room has opened and is not yet
 * confirmed closed, including one that was cancelled or has just run out.
 * Throws if the video service cannot confirm it.
 */
async function leaveOtherCalls(reader: Pick<typeof db, "select">, userId: string, thisCallId: string, now: Date): Promise<void> {
  // Read with the join step's own connection: a second one, asked for while the step holds its locks, could
  // leave many joins at once waiting for each other.
  const others = await reader
    .select()
    .from(schema.calls)
    .where(and(or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)), ne(schema.calls.id, thisCallId), isNull(schema.calls.closedAt)));
  for (const other of others) {
    if (roomState(other, now) === "not_open_yet") continue;
    await removeFromRoom(other.roomName, userId);
  }
}

const PAUSED = "Your account is paused, so you cannot join calls.";

const MESSAGES = {
  not_open_yet: "This room is not open yet.",
  closed: "This call has ended.",
  not_paid: "This call has not been paid for yet.",
  hold_ended: "The payment hold for this call is no longer valid.",
} as const;

export type EntryPass = {
  token: string;
  serverUrl: string;
  role: "host" | "customer";
  /** The call's end as it is now (time may have been added). */
  endsAt: string;
  /** The server's clock, read just before the answer is sent. */
  serverNow: string;
};

/**
 * Why no pass was handed out, with the website's status and sentence.
 * `why`: "not_found" (no such call, or not this person's: the same answer), "paused" (the account),
 * "signed_out" (the account was closed a moment ago), "switched_off" (calls are paused across
 * Connect), "not_now" (cancelled, over, not open yet, not paid, a blocked pair), "failed" (the
 * video service could not be reached: nothing is decided).
 */
export type EntryRefused = { refused: { status: 401 | 403 | 404 | 409 | 503; message: string; why: "not_found" | "paused" | "signed_out" | "switched_off" | "not_now" | "failed" } };

const no = (status: 401 | 403 | 404 | 409 | 503, why: EntryRefused["refused"]["why"], message: string): EntryRefused => ({ refused: { status, message, why } });

/**
 * Hands out an entry pass only to a person who is on this call, only while the room is open, and
 * for a paid call only while the money is held. Entering takes the person out of any other room first.
 */
export async function enterCall(user: { id: string; name: string; paused: boolean }, callId: string): Promise<EntryPass | EntryRefused> {
  const access = await callForParticipant(callId, user.id);
  // A stranger gets the same answer whether or not the call exists.
  if (!access) return no(404, "not_found", "Call not found.");
  const { call, payment } = access;

  if (call.cancelledAt) return no(409, "not_now", "This call was cancelled.");
  if (call.safetyEndedAt) return no(409, "not_now", MESSAGES.closed);
  if (user.paused) return no(403, "paused", PAUSED);
  if ((await switches()).joiningOff) return no(503, "switched_off", "Calls are paused across Connect right now. Please try again shortly.");
  if (await isBlockedEitherWay(call.hostId, call.customerId)) return no(409, "not_now", MESSAGES.closed);

  const now = new Date();
  const decision = canJoin(call, user.id, now);
  if (!decision.allowed) {
    if (decision.reason === "not_on_call") return no(404, "not_found", "Call not found.");
    return no(409, "not_now", MESSAGES[decision.reason]);
  }

  // The call's own hold is compared with the stretch it pays for, not with the call's end: the end
  // moves when time is added, and that extra time has a hold of its own (checked when the host accepted).
  const blocked = paymentBlocksJoin({ payment, callEndsAt: payment?.coversUntil ?? call.endsAt, now });
  if (blocked) return no(409, "not_now", MESSAGES[blocked]);

  // The name the other person sees on the video: a host's display name, as on their page, not their account name.
  const [hostProfile] = decision.role === "host" ? await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id)) : [];
  const shownName = hostProfile?.displayName ?? user.name;

  // One call at a time. Taking the person out of other rooms and handing out this pass happen one
  // after the other per person (also across servers), so two joins at once cannot both get through.
  let token: string;
  let endsAt = call.endsAt;
  try {
    token = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`join:${user.id}`}))`);
      // The person again, holding their own line: pausing or closing an account writes that line, so the two wait
      // for each other. Either this pass is handed out first, and the pause that follows makes it stop working
      // when it puts the person out of their calls; or the pause is first, and no pass is handed out.
      const [me] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, user.id)).for("share");
      if (!me || me.closedAt) throw new Error("closed");
      if (me.pausedAt) throw new Error("paused");
      // A first look at this call before anyone is taken out of another room: if it was stopped or cancelled, or
      // its time ran out, while this step waited its turn, the person stays where they are. (The look that counts
      // comes below, with the call held.)
      const [early] = await tx.select({ safetyEndedAt: schema.calls.safetyEndedAt, cancelledAt: schema.calls.cancelledAt, startsAt: schema.calls.startsAt, endsAt: schema.calls.endsAt }).from(schema.calls).where(eq(schema.calls.id, call.id));
      if (!early || early.safetyEndedAt || early.cancelledAt || roomState(early, new Date()) !== "open") throw new Error("ended");
      await leaveOtherCalls(tx, user.id, call.id, now);
      // Waiting for the lock and stepping out of other rooms takes time. So the call is read only now, and held
      // as it is until the pass is made (nothing can stop it, cancel it or move its end in between): it may have
      // been stopped or cancelled a moment ago, its time may have run out, or time may have been added to it.
      const [fresh] = await tx
        .select({ safetyEndedAt: schema.calls.safetyEndedAt, cancelledAt: schema.calls.cancelledAt, startsAt: schema.calls.startsAt, endsAt: schema.calls.endsAt })
        .from(schema.calls)
        .where(eq(schema.calls.id, call.id))
        .for("share");
      if (!fresh || fresh.safetyEndedAt || fresh.cancelledAt) throw new Error("ended");
      if (roomState(fresh, new Date()) !== "open") throw new Error("ended");
      // One of the two may have blocked the other while this step waited: looked at again as the very last
      // thing before the pass is made. (A block does not put anyone out of a call that is under way; a pass
      // made in the instant before a block is the same as having entered just before it.)
      if (await isBlockedEitherWay(call.hostId, call.customerId, tx)) throw new Error("ended");
      endsAt = fresh.endsAt;
      return createEntryPass({ roomName: call.roomName, userId: user.id, displayName: shownName });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ended") return no(409, "not_now", MESSAGES.closed);
    if (error instanceof Error && error.message === "paused") return no(403, "paused", PAUSED);
    if (error instanceof Error && error.message === "closed") return no(401, "signed_out", "Please log in.");
    console.error(`[calls] could not hand out an entry pass for call ${call.id}`, error);
    return no(503, "failed", "Could not connect you just now. Please try again.");
  }

  return { token, serverUrl: videoServerUrl(), role: decision.role, endsAt: endsAt.toISOString(), serverNow: new Date().toISOString() };
}
