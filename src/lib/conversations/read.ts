/**
 * Reading conversations (plans/49-messaging.md): one conversation for its page, the list on
 * "Messages", the count in the top bar, and the two small things a person changes without
 * sending: what they have been shown, and the customer's switch.
 *
 * Only ever for one of the conversation's two people. Someone else's conversation and one that
 * does not exist give the same answer everywhere: nothing.
 */
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Conversation, ConversationMessage } from "@/db/schema";
import { hostForMember } from "@/lib/membership/access";
import { type ConversationFacts, factsFor } from "./facts";
import { CONVERSATION, mayWrite, type Refusal, type Role, type Verdict } from "./rules";
import { isConversationId } from "./send";

const conversations = schema.conversations;
const messages = schema.conversationMessages;

/** The most messages one page ever holds. */
export const MOST_SHOWN = 500;

/** The conversation, if this person is one of its two. */
export async function conversationFor(userId: string, id: string): Promise<Conversation | null> {
  if (!isConversationId(id)) return null;
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!row || (row.hostId !== userId && row.customerId !== userId)) return null;
  return row;
}

/**
 * The other person's name, as this person knows them: a customer knows a host by her host name
 * (never her account name); a host knows a customer by his own name.
 */
async function otherPerson(conversation: Conversation, role: Role): Promise<{ id: string; name: string; handle: string | null; pagePublic: boolean }> {
  const otherId = role === "host" ? conversation.customerId : conversation.hostId;
  const [person] = await db
    .select({ name: schema.user.name, displayName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle, status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden })
    .from(schema.user)
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
    .where(eq(schema.user.id, otherId));
  const asHost = role === "customer";
  return {
    id: otherId,
    name: (asHost ? (person?.displayName ?? person?.name) : person?.name) ?? "this person",
    handle: asHost ? (person?.handle ?? null) : null,
    pagePublic: person?.status === "approved" && person.hidden === false,
  };
}

export type ConversationView = {
  conversation: Conversation;
  role: Role;
  other: { id: string; name: string };
  facts: ConversationFacts;
  verdict: Verdict;
  /** For a refusal: the one that is shown. "Book again" becomes "closed" when there is no way to book (decisions 11 and 21). */
  shownRefusal: Refusal | null;
  /** For the customer: where he can book this host, when he can. */
  bookHref: string | null;
  /** Oldest first. */
  messages: ConversationMessage[];
  /** True when older messages exist that are not on the page. */
  hasEarlier: boolean;
  /** The lowest message number on the page, for "Show earlier". */
  firstNumber: number | null;
};

/** What a refusal is shown as, given whether the customer has a way to book. Shared by the page and the answer to a late form. */
export function shownRefusalFor(why: Refusal, canBook: boolean, stopped: boolean): Refusal {
  return why === "book_again" && (!canBook || stopped) ? "closed" : why;
}

/** Where this customer can book this host: her public page, or the page a member reaches while it is hidden. */
async function bookHrefFor(conversation: Conversation, handle: string | null, pagePublic: boolean, now: Date): Promise<string | null> {
  if (handle && pagePublic) return `/h/${handle}`;
  const forMember = await hostForMember(conversation.customerId, conversation.hostId, now);
  return forMember?.canBook ? `/h/${forMember.handle}` : null;
}

/**
 * Everything the conversation's page shows, for one of its two people. `from` is the message
 * number "Show earlier" asked for. Without it the page holds every message this person has not
 * been shown yet and at least the latest 50 (decision 29), so nothing can count as shown that was
 * not on the page.
 */
export async function viewOf(conversation: Conversation, viewerId: string, now: Date, from?: number): Promise<ConversationView> {
  const role: Role = viewerId === conversation.hostId ? "host" : "customer";
  const facts = await factsFor(db, conversation, viewerId, now);
  const verdict = mayWrite(facts, now);
  const person = await otherPerson(conversation, role);
  const bookHref = role === "customer" && !facts.stopped && !facts.blockedByMe && !facts.blockedByOther ? await bookHrefFor(conversation, person.handle, person.pagePublic, now) : null;

  const shownUpTo = role === "host" ? conversation.hostShownNumber : conversation.customerShownNumber;
  const wanted = Math.min(shownUpTo + 1, conversation.lastNumber - CONVERSATION.shown + 1);
  const lowest = Math.max(1, from !== undefined && Number.isInteger(from) && from > 0 ? Math.min(from, wanted) : wanted);
  const newestFirst = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), gte(messages.number, lowest)))
    .orderBy(desc(messages.number))
    .limit(MOST_SHOWN);
  const shown = newestFirst.reverse();
  const firstNumber = shown.length > 0 ? shown[0].number : null;
  const [earlier] = firstNumber === null ? [] : await db.select({ number: messages.number }).from(messages).where(and(eq(messages.conversationId, conversation.id), sql`${messages.number} < ${firstNumber}`)).limit(1);

  return {
    conversation,
    role,
    other: { id: person.id, name: person.name },
    facts,
    verdict,
    shownRefusal: verdict.ok ? null : shownRefusalFor(verdict.why, bookHref !== null, facts.stopped),
    bookHref,
    messages: shown,
    hasEarlier: Boolean(earlier),
    firstNumber,
  };
}

/** A message of the other person that this person has not been shown yet. For a query over conversations. */
const hasNewFor = (userId: string) =>
  sql<boolean>`exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id} and m.sender_id <> ${userId} and m.number > case when ${conversations.hostId} = ${userId} then ${conversations.hostShownNumber} else ${conversations.customerShownNumber} end)`;

const mineOf = (userId: string) => or(eq(conversations.hostId, userId), eq(conversations.customerId, userId));

/** In how many conversations the other person wrote something this person has not been shown. For the top bar. */
export async function newConversationCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(mineOf(userId), hasNewFor(userId)));
  return row?.n ?? 0;
}

export type ListedConversation = { id: string; name: string; lastMessageAt: Date; hasNew: boolean };

/**
 * This person's conversations that hold a message, the latest first. One that was only opened,
 * and one whose messages have all been deleted, is not listed.
 */
export async function conversationsOf(userId: string): Promise<ListedConversation[]> {
  const rows = await db
    .select({ conversation: conversations, hasNew: hasNewFor(userId) })
    .from(conversations)
    .where(and(mineOf(userId), sql`exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id})`))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  const listed: ListedConversation[] = [];
  for (const { conversation, hasNew } of rows) {
    const person = await otherPerson(conversation, conversation.hostId === userId ? "host" : "customer");
    listed.push({ id: conversation.id, name: person.name, lastMessageAt: conversation.lastMessageAt ?? conversation.createdAt, hasNew: Boolean(hasNew) });
  }
  return listed;
}

/**
 * This person's own browser has shown the conversation up to this message number. Their mark only
 * ever goes up, and never past the last message there is; a late word from an older tab changes
 * nothing. Someone else's conversation changes nothing.
 */
export async function markShownUpTo(userId: string, conversationId: string, number: number): Promise<void> {
  if (!isConversationId(conversationId) || !Number.isInteger(number) || number < 1) return;
  const upTo = sql`least(${number}, ${conversations.lastNumber})`;
  await db
    .update(conversations)
    .set({ hostShownNumber: sql`greatest(${conversations.hostShownNumber}, ${upTo})` })
    .where(and(eq(conversations.id, conversationId), eq(conversations.hostId, userId)));
  await db
    .update(conversations)
    .set({ customerShownNumber: sql`greatest(${conversations.customerShownNumber}, ${upTo})` })
    .where(and(eq(conversations.id, conversationId), eq(conversations.customerId, userId)));
}

/**
 * The customer's switch for this one host (decision 13). Only the customer of the conversation
 * can move it; for anyone else nothing changes. Gives back whether it was theirs to move.
 */
export async function setMuted(userId: string, conversationId: string, on: boolean, now: Date): Promise<boolean> {
  if (!isConversationId(conversationId)) return false;
  const changed = await db
    .update(conversations)
    // Switching it on twice keeps the first moment.
    .set({ customerMutedAt: on ? sql`coalesce(${conversations.customerMutedAt}, ${now.toISOString()}::timestamptz)` : null })
    .where(and(eq(conversations.id, conversationId), eq(conversations.customerId, userId)))
    .returning({ id: conversations.id });
  return changed.length > 0;
}
