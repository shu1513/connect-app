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
  /**
   * The call's two people may no longer act (an account paused or closed, or a block between them). Such a call
   * is cancelled at no charge by the step that follows a pause, a closure or a block; a person who does that
   * cancelling by hand, because that step failed or has not run yet, gets the same: free, whatever the clock
   * says. Only before the start: a call that has started keeps its own rules. Left out: they may act.
   */
  cannotGoAhead?: boolean;
}): CancellationOutcome {
  if (input.now >= input.startsAt) return "not_allowed";
  if (input.by !== "customer" || !input.held || input.cannotGoAhead) return "free";
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
  payment: { status: string; holdExpiresAt: Date | null; kind?: string } | null;
  callEndsAt: Date;
  now: Date;
}): "not_paid" | "hold_ended" | null {
  if (!input.payment) return null;
  if (input.payment.status !== "held") return "not_paid";
  // A call paid from a membership: its money is set aside in the month, which counts as paid. There is no hold that could end.
  if (input.payment.kind === "member_call") return null;
  if (
    !input.payment.holdExpiresAt ||
    !holdCoversCall({ now: input.now, holdExpiresAt: input.payment.holdExpiresAt, callEndsAt: input.callEndsAt })
  ) {
    return "hold_ended";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Taking the money. An ordinary charge is not taken minutes after the call any
// more, but about a day later, so that a customer can first ask for a refund
// and a lower charge costs no card fee. (A charge under review, and a charge
// for cancelling late, keep their own rules.)
// ---------------------------------------------------------------------------

/** How long a customer can ask for a refund, counted from the call's start (they can ask once it has ended). */
export const ASK_WINDOW_MS = DAY_MS;
/** How long the host has to answer a request before the money is taken anyway. */
export const ANSWER_WINDOW_MS = DAY_MS;
/**
 * The app acts by itself this long after a deadline it shows a person, so a
 * request or an answer sent in the last seconds still arrives first.
 *
 * It must stay shorter than the shortest call a host can offer: a host can
 * collect 24 hours after a call's end, and the customer's last moment to ask
 * (24 hours after its start, plus this) has to come before that. A test keeps
 * watch over it.
 */
export const DEADLINE_CUSHION_MS = 3 * 60_000;
/** An ordinary charge is never left on hold later than this long before the hold ends. */
export const TAKE_BEFORE_EXPIRY_MS = 12 * HOUR_MS;

/**
 * The moments around taking the money for a call's ordinary charges.
 * `holdExpiresAt` is the earliest end among the holds of those charges: they
 * share one moment, and each is then taken as its own payment.
 */
export function moneyTiming(input: {
  /** The call's start: the customer's time to ask is counted from it, so added time does not move it. */
  callStartsAt: Date;
  /** When the customer asked for a refund, or null if they have not. */
  requestedAt: Date | null;
  /** Null for a call paid from a membership: there is no card hold whose end could cut these moments short. */
  holdExpiresAt: Date | null;
}): {
  /** The customer can ask until here. */
  askBy: Date;
  /** With a request: the host's answer costs nothing until here. Null without one. */
  answerBy: Date | null;
  /** The app takes the money by itself at this moment, if nothing was decided before. */
  takeAt: Date;
} {
  const limit = input.holdExpiresAt ? input.holdExpiresAt.getTime() - TAKE_BEFORE_EXPIRY_MS : Number.POSITIVE_INFINITY;
  const withoutRequest = Math.min(input.callStartsAt.getTime() + ASK_WINDOW_MS + DEADLINE_CUSHION_MS, limit);
  const askBy = new Date(withoutRequest - DEADLINE_CUSHION_MS);
  if (!input.requestedAt) return { askBy, answerBy: null, takeAt: new Date(withoutRequest) };
  const takeAt = Math.min(input.requestedAt.getTime() + ANSWER_WINDOW_MS + DEADLINE_CUSHION_MS, limit);
  return { askBy, answerBy: new Date(takeAt - DEADLINE_CUSHION_MS), takeAt: new Date(takeAt) };
}

/**
 * What to do right now with a call's ordinary charges that are still on hold.
 * "take" also covers every later try: the app keeps trying for as long as the hold lasts.
 */
export function takeDecision(input: {
  now: Date;
  callStartsAt: Date;
  requestedAt: Date | null;
  /** The request was answered (or closed by the founder): nothing is waited for any more. */
  decided: boolean;
  /** Null when no card hold is involved (a call paid from a membership). */
  holdExpiresAt: Date | null;
}): "wait" | "take" | "hold_ended" {
  if (input.holdExpiresAt && input.now >= input.holdExpiresAt) return "hold_ended";
  if (input.decided) return "take";
  return input.now >= moneyTiming(input).takeAt ? "take" : "wait";
}

// ---------------------------------------------------------------------------
// Collecting. There is no payday: a host takes their earnings with a button.
// ---------------------------------------------------------------------------

/**
 * A charge's share can be collected this long after the call ends when the customer did not ask for a
 * refund. The customer's time to ask is counted from the call's start (24 hours, plus the 3 minutes in
 * which a request sent in the last seconds is still accepted), and a call lasts at least 5 minutes. So by
 * this moment a first request can no longer arrive, and the money has been taken a little before.
 */
export const COLLECT_AFTER_MS = DAY_MS;
/** With a refund request on the call, the wait stays longer (and the host must have answered first). */
export const COLLECT_AFTER_REQUEST_MS = 2 * DAY_MS;
/** A host can collect once in this long, counted from their last collection. */
export const COLLECT_EVERY_MS = DAY_MS;

/**
 * When the host's share of a charge can be collected: 24 hours after the call
 * ends when the customer did not ask for a refund (their time to ask is over
 * a little before that), 2 days after the call when they did, and never
 * before the charge is recorded. Worked out when the charge is recorded. It moves once at most,
 * and only later: when the customer asks for a refund after the charge was
 * recorded, it becomes the 2 days of a call with a request (see askForRefund).
 */
export function readyToCollectAt(input: {
  callEndsAt: Date;
  chargedAt: Date;
  /** Whether the customer has asked for a refund on this call, as it stands at this moment. */
  refundAsked: boolean;
}): Date {
  const wait = input.refundAsked ? COLLECT_AFTER_REQUEST_MS : COLLECT_AFTER_MS;
  return new Date(Math.max(input.callEndsAt.getTime() + wait, input.chargedAt.getTime()));
}

/** The earliest moment a host can collect again, or null if they never have. */
export function canCollectAgainAt(lastCollectedAt: Date | null): Date | null {
  return lastCollectedAt ? new Date(lastCollectedAt.getTime() + COLLECT_EVERY_MS) : null;
}

export type HeldBack = "dispute" | "refund" | "founder" | "request" | "answer_applying" | "being_sent" | "not_yet";

/**
 * Why a share that was charged and not yet sent cannot be collected right now,
 * or null if it can. The same answer is shown to the host and used by a collection.
 */
export function heldBack(input: {
  now: Date;
  /** When the share becomes ready (fixed when the charge was recorded). */
  readyAt: Date | null;
  disputeOpen: boolean;
  refundOnItsWay: boolean;
  /** A money action on this payment was written down and its outcome is not known yet. */
  actionUnfinished: boolean;
  /**
   * The call has a refund request that is not answered ("request"), or an answer that is still being
   * applied to one of the call's charges ("answer_applying"). Either holds every charge of that call.
   */
  request?: "request" | "answer_applying" | null;
  /** A contribution's share the founder is holding back. */
  founderHolds?: boolean;
}): HeldBack | null {
  if (input.disputeOpen) return "dispute";
  if (input.refundOnItsWay) return "refund";
  if (input.founderHolds) return "founder";
  if (input.request) return input.request;
  if (input.actionUnfinished) return "being_sent";
  if (!input.readyAt || input.readyAt > input.now) return "not_yet";
  return null;
}
