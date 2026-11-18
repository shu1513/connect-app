/**
 * What the always-on helper does for memberships, in one fixed order, right after the payment
 * jobs of each round (worker/closer.ts). Every job is safe to run again, and one month going
 * wrong never stops the others.
 *
 * Unfinished money actions of a month are found by the payment jobs' own reconcileOperations,
 * which hands them to recover.ts.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { MoneyError, OutcomeUnknownError, RETRY_AFTER_REFUSAL_MS, type OperationKind } from "@/lib/payments/operations";
import { removeRetiredCards } from "./cards";
import { abandonMonth, intentFor, letHoldGo, syncMonth, takeMonth, tryHold } from "./charge";
import { runClosings } from "./close";
import { runDisputeLooks, runEndings } from "./ending";
import { runInvitations } from "./join";
import { runPayBacks } from "./payback";

const months = schema.membershipMonths;
const BATCH = 50;

/** A payment that is still to be paid is looked at again this often, also without a message from Stripe. */
const LOOK_AGAIN_TO_PAY_MS = 10 * 60_000;
/** A hold that was accepted is looked at again this often (a bank can let one go by itself). */
const LOOK_AGAIN_HELD_MS = 60 * 60_000;
/** A request for a PaymentIntent that is still on its way is left alone this long. */
const CLAIM_SETTLES_MS = 60_000;

function log(message: string, error?: unknown) {
  if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[membership] ${message}: ${error.message}`);
  else console.error(`[membership] ${message}`, error);
}

/** Runs one job over its months; one that fails is logged and tried again next round. */
async function each(what: string, ids: Array<{ id: string }>, job: (monthId: string) => Promise<unknown>): Promise<void> {
  for (const { id } of ids) {
    try {
      await job(id);
    } catch (error) {
      log(`could not ${what} for month ${id}; will retry`, error);
    }
  }
}

/**
 * Not refused by Stripe for this kind of action in the last hour. Part of the query itself, so
 * months that are waiting out a refusal never fill the batch and keep others from their turn.
 */
const notRefusedRecently = (kind: OperationKind, now: Date) =>
  sql`not exists (select 1 from ${schema.moneyOperations} where ${schema.moneyOperations.monthId} = ${months.id} and ${schema.moneyOperations.kind} = ${kind} and ${schema.moneyOperations.status} = 'failed' and ${schema.moneyOperations.finishedAt} > ${new Date(now.getTime() - RETRY_AFTER_REFUSAL_MS).toISOString()}::timestamptz)`;

const open = and(isNull(months.endedHow), isNull(months.problem));

export async function runMembershipJobs(now: Date = new Date()): Promise<void> {

  // 1. PaymentIntents that were asked for and whose id was never saved (also of months given up meanwhile).
  await each(
    "finish asking for the payment",
    await db
      .select({ id: months.id })
      .from(months)
      .where(and(inArray(months.status, ["to_pay", "held"]), isNull(months.problem), isNull(months.stripePaymentIntentId), isNotNull(months.intentRequestedAt), lte(months.intentRequestedAt, new Date(Date.now() - CLAIM_SETTLES_MS))))
      .limit(BATCH),
    (id) => intentFor(id, now),
  );

  // 2. Card steps that ran out without a hold. Stripe is asked first: a hold that arrived in time counts.
  await each(
    "end the card step",
    await db.select({ id: months.id }).from(months).where(and(eq(months.status, "to_pay"), open, lte(months.cardStepExpiresAt, now))).limit(BATCH),
    async (id) => {
      const month = await syncMonth(id, now);
      if (month.status === "to_pay" && !month.endedHow && !month.problem) await abandonMonth(id, "card_step", now);
    },
  );

  // 3. Payments to look at again, also when no message from Stripe came.
  await each(
    "look at the payment again",
    await db
      .select({ id: months.id })
      .from(months)
      .where(
        and(
          open,
          isNotNull(months.stripePaymentIntentId),
          or(and(eq(months.status, "to_pay"), lte(months.updatedAt, new Date(now.getTime() - LOOK_AGAIN_TO_PAY_MS))), and(eq(months.status, "held"), lte(months.updatedAt, new Date(now.getTime() - LOOK_AGAIN_HELD_MS)))),
        ),
      )
      .orderBy(months.updatedAt)
      .limit(BATCH),
    (id) => syncMonth(id, now),
  );
  //    And months that are being given up, whose payment is not cancelled yet.
  await each(
    "let go of the payment",
    await db.select({ id: months.id }).from(months).where(and(inArray(months.status, ["to_pay", "held"]), isNotNull(months.endedHow), notRefusedRecently("release", now))).limit(BATCH),
    (id) => letHoldGo(id, now),
  );

  // 4. Held money whose time to be taken has come.
  await each(
    "take the month's money",
    await db.select({ id: months.id }).from(months).where(and(eq(months.status, "held"), open, lte(months.takeAt, now), notRefusedRecently("capture", now))).orderBy(months.takeAt).limit(BATCH),
    (id) => takeMonth(id, now),
  );

  // 5. New tries with the saved card, on their days.
  await each(
    "try the saved card",
    await db
      .select({ id: months.id })
      .from(months)
      .where(and(eq(months.status, "to_pay"), open, lte(months.nextTryAt, now), or(isNull(months.giveUpAt), gt(months.giveUpAt, now))))
      .orderBy(months.nextTryAt)
      .limit(BATCH),
    (id) => tryHold(id, now),
  );

  // 6. Giving up after 7 days without a hold. Stripe is asked first: a payment that went through counts.
  await each(
    "give the payment up",
    await db.select({ id: months.id }).from(months).where(and(eq(months.status, "to_pay"), open, lte(months.giveUpAt, now))).limit(BATCH),
    async (id) => {
      const month = await syncMonth(id, now);
      if (month.status === "to_pay" && !month.endedHow && !month.problem) await abandonMonth(id, "given_up", now);
    },
  );

  // 7 and 8. Months past their end are closed, and in the same step renewed or their membership paused.
  await runClosings(now);

  // Disputes that are still open are asked about once an hour, so a lost message never leaves a month frozen.
  await runDisputeLooks(now);

  // 9. Pay-backs. 10. Endings to clean up. 11. Retired cards nothing needs any more.
  await runPayBacks(now);
  await runEndings(now);
  await removeRetiredCards(now);

  // Last, and on its own: invitations whose 24 hours are over end by themselves, and their places are free
  // again. Nothing about money waits for this, and a failure here is only logged (every step that uses an
  // invitation checks its 24 hours itself).
  await runInvitations(now).catch((error) => log("could not end the invitations that ran out; will retry", error));
}
