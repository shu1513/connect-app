/**
 * The rules for messages between a host and a customer (plans/49-messaging.md): who may write
 * when, and the limits. Plain facts in, an answer out. No database and no clock of its own, so
 * every edge can be tested.
 *
 * Everything here is about one pair in its roles: "this host, this customer". Three terms, worked
 * out from the calls between them (facts.ts):
 *
 *   - around a call: from the moment a call that counts is agreed until 7 days after its booked end
 *   - they have talked: one such call is over, and both of them joined that same call
 *   - the host woke it: her latest message is less than 7 days old
 */

export const CONVERSATION = {
  /** How long a call, and a host's message, keep a conversation open (the founder's decision: one number). */
  openDays: 7,
  /** The longest message. The database refuses a longer one too. */
  maxChars: 2000,
  /** One person's messages over all their conversations. */
  perMinute: 10,
  perDay: 100,
  /** One person's messages in a row in one conversation, without an answer. */
  inARow: 5,
  /** How many quiet conversations a host can wake in 24 hours. */
  wakesPerDay: 20,
  /** How many messages the page shows before "Show earlier". */
  shown: 50,
} as const;

const DAY = 24 * 3_600_000;
export const OPEN_MS = CONVERSATION.openDays * DAY;

export type Role = "host" | "customer";

/** What is true about one conversation at one moment, for the person who wants to write (or is looking). */
export type Facts = {
  role: Role;
  /** The founder's switch: false while messages are switched off. */
  switchOn: boolean;
  /** This person blocked the other one. */
  blockedByMe: boolean;
  /** The other one blocked this person. */
  blockedByOther: boolean;
  /** This person's own account is paused. */
  paused: boolean;
  /** The other person's account is closed. */
  otherClosed: boolean;
  /** A call that counts is agreed, and its booked end is less than 7 days ago. */
  aroundCall: boolean;
  /** They have talked, in these roles. */
  talked: boolean;
  /** The host's page is approved and not hidden. */
  hostPagePublic: boolean;
  /** The customer switched this host off between calls. */
  muted: boolean;
  /** When the host last wrote in this conversation. */
  hostLastWroteAt: Date | null;
};

/** Why someone may not write. Each has its sentence in words.ts; several share one on purpose. */
export type Refusal =
  | "switched_off"
  | "you_blocked"
  | "not_taking" // a host, when the customer blocked her or switched her off: one answer for both
  | "closed" // a customer whom the host blocked, a closed account, a host who never talked with this customer
  | "paused"
  | "page_not_public"
  | "you_muted"
  | "book_again"; // a customer, when the 7 days are over: he books another call

export type Verdict = { ok: true; wakes: boolean } | { ok: false; why: Refusal };

/** Whether the host's latest message still gives the customer time to answer. */
export function hostWokeIt(hostLastWroteAt: Date | null, now: Date): boolean {
  return hostLastWroteAt !== null && now.getTime() - hostLastWroteAt.getTime() < OPEN_MS;
}

/**
 * May this person write now? The order matters: what stops everybody comes first, and a refusal
 * never says more than the person may know (a blocked host and a switched-off host get one answer).
 */
export function mayWrite(facts: Facts, now: Date): Verdict {
  if (!facts.switchOn) return { ok: false, why: "switched_off" };
  if (facts.blockedByMe) return { ok: false, why: "you_blocked" };
  if (facts.blockedByOther) return { ok: false, why: facts.role === "host" ? "not_taking" : "closed" };
  if (facts.paused) return { ok: false, why: "paused" };
  if (facts.otherClosed) return { ok: false, why: "closed" };
  // Around a call both may write, whatever the customer's switch says (decision 14).
  if (facts.aroundCall) return { ok: true, wakes: false };

  if (facts.role === "host") {
    // Outside a call she writes only to someone she has talked with (decision 6), with her page public (decision 11).
    if (!facts.talked) return { ok: false, why: "closed" };
    if (facts.muted) return { ok: false, why: "not_taking" };
    if (!facts.hostPagePublic) return { ok: false, why: "page_not_public" };
    // It "wakes" when she has sent nothing here in the 7 days before (decision 18).
    return { ok: true, wakes: !hostWokeIt(facts.hostLastWroteAt, now) };
  }

  // The customer, outside a call: only while they have talked and her latest message is less than 7 days old (decision 7).
  if (facts.talked && facts.muted) return { ok: false, why: "you_muted" };
  if (facts.talked && hostWokeIt(facts.hostLastWroteAt, now)) return { ok: true, wakes: false };
  return { ok: false, why: "book_again" };
}

/** How much one person has sent, counted inside the sending step. */
export type Counts = {
  /** Their messages in the last minute and the last 24 hours, over all conversations. */
  lastMinute: number;
  lastDay: number;
  /** Their messages in a row here: since the other person's latest message, or since the latest call that counts was agreed, whichever is later. */
  inARow: number;
  /** The quiet conversations they woke in the last 24 hours. */
  wakesLastDay: number;
};

export type LimitProblem = "minute" | "day" | "in_a_row" | "wakes";

/** Which limit one more message would break, or null. `wakes` says whether this message would wake a quiet conversation. */
export function limitProblem(counts: Counts, wakes: boolean): LimitProblem | null {
  if (counts.inARow >= CONVERSATION.inARow) return "in_a_row";
  if (wakes && counts.wakesLastDay >= CONVERSATION.wakesPerDay) return "wakes";
  if (counts.lastMinute >= CONVERSATION.perMinute) return "minute";
  if (counts.lastDay >= CONVERSATION.perDay) return "day";
  return null;
}

/**
 * A message as it is kept: line ends made alike, the ends trimmed. Null when nothing is left or
 * it is too long. Nothing else is changed: what a person wrote is what the other one reads.
 */
export function tidyMessage(text: string): string | null {
  const tidy = text.replace(/\r\n?/g, "\n").trim();
  if (tidy.length === 0 || tidy.length > CONVERSATION.maxChars) return null;
  return tidy;
}

/** A once-only key as the browser makes it (a random id). Anything else is refused. */
export const isSendKey = (key: string): boolean => /^[A-Za-z0-9_-]{16,64}$/.test(key);
