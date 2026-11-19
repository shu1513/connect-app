/**
 * The rules of following that are plain logic (plans/30): the numbers, whether a call leads to
 * a follow by itself, and the order of the list. No database.
 */

export const FOLLOW = {
  /** A person can follow this many hosts. */
  limit: 200,
  /** A call leads to a follow by itself only if the two were in it together at least this long (the number ratings use). */
  minTogetherSeconds: 120,
  /** A call whose record is still not final this long after its end is no longer looked at. */
  lookBackDays: 7,
  /** How many calls the helper decides in one round. */
  perRound: 50,
  /** The list and the home page ask the server again this often while the tab is in front. */
  refreshSeconds: 60,
} as const;

/**
 * What the automatic follow after a call is decided from. Each is read from what is recorded,
 * at the one moment the decision is made; nothing is guessed.
 *
 * Only what the customer did themselves stands in the way (their report, their block, their
 * request for a refund). What the host did does not: a customer who is not followed up after a
 * call could tell from it that the host blocked or reported them. Such a follow is quiet anyway:
 * the host never shows as available to someone they have blocked.
 */
export type AfterCallFacts = {
  /** Where the call came from: "customer" (a request), "now" (a call now), "member" (a membership booking), "admin" (a check script), or null for a call with no booking. */
  source: string | null;
  cancelled: boolean;
  /** Ended with "End call and report". */
  safetyEnded: boolean;
  /** The call's record is final and complete, as the charge judges it. A record that needs review is not. */
  recordComplete: boolean;
  /** Time the two were in the room together. Null while the record has no totals. */
  togetherSeconds: number | null;
  /** The customer has reported the host, about anything, whatever became of the report. */
  customerReported: boolean;
  /** The customer has blocked the host. */
  customerBlocked: boolean;
  /** The customer asked for a refund of this call, whatever became of the request. */
  refundAsked: boolean;
  /** The host's page is open to everyone: approved, not hidden by the host. */
  hostPageOpen: boolean;
  /** Either account is closed or paused. */
  eitherClosedOrPaused: boolean;
  /** There is already a line for this customer and this host: they follow, unfollowed, or said "Don't follow". */
  hasLine: boolean;
  /** How many hosts the customer has on their list. */
  following: number;
};

/** Whether the customer follows the host from this call on. Every condition must hold. */
export function followsAfterCall(facts: AfterCallFacts): boolean {
  if (facts.source !== "customer" && facts.source !== "now" && facts.source !== "member") return false;
  // The call took place.
  if (facts.cancelled || !facts.recordComplete || (facts.togetherSeconds ?? 0) < FOLLOW.minTogetherSeconds) return false;
  // And did not go wrong.
  if (facts.safetyEnded || facts.customerReported || facts.customerBlocked || facts.refundAsked) return false;
  if (!facts.hostPageOpen || facts.eitherClosedOrPaused) return false;
  // Someone who said no is never made to follow, and nobody is pushed over the limit.
  return !facts.hasLine && facts.following < FOLLOW.limit;
}

/**
 * The order of "Hosts you follow": the hosts who are available now first, then those with a
 * call coming up (the soonest first), then the rest; by name inside each group.
 */
export function inListOrder<T extends { name: string; available: boolean; nextCallAt: Date | null }>(hosts: T[]): T[] {
  const group = (host: T) => (host.available ? 0 : host.nextCallAt ? 1 : 2);
  return [...hosts].sort((a, b) => {
    if (group(a) !== group(b)) return group(a) - group(b);
    if (group(a) === 1 && a.nextCallAt!.getTime() !== b.nextCallAt!.getTime()) return a.nextCallAt!.getTime() - b.nextCallAt!.getTime();
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}
