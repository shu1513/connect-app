/**
 * What the pages read about contributions (plans/25, "The pages"). Everything here only reads:
 * a page never writes a contribution or a payment, and never asks Stripe for one.
 */
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contribution, ContributionPayment, ContributionRefund, Payment } from "@/db/schema";
import { currentSplit } from "@/lib/payments/actions";
import { unsentEarnings } from "@/lib/payments/collect";

const pays = schema.contributionPayments;

/** A payment as a person reads it. `takeBy` is its real last moment. */
export type PaymentState = "to_pay" | "confirm" | "failed" | "held" | "cancelling" | "taken" | "cancelled" | "problem";

/** Where a payment stands, in one word the pages turn into a sentence. Nothing is called cancelled before its hold is certainly gone. */
export function stateOf(payment: Pick<ContributionPayment, "status" | "endedHow" | "problem" | "needsAction" | "firstFailedAt">): PaymentState {
  if (payment.status === "taken") return "taken";
  if (payment.status === "given_up") return "cancelled";
  if (payment.problem) return "problem";
  if (payment.endedHow) return "cancelling";
  if (payment.status === "held") return "held";
  if (payment.needsAction) return "confirm";
  return payment.firstFailedAt ? "failed" : "to_pay";
}

/**
 * Why a contribution ended, in words for the person who made it. It says why, and nothing about
 * money: whether anything was charged is said by each payment's own line, from what is known
 * about that payment.
 */
export function endedWords(how: string | null): string {
  switch (how) {
    case "paid":
      return "It was paid.";
    case "stopped":
      return "You stopped it.";
    case "cancelled":
      return "You cancelled it.";
    case "card_step":
      return "The card step was not finished in time.";
    case "project_ended":
      return "The project has ended.";
    case "host_let_go":
      return "The host let the payment go.";
    case "switch":
      return "It could not be taken while this was paused.";
    case "saved_card":
      return "The card is one that is saved for something else on Connect, so it was not used. Please type a card for it.";
    case "given_up":
      return "No payment could be put in place for 7 days.";
    case "never_again":
      return "Your bank told us not to try your card again.";
    case "card_gone":
      return "The card saved for it is no longer there.";
    case "dispute":
      return "Your bank disputed one of its charges.";
    case "hold_lost":
      return "Your bank let the hold go by itself.";
    case "not_taken_in_time":
    case "no_hold_end":
      return "The payment could not be taken in time.";
    default:
      return "It can no longer go on.";
  }
}

export type Supported = {
  contribution: Contribution;
  projectName: string;
  hostName: string;
  handle: string | null;
  latest: ContributionPayment | null;
  /** Whether it ever got as far as a hold on the card. One that was left at the card step never did. */
  began: boolean;
};

/** "Projects you support": every contribution of a person, the newest first, each with its latest payment. */
export async function supportedBy(contributorId: string): Promise<Supported[]> {
  const rows = await db
    .select({ contribution: schema.contributions, projectName: schema.projects.name, hostName: schema.hostProfiles.displayName, userName: schema.user.name, handle: schema.hostProfiles.handle })
    .from(schema.contributions)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.contributions.projectId))
    .innerJoin(schema.user, eq(schema.user.id, schema.contributions.hostId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.contributions.hostId))
    .where(eq(schema.contributions.contributorId, contributorId))
    .orderBy(desc(schema.contributions.createdAt));
  if (rows.length === 0) return [];
  const payments = await db.select().from(pays).where(inArray(pays.contributionId, rows.map((row) => row.contribution.id))).orderBy(asc(pays.number));
  return rows.map((row) => {
    const own = payments.filter((payment) => payment.contributionId === row.contribution.id);
    return {
      contribution: row.contribution,
      projectName: row.projectName,
      hostName: row.hostName ?? row.userName,
      handle: row.handle,
      latest: own.at(-1) ?? null,
      began: own.some((payment) => payment.authorisedAt !== null || payment.status === "held" || payment.status === "taken"),
    };
  });
}

/** The refund lines of some payments, by payment. */
async function refundsOf(paymentIds: string[]): Promise<Map<string, ContributionRefund[]>> {
  const found = new Map<string, ContributionRefund[]>();
  if (paymentIds.length === 0) return found;
  const lines = await db.select().from(schema.contributionRefunds).where(inArray(schema.contributionRefunds.contributionPaymentId, paymentIds)).orderBy(asc(schema.contributionRefunds.createdAt));
  for (const line of lines) found.set(line.contributionPaymentId, [...(found.get(line.contributionPaymentId) ?? []), line]);
  return found;
}

/** The share's lines of some payments, by payment. */
async function sharesOf(paymentIds: string[]): Promise<Map<string, Payment>> {
  const found = new Map<string, Payment>();
  if (paymentIds.length === 0) return found;
  const shares = await db.select().from(schema.payments).where(inArray(schema.payments.contributionPaymentId, paymentIds));
  for (const share of shares) if (share.contributionPaymentId) found.set(share.contributionPaymentId, share);
  return found;
}

export type PaymentRow = {
  payment: ContributionPayment;
  /** The host's share of it, once the money was taken. */
  share: Payment | null;
  /** What is owed back or on its way back and not finished, in cents. */
  refundUnderWayCents: number;
  /** What can still be refunded from it: what was taken, less what went back and what is on its way back. */
  refundableCents: number;
};

function rowsFor(payments: ContributionPayment[], shares: Map<string, Payment>, refunds: Map<string, ContributionRefund[]>): PaymentRow[] {
  return payments.map((payment) => {
    const underWay = (refunds.get(payment.id) ?? []).filter((line) => line.status !== "done").reduce((sum, line) => sum + line.amountCents, 0);
    return { payment, share: shares.get(payment.id) ?? null, refundUnderWayCents: underWay, refundableCents: payment.status === "taken" ? Math.max(0, (payment.takenCents ?? 0) - payment.refundedCents - underWay) : 0 };
  });
}

/** One contribution's payments, for its own page. */
export async function paymentRows(contributionId: string): Promise<PaymentRow[]> {
  const payments = await db.select().from(pays).where(eq(pays.contributionId, contributionId)).orderBy(asc(pays.number));
  const ids = payments.map((payment) => payment.id);
  return rowsFor(payments, await sharesOf(ids), await refundsOf(ids));
}

export type Contributor = { contribution: Contribution; name: string; payments: PaymentRow[] };

/**
 * The host's own list for one of her projects: who contributes (the person's name, once or
 * monthly, the amount, since when), each payment with where it stands, what contributors have
 * paid in all, her share of it, and what is ready to collect now. A contribution that never got
 * past its card step is left out: nobody contributed.
 */
export async function contributorsOf(hostId: string, projectId: string, now: Date): Promise<{ contributors: Contributor[]; paidCents: number; shareCents: number; readyCents: number }> {
  const rows = await db
    .select({ contribution: schema.contributions, name: schema.user.name })
    .from(schema.contributions)
    .innerJoin(schema.user, eq(schema.user.id, schema.contributions.contributorId))
    .where(and(eq(schema.contributions.hostId, hostId), eq(schema.contributions.projectId, projectId), or(ne(schema.contributions.status, "card_step"), isNotNull(schema.contributions.firstHoldAt))))
    .orderBy(desc(schema.contributions.createdAt));
  const ids = rows.map((row) => row.contribution.id);
  const payments = ids.length ? await db.select().from(pays).where(inArray(pays.contributionId, ids)).orderBy(asc(pays.number)) : [];
  const paymentIds = payments.map((payment) => payment.id);
  const shares = await sharesOf(paymentIds);
  const all = rowsFor(payments, shares, await refundsOf(paymentIds));
  // Only contributions with a payment that got as far as a hold: someone who left at the card step did not contribute.
  const contributors = rows
    .map((row) => ({ contribution: row.contribution, name: row.name, payments: all.filter((line) => line.payment.contributionId === row.contribution.id) }))
    .filter((row) => row.payments.some((line) => line.payment.authorisedAt !== null || line.payment.status === "taken"));
  const taken = all.filter((line) => line.payment.status === "taken");
  const paidCents = taken.reduce((sum, line) => sum + (line.payment.takenCents ?? 0) - line.payment.refundedCents, 0);
  const shareCents = taken.reduce((sum, line) => sum + (line.share ? currentSplit(line.share).hostShareCents : 0), 0);
  const ready = (await unsentEarnings(now, hostId)).filter((earning) => earning.payment.contributionPaymentId && paymentIds.includes(earning.payment.contributionPaymentId) && earning.heldBack === null && earning.payment.transferDueAt && earning.payment.transferDueAt <= now);
  return { contributors, paidCents, shareCents, readyCents: ready.reduce((sum, earning) => sum + earning.shareCents, 0) };
}

/** `projectName` is null for a tip, which has a call and no project. */
export type FounderRow = PaymentRow & { contribution: Contribution; contributorName: string; hostName: string; projectName: string | null };

/**
 * For the founder: what each project has received, and the payments that need a look: one with a
 * problem, one over the $1,000 line (it carries the mark, or its share waits 30 days), one the
 * founder holds back or released, and one whose charge is disputed.
 */
export async function forFounder(): Promise<{ received: Map<string, number>; rows: FounderRow[] }> {
  // (Added up as a wide number: a project's total can pass what a 32-bit number holds.)
  const totals = await db
    .select({ projectId: schema.contributions.projectId, cents: sql<string>`coalesce(sum(${pays.takenCents} - ${pays.refundedCents}), 0)::bigint` })
    .from(pays)
    .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
    // (What a project received is contributions to that project: a tip has none, and is not counted here.)
    .where(and(eq(pays.status, "taken"), isNotNull(schema.contributions.projectId)))
    .groupBy(schema.contributions.projectId);
  const rows = await founderRows(or(isNotNull(pays.problem), eq(pays.thirtyDayMark, true), ne(pays.founderHold, "none"), inArray(pays.dispute, ["open", "lost"]), and(inArray(pays.status, ["held", "taken"]), sql`${pays.amountCents} > 100000`)), ATTENTION, 0);
  return { received: new Map(totals.flatMap((row) => (row.projectId ? [[row.projectId, Number(row.cents)] as const] : []))), rows };
}

/** The attention list shows this many, the newest first. Every payment is always reachable through its project's own list. */
export const ATTENTION = 200;
/** Payments on one page of a project's list. */
export const PAYMENTS_PER_PAGE = 50;

async function founderRows(where: ReturnType<typeof and>, limit: number, offset: number): Promise<FounderRow[]> {
  const contributor = sql<string>`(select name from "user" where id = ${schema.contributions.contributorId})`;
  const host = sql<string>`(select name from "user" where id = ${schema.contributions.hostId})`;
  const found = await db
    .select({ payment: pays, contribution: schema.contributions, contributorName: contributor, hostName: host, projectName: schema.projects.name })
    .from(pays)
    .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.contributions.projectId))
    .where(where)
    .orderBy(desc(pays.createdAt), desc(pays.id))
    .limit(limit)
    .offset(offset);
  const ids = found.map((row) => row.payment.id);
  const lines = rowsFor(found.map((row) => row.payment), await sharesOf(ids), await refundsOf(ids));
  return found.map((row, index) => ({ ...lines[index], contribution: row.contribution, contributorName: row.contributorName, hostName: row.hostName, projectName: row.projectName }));
}

/**
 * For the founder: every payment of one project, page by page, the newest first, whether or not
 * anything about it needs a look. This is how the founder reaches an ordinary payment, to refund
 * it after the host has collected, or to hold its share back.
 */
export async function projectPaymentsForFounder(projectId: string, page: number): Promise<{ rows: FounderRow[]; older: boolean }> {
  const found = await founderRows(eq(schema.contributions.projectId, projectId), PAYMENTS_PER_PAGE + 1, (Math.max(1, page) - 1) * PAYMENTS_PER_PAGE);
  return { rows: found.slice(0, PAYMENTS_PER_PAGE), older: found.length > PAYMENTS_PER_PAGE };
}

/**
 * For the founder: every payment of a tip (plans/44, decision 17), page by page, the newest first.
 * This is how the founder reaches an ordinary tip, to let it go, hold its share back, or refund it
 * after the host has collected.
 */
export async function tipPaymentsForFounder(page: number): Promise<{ rows: FounderRow[]; older: boolean }> {
  const found = await founderRows(eq(schema.contributions.kind, "tip"), PAYMENTS_PER_PAGE + 1, (Math.max(1, page) - 1) * PAYMENTS_PER_PAGE);
  return { rows: found.slice(0, PAYMENTS_PER_PAGE), older: found.length > PAYMENTS_PER_PAGE };
}
