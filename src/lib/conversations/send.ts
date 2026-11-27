/**
 * Opening a conversation and sending a message (plans/49-messaging.md, "What gets built").
 *
 * Both take the calendar locks of the two people first: the same locks, in the same sorted order,
 * that blocking and booking take. So a send and a block happen in one order or the other, the
 * same person's sends in other conversations wait their turn (which is what makes the per-person
 * limits hold), and `block()` itself needs no change. Then the conversation's row. Only then the
 * clock is read, once, and everything that is decided is decided by what is read after the locks.
 *
 * Not locked, on purpose: a call being cancelled, a call being ended with its button, the
 * founder's switch, an account being paused, a host's page being hidden. A message sent in the
 * very moment one of these changes may go either way; one sent after it sees the change.
 */
import { and, count, eq, gt, gte, isNull, max, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { lockCalendars } from "@/lib/booking/bookings";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { switches } from "@/lib/safety/switches";
import { callFacts, factsFor, type Pair } from "./facts";
import { isSendKey, type LimitProblem, limitProblem, mayWrite, type Refusal, tidyMessage } from "./rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isConversationId = (id: string): boolean => UUID.test(id);

const MINUTE = 60_000;
const DAY = 24 * 3_600_000;

const conversations = schema.conversations;
const messages = schema.conversationMessages;

/**
 * Opens the one conversation of a pair and gives back its id, or null when this person may not.
 * A refusal makes nothing, and a conversation with no message in it is listed for nobody, so
 * opening one never shows up for the other person.
 *
 * Who is the host and who the customer is worked out here, never taken from the browser: from the
 * call that is named (the person must be one of its two), or, for a host's link beside a past
 * customer, with the person as the host.
 */
export async function openConversation(input: { userId: string; callId?: string; customerId?: string }): Promise<string | null> {
  let pair: Pair | null = null;
  const byCall = Boolean(input.callId);
  if (input.callId) {
    if (!UUID.test(input.callId)) return null;
    const [call] = await db.select({ hostId: schema.calls.hostId, customerId: schema.calls.customerId }).from(schema.calls).where(eq(schema.calls.id, input.callId));
    if (call && (call.hostId === input.userId || call.customerId === input.userId)) pair = call;
  } else if (input.customerId) {
    pair = { hostId: input.userId, customerId: input.customerId };
  }
  if (!pair || pair.hostId === pair.customerId) return null;
  const found = pair;
  const ofPair = and(eq(conversations.hostId, found.hostId), eq(conversations.customerId, found.customerId));

  return db.transaction(async (tx) => {
    await lockCalendars(tx, [found.hostId, found.customerId]);
    // One that is there stays reachable for its two people, whatever has happened since: reading is never taken away.
    const [existing] = await tx.select({ id: conversations.id }).from(conversations).where(ofPair);
    if (existing) return existing.id;
    // A new one only where the two could write at all. From a call's page: a call that counts is around, or they
    // have talked. From a host's link beside a past customer: they have talked, with her as the host.
    const now = new Date();
    if ((await switches(tx)).conversationsOff) return null;
    if (await isBlockedEitherWay(found.hostId, found.customerId, tx)) return null;
    // Both accounts must be there and open.
    const open = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(or(eq(schema.user.id, found.hostId), eq(schema.user.id, found.customerId)), isNull(schema.user.closedAt)));
    if (open.length !== 2) return null;
    const calls = await callFacts(tx, found, now);
    if (!calls.talked && !(byCall && calls.aroundCall)) return null;
    await tx.insert(conversations).values({ hostId: found.hostId, customerId: found.customerId }).onConflictDoNothing();
    const [made] = await tx.select({ id: conversations.id }).from(conversations).where(ofPair);
    return made?.id ?? null;
  });
}

export type SendResult =
  | { ok: true; number: number }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "text"; which: "empty" | "too_long" | "key" }
  /** `stopped`: an old "End call and report" stands between the two, so "book again" is not offered. */
  | { ok: false; kind: "refused"; why: Refusal; stopped: boolean }
  | { ok: false; kind: "limit"; problem: LimitProblem };

/**
 * Sends one message. The answer says what happened in a form the page can put into words; nothing
 * is ever half done. The same press sent twice (the same key) makes one message and gives the
 * first answer again, without counting against any limit a second time.
 */
export async function sendMessage(input: { conversationId: string; senderId: string; text: string; sendKey: string }): Promise<SendResult> {
  if (!UUID.test(input.conversationId)) return { ok: false, kind: "not_found" };
  const body = tidyMessage(input.text);
  if (body === null) return { ok: false, kind: "text", which: input.text.trim().length === 0 ? "empty" : "too_long" };
  if (!isSendKey(input.sendKey)) return { ok: false, kind: "text", which: "key" };

  // Read before the locks only to know whose locks to take. The row is read again under them.
  // Someone else's conversation and one that does not exist give the same answer.
  const [pair] = await db.select({ hostId: conversations.hostId, customerId: conversations.customerId }).from(conversations).where(eq(conversations.id, input.conversationId));
  if (!pair || (pair.hostId !== input.senderId && pair.customerId !== input.senderId)) return { ok: false, kind: "not_found" };

  return db.transaction(async (tx): Promise<SendResult> => {
    await lockCalendars(tx, [pair.hostId, pair.customerId]);
    const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, input.conversationId)).for("update");
    if (!conversation) return { ok: false, kind: "not_found" };
    // The clock is read once, after the locks: a message that had to wait is judged, and dated, by this moment.
    const now = new Date();

    const mine = and(eq(messages.conversationId, conversation.id), eq(messages.senderId, input.senderId));
    const [again] = await tx.select({ number: messages.number, body: messages.body }).from(messages).where(and(mine, eq(messages.sendKey, input.sendKey)));
    // The same press again gives the first answer again. A key is bound to its words: other words under a key
    // that was used are never called "sent" (the box makes a new key when the words change, so this is a guard).
    if (again) return again.body === body ? { ok: true, number: again.number } : { ok: false, kind: "text", which: "key" };

    const facts = await factsFor(tx, conversation, input.senderId, now);
    const verdict = mayWrite(facts, now);
    if (!verdict.ok) return { ok: false, kind: "refused", why: verdict.why, stopped: facts.stopped };

    // The limits. This person's other sends wait for the same calendar lock, so these counts cannot be passed together.
    const bySender = eq(messages.senderId, input.senderId);
    const [{ lastMinute }] = await tx.select({ lastMinute: count() }).from(messages).where(and(bySender, gt(messages.createdAt, new Date(now.getTime() - MINUTE))));
    const [{ lastDay }] = await tx.select({ lastDay: count() }).from(messages).where(and(bySender, gt(messages.createdAt, new Date(now.getTime() - DAY))));
    const [{ wakesLastDay }] = await tx.select({ wakesLastDay: count() }).from(messages).where(and(bySender, eq(messages.woke, true), gt(messages.createdAt, new Date(now.getTime() - DAY))));
    // In a row: this person's messages here since the other one's latest, or since the latest call that counts was
    // agreed, whichever is later. By the messages' numbers, so two of the same moment are still in order.
    const [{ otherLast }] = await tx.select({ otherLast: max(messages.number) }).from(messages).where(and(eq(messages.conversationId, conversation.id), ne(messages.senderId, input.senderId)));
    const [{ inARow }] = await tx
      .select({ inARow: count() })
      .from(messages)
      .where(and(mine, gt(messages.number, otherLast ?? 0), facts.latestAgreedAt ? gte(messages.createdAt, facts.latestAgreedAt) : undefined));
    const problem = limitProblem({ lastMinute, lastDay, inARow, wakesLastDay }, verdict.wakes);
    if (problem) return { ok: false, kind: "limit", problem };

    const number = conversation.lastNumber + 1;
    await tx.insert(messages).values({ conversationId: conversation.id, number, senderId: input.senderId, body, sendKey: input.sendKey, woke: verdict.wakes, createdAt: now });
    await tx
      .update(conversations)
      .set({ lastNumber: number, lastMessageAt: now, ...(facts.role === "host" ? { hostLastWroteAt: now } : {}) })
      .where(eq(conversations.id, conversation.id));
    return { ok: true, number };
  });
}
