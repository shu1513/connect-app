/**
 * What is kept with a report that was made from a message, and the founder's look at it
 * (plans/49-messaging.md, decisions 22 to 24).
 *
 * Kept: the reported message, up to 100 messages before it and up to 50 after it, as they are at
 * that moment, each with its number, its writer, its time and its exact words; and how many older
 * ones that still existed were left out. It is written in the report's own database step, under
 * the conversation's lock, into a table of its own (`report_conversations`), never into
 * `reports.snapshot`: the founder's list of reports reads every open report whole.
 *
 * The founder reads it only through `keptMessagesFor`, which writes the look into the record of
 * admin actions first, in the same step, and gives the messages back only when that was written.
 * Nothing else in the app reads the kept words.
 */
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordAdminAction } from "./audit";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

export const KEPT_BEFORE = 100;
export const KEPT_AFTER = 50;

/** Thrown when the message a report names is not there (any more), or is not the other person's. Its sentence is safe to show. */
export class MessageGoneError extends Error {
  constructor() {
    super("That message is no longer there.");
  }
}

const messages = schema.conversationMessages;
const conversations = schema.conversations;
const kept = schema.reportConversations;

/** A report made from a message names the conversation and the message's number in one text: "<conversation id>/<number>". */
export function messagePlace(contextId: string): { conversationId: string; number: number } | null {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([1-9][0-9]{0,8})$/i.exec(contextId);
  return match ? { conversationId: match[1], number: Number(match[2]) } : null;
}
/** The other way round, for a link to the report form. */
export const messagePlaceText = (conversationId: string, number: number): string => `${conversationId}/${number}`;

/**
 * The message a report names, if the reporter is one of the conversation's two people and the
 * message is the OTHER person's and still there. Null otherwise: a conversation that is not
 * theirs, one that does not exist, a message that is gone and one's own message all look alike.
 */
export async function reportableMessage(reader: Reader, reporterId: string, contextId: string): Promise<{ conversationId: string; number: number; writerId: string } | null> {
  const place = messagePlace(contextId);
  if (!place) return null;
  const [conversation] = await reader.select({ hostId: conversations.hostId, customerId: conversations.customerId }).from(conversations).where(eq(conversations.id, place.conversationId));
  if (!conversation || (conversation.hostId !== reporterId && conversation.customerId !== reporterId)) return null;
  const [message] = await reader.select({ senderId: messages.senderId }).from(messages).where(and(eq(messages.conversationId, place.conversationId), eq(messages.number, place.number)));
  if (!message || message.senderId === reporterId) return null;
  return { ...place, writerId: message.senderId };
}

export type KeptMessage = { number: number; from: "reporter" | "reported"; at: string; body: string };

/**
 * Writes what is kept with a report, inside the report's own database step. The conversation's
 * row is locked first, so no message can be added while the stretch is read. Throws
 * `MessageGoneError` when the message is not there any more: the caller's whole step is then
 * undone, and no report is written.
 *
 * Old messages are deleted by the helper without that lock (retention.ts). So the reported
 * message is not looked for first and the stretch read afterwards: the stretch is read in ONE
 * question, and the reported message must be IN what that question gave back. A report can then
 * never be saved with its own message missing from what is kept.
 */
export async function keepMessages(tx: Tx, reportId: string, reporterId: string, contextId: string): Promise<void> {
  const place = messagePlace(contextId);
  if (!place) throw new MessageGoneError();
  const [conversation] = await tx.select({ hostId: conversations.hostId, customerId: conversations.customerId }).from(conversations).where(eq(conversations.id, place.conversationId)).for("update");
  if (!conversation || (conversation.hostId !== reporterId && conversation.customerId !== reporterId)) throw new MessageGoneError();
  const inThis = eq(messages.conversationId, place.conversationId);
  const rows = await tx
    .select({ number: messages.number, senderId: messages.senderId, createdAt: messages.createdAt, body: messages.body })
    .from(messages)
    .where(and(inThis, gte(messages.number, place.number - KEPT_BEFORE), lte(messages.number, place.number + KEPT_AFTER)))
    .orderBy(asc(messages.number));
  // The reported message itself, among what was just read: still there, and the other person's.
  const reported = rows.find((row) => row.number === place.number);
  if (!reported || reported.senderId === reporterId) throw new MessageGoneError();
  const [{ older }] = await tx
    .select({ older: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(inThis, lt(messages.number, rows[0]?.number ?? place.number)));
  const stretch: KeptMessage[] = rows.map((row) => ({ number: row.number, from: row.senderId === reporterId ? "reporter" : "reported", at: row.createdAt.toISOString(), body: row.body }));
  await tx.insert(kept).values({ reportId, conversationId: place.conversationId, reportedNumber: place.number, keptCount: stretch.length, olderLeftOut: older, messages: JSON.stringify(stretch) });
}

export type KeptSummary = { reportedNumber: number; keptCount: number; olderLeftOut: number };

/** For the founder's list: THAT messages are kept with these reports, and how many. Never their words. */
export async function keptSummaries(reportIds: string[]): Promise<Map<string, KeptSummary>> {
  const found = new Map<string, KeptSummary>();
  if (reportIds.length === 0) return found;
  const rows = await db.select({ reportId: kept.reportId, reportedNumber: kept.reportedNumber, keptCount: kept.keptCount, olderLeftOut: kept.olderLeftOut }).from(kept).where(inArray(kept.reportId, reportIds));
  for (const row of rows) found.set(row.reportId, { reportedNumber: row.reportedNumber, keptCount: row.keptCount, olderLeftOut: row.olderLeftOut });
  return found;
}

/**
 * The founder's look at what was kept with a report. The look is written into the record of admin
 * actions first, in the same database step: if that cannot be written, the step fails and
 * nothing is given back. Every look goes this way, also a second one. Null when nothing is kept
 * with that report (and then nothing is written down either).
 *
 * The caller has made sure that `adminId` is an admin with a proper admin login.
 */
export async function keptMessagesFor(input: { adminId: string; reportId: string }): Promise<{ reportedNumber: number; olderLeftOut: number; messages: KeptMessage[] } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ reportedNumber: kept.reportedNumber, olderLeftOut: kept.olderLeftOut, messages: kept.messages, reference: schema.reports.reference, reportedId: schema.reports.reportedId })
      .from(kept)
      .innerJoin(schema.reports, eq(schema.reports.id, kept.reportId))
      .where(eq(kept.reportId, input.reportId));
    if (!row) return null;
    // Never the words themselves in the record: only that they were read, and for which report.
    await recordAdminAction({ adminId: input.adminId, action: "kept messages read", targetUserId: row.reportedId, targetId: input.reportId, detail: `R-${row.reference}` }, tx);
    return { reportedNumber: row.reportedNumber, olderLeftOut: row.olderLeftOut, messages: JSON.parse(row.messages) as KeptMessage[] };
  });
}
