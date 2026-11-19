/**
 * The plain rules of contributions (plans/23, "How it works for a contributor", "The money";
 * plans/25). No database, no Stripe: every function here is tested on its own.
 */

/** A contribution was refused for a reason a person can read. Nothing was changed. */
export class ContributionError extends Error {}

const DAY_MS = 24 * 3_600_000;

export const CONTRIBUTION = {
  /** $5.00, for one made once and for a monthly one. */
  minCents: 500,
  /** $100,000.00 for each charge. */
  maxCents: 10_000_000,
  /** The line of the $1,000 rule. More than this crosses it; exactly this does not. */
  lineCents: 100_000,
  /** The window the line is counted over, and the long wait: 30 days. */
  windowMs: 30 * DAY_MS,
  /** The usual wait before a host can collect a share: 7 days after the money was taken. */
  usualWaitMs: 7 * DAY_MS,
  longWaitMs: 30 * DAY_MS,
  /** Held money may be taken until one hour before its hold ends (plans/25, choice 12). */
  lastMomentBeforeExpiryMs: 3_600_000,
} as const;

/**
 * Reads an amount typed in dollars and cents ("25", "25.5", "$1,000.00") and gives it back in
 * cents, or refuses it in words for the person. US dollars only.
 */
export function readAmount(typed: string): number {
  const text = typed.trim().replace(/^\$\s*/, "");
  // Either plain digits, or digits grouped in threes with commas; then, if any, one or two digits of cents.
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(text)) throw new ContributionError("Please type an amount in dollars, like 25 or 25.50.");
  const [dollars, cents = ""] = text.replace(/,/g, "").split(".");
  if (dollars.length > 7) throw new ContributionError("The largest contribution is $100,000.");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (amount < CONTRIBUTION.minCents) throw new ContributionError("The smallest contribution is $5.");
  if (amount > CONTRIBUTION.maxCents) throw new ContributionError("The largest contribution is $100,000.");
  return amount;
}

/** A host suggests up to this many amounts for each kind (plans/23, choice B). */
export const SUGGESTED_AMOUNTS = 3;

/**
 * Reads the amounts a host typed into her boxes for one kind. Empty boxes are left out; the rest
 * must each be a valid contribution; the same amount twice counts once. Given back in cents, the
 * smallest first. None at all means she does not offer that kind.
 */
export function readSuggested(typed: string[]): number[] {
  const filled = typed.map((box) => box.trim()).filter((box) => box !== "");
  if (filled.length > SUGGESTED_AMOUNTS) throw new ContributionError(`You can suggest up to ${SUGGESTED_AMOUNTS} amounts.`);
  return [...new Set(filled.map(readAmount))].sort((a, b) => a - b);
}

/** The suggested amounts as they are kept on a project (cents, separated by commas), read strictly: anything that is not a valid amount is left out. */
export function suggestedOf(kept: string): number[] {
  return kept
    .split(",")
    .filter((part) => /^\d+$/.test(part))
    .map(Number)
    .filter((cents) => cents >= CONTRIBUTION.minCents && cents <= CONTRIBUTION.maxCents)
    .slice(0, SUGGESTED_AMOUNTS);
}

/** The kinds of contribution a project takes: the ones its host suggests an amount for. */
export function kindsOffered(project: { suggestedOnce: string; suggestedMonthly: string }): Array<"once" | "monthly"> {
  return [...(suggestedOf(project.suggestedOnce).length > 0 ? (["once"] as const) : []), ...(suggestedOf(project.suggestedMonthly).length > 0 ? (["monthly"] as const) : [])];
}

/**
 * The day of a monthly contribution's payment number `n` (1 is the first): the same day of the
 * month as the first hold, at the same minute, by the UTC clock. Counted from the first hold each
 * time, so a short month never moves the day for good: 31 January, 28 February, 31 March.
 */
export function monthlyDue(firstHold: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 1) throw new Error("A payment's number starts at 1.");
  const month = firstHold.getUTCMonth() + (n - 1);
  const daysInThatMonth = new Date(Date.UTC(firstHold.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(firstHold.getUTCFullYear(), month, Math.min(firstHold.getUTCDate(), daysInThatMonth), firstHold.getUTCHours(), firstHold.getUTCMinutes(), firstHold.getUTCSeconds(), firstHold.getUTCMilliseconds()));
}

/** The last moment held money may still be taken: one hour before the hold ends, by Stripe's own time for that card. */
export function lastMomentToTake(holdExpiresAt: Date): Date {
  return new Date(holdExpiresAt.getTime() - CONTRIBUTION.lastMomentBeforeExpiryMs);
}

/**
 * May this held money be taken now? Not before its planned moment, not after its last moment, and
 * not once it was given up or set aside for the founder. Asked with the clock read right before
 * Stripe is asked.
 */
export function mayTake(payment: { status: string; endedHow: string | null; problem: string | null; takeAt: Date | null; takeBy: Date | null }, now: Date): boolean {
  if (payment.status !== "held" || payment.endedHow || payment.problem) return false;
  if (!payment.takeAt || !payment.takeBy) return false;
  return now >= payment.takeAt && now <= payment.takeBy;
}

/** When a share can be collected, counted from the moment the money was taken. */
export function collectFrom(takenAt: Date, long: boolean): Date {
  return new Date(takenAt.getTime() + (long ? CONTRIBUTION.longWaitMs : CONTRIBUTION.usualWaitMs));
}

/** One payment of one contributor to one host, as the $1,000 rule sees it. */
export type PairPayment = {
  id: string;
  /** What the contributor paid, before our fee. */
  amountCents: number;
  /** A hold in place, money taken, or neither (given up, never held). */
  state: "held" | "taken" | "other";
  takenAt: Date | null;
  /** Its share has been sent to the host. */
  sent: boolean;
  /** The founder released it: counting again never puts its 30 days back. */
  released: boolean;
};

/**
 * The $1,000 rule, exactly as the rulebook's "How the $1,000 is counted" says it. What counts:
 * everything taken in the last 30 days (also what was collected or refunded since) plus every
 * hold in place, each payment once. More than $1,000 crosses the line.
 *
 * When the line is crossed it gives back: the held payments, which get the 30-day mark (and keep
 * it whatever happens to the others afterwards), and the taken payments whose share has not been
 * sent, which wait 30 days each from its own taking. A share whose sending is only written down
 * is "not sent" here: its sending is left alone, and it gets the later date in case Stripe
 * refuses. A wait never gets shorter by this: the caller only ever moves a date later.
 */
export function waitFor(payments: PairPayment[], now: Date): { countedCents: number; over: boolean; markHeld: string[]; thirtyDays: string[] } {
  let countedCents = 0;
  for (const payment of payments) {
    if (payment.state === "held") countedCents += payment.amountCents;
    else if (payment.state === "taken" && payment.takenAt && payment.takenAt.getTime() > now.getTime() - CONTRIBUTION.windowMs) countedCents += payment.amountCents;
  }
  const over = countedCents > CONTRIBUTION.lineCents;
  if (!over) return { countedCents, over, markHeld: [], thirtyDays: [] };
  return {
    countedCents,
    over,
    markHeld: payments.filter((payment) => payment.state === "held").map((payment) => payment.id),
    thirtyDays: payments.filter((payment) => payment.state === "taken" && !payment.sent && !payment.released).map((payment) => payment.id),
  };
}
