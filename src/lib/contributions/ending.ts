/**
 * Ending a contribution (plans/23, "What ends a monthly contribution"; plans/25, "ending.ts").
 * This is the state and its guards. The buttons, and the places outside that end a contribution
 * (a block, a paused or closed account, the end of a project), come with part 2b and call this.
 *
 * In one step the contribution is marked ended and every payment of it that is not taken is given
 * up, one made once included. From that moment nothing new is asked of Stripe for those payments
 * except letting their holds go, which comes right after and is repeated by the helper until it
 * is done. Money that was already taken is not touched.
 */
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contribution } from "@/db/schema";
import { MoneyError, type Tx } from "@/lib/payments/operations";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { retireCard } from "./cards";
import { letGo } from "./charge";
import { queueEndedEmails } from "./emails";
import { lockContribution, lockPair } from "./locks";

const pays = schema.contributionPayments;

/**
 * Inside the caller's database step, with the pair's lock and the contribution's lock held. Returns
 * the payments whose hold now has to be let go. Safe to run twice.
 */
export async function endInStep(tx: Tx, contribution: Contribution, how: string, now: Date): Promise<string[]> {
  if (contribution.status !== "ended") {
    await tx.update(schema.contributions).set({ status: "ended", endedAt: now, endedHow: how, updatedAt: now }).where(eq(schema.contributions.id, contribution.id));
    // A monthly contribution that had begun: its contributor is told, with the reason, and its host where she is to know.
    await queueEndedEmails(tx, contribution, how);
  }
  await retireCard(tx, contribution.id, now);
  const openOnes = await tx
    .select({ id: pays.id })
    .from(pays)
    .where(and(eq(pays.contributionId, contribution.id), inArray(pays.status, ["to_pay", "held"]), isNull(pays.endedHow)))
    .orderBy(asc(pays.id))
    .for("update");
  const ids = openOnes.map((payment) => payment.id);
  if (ids.length > 0) await tx.update(pays).set({ endedHow: how, nextTryAt: null, updatedAt: now }).where(inArray(pays.id, ids));
  return ids;
}

type Reader = Pick<typeof db, "select">;

/**
 * Why a contribution that has not ended can no longer go on, or null when it can: its project
 * ended, either of the two blocked the other, either account is paused or closed, or the host's
 * page is suspended (plans/23, "What ends a monthly contribution"). The steps that cause these end
 * the contributions themselves, in their own step; the helper's jobs ask this right before they
 * start anything new, as the net behind them.
 */
export async function whyMustEnd(reader: Reader, contribution: Pick<Contribution, "projectId" | "hostId" | "contributorId">): Promise<string | null> {
  const [project] = await reader.select({ status: schema.projects.status }).from(schema.projects).where(eq(schema.projects.id, contribution.projectId));
  if (project?.status !== "running") return "project_ended";
  const people = await reader.select({ id: schema.user.id, pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(inArray(schema.user.id, [contribution.hostId, contribution.contributorId]));
  if (people.length !== 2 || people.some((person) => person.closedAt)) return "closed";
  if (people.some((person) => person.pausedAt)) return "paused";
  const [page] = await reader.select({ status: schema.hostProfiles.status }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, contribution.hostId));
  if (page?.status === "suspended") return "suspended";
  if (await isBlockedEitherWay(contribution.hostId, contribution.contributorId, reader)) return "blocked";
  return null;
}

/**
 * Ends, inside the caller's database step, every contribution among these that has not ended, and
 * gives up their payments that are not taken (one made once included). The pairs are locked first,
 * all of them, in the one order pairs are locked in everywhere; then each contribution. Returns
 * the payments whose hold now has to be let go: the caller does that after its step is saved
 * (`letGoAll`), and the helper repeats it until it is done.
 */
async function endAllInStep(tx: Tx, found: Array<{ id: string; contributorId: string; hostId: string }>, how: string, now: Date): Promise<string[]> {
  const pairs = new Map<string, { contributorId: string; hostId: string }>();
  for (const row of found) pairs.set(`${row.contributorId}:${row.hostId}`, row);
  for (const key of [...pairs.keys()].sort()) await lockPair(tx, pairs.get(key)!.contributorId, pairs.get(key)!.hostId);
  const toLetGo: string[] = [];
  for (const id of found.map((row) => row.id).sort()) {
    const contribution = await lockContribution(tx, id);
    if (contribution.status !== "ended") toLetGo.push(...(await endInStep(tx, contribution, how, now)));
  }
  return toLetGo;
}

const notEnded = ne(schema.contributions.status, "ended");
const found = (tx: Tx, where: ReturnType<typeof and>) => tx.select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId }).from(schema.contributions).where(where);

/** A block: every contribution between the two, whichever of them is the host. In the step that saves the block. */
export async function endContributionsBetween(tx: Tx, a: string, b: string, how: string, now: Date): Promise<string[]> {
  // The pair's locks first, also when nothing is found yet: a contribution that starts at this very moment
  // waits for them, and then sees the block (start.ts asks again once it has the pair's lock).
  const both = [
    { contributorId: a, hostId: b },
    { contributorId: b, hostId: a },
  ].sort((x, y) => (`${x.contributorId}:${x.hostId}` < `${y.contributorId}:${y.hostId}` ? -1 : 1));
  for (const pair of both) await lockPair(tx, pair.contributorId, pair.hostId);
  return endAllInStep(tx, await found(tx, and(notEnded, inArray(schema.contributions.hostId, [a, b]), inArray(schema.contributions.contributorId, [a, b]))), how, now);
}

/**
 * An account paused or closed: every contribution the person has, as a host and as a contributor.
 * `asHostOnly` is for a host whose page is suspended: what she contributes to others goes on.
 * In the step that saves it, after the person's line was written.
 */
export async function endContributionsOf(tx: Tx, userId: string, how: string, now: Date, opts: { asHostOnly?: boolean } = {}): Promise<string[]> {
  const mine = opts.asHostOnly ? eq(schema.contributions.hostId, userId) : or(eq(schema.contributions.hostId, userId), eq(schema.contributions.contributorId, userId));
  return endAllInStep(tx, await found(tx, and(notEnded, mine)), how, now);
}

/** The host ends her project: every contribution to it. In the step that ends the project. */
export async function endContributionsOfProject(tx: Tx, projectId: string, how: string, now: Date): Promise<string[]> {
  return endAllInStep(tx, await found(tx, and(notEnded, eq(schema.contributions.projectId, projectId))), how, now);
}

/** Lets go of the holds of payments a step has just given up. Never throws: the giving up is saved, and the helper repeats the letting-go until it is done. */
export async function letGoAll(paymentIds: string[], now: Date = new Date()): Promise<void> {
  for (const id of paymentIds) {
    await letGo(id, now).catch((error) => console.error(`[contributions] could not let go of payment ${id} yet; the helper will retry`, error));
  }
}

/** Ends one contribution, and lets go of what was only held. */
export async function endContribution(contributionId: string, how: string, now: Date = new Date()): Promise<void> {
  const toLetGo = await db.transaction(async (tx) => {
    const [found] = await tx.select({ contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId }).from(schema.contributions).where(eq(schema.contributions.id, contributionId));
    if (!found) throw new MoneyError("Contribution not found.");
    await lockPair(tx, found.contributorId, found.hostId);
    return endInStep(tx, await lockContribution(tx, contributionId), how, now);
  });
  for (const id of toLetGo) {
    await letGo(id, now).catch((error) => console.error(`[contributions] could not let go of payment ${id} yet; the helper will retry`, error));
  }
}
