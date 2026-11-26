/**
 * "End call now" (plans/50-end-call-now.md): one of the two ends the call for both at once, nobody
 * can come back in, and time after that moment is not counted. The money of the call settles by
 * itself, by who pressed (src/lib/payments/owed.ts). Nothing is put on the founder's review list.
 *
 * (Until 26 November 2026 the button was "End call and report" and sent every payment of the call
 * to the founder's review. A call ended with that button carries the same mark without
 * `endedNowBy`, and keeps those rules: this file never writes such a call, and never changes one.)
 */
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { CLOSE_LATE_SECONDS, OPEN_EARLY_SECONDS, roleOnCall, roomState } from "@/lib/calls";
import { closeRoom } from "@/lib/video/livekit";
import { closeCallIfDue } from "@/lib/video/closing";

/**
 * What became of a press, said from what is really written on the call:
 *   not_open_yet  the room has not opened: nothing was ended (such a call is cancelled, not ended)
 *   over          the room had closed already, or the call was cancelled: nothing was written, and the
 *                 call is charged as any call that ran to its end
 *   ended         the call is ended for both. `by` is the role of the person written down as having
 *                 pressed, `byMe` whether that is the person asking now (true also for a second press
 *                 of theirs), `old` whether it was ended with the earlier button
 */
export type EndOutcome = { state: "not_open_yet" } | { state: "over" } | { state: "ended"; by: "host" | "customer"; byMe: boolean; old: boolean };

/**
 * The press itself: one update that only goes through while the call is neither ended nor
 * cancelled and its room is open. The room's times are read from the row at that moment, so time
 * that was added a moment ago counts (adding time holds the same row). When it changed nothing,
 * the call is read again and the answer says what is true: who pressed is never taken from who
 * is asking.
 */
async function press(input: { call: Call; by: string; now: Date }): Promise<EndOutcome> {
  const { call, by, now } = input;
  const role = roleOnCall(call, by);
  if (!role) return { state: "over" };
  // Twice at most: the second time only when the room turned out to be open after all (time was added between the two looks).
  for (let attempt = 0; attempt < 2; attempt++) {
    const written = await db
      .update(schema.calls)
      .set({ safetyEndedAt: now, safetyEndedBy: by, endedNowBy: role })
      .where(
        and(
          eq(schema.calls.id, call.id),
          isNull(schema.calls.safetyEndedAt),
          isNull(schema.calls.cancelledAt),
          // The room is open: from 5 minutes before the start until the end (src/lib/calls.ts, `roomState`).
          lte(schema.calls.startsAt, new Date(now.getTime() + OPEN_EARLY_SECONDS * 1000)),
          gt(schema.calls.endsAt, new Date(now.getTime() - CLOSE_LATE_SECONDS * 1000)),
        ),
      )
      .returning({ id: schema.calls.id });
    if (written.length > 0) return { state: "ended", by: role, byMe: true, old: false };

    const [fresh] = await db.select().from(schema.calls).where(eq(schema.calls.id, call.id));
    if (!fresh || fresh.cancelledAt) return { state: "over" };
    if (fresh.safetyEndedAt) {
      // Somebody's press is written down: the other person's a moment earlier, or this person's own first one.
      const presser = fresh.endedNowBy === "host" || fresh.endedNowBy === "customer" ? fresh.endedNowBy : (roleOnCall(fresh, fresh.safetyEndedBy ?? "") ?? "host");
      return { state: "ended", by: presser, byMe: fresh.safetyEndedBy === by, old: fresh.endedNowBy === null };
    }
    const state = roomState(fresh, now);
    if (state === "not_open_yet") return { state };
    if (state === "closed") return { state: "over" };
  }
  // The room read as open twice and the press went through neither time: said as "not ended", so the screen offers to try again.
  throw new Error(`could not end call ${call.id}: the press was not written`);
}

/**
 * For the website. Only while the room is open (from 5 minutes before the start until the end):
 * that is when there is a call to end. Before that a call is cancelled, with the host's
 * cancelling rule; after it, a person reports or blocks from the call's page.
 */
export async function endCallNow(input: { call: Call; by: string; now: Date }): Promise<EndOutcome> {
  const outcome = await press(input);
  if (outcome.state !== "ended") return outcome;
  const { call } = input;
  // Put both people out and cancel their entry passes. The always-on helper repeats this until the room is confirmed closed.
  await closeRoom(call.roomName, [call.hostId, call.customerId]).catch((error) => {
    console.error(`[safety] could not close the room of call ${call.id} yet; the helper will retry`, error);
  });
  return outcome;
}

/**
 * The same, for the phone app, which does not say "ended for both" on the mark alone: `closed` is
 * true only with proof that the room is closed (both people out, their entry passes cancelled).
 * The proof is the helper's own step (`closeCallIfDue`), which closes the room and writes down
 * that it is closed once the video service has confirmed it; a room written down as closed before
 * counts too. So trying again after a failure, also after the call's booked end, asks the video
 * service again instead of taking the clock's word. For a room that has not opened there is
 * nothing to close.
 */
export async function endCallNowConfirmed(input: { call: Call; by: string; now: Date }): Promise<{ outcome: EndOutcome; closed: boolean }> {
  const outcome = await press(input);
  if (outcome.state === "not_open_yet") return { outcome, closed: true };
  const closed = await closeCallIfDue(input.call.id).then(
    (result) => result === "closed" || result === "already closed",
    (error) => {
      console.error(`[safety] could not close the room of call ${input.call.id} yet; the helper will retry`, error);
      return false;
    },
  );
  return { outcome, closed };
}
