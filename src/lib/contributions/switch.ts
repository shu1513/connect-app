/**
 * Saving the founder's projects switch, and what that does to contributions in the same step
 * (plans/23, "What ends a monthly contribution"; plans/25, "The switch" and choice 13).
 *
 * The switch ends nothing. For every host it does not cover after this save:
 *   - every payment of hers that is not taken is given up (a hold in place, a card that failed
 *     and waits for its next try, a bank's confirmation that is waited for, a hold just asked
 *     for), so that switching off and on again quickly cannot bring an old payment back;
 *   - her running monthly contributions are marked with this moment. They stay.
 * For every host it covers again, each marked monthly contribution records as skipped every
 * month whose day fell between its mark and now, and the mark is cleared: a month that passed
 * meanwhile is never charged afterwards, and only such a month.
 *
 * Saving the switch and writing a new payment down wait for each other (one small lock, taken
 * before any other), so a payment that is being written at that very moment cannot slip past.
 * The helper's first job is the net behind this step.
 */
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordAdminAction } from "@/lib/safety/audit";
import { setSwitches, switches, type Switches } from "@/lib/safety/switches";
import { giveUpInStep, letGo } from "./charge";
import { lockContribution, lockForPayment, lockPair, lockSwitchForSaving } from "./locks";
import { addSkipped } from "./skipped";
import { monthsBetween } from "./rules";

const pays = schema.contributionPayments;

const coveredBy = (current: Pick<Switches, "projects" | "projectsHosts">, hostId: string): boolean => current.projects === "everyone" || (current.projects === "named" && current.projectsHosts.includes(hostId));

/** The pairs of these rows, each once, in the one order pairs are locked in everywhere. */
function pairsOf(rows: Array<{ contributorId: string; hostId: string }>): Array<{ contributorId: string; hostId: string }> {
  const seen = new Map<string, { contributorId: string; hostId: string }>();
  for (const row of rows) seen.set(`${row.contributorId}:${row.hostId}`, { contributorId: row.contributorId, hostId: row.hostId });
  return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, pair]) => pair);
}

/**
 * Saves the projects switch for the founder, with its line in the record of the founder's
 * actions, and applies it to contributions, all in one step. Then lets go of what was given up
 * (the helper repeats that until it is done).
 */
export async function saveProjectsSwitch(input: { adminId: string; values: Pick<Partial<Switches>, "projects" | "projectsHosts">; detail: string; now?: Date }): Promise<void> {
  // The moment of the change. Read inside the step, once every lock is held (see below), not when the press arrived.
  let at = input.now ?? new Date();
  const toLetGo = await db.transaction(async (tx) => {
    // Before any other lock.
    await lockSwitchForSaving(tx);
    await setSwitches(input.values, tx);
    await recordAdminAction({ adminId: input.adminId, action: "projects switch set", detail: input.detail }, tx);
    const current = await switches(tx);

    // Every payment that is not taken, and every monthly contribution whose mark may have to change. One that is
    // still at its card step is looked at too: its first hold may be accepted while this step waits for its lock.
    const openPayments = await tx
      .select({ id: pays.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
      .from(pays)
      .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
      .where(and(inArray(pays.status, ["to_pay", "held"]), isNull(pays.endedHow)));
    const giveUp = openPayments.filter((row) => !coveredBy(current, row.hostId));
    const monthly = await tx
      .select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId, switchOffAt: schema.contributions.switchOffAt })
      .from(schema.contributions)
      .where(and(eq(schema.contributions.kind, "monthly"), ne(schema.contributions.status, "ended")));
    const touch = monthly.filter((row) => Boolean(row.switchOffAt) === coveredBy(current, row.hostId));

    for (const pair of pairsOf([...giveUp, ...touch])) await lockPair(tx, pair.contributorId, pair.hostId);
    // Every lock is held now. This is the moment the switch changes for these contributions: no month's payment
    // can be written between here and the end of this step, because writing one waits for the switch's own lock.
    // (Only the check scripts hand a moment in, to pretend it is another day.)
    const now = input.now ?? new Date();
    at = now;

    const letGoOf: string[] = [];
    for (const { id } of [...giveUp].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (await giveUpInStep(tx, await lockForPayment(tx, id), "switch", now)) letGoOf.push(id);
    }
    // Each contribution is read again under its lock, and judged as it stands now.
    for (const { id } of [...touch].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const contribution = await lockContribution(tx, id);
      if (contribution.kind !== "monthly" || contribution.status !== "running") continue;
      if (!coveredBy(current, contribution.hostId)) {
        if (!contribution.switchOffAt) await tx.update(schema.contributions).set({ switchOffAt: now, updatedAt: now }).where(eq(schema.contributions.id, id));
        continue;
      }
      if (!contribution.switchOffAt) continue;
      // Covered again: the months whose day passed meanwhile are skipped, and only those. (A month that fell
      // due before the mark is not touched here: the helper's own rule for a late month decides about it.)
      const passed = contribution.firstHoldAt ? monthsBetween(contribution.firstHoldAt, contribution.lastWrittenMonth, contribution.switchOffAt, now) : [];
      await addSkipped(tx, contribution, passed, now);
      await tx.update(schema.contributions).set({ switchOffAt: null, updatedAt: now }).where(eq(schema.contributions.id, id));
    }
    return letGoOf;
  });
  for (const id of toLetGo) {
    await letGo(id, at).catch((error) => console.error(`[contributions] could not let go of payment ${id} after the switch was saved; the helper will retry`, error));
  }
}
