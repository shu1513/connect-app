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

/**
 * How long the sending service has to report an email as delivered before its silence is told to the founder. The
 * days still count from the sending; without that report there is simply no due day.
 */
export const CONFIRM_WITHIN_MS = 2 * DAY_MS;

/** After the founder has answered an objection and it is taken after all: not before this long after that answer was sent. */
export const AFTER_ANSWER_MS = 3 * DAY_MS;

/**
 * told: the host has their notice. objected: the host said it is wrong, and nothing is taken until the founder has
 * decided. answered: the founder answered and it is taken after all. cancelled: called off. taking: Stripe is being
 * asked. taken: done.
 */
export type DebtStatus = "told" | "objected" | "answered" | "cancelled" | "taking" | "taken";

/** The states in which a take-back can become due: it has its notice, or its objection was answered. */
export const TAKEABLE: readonly string[] = ["told", "answered"];
/** The states in which the amount is still to take and so is set aside on its share: everything but done, called off and nothing. */
export const OPEN: readonly string[] = ["told", "objected", "answered"];

/**
 * The day from which a take-back is taken, or null while there is none (plans/46-part-3-money-owed.md, decision 6).
 *
 *   - Never without proof that the notice email arrived: `noticeArrivedAt` is the moment it had been sent AND reported
 *     as delivered (the later of the two), and is empty while it waits, failed, bounced or is unconfirmed.
 *   - 14 days after that moment. So never less than 14 days after it was sent, which is what the notice says, and
 *     never less than 14 days after it reached her.
 *   - Never earlier than a day an earlier notice named (`promisedAt`: a take-back from before this rule, or the first
 *     day this one was given).
 *   - After an objection the founder answered: also never earlier than 3 days after that answer arrived, and none at
 *     all while the answer has not arrived. An objection can only make the day later, never earlier.
 *   - None while the host's objection is open, or once it is being taken, taken or called off.
 */
export function dueDay(input: { status: string; promisedAt: Date | null; noticeArrivedAt: Date | null; answerArrivedAt: Date | null }): Date | null {
  if (!TAKEABLE.includes(input.status) || input.noticeArrivedAt === null) return null;
  let due = input.noticeArrivedAt.getTime() + NOTICE_MS;
  if (input.promisedAt !== null) due = Math.max(due, input.promisedAt.getTime());
  if (input.status === "answered") {
    if (input.answerArrivedAt === null) return null;
    due = Math.max(due, input.answerArrivedAt.getTime() + AFTER_ANSWER_MS);
  }
  return new Date(due);
}

/** The host can say "I think this is wrong" while they only have their notice. Not twice: an answered take-back cannot be objected to again in the app. */
export const canObject = (debt: { status: string }): boolean => debt.status === "told";
/** The founder can answer an objection, or hold a take-back for one that came by email, in these states. */
export const canAnswer = (debt: { status: string }): boolean => debt.status === "objected";
export const canHold = (debt: { status: string }): boolean => debt.status === "told";
/** What a take-back goes back to when Stripe did not take it: where it stood before. */
export const stateBeforeTaking = (debt: { answer: string | null }): "told" | "answered" => (debt.answer !== null ? "answered" : "told");

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
 * And never more than the bank took back in this dispute, all shares under it counted together (`sameDisputeCents`:
 * what other shares of the same dispute already owe or paid back): where a refund Connect paid for itself had made
 * the charge smaller without making the host's shares smaller, the host does not owe more than the bank's loss.
 */
export function owedCents(input: { sentCents: number; disputedCents: number; chargeLeftCents: number; transferLeftCents: number; othersOpenCents: number; sameDisputeCents?: number }): number {
  const { sentCents, disputedCents, chargeLeftCents, transferLeftCents, othersOpenCents } = input;
  const sameDisputeCents = Number.isFinite(input.sameDisputeCents) ? Math.max(0, Math.floor(input.sameDisputeCents!)) : 0;
  if (![sentCents, disputedCents, chargeLeftCents, transferLeftCents, othersOpenCents].every(Number.isFinite)) return 0;
  if (sentCents <= 0 || disputedCents <= 0) return 0;
  const whole = chargeLeftCents <= 0 || disputedCents >= chargeLeftCents;
  const part = whole ? sentCents : Math.floor((sentCents * disputedCents) / chargeLeftCents);
  const room = Math.max(0, Math.floor(transferLeftCents) - Math.max(0, Math.floor(othersOpenCents)));
  return Math.max(0, Math.min(part, room, Math.floor(disputedCents) - sameDisputeCents));
}

/** Whether a take-back is due to be asked of Stripe now: told, its notice over, and not refused within the last day. */
export function dueToTake(debt: { status: string; dueAt: Date | null; refusedAt: Date | null }, now: Date): boolean {
  if (!TAKEABLE.includes(debt.status)) return false;
  // No due day yet: the notice (or the answer to an objection) has not been sent, or did not arrive.
  if (debt.dueAt === null || now < debt.dueAt) return false;
  return debt.refusedAt === null || now.getTime() - debt.refusedAt.getTime() >= RETRY_MS;
}

/** The founder can call a take-back off until the app starts it. One that has started, or is done, cannot be cancelled. */
export const canCancel = (debt: { status: string }): boolean => OPEN.includes(debt.status) || debt.status === "waiting";

/** Whether the founder is due to be told that Stripe keeps refusing: 30 days after the first refusal, once. */
export function tellFounderOfRefusals(debt: { status: string; dueAt?: Date | null; firstRefusedAt: Date | null; founderToldAt: Date | null }, now: Date): boolean {
  // Not while it has no due day, or a day that has not come (a notice that was sent again, say): nothing is being
  // tried then, so "it keeps trying" would not be true.
  if (debt.dueAt === null || (debt.dueAt !== undefined && debt.dueAt.getTime() > now.getTime())) return false;
  return TAKEABLE.includes(debt.status) && debt.firstRefusedAt !== null && debt.founderToldAt === null && now.getTime() - debt.firstRefusedAt.getTime() >= TELL_FOUNDER_AFTER_MS;
}

/** The label of the request to Stripe is made from this (the money action adds the attempt's number). */
export const takebackLabel = (debtId: string): string => `takeback:${debtId}`;

// ---------------------------------------------------------------------------
// A refund given after the host had collected (plans/46-part-3-money-owed.md, decision 4)
// ---------------------------------------------------------------------------

/** The states in which an amount is still set aside on its share: open, or waiting for the founder. */
export const RESERVED: readonly string[] = [...OPEN, "waiting"];

/**
 * The room on a transfer: what Stripe shows as not reversed, less the take-backs on that share that are still open
 * (told, waiting, objected, answered), less what the host paid back outside Stripe for that share. A reversal the
 * founder made by hand at Stripe is in the first number already and is not counted again.
 */
export function roomOn(input: { transferLeftCents: number; reservedCents: number; repaidOutsideCents: number }): number {
  const { transferLeftCents, reservedCents, repaidOutsideCents } = input;
  if (![transferLeftCents, reservedCents, repaidOutsideCents].every(Number.isFinite)) return 0;
  return Math.max(0, Math.floor(transferLeftCents) - Math.max(0, Math.floor(reservedCents)) - Math.max(0, Math.floor(repaidOutsideCents)));
}

/**
 * What one refund makes the host owe.
 *
 * - `reductionCents`: what her share lost to THIS refund (her share before less her share after, as written on the
 *   refund when Stripe confirmed it).
 * - `reductionsBeforeCents`: the same, summed over every earlier refund after the sending, whatever became of the
 *   take-backs for them (written as nothing, cut short, called off, repaid).
 * - The reductions are never counted beyond what was really sent (`sentCents`): once refunds have used up all that
 *   was sent, a further refund adds nothing.
 * - And never more than the room on the transfer (`roomCents`).
 */
export function refundOwes(input: { sentCents: number; reductionsBeforeCents: number; reductionCents: number; roomCents: number }): number {
  const { sentCents, reductionsBeforeCents, reductionCents, roomCents } = input;
  if (![sentCents, reductionsBeforeCents, reductionCents, roomCents].every(Number.isFinite)) return 0;
  if (sentCents <= 0 || reductionCents <= 0) return 0;
  const before = Math.min(sentCents, Math.max(0, Math.floor(reductionsBeforeCents)));
  const after = Math.min(sentCents, Math.max(0, Math.floor(reductionsBeforeCents)) + Math.floor(reductionCents));
  return Math.max(0, Math.min(after - before, Math.floor(roomCents)));
}

/**
 * What a lost dispute starts from on a share that had refunds after the sending: what was sent, less everything her
 * share lost to those refunds, never below nothing. With no such refund it is what was sent, as before.
 */
export function leftAfterRefunds(sentCents: number, reductionsCents: number): number {
  if (!Number.isFinite(sentCents) || !Number.isFinite(reductionsCents)) return 0;
  return Math.max(0, Math.floor(sentCents) - Math.max(0, Math.floor(reductionsCents)));
}

/** The founder can settle a take-back outside the app while it is open or waiting: not once the app has started taking it. */
export const canSettle = (debt: { status: string }): boolean => RESERVED.includes(debt.status);

/**
 * What a host has really paid back for one take-back, whichever way: taken by the app, counted from a reversal made
 * by hand at Stripe, or paid to Connect outside the app. (A take-back that a reversal by hand paid in full is "taken"
 * with nothing left on it: all of it is in `byHandCents`.) What a reversal by hand took ON TOP of a take-back that
 * had ended (`overpaidCents`) is not part of it: that is owed back to her in any case, and told on its own.
 */
export const paidBackCents = (debt: { status: string; amountCents: number; repaidCents: number | null; byHandCents: number }): number =>
  (debt.status === "taken" ? debt.amountCents : 0) + (debt.repaidCents ?? 0) + debt.byHandCents;

/**
 * What one take-back counts against what the bank took in its dispute (all shares of a dispute together never owe
 * more than that): what it still reserves, and what was really paid for it, whichever way. A waived amount, and the
 * part of a settlement that was let go, count for nothing: that is room for another share again.
 */
export const againstBank = (row: { status: string; amountCents: number; repaidCents: number | null; byHandCents: number }): number =>
  ([...OPEN, "taking", "taken"].includes(row.status) ? row.amountCents : 0) + (row.status === "settled" ? (row.repaidCents ?? 0) : 0) + row.byHandCents;

/**
 * Of what a host paid for a take-back whose cause has fallen away: what is still to give back to her. What the
 * founder was already told to give back of it (because less had turned out to be owed) is not told a second time.
 * The emails and the pages all use this one sum.
 */
export const toGiveBackCents = (debt: { status: string; amountCents: number; repaidCents: number | null; byHandCents: number; excessToldCents: number }): number =>
  Math.max(0, paidBackCents(debt) - debt.excessToldCents);

/**
 * What a host paid back outside Stripe for a share and still stands as paid: the payments of settled take-backs
 * whose cause has NOT fallen away. Once it has (the refund failed after all, the bank decided the other way), the
 * founder is told to give that money back, and it no longer uses up room on the transfer: a new take-back on the same
 * share (the customer is refunded a second time, say) is written for its full amount again.
 */
export const repaidOutsideStanding = (rows: Array<{ status: string; repaidCents: number | null; leftoverToldAt: Date | null }>): number =>
  rows.filter((row) => row.status === "settled" && row.leftoverToldAt === null).reduce((sum, row) => sum + (row.repaidCents ?? 0), 0);

