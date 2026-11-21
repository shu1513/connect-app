/**
 * Taking a share back from a host after a lost dispute: the rules, with no database and no Stripe
 * in them (plans/47-bank-disputes.md, decision 10 and part 3).
 *
 * A host can collect their share before the customer's bank disputes the payment. If the dispute
 * is then lost, the bank has taken the money from Connect, and the host still has their share of
 * it. The app tells the host in writing, waits 14 days, and then asks Stripe to take that amount
 * back out of the transfer that carried it. Never while a dispute is open, never more than was
 * sent, and never the bank's fees.
 */

const DAY_MS = 24 * 3_600_000;

/** The host is told, and nothing is taken before this long has passed (host agreement draft, section 9.4). */
export const NOTICE_MS = 14 * DAY_MS;
/** After Stripe refuses, it is tried again this much later. */
export const RETRY_MS = DAY_MS;
/** After this long of refusals the founder is told. It keeps being tried. */
export const TELL_FOUNDER_AFTER_MS = 30 * DAY_MS;

/** told: the host has their notice. cancelled: the founder called it off. taking: Stripe is being asked. taken: done. */
export type DebtStatus = "told" | "cancelled" | "taking" | "taken";

/**
 * What a host owes for one share that was sent to them, after a dispute over its payment was lost.
 *
 * - `sentCents`: what the transfer for this share carried.
 * - `disputedCents` of `chargeLeftCents`: the bank disputed this much of what was left of the charge
 *   (the charge less what had been refunded). A dispute over all of it takes the whole share; one
 *   over a part takes the same part, rounded down to the cent.
 * - `transferLeftCents`: what is left of that transfer at Stripe after everything already reversed.
 * - `othersOpenCents`: what other take-backs on the same share are still to take (two disputes can
 *   be lost on one charge). Together they never ask for more than is left.
 * And never more than the bank took back in this dispute: where a refund Connect paid for itself had made the charge
 * smaller without making the host's share smaller, the host does not owe more than the bank's loss.
 */
export function owedCents(input: { sentCents: number; disputedCents: number; chargeLeftCents: number; transferLeftCents: number; othersOpenCents: number }): number {
  const { sentCents, disputedCents, chargeLeftCents, transferLeftCents, othersOpenCents } = input;
  if (![sentCents, disputedCents, chargeLeftCents, transferLeftCents, othersOpenCents].every(Number.isFinite)) return 0;
  if (sentCents <= 0 || disputedCents <= 0) return 0;
  const whole = chargeLeftCents <= 0 || disputedCents >= chargeLeftCents;
  const part = whole ? sentCents : Math.floor((sentCents * disputedCents) / chargeLeftCents);
  const room = Math.max(0, Math.floor(transferLeftCents) - Math.max(0, Math.floor(othersOpenCents)));
  return Math.max(0, Math.min(part, room, Math.floor(disputedCents)));
}

/** Whether a take-back is due to be asked of Stripe now: told, its notice over, and not refused within the last day. */
export function dueToTake(debt: { status: string; dueAt: Date; refusedAt: Date | null }, now: Date): boolean {
  if (debt.status !== "told") return false;
  if (now < debt.dueAt) return false;
  return debt.refusedAt === null || now.getTime() - debt.refusedAt.getTime() >= RETRY_MS;
}

/** The founder can call a take-back off until the app starts it. One that has started, or is done, cannot be cancelled. */
export const canCancel = (debt: { status: string }): boolean => debt.status === "told";

/** Whether the founder is due to be told that Stripe keeps refusing: 30 days after the first refusal, once. */
export function tellFounderOfRefusals(debt: { status: string; firstRefusedAt: Date | null; founderToldAt: Date | null }, now: Date): boolean {
  return debt.status === "told" && debt.firstRefusedAt !== null && debt.founderToldAt === null && now.getTime() - debt.firstRefusedAt.getTime() >= TELL_FOUNDER_AFTER_MS;
}

/** The label of the request to Stripe is made from this (the money action adds the attempt's number). */
export const takebackLabel = (debtId: string): string => `takeback:${debtId}`;
