/**
 * Reading conversations (plans/49-messaging.md): one conversation for its page, the list on
 * "Messages", the count in the top bar, and the two small things a person changes without
 * sending: what they have been shown, and the customer's switch.
 *
 * Only ever for one of the conversation's two people. Every function here takes the person and
 * checks that itself. Someone else's conversation and one that does not exist give the same
 * answer everywhere: nothing.
 */
import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Conversation, ConversationMessage } from "@/db/schema";
import { offerOf } from "@/lib/booking/bookings";
import { hostForMember } from "@/lib/membership/access";
import { type ConversationFacts, factsFor } from "./facts";
import { CONVERSATION, mayWrite, type Refusal, type Role, type Verdict } from "./rules";
import { isConversationId } from "./send";

const conversations = schema.conversations;
const messages = schema.conversationMessages;

/** The most messages one page ever holds. */
export const MOST_SHOWN = 500;
/** The most conversations the list on "Messages" holds: those with something new first, then the latest. */
export const MOST_LISTED = 200;

/** The conversation, if this person is one of its two. */
export async function conversationFor(userId: string, id: string): Promise<Conversation | null> {
  if (!isConversationId(id)) return null;
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!row || (row.hostId !== userId && row.customerId !== userId)) return null;
  return row;
}

type Known = { ownName: string; hostName: string; handle: string | null };

/**
 * People's names, in one question. Which name is shown is chosen for each conversation
 * (`nameIn`): two people can have a conversation in each direction, and the same person is then
 * known by a different name in each.
 */
async function namesOf(ids: string[]): Promise<Map<string, Known>> {
  const known = new Map<string, Known>();
  if (ids.length === 0) return known;
  const people = await db
    .select({ id: schema.user.id, name: schema.user.name, displayName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle })
    .from(schema.user)
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
    .where(inArray(schema.user.id, [...new Set(ids)]));
  for (const person of people) known.set(person.id, { ownName: person.name, hostName: person.displayName ?? person.name, handle: person.handle });
  return known;
}

/**
 * The other person as this person knows them in one conversation: the customer knows his host by
 * her host name (never her account name); the host knows her customer by his own name.
 */
function nameIn(known: Known | undefined, viewerRole: Role): string {
  if (!known) return "this person";
  return viewerRole === "customer" ? known.hostName : known.ownName;
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
  /** True when the page shows a stretch of older messages that does not reach the latest. */
  hasLater: boolean;
  /** True when a message this person has not been shown yet lies before the first one on the page. */
  unshownBefore: boolean;
  /** The lowest message number on the page, for "Show earlier". */
  firstNumber: number | null;
};

/**
 * Whether the page may tell the server "shown up to the highest message here". Only when no
 * message this person has not been shown yet lies before the first one on the page: such a
 * message was not on the page, and the mark is one number that covers everything below it. It
 * goes by the messages the page really holds, whichever way the page was asked for.
 */
export function mayMarkShown(view: Pick<ConversationView, "firstNumber" | "unshownBefore">): boolean {
  return view.firstNumber !== null && !view.unshownBefore;
}

/** What a refusal is shown as, given whether the customer has a way to book. Shared by the page and the answer to a late form. */
export function shownRefusalFor(why: Refusal, canBook: boolean, stopped: boolean): Refusal {
  return why === "book_again" && (!canBook || stopped) ? "closed" : why;
}

/**
 * Where this customer can book this host, or null when he cannot. It asks the booking code's own
 * question (`offerOf`): approved, not hidden, the account open and not paused, and hours to book.
 * For a member the same question is asked as for a member, so a page hidden from the public does
 * not stand in his way.
 */
async function bookHrefFor(conversation: Conversation, now: Date): Promise<string | null> {
  const open = await offerOf(conversation.hostId);
  if (open) return `/h/${open.handle}`;
  const forMember = await hostForMember(conversation.customerId, conversation.hostId, now);
  if (!forMember?.canBook) return null;
  const asMember = await offerOf(conversation.hostId, db, { forMember: true });
  return asMember ? `/h/${asMember.handle}` : null;
}

/**
 * Everything the conversation's page shows, for one of its two people; null for anyone else.
 *
 * Which messages: every one this person has not been shown yet and at least the latest 50
 * (decision 29), so nothing can count as shown that was not on the page. `from` is the message
 * number "Show earlier" asked for: the page then holds the messages from that number on. Never
 * more than 500 at once; a stretch of old messages that does not reach the latest says so
 * (`hasLater`). Whatever the page holds, it never marks as shown a message that lies before its
 * first one (`unshownBefore`, `mayMarkShown`). `messages: false` leaves the messages out, for a
 * caller that needs only the rest.
 */
export async function viewFor(userId: string, conversationId: string, now: Date, options: { from?: number; messages?: boolean } = {}): Promise<ConversationView | null> {
  const conversation = await conversationFor(userId, conversationId);
  if (!conversation) return null;
  const role: Role = userId === conversation.hostId ? "host" : "customer";
  const otherId = role === "host" ? conversation.customerId : conversation.hostId;
  const facts = await factsFor(db, conversation, userId, now);
  const verdict = mayWrite(facts, now);
  const known = (await namesOf([otherId])).get(otherId);
  // No way to book is offered across a block, or after an old "End call and report" (decision 21; never after an "End call now", plans/51).
  const bookHref = role === "customer" && !facts.stopped && !facts.blockedByMe && !facts.blockedByOther ? await bookHrefFor(conversation, now) : null;

  let shown: ConversationMessage[] = [];
  let hasLater = false;
  const shownMark = role === "host" ? conversation.hostShownNumber : conversation.customerShownNumber;
  const inThis = eq(messages.conversationId, conversation.id);
  if (options.messages !== false) {
    const from = options.from;
    if (from !== undefined && Number.isInteger(from) && from > 0) {
      // Older messages were asked for: from that number on, oldest first. Whatever this person has or has not been
      // shown yet plays no part here, so "Show earlier" always moves.
      shown = await db.select().from(messages).where(and(inThis, gte(messages.number, from))).orderBy(asc(messages.number)).limit(MOST_SHOWN);
      hasLater = shown.length > 0 && shown[shown.length - 1].number < conversation.lastNumber;
    } else {
      const usual = Math.max(1, Math.min(shownMark + 1, conversation.lastNumber - CONVERSATION.shown + 1));
      const newestFirst = await db.select().from(messages).where(and(inThis, gte(messages.number, usual))).orderBy(desc(messages.number)).limit(MOST_SHOWN);
      shown = newestFirst.reverse();
    }
  }
  const firstNumber = shown.length > 0 ? shown[0].number : null;
  const [earlier] = firstNumber === null ? [] : await db.select({ number: messages.number }).from(messages).where(and(inThis, sql`${messages.number} < ${firstNumber}`)).limit(1);
  // A message that still exists, that this person has not been shown, and that lies before the page's first one.
  const [unshown] =
    firstNumber === null || firstNumber <= shownMark + 1
      ? []
      : await db.select({ number: messages.number }).from(messages).where(and(inThis, sql`${messages.number} > ${shownMark}`, sql`${messages.number} < ${firstNumber}`)).limit(1);

  return {
    conversation,
    role,
    other: { id: otherId, name: nameIn(known, role) },
    facts,
    verdict,
    shownRefusal: verdict.ok ? null : shownRefusalFor(verdict.why, bookHref !== null, facts.stopped),
    bookHref,
    messages: shown,
    hasEarlier: Boolean(earlier),
    hasLater,
    unshownBefore: Boolean(unshown),
    firstNumber,
  };
}

/**
 * A message of the other person that this person has not been shown yet. For a query over
 * conversations. The outer table's columns are written out with the table's name: in the list of
 * things a query selects, a column put in by reference is written without it, and inside this
 * inner query a bare "id" would be the message's own.
 */
const hasNewFor = (userId: string) =>
  sql<boolean>`exists (select 1 from "conversation_messages" m where m.conversation_id = "conversations"."id" and m.sender_id <> ${userId} and m.number > case when "conversations"."host_id" = ${userId} then "conversations"."host_shown_number" else "conversations"."customer_shown_number" end)`;

const mineOf = (userId: string) => or(eq(conversations.hostId, userId), eq(conversations.customerId, userId));

/** In how many conversations the other person wrote something this person has not been shown. */
export async function newConversationCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(mineOf(userId), hasNewFor(userId)));
  return row?.n ?? 0;
}

/**
 * The number beside "Messages" in the top bar: what Connect wrote to this person and they have
 * not read (plans/47), plus the conversations with something new for them (plans/49). One
 * question to the database, because every page of a logged-in person asks it.
 */
export async function topBarCount(userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    select
      (select count(*) from "messages" where "user_id" = ${userId} and "read_at" is null)::int
      + (select count(*) from "conversations" where ("host_id" = ${userId} or "customer_id" = ${userId}) and ${hasNewFor(userId)})::int as n`);
  return Number(rows[0]?.n ?? 0);
}

export type ListedConversation = { id: string; name: string; lastMessageAt: Date; hasNew: boolean };

/**
 * This person's conversations that hold a message: those with something new first, then the
 * latest. One that was only opened, and one whose messages have all been deleted, is not listed.
 * At most 200; because the new ones come first, one that the top bar counts is always among them
 * (short of 200 conversations with something new at once).
 */
export async function conversationsOf(userId: string): Promise<ListedConversation[]> {
  const hasNew = hasNewFor(userId);
  const rows = await db
    .select({ conversation: conversations, hasNew })
    .from(conversations)
    .where(and(mineOf(userId), sql`exists (select 1 from "conversation_messages" m where m.conversation_id = "conversations"."id")`))
    .orderBy(sql`${hasNew} desc`, desc(conversations.lastMessageAt))
    .limit(MOST_LISTED);
  const otherOf = (conversation: Conversation) => (conversation.hostId === userId ? conversation.customerId : conversation.hostId);
  const known = await namesOf(rows.map((row) => otherOf(row.conversation)));
  return rows.map(({ conversation, hasNew: isNew }) => ({
    id: conversation.id,
    // Chosen for each conversation: where this person is the customer, the other one is named as his host.
    name: nameIn(known.get(otherOf(conversation)), conversation.customerId === userId ? "customer" : "host"),
    lastMessageAt: conversation.lastMessageAt ?? conversation.createdAt,
    hasNew: Boolean(isNew),
  }));
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
