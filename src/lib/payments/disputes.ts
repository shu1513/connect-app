/**
 * Dispute states that block paying the host and refunding: the customer's bank
 * still has the charge under dispute, or we lost and the money has gone back to
 * the customer. A lost dispute stays blocked; the founder settles it by hand.
 */
export const BLOCKING_DISPUTE = new Set([
  "lost",
  "warning_needs_response",
  "warning_under_review",
  "needs_response",
  "under_review",
  "appeal_needs_response",
  "appeal_under_review",
]);
