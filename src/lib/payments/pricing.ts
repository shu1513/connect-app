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
/** The lowest price a paid call may have. Zero means a free call. */
export const MIN_PRICE_PER_15_CENTS = 500;
/** Taken from each payout to a host's bank. Covers Stripe's payout charge. */
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
  hostSeconds: number;
}): number {
  assertWholeNonNegative("hostSeconds", input.hostSeconds);
  const booked = bookedTotalCents(input.pricePer15Cents, input.bookedSeconds);
  const billableSeconds = Math.min(input.hostSeconds, input.bookedSeconds);
  const charge = Math.min(booked, roundDiv(input.pricePer15Cents * billableSeconds, QUARTER_HOUR_SECONDS));
  return charge < MIN_CHARGE_CENTS ? 0 : charge;
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
 * What actually leaves for the host's bank on a payday: everything due to
 * them, less the payout charge. The payout charge is never more than the payout.
 */
export function payoutAfterFee(dueCents: number, payoutFeeCents: number = PAYOUT_FEE_CENTS): {
  payoutCents: number;
  payoutFeeCents: number;
} {
  assertWholeNonNegative("dueCents", dueCents);
  const fee = Math.min(dueCents, payoutFeeCents);
  return { payoutCents: dueCents - fee, payoutFeeCents: fee };
}
