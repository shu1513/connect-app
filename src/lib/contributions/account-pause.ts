/**
 * A paused account and its contributions (plans/54-contributions-paused-with-an-account.md).
 *
 * A monthly contribution that has begun is paused with the account, not ended: it is marked with
 * the moment the account was paused, a payment of it that is not taken is given up, and no month
 * is written while the mark stands (monthly.ts). When the pause is lifted the mark is cleared,
 * the months whose day passed are skipped for good, and it carries on by itself. The founder's
 * switch does the same with a mark of its own (switch.ts); the two never touch each other's mark.
 *
 * Everything else a paused person has ends as it always did: a contribution made once, a tip, a
 * monthly one still at its first card step. Their one payment, if it was not taken, is let go.
 */
import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import type { Contribution } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { giveUpInStep } from "./charge";
import { queueAccountPausedEmail, queueCarriesOnEmail } from "./emails";
import { endInStep } from "./ending";
import { lockContribution, lockForPayment, lockPair } from "./locks";
import { monthlyDue, monthsBetween } from "./rules";
import { addSkipped, skippedOf } from "./skipped";

const pays = schema.contributionPayments;

/** The pairs of these rows, each once, in the one order pairs are locked in everywhere. */
async function lockPairsOf(tx: Tx, rows: Array<{ contributorId: string; hostId: string }>): Promise<void> {
  const pairs = new Map<string, { contributorId: string; hostId: string }>();
  for (const row of rows) pairs.set(`${row.contributorId}:${row.hostId}`, row);
  for (const key of [...pairs.keys()].sort()) await lockPair(tx, pairs.get(key)!.contributorId, pairs.get(key)!.hostId);
}

/**
 * Makes one running monthly contribution wait for a paused account, with the pair's lock and the
 * contribution's lock held. `since` is the moment the account was paused: the mark is that moment,
 * not the moment this runs, so that a month whose day fell in between counts as passed during
 * the pause. The contributor is told, and every payment that is not taken is given up (the
 * contribution stays, and so does its saved card). Returns the payments whose hold now has to be
 * let go. Safe to run twice.
 */
export async function makeWait(tx: Tx, contribution: Contribution, since: Date, now: Date): Promise<string[]> {
  if (!contribution.accountPausedAt) {
    await tx.update(schema.contributions).set({ accountPausedAt: since, updatedAt: now }).where(eq(schema.contributions.id, contribution.id));
    await queueAccountPausedEmail(tx, contribution, since);
  }
  const toLetGo: string[] = [];
  const open = await tx.select({ id: pays.id }).from(pays).where(and(eq(pays.contributionId, contribution.id), or(eq(pays.status, "to_pay"), eq(pays.status, "held")), isNull(pays.endedHow))).orderBy(pays.id);
  for (const payment of open) {
    if (await giveUpInStep(tx, await lockForPayment(tx, payment.id), "account_paused", now)) toLetGo.push(payment.id);
  }
  return toLetGo;
}

/**
 * Inside the step that pauses an account, at the moment `pausedAt` written on it: every
 * contribution the person has that is not ended, as a host and as a contributor. A monthly one
 * that has begun waits; the rest end. The pairs are locked first, all of them, then each
 * contribution, as an ending does it. Returns the payments whose hold now has to be let go (the
 * caller does that once its step is saved, and the helper repeats it until it is done).
 */
export async function pauseContributionsOf(tx: Tx, userId: string, pausedAt: Date, now: Date = pausedAt): Promise<string[]> {
  const found = await tx
    .select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
    .from(schema.contributions)
    .where(and(ne(schema.contributions.status, "ended"), or(eq(schema.contributions.hostId, userId), eq(schema.contributions.contributorId, userId))));
  await lockPairsOf(tx, found);
  const toLetGo: string[] = [];
  for (const id of found.map((row) => row.id).sort()) {
    const contribution = await lockContribution(tx, id);
    if (contribution.status === "ended") continue;
    const waits = contribution.kind === "monthly" && contribution.status === "running" && contribution.firstHoldAt;
    toLetGo.push(...(waits ? await makeWait(tx, contribution, pausedAt, now) : await endInStep(tx, contribution, "paused", now)));
  }
  return toLetGo;
}

/**
 * A contribution that waited for an account carries on, with its pair's lock and its own lock
 * held: the months whose day passed between its mark and `at` are skipped and never charged
 * afterwards, the mark is cleared, and the contributor is told what comes next.
 */
async function carryOn(tx: Tx, contribution: Contribution, at: Date): Promise<void> {
  if (contribution.status !== "running" || !contribution.accountPausedAt) return;
  const passed = contribution.firstHoldAt ? monthsBetween(contribution.firstHoldAt, contribution.lastWrittenMonth, contribution.accountPausedAt, at) : [];
  await addSkipped(tx, contribution, passed, at);
  await tx.update(schema.contributions).set({ accountPausedAt: null, updatedAt: at }).where(eq(schema.contributions.id, contribution.id));
  // What the contributor is told about the next payment, from the same sums the helper will do: the first month
  // that is neither written nor skipped. Its day may lie behind us (a month that fell due shortly before the
  // pause and was not written yet): then it can be held at once. And while the founder's switch does not cover
  // the host, nothing is held whatever the day.
  const skipped = new Set([...skippedOf(contribution), ...passed]);
  let number = contribution.lastWrittenMonth + 1;
  while (skipped.has(number)) number++;
  const due = contribution.firstHoldAt ? monthlyDue(contribution.firstHoldAt, number) : null;
  await queueCarriesOnEmail(tx, contribution, contribution.switchOffAt ? "waits" : due && due > at ? due : "now", at);
}

/**
 * Inside the step that lifts an account's pause: every contribution that waits for an account
 * and has this person as its host or its contributor carries on, where the other of the two
 * accounts is in use as well (if it is paused too, the contribution waits for that lift).
 *
 * The moment that separates "passed during the pause" from "still to come" is read once every
 * lock is held, as saving the founder's switch does it: a month whose day falls while this step
 * waits for a lock belongs to the pause. (Only the check script hands a moment in.)
 */
export async function resumeContributionsOf(tx: Tx, userId: string, pretendNow?: Date): Promise<void> {
  const waiting = await tx
    .select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
    .from(schema.contributions)
    .where(and(isNotNull(schema.contributions.accountPausedAt), ne(schema.contributions.status, "ended"), or(eq(schema.contributions.hostId, userId), eq(schema.contributions.contributorId, userId))));
  if (waiting.length === 0) return;
  await lockPairsOf(tx, waiting);
  const locked: Contribution[] = [];
  for (const id of waiting.map((row) => row.id).sort()) locked.push(await lockContribution(tx, id));
  const at = pretendNow ?? new Date();
  for (const contribution of locked) {
    const otherId = contribution.hostId === userId ? contribution.contributorId : contribution.hostId;
    const [other] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, otherId));
    if (!other || other.pausedAt || other.closedAt) continue;
    await carryOn(tx, contribution, at);
  }
}

/**
 * The helper's net behind the lift: a contribution that still waits for an account although
 * neither of its two accounts is paused or closed any more carries on. (It should not happen. It
 * can, when the helper marked a contribution in the very moment the pause was lifted, or when
 * two pauses of one pair were lifted in the same instant and each saw the other still standing.)
 */
export async function carryOnWhereNobodyIsPaused(now: Date = new Date()): Promise<void> {
  const host = alias(schema.user, "host_account");
  const giver = alias(schema.user, "giver_account");
  const stale = await db
    .select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
    .from(schema.contributions)
    .innerJoin(host, eq(host.id, schema.contributions.hostId))
    .innerJoin(giver, eq(giver.id, schema.contributions.contributorId))
    .where(and(isNotNull(schema.contributions.accountPausedAt), eq(schema.contributions.status, "running"), isNull(host.pausedAt), isNull(host.closedAt), isNull(giver.pausedAt), isNull(giver.closedAt)))
    .limit(50);
  for (const found of stale) {
    try {
      await db.transaction(async (tx) => {
        await lockPair(tx, found.contributorId, found.hostId);
        const contribution = await lockContribution(tx, found.id);
        // Read again now that the locks are held: one of the two may have been paused a moment ago.
        const people = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(or(eq(schema.user.id, contribution.hostId), eq(schema.user.id, contribution.contributorId)));
        if (people.length !== 2 || people.some((person) => person.pausedAt || person.closedAt)) return;
        await carryOn(tx, contribution, now);
      });
    } catch (error) {
      console.error(`[contributions] could not let contribution ${found.id} carry on after its accounts' pauses were lifted; will retry`, error);
    }
  }
}
