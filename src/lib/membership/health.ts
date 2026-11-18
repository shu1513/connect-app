/**
 * Is the membership work healthy? Part of the app's one health answer (src/lib/health.ts), which
 * an outside service asks every few minutes. Each line is something the helper should have done
 * by now and has not, or something only the founder can settle.
 *
 * A renewal has no line of its own: a month is closed and renewed (or its membership paused) in
 * one database step, so "a month past its end that is not closed" covers both.
 */
import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or, gt } from "drizzle-orm";
import { db, schema } from "@/db";

const months = schema.membershipMonths;
const MINUTE_MS = 60_000;

export const MEMBERSHIP_LATE_MS = 5 * MINUTE_MS;
export const INTENT_UNSAVED_MS = 6 * MINUTE_MS;
export const PAY_BACK_LATE_MS = 120 * MINUTE_MS;
export const ENDING_LATE_MS = 10 * MINUTE_MS;
export const GIVING_UP_LATE_MS = 15 * MINUTE_MS;

export async function membershipHealthProblems(now: Date): Promise<string[]> {
  const late = new Date(now.getTime() - MEMBERSHIP_LATE_MS);
  const open = and(isNull(months.endedHow), isNull(months.problem));
  const any = async (where: ReturnType<typeof and>) => (await db.select({ id: months.id }).from(months).where(where).limit(1)).length > 0;
  const problems: string[] = [];

  if (await any(and(inArray(months.status, ["to_pay", "held"]), isNull(months.problem), isNull(months.stripePaymentIntentId), lt(months.intentRequestedAt, new Date(now.getTime() - INTENT_UNSAVED_MS))))) {
    problems.push("a membership payment was asked of Stripe more than 6 minutes ago and its answer is not saved");
  }
  if (await any(and(eq(months.status, "held"), open, lt(months.takeAt, late)))) problems.push("a membership month's held money is more than 5 minutes past the moment it should have been taken");
  if (await any(and(eq(months.status, "to_pay"), open, lt(months.nextTryAt, late), or(isNull(months.giveUpAt), gt(months.giveUpAt, now))))) {
    problems.push("a try of a membership payment is more than 5 minutes late");
  }
  if (await any(and(eq(months.status, "to_pay"), isNull(months.endedHow), lt(months.giveUpAt, late)))) problems.push("a membership payment should have been given up more than 5 minutes ago");
  if (await any(and(inArray(months.status, ["to_pay", "held"]), isNotNull(months.endedHow), lt(months.updatedAt, new Date(now.getTime() - GIVING_UP_LATE_MS))))) {
    problems.push("a membership payment that was given up is still open at Stripe after 15 minutes");
  }
  if (await any(and(eq(months.status, "running"), lt(months.endsAt, late)))) problems.push("a membership month is more than 5 minutes past its end and is not closed or renewed");

  const [owed] = await db
    .select({ id: schema.membershipRefunds.id })
    .from(schema.membershipRefunds)
    .innerJoin(months, eq(months.id, schema.membershipRefunds.monthId))
    // A month whose charge is disputed pays nothing back until the bank has decided: that is not lateness.
    .where(and(inArray(schema.membershipRefunds.status, ["owed", "at_stripe"]), lt(schema.membershipRefunds.createdAt, new Date(now.getTime() - PAY_BACK_LATE_MS)), notInArray(months.dispute, ["open", "lost"])))
    .limit(1);
  if (owed) problems.push("a membership pay-back has been owed for more than 2 hours");

  const [ending] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.status, "ended"), isNull(schema.memberships.cleanupDoneAt), lt(schema.memberships.endedAt, new Date(now.getTime() - ENDING_LATE_MS))))
    .limit(1);
  if (ending) problems.push("an ended membership has not been cleaned up after 10 minutes");

  if (await any(isNotNull(months.problem))) problems.push("a membership month needs the founder (see the admin page)");
  return problems;
}

/** The founder's short list on the admin page: what went wrong and only a person can look at. */
export async function membershipsToLookAt(now: Date) {
  const who = { hostId: schema.memberships.hostId, customerId: schema.memberships.customerId };
  const [withProblem, disputed, payBacks] = await Promise.all([
    db.select({ month: months, ...who }).from(months).innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId)).where(isNotNull(months.problem)).limit(100),
    db.select({ month: months, ...who }).from(months).innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId)).where(inArray(months.dispute, ["open", "lost"])).limit(100),
    db
      .select({ refund: schema.membershipRefunds, ...who })
      .from(schema.membershipRefunds)
      .innerJoin(months, eq(months.id, schema.membershipRefunds.monthId))
      .innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId))
      // A pay-back that waits for a bank's decision on a dispute is shown with the dispute, not here.
      .where(and(inArray(schema.membershipRefunds.status, ["owed", "at_stripe"]), lt(schema.membershipRefunds.createdAt, new Date(now.getTime() - 60 * MINUTE_MS)), or(eq(schema.membershipRefunds.status, "at_stripe"), notInArray(months.dispute, ["open", "lost"]))))
      .orderBy(schema.membershipRefunds.createdAt)
      .limit(100),
  ]);
  return { withProblem, disputed, payBacks };
}
