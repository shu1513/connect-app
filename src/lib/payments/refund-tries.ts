/**
 * Finding a refund on Stripe's own list of a charge's refunds, for money that is owed back as a
 * LINE and sent in TRIES: a tip's or a contribution's refund (src/lib/contributions/refund.ts) and
 * a membership's pay-back (src/lib/membership/payback.ts). Both tell Stripe the line and the try
 * with every request (`metadata.refundId`, `metadata.attempt`), so one search serves both and the
 * two cannot drift apart.
 *
 * And, for those two and for a call's refund alike (payments/jobs.ts): how the helper's REPEAT of
 * a refund request leaves (`repeatFromFreshLook`), and what is said when a refund turns out to be
 * alive at Stripe while the books do not have it (`sayIfRefundNotInBooks`). Why both:
 * plans/50-part-1-gifts-owed-back.md, "A helper that stood still".
 */
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { REFUND_SEND_TIMEOUT_MS } from "./actions";
import { SEARCH_WITHIN_MS } from "./operations";
import { lookUp, stripe } from "./stripe";

/** One try of one line, and the payment at Stripe it is sent to. */
export type RefundTry = { intentId: string; refundId: string; attempt: number };

/**
 * The first refund on Stripe's complete list of a charge's refunds that is the wanted one, or undefined when the
 * list shows none. Every page: a payment can have several refunds on its one charge. A look, not the action: a "no"
 * to the look itself proves nothing and is thrown as "could not look" (`lookUp`). So is a search that took too
 * long, each page and the whole of it: a search that did not finish is never "not there".
 */
export async function refundOnStripesList(intentId: string, wanted: (refund: Stripe.Refund) => boolean): Promise<Stripe.Refund | undefined> {
  const until = Date.now() + SEARCH_WITHIN_MS;
  return lookUp(async () => {
    for await (const candidate of stripe().refunds.list({ payment_intent: intentId, limit: 100 }, { timeout: SEARCH_WITHIN_MS })) {
      if (wanted(candidate)) return candidate;
      if (Date.now() > until) throw new Error("the search through this charge's refunds took too long");
    }
    // (Also when the last page came late and held nothing: a search that ran past its time proves nothing.)
    if (Date.now() > until) throw new Error("the search through this charge's refunds took too long");
    return undefined;
  });
}

/** Whether a refund on Stripe's list is this line's and this try's. */
export const isTry = (params: Pick<RefundTry, "refundId" | "attempt">) => (refund: Stripe.Refund) => refund.metadata?.refundId === params.refundId && refund.metadata?.attempt === String(params.attempt);

/**
 * The last safeguard against paying one line twice, looked at before ANY try after the first is sent, by whoever
 * sends it: a refund that an EARLIER try of this line made at Stripe and that is not over there (failed or
 * cancelled). A new try only exists because the one before was recorded as "not made" (or because Stripe said a
 * refund it had confirmed failed after all: that one is failed on the list too, and is passed over). Every way the record can
 * be wrong although each step judged rightly by what it saw (two helpers repeating at the same moment, one refused
 * and the other paid a moment later; the Stripe library sending a request a second time by itself after a closed
 * connection; a try written down before its sender had a last moment for sending it) leaves the earlier refund on
 * Stripe's list by the time the new try is due, an hour later. Then that refund is the line's refund: it is booked
 * as this try's outcome and nothing is sent.
 */
export async function earlierTryAtStripe(params: RefundTry): Promise<Stripe.Refund | undefined> {
  if (params.attempt <= 1) return undefined;
  return refundOnStripesList(params.intentId, (refund) => {
    const attempt = Number(refund.metadata?.attempt);
    return refund.metadata?.refundId === params.refundId && Number.isInteger(attempt) && attempt < params.attempt && refund.status !== "failed" && refund.status !== "canceled";
  });
}

/** How long a helper's look at a try stays good: its repeat leaves no later than this after the look began. */
export const LOOK_GOOD_FOR_MS = 5_000;
/**
 * How long the look itself waits for somebody who holds the try's row before it gives up for this pass. A little
 * longer than a look stays good, so that the clock alone judges a look that did come back; and never for ever, so
 * that one row somebody holds on to cannot keep the helper from all its other work.
 */
export const LOOK_WAITS_MS = LOOK_GOOD_FOR_MS + 3_000;

/**
 * How a helper's repeat is sent: with a limit of ten seconds on the request, and the Stripe library told not to send
 * it again. (Two things this does not promise. The library counts those ten seconds on the connection, so a sending
 * can take longer as a whole. And it still sends a request once more by itself when the connection was closed under
 * it; that cannot be switched off.)
 */
export const REPEAT_HOW = { maxNetworkRetries: 0, timeout: REFUND_SEND_TIMEOUT_MS } as const;

/** `sent: false`: nothing left for Stripe. "ended": the try has an outcome. "row_held": somebody held the try's row for too long. "stood_still": the look was too old. "too_late": the label can no longer be trusted. */
export type Repeated<T> = { sent: true; answer: T } | { sent: false; why: "ended" | "row_held" | "stood_still" | "too_late" };

/** Why a repeat was not sent, for the helper's log. */
export const WHY_NOT_REPEATED = {
  ended: "it has an outcome by now",
  row_held: "somebody held its row for too long; looked at again on the next pass",
  stood_still: "this helper stood still after its look, so the look is too old; looked at again on the next pass",
} as const;

/** Postgres's "the lock was not given in time" (55P03), also when the database library has wrapped it. */
function lockNotGiven(error: unknown): boolean {
  for (let at = error as { code?: unknown; cause?: unknown } | undefined, depth = 0; at && depth < 5; at = at.cause as typeof at, depth++) if (at.code === "55P03") return true;
  return false;
}

/**
 * The helper's repeat of a refund request, sent only from a look that is fresh.
 *
 * A repeat under an old label is only safe while its try is still open. Once another helper has written the try down
 * as "not made", the money is owed again and can be paid as a new try (or, for a call, refunded again by a person);
 * the old label, which never produced a refund, would then be paid by Stripe a second time. So, as the last things
 * before the request leaves:
 *   1. the try is looked at once more, and the look waits for anybody who is writing the try's outcome down at that
 *      very moment (`for share`; every writer of an outcome holds the try's row from before it writes anything): it
 *      sees what they wrote, never the moment before. It waits LOOK_WAITS_MS at most;
 *   2. the clock is read. If more than LOOK_GOOD_FOR_MS have passed since the look began, the helper stood still
 *      in between (a frozen process, a machine put to sleep), the look proves nothing any more, and nothing is sent.
 *      The try stays open and the next pass looks afresh. (The clock on the wall, not a count of the time this
 *      process ran: time spent asleep must count.)
 *   3. `mayRepeat` is asked (the label's 23 hours).
 * What is left open after that is the instant between reading the clock and the request leaving, and the library's
 * own second sending. No check of ours can come after our last check; `sayIfRefundNotInBooks` is for that.
 */
/**
 * The look at a try: its row as it stands once anybody who was writing its outcome has saved it. Waits LOOK_WAITS_MS
 * at most; `"row_held"` when the row was not let go in that time.
 */
async function lookAtTry(operationId: string): Promise<{ status: string; label: string } | undefined | "row_held"> {
  try {
    const [seen] = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = ${LOOK_WAITS_MS}`));
      return tx.select({ status: schema.moneyOperations.status, label: schema.moneyOperations.label }).from(schema.moneyOperations).where(eq(schema.moneyOperations.id, operationId)).for("share");
    });
    return seen;
  } catch (error) {
    if (lockNotGiven(error)) return "row_held";
    throw error;
  }
}

export async function repeatFromFreshLook<T>(operationId: string, mayRepeat: () => boolean, send: (how: typeof REPEAT_HOW) => Promise<T>): Promise<Repeated<T>> {
  const began = Date.now();
  const seen = await lookAtTry(operationId);
  if (seen === "row_held") return { sent: false, why: "row_held" };
  if (seen?.status !== "started") return { sent: false, why: "ended" };
  if (Date.now() - began > LOOK_GOOD_FOR_MS) return { sent: false, why: "stood_still" };
  if (!mayRepeat()) return { sent: false, why: "too_late" };
  return { sent: true, answer: await send(REPEAT_HOW) };
}

const over = (status: string | null) => status === "failed" || status === "canceled";

/**
 * Said out loud, once, when a helper holds a refund that is alive at Stripe and the books do not have it.
 *
 * A helper calls this for the refund it holds after its try has an outcome (its own write, or somebody else's, in
 * which case its own was thrown away, rightly: an outcome is never overwritten). `booked` gives Stripe's number of
 * the refund the books hold for this money NOW (the line's, or the call refund's), or null when they hold none. If
 * that is this refund, all is well, whoever booked it and under whichever try. If it is not, the books and Stripe
 * disagree: the try was written down as "not made" although Stripe made the refund, or the money was booked with
 * another refund while this one was made as well. The money may have been paid twice. Nothing is changed here: the
 * error log names it and every founder gets one email per refund. `about` says which money; `next` what Connect
 * does about it by itself, if anything.
 *
 * Three looks come first, in this order:
 *   - the try itself, waiting (as the look before a repeat does) for anybody who is writing its outcome down. A try
 *     that is still open says nothing: whoever ends it books this refund or finds it;
 *   - the books, through `booked`;
 *   - Stripe, about the refund by its number: one that has failed since the helper saw it is no disagreement. If
 *     Stripe cannot be asked just then, it is said all the same, with the last answer received.
 * Never throws: the helper's pass goes on. (If the database cannot be read or written at that moment, only the error
 * log has it: a try that has an outcome is not looked at again.)
 */
export async function sayIfRefundNotInBooks(found: { operationId: string; refund: { id: string; status: string | null }; booked: () => Promise<string | null>; about: string; next: string }): Promise<void> {
  try {
    if (over(found.refund.status)) return;
    const action = await lookAtTry(found.operationId);
    if (action === "row_held") {
      console.error(`[payments] ${found.about}: Stripe has refund ${found.refund.id}, and whether the books have it could not be found out (somebody held the request's row for too long). Compare this payment's refunds at Stripe with the app's.`);
      return;
    }
    if (!action || action.status === "started") return;
    const booked = await found.booked();
    if (booked === found.refund.id) return;
    let shows: string;
    try {
      const now = await stripe().refunds.retrieve(found.refund.id);
      if (over(now.status)) return;
      shows = now.status === "succeeded" ? "paid" : `not finished yet ("${now.status}")`;
    } catch {
      shows = `could not be checked just now. The last answer Connect received said "${found.refund.status}"`;
    }
    const have = booked ? `another refund for this money, ${booked}` : "no refund for this money";
    console.error(`[payments] ${found.about}: Stripe has refund ${found.refund.id} (${shows}), made for the request "${action.label}", and the books have ${have}. Nothing was changed. Compare this payment's refunds at Stripe with the app's.`);
    await db.transaction(async (tx) => {
      const admins = await tx.select({ id: schema.user.id, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
      for (const admin of admins) {
        await queueEmail(tx, {
          to: admin.email,
          subject: "A refund may have been paid twice: please look",
          text: [
            "Stripe has made a refund that Connect's books do not have.",
            "",
            `Which money: ${found.about}.`,
            `Stripe's number for the refund: ${found.refund.id}`,
            `What Stripe shows for it: ${shows}.`,
            `What Connect's books have: ${have}.`,
            "",
            "How this can happen: one of Connect's helpers stood still for a long time (a frozen or sleeping machine) and its old request reached Stripe after Connect had already moved on.",
            "",
            `What Connect does by itself: ${found.next}`,
            "",
            "What to do: open this payment in Stripe and compare the refunds listed there with what Connect shows for it. If two refunds for the same money both stay paid, the customer got it twice: the second amount came out of Connect's balance and Connect's books do not show it.",
          ].join("\n"),
          key: `refund-not-in-books:${found.refund.id}:${admin.id}`,
        });
      }
    });
  } catch (error) {
    console.error(`[payments] ${found.about}: could not find out, or could not write down, whether Stripe's refund ${found.refund.id} is in the books. Compare this payment's refunds at Stripe with the app's.`, error);
  }
}
