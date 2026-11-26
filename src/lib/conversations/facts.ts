/**
 * The facts the rules of a conversation decide by (plans/49-messaging.md), read from the database
 * in one place. Everything is asked about the pair in its roles, "this host, this customer", and
 * through the reader it is given: the sending step passes its own database step, so what it
 * decides by is what it read after its locks.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { switches } from "@/lib/safety/switches";
import { callsThatCount, callTerms, type Facts, type PairCall, type Role } from "./rules";

type Reader = Pick<typeof db, "select">;

export type Pair = { hostId: string; customerId: string };

/**
 * The video service said this person joined the call. The call's columns are written out with the
 * table's name: put in by reference they can be written without it, and inside this inner query a
 * bare "id" would be the attendance line's own.
 */
const joined = (who: "host_id" | "customer_id") =>
  sql<boolean>`exists (select 1 from "attendance_events" a where a.call_id = "calls"."id" and a.type = 'participant_joined' and a.participant_identity = ${sql.raw(`"calls"."${who}"`)})`;

/**
 * What the calls between the two say: whether a call that counts is around, whether they have
 * talked, when the latest call that counts was agreed, and whether an "End call and report" stands
 * between them with no call that counts since (then the conversation is simply closed).
 */
export async function callFacts(reader: Reader, pair: Pair, now: Date): Promise<{ aroundCall: boolean; talked: boolean; latestAgreedAt: Date | null; stopped: boolean }> {
  // The latest "End call and report" between the two people, whoever was the host then.
  const [stop] = await reader
    .select({ at: sql<Date | null>`max(${schema.calls.safetyEndedAt})`.mapWith(schema.calls.safetyEndedAt) })
    .from(schema.calls)
    .where(
      or(
        and(eq(schema.calls.hostId, pair.hostId), eq(schema.calls.customerId, pair.customerId)),
        and(eq(schema.calls.hostId, pair.customerId), eq(schema.calls.customerId, pair.hostId)),
      ),
    );
  const latestStop = stop?.at ?? null;
  // The pair's calls in these roles that are not cancelled and were not ended that way, each with its booking.
  const rows = await reader
    .select({
      source: schema.bookings.source,
      begunAt: schema.bookings.createdAt,
      decidedAt: schema.bookings.decidedAt,
      madeAt: schema.calls.createdAt,
      endsAt: schema.calls.endsAt,
      hostJoined: joined("host_id"),
      customerJoined: joined("customer_id"),
    })
    .from(schema.calls)
    .innerJoin(schema.bookings, eq(schema.bookings.callId, schema.calls.id))
    .where(and(eq(schema.calls.hostId, pair.hostId), eq(schema.calls.customerId, pair.customerId), isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt)));
  const calls: PairCall[] = rows.map((row) => ({
    source: row.source,
    begunAt: row.begunAt,
    // A call's row is made at the moment it is agreed; the booking says so too for every kind made today.
    agreedAt: row.decidedAt ?? row.madeAt,
    endsAt: row.endsAt,
    bothJoined: Boolean(row.hostJoined) && Boolean(row.customerJoined),
  }));
  const counting = callsThatCount(calls, latestStop);
  return { ...callTerms(counting, now), stopped: latestStop !== null && counting.length === 0 };
}

export type ConversationFacts = Facts & {
  /** When the latest call that counts was agreed: where the count of messages in a row starts again. */
  latestAgreedAt: Date | null;
  /** An "End call and report" stands between the two with no call that counts since. */
  stopped: boolean;
};

/**
 * Everything the rules need about one conversation, for one of its two people. The caller has
 * made sure the viewer is one of them.
 */
export async function factsFor(
  reader: Reader,
  conversation: { hostId: string; customerId: string; customerMutedAt: Date | null; hostLastWroteAt: Date | null },
  viewerId: string,
  now: Date,
): Promise<ConversationFacts> {
  const role: Role = viewerId === conversation.hostId ? "host" : "customer";
  const otherId = role === "host" ? conversation.customerId : conversation.hostId;
  // One after the other, not side by side: the reader may be a database step, which has one connection.
  const { conversationsOff } = await switches(reader);
  const blocks = await reader
    .select({ blockerId: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(or(and(eq(schema.blocks.blockerId, viewerId), eq(schema.blocks.blockedId, otherId)), and(eq(schema.blocks.blockerId, otherId), eq(schema.blocks.blockedId, viewerId))));
  const people = await reader
    .select({ id: schema.user.id, pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt })
    .from(schema.user)
    .where(inArray(schema.user.id, [viewerId, otherId]));
  const me = people.find((person) => person.id === viewerId);
  const other = people.find((person) => person.id === otherId);
  const [page] = await reader.select({ status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, conversation.hostId));
  const calls = await callFacts(reader, conversation, now);
  return {
    role,
    switchOn: !conversationsOff,
    blockedByMe: blocks.some((block) => block.blockerId === viewerId),
    blockedByOther: blocks.some((block) => block.blockerId === otherId),
    paused: Boolean(me?.pausedAt),
    // Someone whose row is not there is treated as gone.
    otherClosed: !other || Boolean(other.closedAt),
    aroundCall: calls.aroundCall,
    talked: calls.talked,
    hostPagePublic: page?.status === "approved" && page.hidden === false,
    muted: conversation.customerMutedAt !== null,
    hostLastWroteAt: conversation.hostLastWroteAt,
    latestAgreedAt: calls.latestAgreedAt,
    stopped: calls.stopped,
  };
}
