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

// ---------------------------------------------------------------------------
// Emails to followers (plans/31)
// ---------------------------------------------------------------------------

export const EMAILS = {
  /** A host who switches "Available now" on is announced this long after. Switched off again before that: nothing is sent. */
  announceAfterSeconds: 60,
  /** One follower gets at most one email of each kind about one host in this many hours. */
  perHostHours: 20,
  /** One follower gets at most this many of these emails in 24 hours, whatever the host and the kind. */
  perDay: 5,
  /** A diary post is announced this long after it was written, if it is still there. */
  postAfterMinutes: 30,
  /** A post that could not be announced within this long is not announced at all. */
  postTooOldHours: 24,
  /** A diary email that has not been sent this long after it was written is dropped. */
  postExpiresHours: 12,
} as const;

/**
 * The switch for the whole of plans/31: the postal address for the last line of these emails.
 * While there is none, the choices are not shown and nothing is written or sent. Read each time,
 * so the one setting is the one truth.
 */
export function followEmailsAddress(): string | null {
  const address = (process.env.FOLLOW_EMAILS_ADDRESS ?? "").replace(/\s+/g, " ").trim();
  return address === "" ? null : address;
}
export const followEmailsOn = (): boolean => followEmailsAddress() !== null;

/** Minutes of the day at this moment in that time zone. Someone who never chose a zone is treated as New York, as their other emails are. */
export function minuteOfDay(moment: Date, timeZone: string | null): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timeZone ?? "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(moment);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

/**
 * Whether the moment is inside the follower's hours. No hours: any time. The stretch runs from
 * `from` up to, not including, `to`, and may run past midnight (22:00 to 02:00).
 */
export function insideHours(moment: Date, timeZone: string | null, from: number | null, to: number | null): boolean {
  if (from === null || to === null) return true;
  const minute = minuteOfDay(moment, timeZone);
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** The hours a follower may choose: whole hours, different from each other. Null for "any time"; false for something that cannot be saved. */
export function readHours(from: string, to: string): { from: number; to: number } | null | false {
  if (from === "" && to === "") return null;
  const [a, b] = [Number(from), Number(to)];
  const whole = (n: number) => Number.isInteger(n) && n >= 0 && n < 24;
  if (from === "" || to === "" || !whole(a) || !whole(b) || a === b) return false;
  return { from: a * 60, to: b * 60 };
}
