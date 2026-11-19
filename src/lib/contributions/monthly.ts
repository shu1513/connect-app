/**
 * The monthly rhythm, and the buttons that stop (plans/23, "When the monthly payment is made",
 * "Cancelling"; plans/25, "start.ts, monthly.ts").
 *
 *   writeDuePayments   the helper's job: each running monthly contribution's next payment is
 *                      written down when its day has come, to be tried with the saved card
 *   stopContribution   the contributor stops: at once, whatever else is going on
 *   letPaymentGo       one payment that is not taken yet is let go, by the contributor, the host
 *                      or the founder. For a monthly contribution that month is skipped and the
 *                      contribution goes on; letting go is not stopping.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contribution } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { isId } from "@/lib/projects/projects";
import { recordAdminAction } from "@/lib/safety/audit";
import { projectsOnFor } from "@/lib/safety/switches";
import { giveUpInStep, letGo, writeDownPayment } from "./charge";
import { endContribution, endInStep, letGoAll, whyMustEnd } from "./ending";
import { lockContribution, lockForPayment, lockPair, lockSwitchForWriting } from "./locks";
import { ContributionError, dueMonths } from "./rules";

const BATCH = 50;
const DAY_MS = 24 * 3_600_000;

/** The numbers of the months that were skipped, as they are kept on a contribution. */
export function skippedOf(contribution: Pick<Contribution, "skippedMonths">): number[] {
  try {
    const parsed: unknown = JSON.parse(contribution.skippedMonths);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/** Adds months to the ones a contribution skipped, inside the caller's step, with the contribution locked. */
export async function addSkipped(tx: Tx, contribution: Contribution, months: number[], now: Date, alsoLastWritten?: number): Promise<void> {
  if (months.length === 0 && alsoLastWritten === undefined) return;
  const skipped = [...new Set([...skippedOf(contribution), ...months])].sort((a, b) => a - b);
  await tx
    .update(schema.contributions)
    .set({ skippedMonths: JSON.stringify(skipped), ...(alsoLastWritten !== undefined && alsoLastWritten > contribution.lastWrittenMonth ? { lastWrittenMonth: alsoLastWritten } : {}), updatedAt: now })
    .where(eq(schema.contributions.id, contribution.id));
}

/**
 * The helper's job: for every running monthly contribution whose next day has come, write that
 * month's payment down, once, to be tried with the saved card at once. A month whose day lies
 * more than 7 days back is recorded as skipped and never made up for. Nothing is written while the
 * founder's switch does not cover the host. Safe to run again.
 */
export async function writeDuePayments(now: Date = new Date()): Promise<void> {
  const due = await db
    .select({ id: schema.contributions.id, contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
    .from(schema.contributions)
    .where(
      and(
        eq(schema.contributions.kind, "monthly"),
        eq(schema.contributions.status, "running"),
        isNotNull(schema.contributions.firstHoldAt),
        isNull(schema.contributions.switchOffAt),
        // Roughly, by the database's own month arithmetic and a day to spare; the exact day is worked out below.
        sql`${schema.contributions.firstHoldAt} + make_interval(months => ${schema.contributions.lastWrittenMonth}) <= ${new Date(now.getTime() + DAY_MS).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(schema.contributions.updatedAt))
    .limit(BATCH);
  for (const found of due) {
    try {
      const toLetGo = await db.transaction(async (tx): Promise<string[]> => {
        // Before any other lock: writing a payment and saving the founder's switch wait for each other.
        await lockSwitchForWriting(tx);
        await lockPair(tx, found.contributorId, found.hostId);
        const contribution = await lockContribution(tx, found.id);
        if (contribution.kind !== "monthly" || contribution.status !== "running" || !contribution.firstHoldAt || contribution.switchOffAt) return [];
        // A contribution that can no longer go on (a block between the two, an account paused or closed, the
        // project ended) is ended here, and no payment is written. The steps that cause these end it
        // themselves; this is the net behind them.
        const over = await whyMustEnd(tx, contribution);
        if (over) return endInStep(tx, contribution, over, now);
        // Nothing new is started while the switch does not cover her. (The step that saves the switch marks her contributions; this is the net behind it.)
        if (!(await projectsOnFor(contribution.hostId, tx))) return [];
        const due = dueMonths(contribution.firstHoldAt, contribution.lastWrittenMonth, now);
        // A month that was skipped while the switch was off (choice 13) is never written, also when its day has only just come.
        const alreadySkipped = due.write !== null && skippedOf(contribution).includes(due.write);
        const missed = alreadySkipped ? [...due.missed, due.write!] : due.missed;
        const write = alreadySkipped ? null : due.write;
        if (missed.length > 0) await addSkipped(tx, contribution, missed, now, Math.max(...missed));
        if (write === null) return [];
        const [current] = await tx.select().from(schema.contributions).where(eq(schema.contributions.id, contribution.id));
        await writeDownPayment(tx, current, { number: write, originKey: `month:${contribution.id}:${write}`, tryNow: true }, now);
        return [];
      });
      await letGoAll(toLetGo, now);
    } catch (error) {
      console.error(`[contributions] could not write down the next payment of contribution ${found.id}; will retry`, error);
    }
  }
}

/**
 * "Stop contributing": the contributor ends their contribution. It takes effect at once, whatever
 * else is going on, also while the founder's switch is off: no further month is ever held or
 * taken, and a payment that is still only held is let go. Money that was taken is not returned.
 */
export async function stopContribution(input: { contributionId: string; contributorId: string; now?: Date }): Promise<void> {
  if (!isId(input.contributionId)) throw new ContributionError("Contribution not found.");
  const [found] = await db
    .select({ id: schema.contributions.id })
    .from(schema.contributions)
    .where(and(eq(schema.contributions.id, input.contributionId.toLowerCase()), eq(schema.contributions.contributorId, input.contributorId)));
  // Someone else's and one that does not exist look the same.
  if (!found) throw new ContributionError("Contribution not found.");
  await endContribution(found.id, "stopped", input.now ?? new Date());
}

const HOW = { contributor: "cancelled", host: "host_let_go", founder: "founder_let_go" } as const;

/**
 * One payment that has not been taken is let go: "Cancel, nothing is charged" for the contributor
 * (also before they have paid, at the card step), "Let it go" for the host and for the founder
 * (a hold in place only). Each is checked here to be who they say: the contributor of that
 * contribution, its host, or the founder (whose action is recorded). The server accepts it until
 * the money has really been taken; if it was taken in that very moment, all of it is owed back
 * (charge.ts, `letGo`).
 *
 * For a monthly contribution that has had its first hold, the month is skipped and the
 * contribution goes on. A contribution made once, and a monthly one that never got its first
 * hold, end with their only payment.
 */
export async function letPaymentGo(input: { paymentId: string; by: keyof typeof HOW; actorId: string; note?: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  if (!isId(input.paymentId)) throw new ContributionError("Payment not found.");
  const paymentId = input.paymentId.toLowerCase();
  const note = (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (input.by === "founder" && !note) throw new ContributionError("Please give a reason. It is kept.");
  await db.transaction(async (tx) => {
    const [seen] = await tx
      .select({ contributorId: schema.contributions.contributorId, hostId: schema.contributions.hostId })
      .from(schema.contributionPayments)
      .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
      .where(eq(schema.contributionPayments.id, paymentId));
    // Someone else's and one that does not exist look the same.
    if (!seen || (input.by === "contributor" && seen.contributorId !== input.actorId) || (input.by === "host" && seen.hostId !== input.actorId)) throw new ContributionError("Payment not found.");
    const locked = await lockForPayment(tx, paymentId);
    const { contribution, payment } = locked;
    if (payment.status === "taken") throw new ContributionError("This payment's money has already been taken. Giving it back is a refund.");
    if (payment.status === "given_up" || payment.endedHow) throw new ContributionError("This payment was already cancelled.");
    // The host and the founder let a hold go. Only the contributor cancels a payment they have not paid yet.
    if (payment.status !== "held" && input.by !== "contributor") throw new ContributionError("Nothing is held for this payment at the moment.");
    await giveUpInStep(tx, locked, HOW[input.by], now);
    const [after] = await tx.select().from(schema.contributions).where(eq(schema.contributions.id, contribution.id));
    if (after.kind === "monthly" && after.status !== "ended") await addSkipped(tx, after, [payment.number], now);
    if (input.by === "founder") await recordAdminAction({ adminId: input.actorId, action: "contribution payment let go", targetUserId: contribution.hostId, targetId: payment.id, detail: note }, tx);
  });
  await letGo(paymentId, now).catch((error) => console.error(`[contributions] could not let go of payment ${paymentId} yet; the helper will retry`, error));
}
