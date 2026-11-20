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
async function leaveOtherCalls(userId: string, thisCallId: string, now: Date): Promise<void> {
  const others = await db
    .select()
    .from(schema.calls)
    .where(and(or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId)), ne(schema.calls.id, thisCallId), isNull(schema.calls.closedAt)));
  for (const other of others) {
    if (roomState(other, now) === "not_open_yet") continue;
    await removeFromRoom(other.roomName, userId);
  }
}

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
 * "switched_off" (calls are paused across Connect), "not_now" (cancelled, over, not open yet, not
 * paid, a blocked pair), "failed" (the video service could not be reached: nothing is decided).
 */
export type EntryRefused = { refused: { status: 403 | 404 | 409 | 503; message: string; why: "not_found" | "paused" | "switched_off" | "not_now" | "failed" } };

const no = (status: 403 | 404 | 409 | 503, why: EntryRefused["refused"]["why"], message: string): EntryRefused => ({ refused: { status, message, why } });

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
  if (user.paused) return no(403, "paused", "Your account is paused, so you cannot join calls.");
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
  try {
    token = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`join:${user.id}`}))`);
      // Read the call again under the lock: it may have been stopped or cancelled a moment ago.
      const [fresh] = await tx.select({ safetyEndedAt: schema.calls.safetyEndedAt, cancelledAt: schema.calls.cancelledAt }).from(schema.calls).where(eq(schema.calls.id, call.id));
      if (!fresh || fresh.safetyEndedAt || fresh.cancelledAt) throw new Error("ended");
      await leaveOtherCalls(user.id, call.id, now);
      return createEntryPass({ roomName: call.roomName, userId: user.id, displayName: shownName });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ended") return no(409, "not_now", MESSAGES.closed);
    console.error(`[calls] could not hand out an entry pass for call ${call.id}`, error);
    return no(503, "failed", "Could not connect you just now. Please try again.");
  }

  return { token, serverUrl: videoServerUrl(), role: decision.role, endsAt: call.endsAt.toISOString(), serverNow: new Date().toISOString() };
}
