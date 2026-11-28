/**
 * A paused account and its contributions (plans/54-contributions-paused-with-an-account.md).
 *
 * A monthly contribution that has begun is paused with the account, not ended: it is marked with
 * the moment, a payment of it that is not taken is given up, and no month is written while the
 * mark stands (monthly.ts). When the pause is lifted the mark is cleared, the months whose day
 * passed are skipped for good, and it carries on by itself. The founder's switch does the same
 * with a mark of its own (switch.ts); the two never touch each other's mark.
 *
 * Everything else a paused person has ends as it always did: a contribution made once, a tip, a
 * monthly one still at its first card step. Their one payment, if it was not taken, is let go.
 */
import { and, eq, isNotNull, ne, or } from "drizzle-orm";
import { schema } from "@/db";
import type { Tx } from "@/lib/payments/operations";
import { giveUpInStep } from "./charge";
import { queueAccountPausedEmail, queueCarriesOnEmail } from "./emails";
import { endInStep } from "./ending";
import { lockContribution, lockForPayment, lockPair } from "./locks";
import { monthlyDue, monthsBetween } from "./rules";
import { addSkipped } from "./skipped";

const pays = schema.contributionPayments;

/** The pairs of these rows, each once, in the one order pairs are locked in everywhere. */
async function lockPairsOf(tx: Tx, rows: Array<{ contributorId: string; hostId: string }>): Promise<void> {
  const pairs = new Map<string, { contributorId: string; hostId: string }>();
  for (const row of rows) pairs.set(`${row.contributorId}:${row.hostId}`, row);
  for (const key of [...pairs.keys()].sort()) await lockPair(tx, pairs.get(key)!.contributorId, pairs.get(key)!.hostId);
}

/**
 * Inside the step that pauses an account: every contribution the person has that is not ended,
 * as a host and as a contributor. A monthly one that has begun is marked and waits; the rest end.
 * The pairs are locked first, all of them, then each contribution, as an ending does it. Returns
 * the payments whose hold now has to be let go (the caller does that once its step is saved, and
 * the helper repeats it until it is done).
 */
export async function pauseContributionsOf(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const found = await tx
    .select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
    .from(schema.contributions)
    .where(and(ne(schema.contributions.status, "ended"), or(eq(schema.contributions.hostId, userId), eq(schema.contributions.contributorId, userId))));
  await lockPairsOf(tx, found);
  const toLetGo: string[] = [];
  for (const id of found.map((row) => row.id).sort()) {
    const contribution = await lockContribution(tx, id);
    if (contribution.status === "ended") continue;
    if (contribution.kind !== "monthly" || contribution.status !== "running" || !contribution.firstHoldAt) {
      toLetGo.push(...(await endInStep(tx, contribution, "paused", now)));
      continue;
    }
    if (!contribution.accountPausedAt) {
      await tx.update(schema.contributions).set({ accountPausedAt: now, updatedAt: now }).where(eq(schema.contributions.id, id));
      await queueAccountPausedEmail(tx, contribution, now);
    }
    // A payment that is not taken (a hold in place, a card that waits for its next try) is given up. The
    // contribution itself stays, and so does its saved card.
    const open = await tx.select({ id: pays.id }).from(pays).where(and(eq(pays.contributionId, id), or(eq(pays.status, "to_pay"), eq(pays.status, "held")))).orderBy(pays.id);
    for (const payment of open) {
      if (await giveUpInStep(tx, await lockForPayment(tx, payment.id), "account_paused", now)) toLetGo.push(payment.id);
    }
  }
  return toLetGo;
}

/**
 * Inside the step that lifts an account's pause: every contribution that waits for an account
 * and has this person as its host or its contributor carries on, where the other of the two
 * accounts is in use as well (if it is paused too, the contribution waits for that lift). The
 * months whose day passed while it waited are skipped and never charged afterwards, the mark is
 * cleared, and the contributor is told when the next payment is and how to stop.
 */
export async function resumeContributionsOf(tx: Tx, userId: string, now: Date): Promise<void> {
  const waiting = await tx
    .select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
    .from(schema.contributions)
    .where(and(isNotNull(schema.contributions.accountPausedAt), ne(schema.contributions.status, "ended"), or(eq(schema.contributions.hostId, userId), eq(schema.contributions.contributorId, userId))));
  if (waiting.length === 0) return;
  await lockPairsOf(tx, waiting);
  for (const id of waiting.map((row) => row.id).sort()) {
    const contribution = await lockContribution(tx, id);
    if (contribution.status !== "running" || !contribution.accountPausedAt) continue;
    const otherId = contribution.hostId === userId ? contribution.contributorId : contribution.hostId;
    const [other] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, otherId));
    if (!other || other.pausedAt || other.closedAt) continue;
    const passed = contribution.firstHoldAt ? monthsBetween(contribution.firstHoldAt, contribution.lastWrittenMonth, contribution.accountPausedAt, now) : [];
    await addSkipped(tx, contribution, passed, now);
    await tx.update(schema.contributions).set({ accountPausedAt: null, updatedAt: now }).where(eq(schema.contributions.id, id));
    // The next month whose day is still to come: the first one after everything written or skipped so far.
    const last = Math.max(contribution.lastWrittenMonth, ...passed);
    const next = contribution.firstHoldAt ? monthlyDue(contribution.firstHoldAt, last + 1) : null;
    await queueCarriesOnEmail(tx, contribution, next, now);
  }
}
