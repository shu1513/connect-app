/**
 * "End call now" (plans/51-end-call-now.md): one of the two ends the call for both at once, nobody
 * can come back in, and time after that moment is not counted. The money of the call settles by
 * itself, by who pressed (src/lib/payments/owed.ts). Nothing is put on the founder's review list.
 *
 * (Until 26 November 2026 the button was "End call and report" and sent every payment of the call
 * to the founder's review. A call ended with that button carries the same mark without
 * `endedNowBy`, and keeps those rules: this file never writes such a call, and never changes one.)
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call } from "@/db/schema";
import { wholeBookingSaid } from "@/lib/booking/rules";
import { roleOnCall, roomState } from "@/lib/calls";
import { closeCallIfDue } from "@/lib/video/closing";

/** How long the answer to a press waits for the video service to confirm that the room is closed. */
const CLOSE_WAIT_MS = 8_000;

/**
 * What became of a press, said from what is really written on the call:
 *   not_open_yet  the room has not opened: nothing was ended (such a call is cancelled, not ended)
 *   over          the room had closed already, or the call was cancelled: nothing was written, and the
 *                 call is charged as any call that ran to its end (or was cancelled)
 *   ended         the call is ended for both. `by` is the role of the person written down as having
 *                 pressed, `byMe` whether that is the person asking now (true also for a second press
 *                 of theirs), `old` whether it was ended with the earlier button
 *
 * `closed`: the room is written down as closed, which is the only proof that both people are out
 * (their entry passes cancelled). Until then the helper keeps trying, and no screen says "nobody
 * can come back in".
 */
export type EndOutcome = ({ state: "not_open_yet" } | { state: "over" } | { state: "ended"; by: "host" | "customer"; byMe: boolean; old: boolean }) & { closed: boolean };

type Pressed = { state: "not_open_yet" } | { state: "over" } | { state: "ended"; by: "host" | "customer"; byMe: boolean; old: boolean };

/**
 * The press itself, with the call's row held. Adding time, cancelling and closing the room hold
 * the same row, so what is read here is what is true: time that was added a moment ago counts, a
 * call cancelled a moment ago is not ended on top, and of two presses in the same moment one is
 * written and the other is told whose it was. Who pressed is never taken from who is asking.
 *
 * A customer's press is written as "customer" only when the rule "you pay for your whole booked
 * time" holds for him: his booking was made under words that say it (booking/rules.ts). Otherwise
 * it is written as "customer_untold", and the call is charged by the host's time, as he was told.
 * That is read from the booking alone, never from the page or the address the press came from:
 * nobody can choose the cheaper rule by how they send the press.
 */
async function press(input: { call: Call; by: string; now: Date }): Promise<Pressed> {
  const { by, now } = input;
  return db.transaction(async (tx) => {
    const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, input.call.id)).for("update");
    const role = call ? roleOnCall(call, by) : null;
    if (!call || !role) return { state: "over" as const };
    if (call.safetyEndedAt) {
      // Somebody's press is written down: the other person's a moment earlier, or this person's own first one.
      const presser = call.endedNowBy === "host" ? "host" : call.endedNowBy ? "customer" : (roleOnCall(call, call.safetyEndedBy ?? "") ?? "host");
      return { state: "ended" as const, by: presser, byMe: call.safetyEndedBy === by, old: call.endedNowBy === null };
    }
    if (call.cancelledAt || call.closedAt) return { state: "over" as const };
    // The room is open from 5 minutes before the start until the end (src/lib/calls.ts).
    const state = roomState(call, now);
    if (state === "not_open_yet") return { state };
    if (state === "closed") return { state: "over" as const };

    let wholeHolds = false;
    if (role === "customer") {
      const [booking] = await tx.select({ cardConsentVersion: schema.bookings.cardConsentVersion }).from(schema.bookings).where(eq(schema.bookings.callId, call.id));
      wholeHolds = wholeBookingSaid(booking?.cardConsentVersion);
    }
    await tx
      .update(schema.calls)
      .set({ safetyEndedAt: now, safetyEndedBy: by, endedNowBy: role === "host" ? "host" : wholeHolds ? "customer" : "customer_untold" })
      .where(eq(schema.calls.id, call.id));
    return { state: "ended" as const, by: role, byMe: true, old: false };
  });
}

/**
 * Ends the call for both, for the website and the phone app alike. Only while the room is open
 * (from 5 minutes before the start until the end): that is when there is a call to end. Before
 * that a call is cancelled, with the host's cancelling rule; after it, a person reports or
 * blocks from the call's page.
 *
 * After the press the room is closed by the helper's own step (`closeCallIfDue`), which puts
 * both people out, cancels their entry passes, and writes down that the room is closed once the
 * video service has confirmed it. `closed` says whether that is so now; a room written down as
 * closed before counts too. So pressing again after a failure, also after the call's booked end,
 * asks the video service again instead of taking the clock's word. For a room that has not
 * opened there is nothing to close.
 */
export async function endCallNow(input: { call: Call; by: string; now: Date }): Promise<EndOutcome> {
  const pressed = await press(input);
  if (pressed.state === "not_open_yet") return { ...pressed, closed: true };
  const closing = closeCallIfDue(input.call.id).then(
    (result) => result === "closed" || result === "already closed",
    (error) => {
      console.error(`[safety] could not close the room of call ${input.call.id} yet; the helper will retry`, error);
      return false;
    },
  );
  // The press is saved. Its answer does not wait long for the video service: a slow closing goes on by itself (and
  // the helper repeats it), and the person is told "it is being closed", with the three choices at hand.
  const closed = await Promise.race([closing, new Promise<false>((resolve) => setTimeout(() => resolve(false), CLOSE_WAIT_MS))]);
  return { ...pressed, closed };
}
