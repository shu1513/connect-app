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
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contribution } from "@/db/schema";
import { MoneyError, type Tx } from "@/lib/payments/operations";
import { retireCard } from "./cards";
import { letGo } from "./charge";
import { lockContribution, lockPair } from "./locks";

const pays = schema.contributionPayments;

/**
 * Inside the caller's database step, with the pair's lock and the contribution's lock held. Returns
 * the payments whose hold now has to be let go. Safe to run twice.
 */
export async function endInStep(tx: Tx, contribution: Contribution, how: string, now: Date): Promise<string[]> {
  if (contribution.status !== "ended") {
    await tx.update(schema.contributions).set({ status: "ended", endedAt: now, endedHow: how, updatedAt: now }).where(eq(schema.contributions.id, contribution.id));
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
