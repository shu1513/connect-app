/**
 * What a call earned its host, as the calendar on the home page says it
 * (plans/43-calendar-on-the-home-page.md, decision 8). Plain logic: the page works out the host's
 * share of each payment with the one rule for that (`currentSplit`), and hands the numbers in.
 *
 * It is her share of what was charged for the call, time added during it included, after
 * Connect's fee and after any refund that has gone through. It is not what she can collect: that
 * depends on what she has collected already, and the collection charge comes off there.
 */
export type MoneyPart = {
  /** The payment's state: awaiting_payment, held, charged or closed_uncharged. */
  status: string;
  /** Waiting for the founder's decision. */
  needsReview: boolean;
  /** The host's share of this payment as it stands now; nothing for a payment that is not charged. */
  shareCents: number;
};

/**
 * Null while nothing of the call is charged: the page then keeps the words it has for that
 * ("$40.00 held", "Free") and never guesses a figure. `soFar` while another part of the call's
 * money is not settled yet.
 */
export function earnedFrom(parts: MoneyPart[]): { cents: number; soFar: boolean } | null {
  const charged = parts.filter((part) => part.status === "charged");
  if (charged.length === 0) return null;
  return { cents: charged.reduce((sum, part) => sum + part.shareCents, 0), soFar: unsettled(parts) };
}

/** Part of the call's money is not settled yet: held, not paid, or waiting for a decision. What it earned can still grow. */
export function unsettled(parts: MoneyPart[]): boolean {
  return parts.some((part) => part.status === "awaiting_payment" || part.status === "held" || part.needsReview);
}
