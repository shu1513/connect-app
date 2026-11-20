/**
 * Is the contribution work healthy? Part of the app's one health answer (src/lib/health.ts; plans/25,
 * "The watch"). Each line is something the helper should have done by now and has not, or
 * something only the founder can settle.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const pays = schema.contributionPayments;
const MINUTE_MS = 60_000;

export const TAKING_LATE_MS = 5 * MINUTE_MS;
export const INTENT_UNSAVED_MS = 10 * MINUTE_MS;
export const LETTING_GO_LATE_MS = 10 * MINUTE_MS;
export const REFUND_IDLE_MS = 10 * MINUTE_MS;
/** A month's 7 days, and one more day. */
export const LATE_MONTH_UNDECIDED_MS = 8 * 24 * 60 * MINUTE_MS;
/** A card step whose time is over is ended at once; one that still waits a day later is said. */
export const CARD_STEP_UNDECIDED_MS = 24 * 60 * MINUTE_MS;

const nothingUnderWay = sql`not exists (select 1 from ${schema.moneyOperations} where ${schema.moneyOperations.contributionPaymentId} = ${pays.id} and ${schema.moneyOperations.status} = 'started')`;

export async function contributionHealthProblems(now: Date): Promise<string[]> {
  const any = async (where: ReturnType<typeof and>) => (await db.select({ id: pays.id }).from(pays).where(where).limit(1)).length > 0;
  const problems: string[] = [];

  if (await any(and(eq(pays.status, "held"), isNull(pays.endedHow), isNull(pays.problem), lt(pays.takeAt, new Date(now.getTime() - TAKING_LATE_MS)), nothingUnderWay))) {
    problems.push("a contribution's held money is more than 5 minutes past the moment it should have been taken, and nothing is under way for it");
  }
  if (await any(and(inArray(pays.status, ["to_pay", "held"]), isNull(pays.problem), isNull(pays.stripePaymentIntentId), lt(pays.intentRequestedAt, new Date(now.getTime() - INTENT_UNSAVED_MS))))) {
    problems.push("a contribution's payment was asked of Stripe more than 10 minutes ago and its answer is not saved");
  }
  if (await any(and(inArray(pays.status, ["to_pay", "held"]), isNotNull(pays.endedHow), lt(pays.updatedAt, new Date(now.getTime() - LETTING_GO_LATE_MS))))) {
    problems.push("a contribution's payment that was given up still has its hold after 10 minutes");
  }
  // A refund Stripe has accepted and not finished, or one Stripe refused and that waits for its next try, is not this:
  // only one that is owed, was never tried or whose hour after a failure is over, with nothing under way.
  const [idle] = await db
    .select({ id: schema.contributionRefunds.id })
    .from(schema.contributionRefunds)
    .innerJoin(pays, eq(pays.id, schema.contributionRefunds.contributionPaymentId))
    .where(
      and(
        eq(schema.contributionRefunds.status, "owed"),
        lt(schema.contributionRefunds.createdAt, new Date(now.getTime() - REFUND_IDLE_MS)),
        sql`(${schema.contributionRefunds.lastFailedAt} is null or ${schema.contributionRefunds.lastFailedAt} < ${new Date(now.getTime() - 70 * MINUTE_MS).toISOString()}::timestamptz)`,
        inArray(pays.dispute, ["none", "won"]),
        nothingUnderWay,
      ),
    )
    .limit(1);
  if (idle) problems.push("a contribution's refund has been owed for more than 10 minutes with nothing under way");

  // A month nobody has tried to pay is given up as missed two minutes after its 7 days, unless Stripe is still
  // working on a payment for it. One that is still waiting a day after those 7 days is said here: it is not given
  // up because of time, and it must not wait unseen either.
  const monthsDay = sql`((${schema.contributions.firstHoldAt} at time zone 'UTC') + make_interval(months => ${pays.number} - 1)) at time zone 'UTC'`;
  const [stillWaiting] = await db
    .select({ id: pays.id })
    .from(pays)
    .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
    .where(
      and(
        eq(pays.status, "to_pay"),
        isNull(pays.endedHow),
        isNull(pays.problem),
        isNull(pays.firstFailedAt),
        gt(pays.number, 1),
        eq(schema.contributions.kind, "monthly"),
        isNotNull(schema.contributions.firstHoldAt),
        sql`${monthsDay} < ${new Date(now.getTime() - LATE_MONTH_UNDECIDED_MS).toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  if (stillWaiting) problems.push("a contribution's late month has had no outcome for more than a day after its 7 days were over");

  // A card step is ended when its time is over, unless Stripe is still working on its payment (jobs.ts, job 3). One
  // that still waits a day after its time must not wait unseen: until it has an outcome, a tip keeps its call.
  if (await any(and(eq(pays.status, "to_pay"), isNull(pays.endedHow), isNull(pays.problem), lt(pays.cardStepExpiresAt, new Date(now.getTime() - CARD_STEP_UNDECIDED_MS))))) {
    problems.push("a contribution's or a tip's card step has had no outcome for more than a day after its time was over");
  }

  if (await any(isNotNull(pays.problem))) problems.push("a contribution's payment needs the founder (see the projects page)");
  return problems;
}
