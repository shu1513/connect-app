/**
 * The stages a payment moves through, and the timing rules around holds,
 * cancelling and reviews. Plain functions: no Stripe, no database.
 */

// ---------------------------------------------------------------------------
// Stages. Three small, separate tracks, because one payment can be charged,
// partly refunded and paid out at the same time.
// ---------------------------------------------------------------------------

/** The customer's side: is the money held, charged, or let go? */
export type PaymentStatus = "awaiting_payment" | "held" | "charged" | "closed_uncharged";
/** The host's side: is their share owed, and has it been sent? */
export type TransferStatus = "not_due" | "due" | "sent" | "not_owed";
export type RefundStatus = "in_progress" | "done" | "failed";

const PAYMENT_MOVES: Record<PaymentStatus, PaymentStatus[]> = {
  awaiting_payment: ["held", "closed_uncharged"],
  held: ["charged", "closed_uncharged"],
  charged: [], // a charge is never undone; money goes back only through a refund
  closed_uncharged: [],
};

const TRANSFER_MOVES: Record<TransferStatus, TransferStatus[]> = {
  not_due: ["due", "not_owed"],
  due: ["sent", "not_owed"],
  sent: [],
  not_owed: [],
};

export function canMovePayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_MOVES[from].includes(to);
}

export function canMoveTransfer(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSFER_MOVES[from].includes(to);
}

// ---------------------------------------------------------------------------
// Cancelling. The host picks how long before the start cancelling is free.
// ---------------------------------------------------------------------------

/** The choices a host has, in minutes before the start. 0 = any time before the start. */
export const FREE_CANCEL_CHOICES_MINUTES = [0, 60, 12 * 60, 24 * 60] as const;
/** Our default: free until the start. */
export const DEFAULT_FREE_CANCEL_MINUTES = 0;

export type CancellationOutcome =
  /** Nothing is charged; any hold is released. */
  | "free"
  /** Past the free period: the full booked price is charged, and the host may refund. */
  | "late_charge"
  /** The call has started; it can no longer be cancelled. */
  | "not_allowed";

export function cancellationOutcome(input: {
  /** "admin" is the founder closing an account: always free, like a host cancelling. */
  by: "host" | "customer" | "admin";
  now: Date;
  startsAt: Date;
  /** The rule this call was created with. */
  freeCancelMinutes: number;
  /** Whether money is currently held for this call. Without a hold there is nothing to charge. */
  held: boolean;
}): CancellationOutcome {
  if (input.now >= input.startsAt) return "not_allowed";
  if (input.by !== "customer" || !input.held) return "free";
  const freeUntil = input.startsAt.getTime() - input.freeCancelMinutes * 60_000;
  return input.now.getTime() < freeUntil ? "free" : "late_charge";
}

// ---------------------------------------------------------------------------
// Holds. A card hold only lasts a few days, so the timing is kept tight.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A hold may be placed at most this long before the call starts. */
export const MAX_HOLD_BEFORE_START_MS = 2 * DAY_MS;
/** The hold must outlast the end of the call by at least this much, to leave time to charge it. */
export const HOLD_MARGIN_AFTER_CALL_MS = DAY_MS;
/** If Stripe does not say when a hold runs out, assume the shortest window any card network uses. */
export const ASSUMED_HOLD_LIFETIME_MS = 4 * DAY_MS;
/** How long the founder has to decide a call that needs review. */
export const REVIEW_WINDOW_MS = 3 * DAY_MS;
/** A held payment is always decided or released at least this long before the hold runs out. */
export const RELEASE_BEFORE_EXPIRY_MS = DAY_MS;

export type PayWindow = "too_early" | "open" | "call_over";

/** Whether the customer can place the hold right now. */
export function payWindow(input: { now: Date; startsAt: Date; endsAt: Date }): PayWindow {
  if (input.now >= input.endsAt) return "call_over";
  if (input.startsAt.getTime() - input.now.getTime() > MAX_HOLD_BEFORE_START_MS) return "too_early";
  return "open";
}

/** The earliest moment the customer can pay for a call. */
export function payOpensAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - MAX_HOLD_BEFORE_START_MS);
}

/** When a hold runs out: Stripe's own answer if it gave one, otherwise a cautious assumption. */
export function holdExpiry(input: { heldAt: Date; captureBefore: Date | null }): Date {
  return input.captureBefore ?? new Date(input.heldAt.getTime() + ASSUMED_HOLD_LIFETIME_MS);
}

/**
 * Whether a hold is good enough to let the call go ahead: it has not run out,
 * and it will still be there a day after the call ends.
 */
export function holdCoversCall(input: { now: Date; holdExpiresAt: Date; callEndsAt: Date }): boolean {
  return (
    input.now < input.holdExpiresAt &&
    input.holdExpiresAt.getTime() >= input.callEndsAt.getTime() + HOLD_MARGIN_AFTER_CALL_MS
  );
}

/**
 * The last moment a held payment can wait for a decision. After this the hold
 * is released and nothing is charged. Whichever comes first: 3 days after the
 * call, or 1 day before the hold runs out.
 */
export function decisionDeadline(input: { callEndsAt: Date; holdExpiresAt: Date }): Date {
  return new Date(
    Math.min(
      input.callEndsAt.getTime() + REVIEW_WINDOW_MS,
      input.holdExpiresAt.getTime() - RELEASE_BEFORE_EXPIRY_MS,
    ),
  );
}

/** Why a paid call cannot be joined right now, or null if payment is in order. */
export function paymentBlocksJoin(input: {
  /** Null for a free call. */
  payment: { status: string; holdExpiresAt: Date | null } | null;
  callEndsAt: Date;
  now: Date;
}): "not_paid" | "hold_ended" | null {
  if (!input.payment) return null;
  if (input.payment.status !== "held") return "not_paid";
  if (
    !input.payment.holdExpiresAt ||
    !holdCoversCall({ now: input.now, holdExpiresAt: input.payment.holdExpiresAt, callEndsAt: input.callEndsAt })
  ) {
    return "hold_ended";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Paydays. Hosts are paid once a week, for calls that ended at least 7 days earlier.
// ---------------------------------------------------------------------------

export const PAYOUT_DELAY_MS = 7 * DAY_MS;
/** 1 = Monday (UTC). */
export const PAYDAY_WEEKDAY_UTC = 1;

/** The first weekly payday on or after 7 days from the end of the call. */
export function transferDueAt(callEndsAt: Date): Date {
  const earliest = new Date(callEndsAt.getTime() + PAYOUT_DELAY_MS);
  const due = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), earliest.getUTCDate()));
  // If the 7 days end partway through a day, the earliest payday is the next day.
  if (due.getTime() < earliest.getTime()) due.setUTCDate(due.getUTCDate() + 1);
  while (due.getUTCDay() !== PAYDAY_WEEKDAY_UTC) due.setUTCDate(due.getUTCDate() + 1);
  return due;
}
