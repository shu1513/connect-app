/**
 * What the always-on helper does for contributions, in one fixed order, after the payment and
 * membership jobs of each round (worker/closer.ts; plans/25, "The helper's jobs"). Every job is
 * safe to run again, and one payment going wrong never stops the others.
 *
 * What a stop forbids, and what it does not: once a payment is given up, or the founder's switch
 * does not cover its host, nothing new is started for it: no hold is placed and no money is taken.
 * Each of those jobs checks that for itself, right before it acts. Everything that only finishes
 * or tidies goes on regardless: looking at Stripe, letting a hold go, recording a taking that had
 * already happened, refunds, disputes, and removing cards.
 *
 * Unfinished money actions of a contribution's payment are found by the payment jobs' own
 * reconcileOperations, which hands them to recover.ts. Writing down the monthly payments that are
 * due comes with part 2b.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { MoneyError, OutcomeUnknownError, RETRY_AFTER_REFUSAL_MS, type OperationKind } from "@/lib/payments/operations";
import { projectsOnFor, switches, tipsOn } from "@/lib/safety/switches";
import { removeRetiredCards } from "./cards";
import { giveUp, giveUpIfWaiting, intentFor, letGo, lookAndRecord, syncPayment, takePayment, tryHold } from "./charge";
import { runDisputeLooks } from "./dispute";
import { endContribution } from "./ending";
import { carryOnWhereNobodyIsPaused } from "./account-pause";
import { writeDuePayments } from "./monthly";
import { runRefunds } from "./refund";

const pays = schema.contributionPayments;
const BATCH = 50;

/** A payment that is still to be paid is looked at again this often, also without a message from Stripe. */
const LOOK_AGAIN_TO_PAY_MS = 10 * 60_000;
/** A hold that was accepted is looked at again this often (a bank can let one go by itself). */
const LOOK_AGAIN_HELD_MS = 60 * 60_000;
/** A request for a PaymentIntent that is still on its way is left alone this long. */
const CLAIM_SETTLES_MS = 60_000;

function log(message: string, error?: unknown) {
  if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[contributions] ${message}: ${error.message}`);
  else console.error(`[contributions] ${message}`, error);
}

/** Runs one job over its payments; one that fails is logged and tried again next round. */
async function each(what: string, ids: Array<{ id: string }>, job: (paymentId: string) => Promise<unknown>): Promise<void> {
  for (const { id } of ids) {
    try {
      await job(id);
    } catch (error) {
      log(`could not ${what} for contribution payment ${id}; will retry`, error);
    }
  }
}

/** Not refused by Stripe for this kind of action in the last hour, so payments waiting out a refusal never fill the batch. */
const notRefusedRecently = (kind: OperationKind, now: Date) =>
  sql`not exists (select 1 from ${schema.moneyOperations} where ${schema.moneyOperations.contributionPaymentId} = ${pays.id} and ${schema.moneyOperations.kind} = ${kind} and ${schema.moneyOperations.status} = 'failed' and ${schema.moneyOperations.finishedAt} > ${new Date(now.getTime() - RETRY_AFTER_REFUSAL_MS).toISOString()}::timestamptz)`;

const open = and(isNull(pays.endedHow), isNull(pays.problem));

export async function runContributionJobs(now: Date = new Date()): Promise<void> {
  // 1. Stops first. Payments that were given up and whose hold is not let go yet.
  await each(
    "let go of the payment",
    await db.select({ id: pays.id }).from(pays).where(and(inArray(pays.status, ["to_pay", "held"]), isNotNull(pays.endedHow), notRefusedRecently("release", now))).limit(BATCH),
    (id) => letGo(id, now),
  );
  //    And for every host the founder's switch does not cover: what is only held is given up. (The step that
  //    saves the switch does this itself, in part 2b; this is the net behind it.)
  //    The hosts are told apart in the query itself, so payments of covered hosts never fill the batch.
  const current = await switches();
  if (current.projects !== "everyone") {
    const uncovered = current.projects === "named" && current.projectsHosts.length > 0 ? notInArray(schema.contributions.hostId, current.projectsHosts) : undefined;
    await each(
      "give up a held payment of a host the switch does not cover",
      // (Not a tip: tips follow their own switch, below.)
      await db.select({ id: pays.id }).from(pays).innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId)).where(and(eq(pays.status, "held"), open, ne(schema.contributions.kind, "tip"), uncovered)).limit(BATCH),
      async (id) => {
        // Asked once more for this host, by the one function that knows, right before acting.
        const [owner] = await db.select({ hostId: schema.contributions.hostId }).from(pays).innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId)).where(eq(pays.id, id));
        if (owner && !(await projectsOnFor(owner.hostId))) await giveUp(id, "switch", now);
      },
    );
  }
  //    The same for tips while the founder has switched them off (plans/44, decision 12): every tip payment that is
  //    not taken, held or still at its card step, is given up. Chosen in the search itself, so nothing else fills the batch.
  if (current.tipsOff) {
    await each(
      "give up a tip while tips are switched off",
      await db.select({ id: pays.id }).from(pays).innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId)).where(and(inArray(pays.status, ["to_pay", "held"]), open, eq(schema.contributions.kind, "tip"))).limit(BATCH),
      async (id) => {
        if (!(await tipsOn())) await giveUp(id, "switch", now);
      },
    );
  }

  // 2. PaymentIntents that were asked for and whose id was never saved (also of payments given up meanwhile).
  await each(
    "finish asking for the payment",
    await db
      .select({ id: pays.id })
      .from(pays)
      .where(and(inArray(pays.status, ["to_pay", "held"]), isNull(pays.problem), isNull(pays.stripePaymentIntentId), isNotNull(pays.intentRequestedAt), lte(pays.intentRequestedAt, new Date(Date.now() - CLAIM_SETTLES_MS))))
      .limit(BATCH),
    (id) => intentFor(id, now),
  );

  // 3. Card steps that ran out without a hold. Stripe is asked first: a hold that arrived in time counts.
  await each(
    "end the card step",
    // (The one that was looked at longest ago first, so payments that are still waiting for an outcome never keep the others out of the batch.)
    await db.select({ id: pays.id }).from(pays).where(and(eq(pays.status, "to_pay"), open, lte(pays.cardStepExpiresAt, now))).orderBy(pays.updatedAt).limit(BATCH),
    async (id) => {
      /** Marked as looked at, so it goes to the end of the line. Only while it still waits for a card: the time of a payment that is being given up is the watch's to read. */
      const looked = () => db.update(pays).set({ updatedAt: new Date() }).where(and(eq(pays.id, id), eq(pays.status, "to_pay"), open));
      // A look that fails (Stripe cannot be reached) is marked too, before the failure is passed on: fifty such payments must not keep the others out of every round.
      const { payment, shown } = await lookAndRecord(id, now).catch(async (error) => {
        await looked().catch(() => undefined);
        throw error;
      });
      // Stripe is still working on the payment, or its answer could not be recorded: a hold placed in time may be
      // about to appear, and giving the payment up now would cancel it. Nothing is decided until there is an outcome;
      // the next round looks again. (The rule a missed month follows too: charge.ts, missMonth.) It is marked as
      // looked at, so it goes to the end of the line; if it waits like this for more than a day, the watch says so (health.ts).
      if (shown === "processing" || shown === "unrecorded") {
        await looked();
        return;
      }
      // Given up only if it still waits for a card when it is locked: a hold recorded in this very moment stays.
      if (payment.status === "to_pay" && !payment.endedHow && !payment.problem) await giveUpIfWaiting(id, "card_step", now);
    },
  );

  // 4. Payments to look at again, also when no message from Stripe came.
  await each(
    "look at the payment again",
    await db
      .select({ id: pays.id })
      .from(pays)
      .where(and(open, isNotNull(pays.stripePaymentIntentId), or(and(eq(pays.status, "to_pay"), lte(pays.updatedAt, new Date(now.getTime() - LOOK_AGAIN_TO_PAY_MS))), and(eq(pays.status, "held"), lte(pays.updatedAt, new Date(now.getTime() - LOOK_AGAIN_HELD_MS))))))
      .orderBy(pays.updatedAt)
      .limit(BATCH),
    (id) => syncPayment(id, now),
  );

  // 5. Held money whose moment has come. (takePayment itself asks whether it may still be taken, and gives up one whose last moment has passed.)
  await each(
    "take the payment's money",
    await db.select({ id: pays.id }).from(pays).where(and(eq(pays.status, "held"), open, lte(pays.takeAt, now), notRefusedRecently("capture", now))).orderBy(pays.takeAt).limit(BATCH),
    (id) => takePayment(id, now),
  );

  //    A hold whose last moment has passed is given up and let go at once: it does not wait out the hour the
  //    helper leaves after a taking that Stripe refused.
  await each(
    "give up a hold whose last moment has passed",
    await db.select({ id: pays.id }).from(pays).where(and(eq(pays.status, "held"), open, lt(pays.takeBy, now))).limit(BATCH),
    (id) => takePayment(id, now),
  );

  // 6. Tries with the saved card, on their days.
  await each(
    "try the saved card",
    await db
      .select({ id: pays.id })
      .from(pays)
      .where(and(eq(pays.status, "to_pay"), open, lte(pays.nextTryAt, now), or(isNull(pays.giveUpAt), gt(pays.giveUpAt, now))))
      .orderBy(pays.nextTryAt)
      .limit(BATCH),
    (id) => tryHold(id, now),
  );

  // 7. Giving up after 7 days without a hold: the monthly contribution is stopped. Stripe is asked first.
  await each(
    "stop the contribution after 7 days without a hold",
    await db.select({ id: pays.id }).from(pays).where(and(eq(pays.status, "to_pay"), open, lte(pays.giveUpAt, now))).limit(BATCH),
    async (id) => {
      const payment = await syncPayment(id, now);
      if (payment.status !== "to_pay" || payment.endedHow || payment.problem) return;
      // Read again right before ending: a contribution that waits for a paused account since a moment ago has had
      // this payment given up by that pause, and is kept (plans/54). It must not be ended on what was read before.
      const [fresh] = await db.select({ endedHow: pays.endedHow, waits: schema.contributions.accountPausedAt }).from(pays).innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId)).where(eq(pays.id, id));
      if (!fresh || fresh.endedHow || fresh.waits) return;
      await endContribution(payment.contributionId, "given_up", now);
    },
  );

  // 8. Monthly payments that are due: each is written down once, to be tried with the saved card on the next round.
  //    First the net behind a lifted pause: a contribution that still waits though nobody is paused carries on.
  await carryOnWhereNobodyIsPaused(now).catch((error) => console.error("[contributions] letting contributions carry on after lifted pauses failed; will retry", error));
  await writeDuePayments(now);

  // 9. Refunds that are owed. 10. Disputes still open (asked once an hour), and retired cards nothing needs.
  await runRefunds(now);
  await runDisputeLooks(now);
  await removeRetiredCards(now);
}
