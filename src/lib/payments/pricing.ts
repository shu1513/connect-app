/**
 * The pricing rule: how much the customer pays, and how that is split between
 * the host and us.
 *
 * This file knows nothing about Stripe or the database. It takes plain numbers
 * in and gives plain numbers out, so it can be tested exhaustively.
 *
 * All money is in whole cents. All time is in whole seconds.
 */

/** The fee settings a call is created with. Fixed for the life of that call. */
export type FeeTerms = {
  /** Our percentage of the charge, in hundredths of a percent. 490 = 4.9%. */
  percentBps: number;
  /** A fixed amount per paid call, in cents. Covers Stripe's fixed card charge. */
  fixedCents: number;
  /** Extra percentage when the card is from outside the United States. 150 = 1.5%. */
  foreignCardBps: number;
};

export const DEFAULT_FEE_TERMS: FeeTerms = { percentBps: 490, fixedCents: 30, foreignCardBps: 150 };

/** Stripe will not charge less than this in US dollars. */
export const MIN_CHARGE_CENTS = 50;
/** The lowest price a host may set. (A call with a price of zero, from before 19 November 2026 or made by a check script, is a free call.) */
export const MIN_PRICE_PER_15_CENTS = 500;

/** The highest price every host may set: $1,000 per 15 minutes. */
export const MAX_PRICE_PER_15_CENTS = 100_000;
/**
 * The highest top price the founder can give one host: $2,500 per 15 minutes (the founder's
 * decision of 20 November 2026, plans/48). Connect carries the loss of a lost bank dispute and
 * holds the whole booked price on the customer's card, so this is kept low: the longest call
 * (6 hours) then costs $60,000. The database refuses a higher one too.
 */
export const HIGHEST_TOP_PRICE_PER_15_CENTS = 250_000;
/** Stripe takes at most this much in one payment in US dollars: $999,999.99. */
export const STRIPE_MAX_CHARGE_CENTS = 99_999_999;

/**
 * Checks the price a host sets for their calls. Every host charges at least the minimum: a host
 * cannot set a price of zero (the founder's decision of 19 November 2026, plans/40; until then zero
 * meant "free calls"). Calls that already exist keep the price they were made with.
 *
 * And no host charges more than her top price: $1,000 for everyone, or the higher one the founder
 * gave this one host (plans/48). The caller passes that host's top price; without one it is everyone's.
 */
export function hostPriceProblem(pricePer15Cents: number, topPricePer15Cents: number = MAX_PRICE_PER_15_CENTS): string | null {
  if (!Number.isInteger(pricePer15Cents) || pricePer15Cents < 0) return "The price must be a whole number of cents.";
  if (pricePer15Cents < MIN_PRICE_PER_15_CENTS) return `Your price must be at least $${(MIN_PRICE_PER_15_CENTS / 100).toFixed(2)} per 15 minutes.`;
  if (pricePer15Cents > topPricePer15Cents) return `Your price can be at most $${(topPricePer15Cents / 100).toFixed(2)} per 15 minutes.`;
  return null;
}

/** The highest price this host may set: her own top price when the founder gave her one, otherwise everyone's. */
export function topPriceOf(host: { topPricePer15Cents: number | null } | null | undefined): number {
  return host?.topPricePer15Cents ?? MAX_PRICE_PER_15_CENTS;
}

/** What is wrong with a top price the founder types for one host, in words for the founder, or null. */
export function topPriceProblem(topPricePer15Cents: number): string | null {
  if (!Number.isInteger(topPricePer15Cents)) return "Type the top price in dollars, for example 2000 or 1500.50.";
  if (topPricePer15Cents <= MAX_PRICE_PER_15_CENTS) {
    return `Every host can already charge up to $${(MAX_PRICE_PER_15_CENTS / 100).toFixed(2)} per 15 minutes, so a top price of a host's own must be more than that.`;
  }
  if (topPricePer15Cents > HIGHEST_TOP_PRICE_PER_15_CENTS) return `The highest top price a host can be given is $${(HIGHEST_TOP_PRICE_PER_15_CENTS / 100).toFixed(2)} per 15 minutes.`;
  return null;
}
/** Our charge for one collection of earnings by a host. Covers Stripe's payout charge. */
export const PAYOUT_FEE_CENTS = 25;

const QUARTER_HOUR_SECONDS = 900;

/** Divide two non-negative whole numbers, rounding halves up. */
function roundDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

function assertWholeNonNegative(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number, zero or more.`);
}

/** The most a call can ever cost: the price for its full booked length. */
export function bookedTotalCents(pricePer15Cents: number, bookedSeconds: number): number {
  assertWholeNonNegative("pricePer15Cents", pricePer15Cents);
  assertWholeNonNegative("bookedSeconds", bookedSeconds);
  return roundDiv(pricePer15Cents * bookedSeconds, QUARTER_HOUR_SECONDS);
}

/**
 * What the customer owes for a call that took place: the host's connected time
 * inside the booked window, at the call's price. Never more than the booked
 * total. Below Stripe's minimum, nothing is charged.
 */
export function attendanceChargeCents(input: {
  pricePer15Cents: number;
  bookedSeconds: number;
  /** The seconds that count by the call's rule: the host's time, or the time both were in. */
  countedSeconds: number;
}): number {
  assertWholeNonNegative("countedSeconds", input.countedSeconds);
  const booked = bookedTotalCents(input.pricePer15Cents, input.bookedSeconds);
  const billableSeconds = Math.min(input.countedSeconds, input.bookedSeconds);
  const charge = Math.min(booked, roundDiv(input.pricePer15Cents * billableSeconds, QUARTER_HOUR_SECONDS));
  return charge < MIN_CHARGE_CENTS ? 0 : charge;
}

/** The seconds a call is charged for, by the rule fixed on the call: the host's time (booked) or the time both were in (instant). */
export function countedSeconds(call: { billing: string }, totals: { hostSeconds: number; togetherSeconds: number }): number {
  return call.billing === "together" ? totals.togetherSeconds : totals.hostSeconds;
}

/**
 * The most the founder may charge on one payment after a review: the price of
 * the stretch of the call that payment pays for, and for a call stopped with
 * "End call and report" only the part of it before the stop.
 */
export function reviewChargeLimitCents(input: {
  pricePer15Cents: number;
  coversFrom: Date;
  coversUntil: Date;
  callEndsAt: Date;
  safetyEndedAt: Date | null;
}): number {
  const stoppedAt = input.safetyEndedAt && input.safetyEndedAt < input.callEndsAt ? input.safetyEndedAt : input.callEndsAt;
  const until = stoppedAt < input.coversUntil ? stoppedAt : input.coversUntil;
  return bookedTotalCents(input.pricePer15Cents, Math.max(0, Math.floor((until.getTime() - input.coversFrom.getTime()) / 1000)));
}

export type Split = { feeCents: number; hostShareCents: number };

/** Splits a charge into our fee and the host's share. The two always add up to the charge. */
export function splitCharge(chargeCents: number, terms: FeeTerms, foreignCard: boolean): Split {
  assertWholeNonNegative("chargeCents", chargeCents);
  if (chargeCents === 0) return { feeCents: 0, hostShareCents: 0 };
  // The percentages are added together first, so the fee is rounded once.
  const percentBps = terms.percentBps + (foreignCard ? terms.foreignCardBps : 0);
  const fee = roundDiv(chargeCents * percentBps, 10_000) + terms.fixedCents;
  const feeCents = Math.min(chargeCents, fee);
  return { feeCents, hostShareCents: chargeCents - feeCents };
}

/**
 * The split once some of the charge has been refunded. The host's share and
 * our fee shrink in the same proportion as the charge, and still add up
 * exactly to what the customer has paid.
 */
export function splitAfterRefunds(input: {
  chargeCents: number;
  refundedCents: number;
  originalHostShareCents: number;
}): Split {
  const { chargeCents, refundedCents, originalHostShareCents } = input;
  assertWholeNonNegative("chargeCents", chargeCents);
  assertWholeNonNegative("refundedCents", refundedCents);
  assertWholeNonNegative("originalHostShareCents", originalHostShareCents);
  if (refundedCents > chargeCents) throw new Error("A refund cannot be more than the charge.");
  if (originalHostShareCents > chargeCents) throw new Error("The host's share cannot be more than the charge.");
  const paidCents = chargeCents - refundedCents;
  if (paidCents === 0) return { feeCents: 0, hostShareCents: 0 };
  const hostShareCents = roundDiv(originalHostShareCents * paidCents, chargeCents);
  return { feeCents: paidCents - hostShareCents, hostShareCents };
}

/**
 * What one collection sends for each share in it. The 25-cent collection
 * charge is taken once, from the largest share, and is never more than that
 * share: it is never spread over several. Null when 25 cents or less is ready
 * in total, because then there is nothing worth collecting.
 */
export function collectionAmounts(
  shares: Array<{ id: string; shareCents: number }>,
): Array<{ id: string; amountCents: number; payoutFeeCents: number }> | null {
  let total = 0;
  let largest: { id: string; shareCents: number } | undefined;
  for (const share of shares) {
    assertWholeNonNegative("shareCents", share.shareCents);
    total += share.shareCents;
    if (!largest || share.shareCents > largest.shareCents) largest = share;
  }
  if (!largest || total <= PAYOUT_FEE_CENTS) return null;
  const carrier = largest;
  return shares.map((share) => {
    const payoutFeeCents = share === carrier ? Math.min(PAYOUT_FEE_CENTS, share.shareCents) : 0;
    return { id: share.id, amountCents: share.shareCents - payoutFeeCents, payoutFeeCents };
  });
}
