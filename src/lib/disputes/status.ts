/**
 * What Stripe's words for a bank dispute mean to the app (plans/47-bank-disputes.md). No database
 * and no network: plain rules, so each can be tested.
 *
 * Stripe's statuses do not come in one fixed order, and the first time the app sees a dispute it
 * may already be past the first.
 */

/** Where a dispute stands: the bank waits for an answer, the bank is deciding, or it has ended and how. */
export type Standing = "waiting" | "with_bank" | "won" | "lost" | "closed";

/** A bank's question (Stripe: an inquiry) or a chargeback. A question can become a chargeback on the same dispute. */
export type Stage = "question" | "chargeback";

export type Outcome = "won" | "lost" | "closed";

/**
 * Where a dispute stands, from Stripe's status.
 *   - `warning_closed`: a bank's question that stayed quiet for 120 days. No decision was made.
 *   - `prevented`: stopped before it became a chargeback. No decision was made either.
 *   - the two appeal states, and any status this code does not know: with the bank. A status we do
 *     not understand must never look like an ending, because an ending lets money move.
 */
export function standingOf(status: string): Standing {
  switch (status) {
    case "needs_response":
    case "warning_needs_response":
      return "waiting";
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "warning_closed":
    case "prevented":
      return "closed";
    default:
      return "with_bank";
  }
}

/** The stage a status belongs to. Stripe marks everything about a bank's question with "warning". */
export function stageOf(status: string): Stage {
  return status.startsWith("warning_") ? "question" : "chargeback";
}

/** A lost dispute the bank is looking at once more. The app answers nothing in an appeal. */
export function isAppeal(status: string): boolean {
  return status.startsWith("appeal_");
}

/** How a dispute ended, or null while it has not. */
export function outcomeOf(status: string): Outcome | null {
  const standing = standingOf(status);
  return standing === "won" || standing === "lost" || standing === "closed" ? standing : null;
}

/**
 * Whether a dispute in this status keeps its charge's money from moving: while it is open in any
 * way, and after it is lost (the bank has returned the money to the customer).
 */
export function blocksMoney(status: string): boolean {
  const standing = standingOf(status);
  return standing === "waiting" || standing === "with_bank" || standing === "lost";
}

/** Whether any of a charge's disputes keeps its money from moving. A bank can dispute one charge more than once. */
export function anyBlocksMoney(statuses: string[]): boolean {
  return statuses.some(blocksMoney);
}

/** Stripe marks a dispute about a card network's own rules in more than one place; any of them counts. */
export function isCompliance(dispute: { reason: string; enhanced_eligibility_types?: string[] | null }): boolean {
  return dispute.reason === "noncompliant" || (dispute.enhanced_eligibility_types ?? []).some((type) => type.endsWith("_compliance"));
}

/** The bank's reason, in words a person can read. */
export function reasonWords(reason: string): string {
  switch (reason) {
    case "fraudulent":
      return "the cardholder says they did not make this payment";
    case "unrecognized":
      return "the cardholder does not recognise this payment";
    case "product_not_received":
      return "the cardholder says they did not get what they paid for";
    case "product_unacceptable":
      return "the cardholder says it was not what was promised";
    case "subscription_canceled":
      return "the cardholder says they had cancelled";
    case "duplicate":
      return "the cardholder says they were charged twice";
    case "credit_not_processed":
      return "the cardholder says a refund they were promised did not arrive";
    case "noncompliant":
      return "the bank says the payment did not follow the card network's rules";
    case "general":
      // Stripe files several of the card networks' own reasons under this one word.
      return 'a reason Stripe only files under "general"';
    default:
      // A reason is there; this app only has no words for it yet.
      return `a reason this app has no words for (Stripe calls it "${reason}")`;
  }
}
