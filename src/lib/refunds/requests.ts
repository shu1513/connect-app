/**
 * A customer asks for a refund; the host answers.
 *
 * One request per call, asked after the call and within 24 hours of its start. Before the money is
 * taken, the host's answer decides what is taken: in full, less, or nothing,
 * for each charge of the call. After that, an answer is a "no" or a refund
 * with the refund tool. Who may decide does not change: the host, or the
 * founder in the host's place.
 *
 * Every step that changes a request runs with the call's row locked, the same
 * lock the taking of the money uses (src/lib/payments/take.ts). So whichever
 * was written down first, the answer or the automatic charge, is what happens.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, like, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Payment, RefundRequest } from "@/db/schema";
import { lockPayment, type Tx } from "@/lib/payments/operations";
import { MIN_CHARGE_CENTS } from "@/lib/payments/pricing";
import { ASK_WINDOW_MS, COLLECT_AFTER_REQUEST_MS, DEADLINE_CUSHION_MS, moneyTiming } from "@/lib/payments/rules";
import { commonExpiry, heldOrdinary, isDecided, settleOrdinaryCharges } from "@/lib/payments/take";
import { summarise, type QualitySummary } from "@/lib/quality/summary";
import { queueAnswerEmail, queueClosedEmail, queueRequestEmail, queueRequestReminder, type AnswerLine } from "./emails";

const REMOVED = "(Removed: the texts of a refund request are kept for one year.)";

/** Refused for a reason a person can read. Nothing was changed. */
export class RequestError extends Error {}

export const NOTE_MAX = 300;
export const MESSAGE_MAX = 300;
export type Reason = "connection" | "other";
export type Choice = "full" | "less" | "nothing";

type Reader = Pick<Tx, "select">;

// ---------------------------------------------------------------------------
// The quality record of a call
// ---------------------------------------------------------------------------

/**
 * The summary of a call's quality record as it stands now, and a short mark of
 * exactly that summary. The mark travels with the form, so that what is sent
 * is what was seen.
 */
export async function loadSummary(call: Call, reader: Reader = db): Promise<{ summary: QualitySummary; json: string; seen: string }> {
  const messages = await reader
    .select({ type: schema.attendanceEvents.type, identity: schema.attendanceEvents.participantIdentity, sessionId: schema.attendanceEvents.participantSessionId, time: schema.attendanceEvents.providerTime, payload: schema.attendanceEvents.payload })
    .from(schema.attendanceEvents)
    .where(eq(schema.attendanceEvents.callId, call.id))
    .orderBy(asc(schema.attendanceEvents.providerTime), asc(schema.attendanceEvents.id));
  const notes = await reader.select().from(schema.qualityNotes).where(eq(schema.qualityNotes.callId, call.id));
  // A call ended with "End call and report" stops at that moment.
  const end = call.safetyEndedAt && call.safetyEndedAt < call.endsAt ? call.safetyEndedAt : call.endsAt;
  const summary = summarise({ hostId: call.hostId, customerId: call.customerId, start: call.startsAt, end, messages, notes });
  const json = JSON.stringify(summary);
  return { summary, json, seen: createHash("sha256").update(json).digest("hex").slice(0, 24) };
}

// ---------------------------------------------------------------------------
// Where a request stands
// ---------------------------------------------------------------------------

/** Whether a refund of this call, started after the request, has gone through. That answers a request too. */
async function refundedSince(reader: Reader, callId: string, askedAt: Date): Promise<boolean> {
  const [done] = await reader
    .select({ id: schema.refunds.id })
    .from(schema.refunds)
    .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
    .where(and(eq(schema.payments.callId, callId), eq(schema.refunds.status, "done"), gt(schema.refunds.createdAt, askedAt)))
    .limit(1);
  return Boolean(done);
}

/** A request counts as answered once the host answered or declined, the founder closed it, or a refund started after it went through. */
export async function isAnswered(request: RefundRequest, reader: Reader = db): Promise<boolean> {
  return request.status !== "asked" || (await refundedSince(reader, request.callId, request.askedAt));
}

export type RequestView = {
  request: RefundRequest;
  /** The answers given before the money was taken, one per charge. */
  answers: Array<{ paymentId: string; choice: Choice; maxCents: number | null }>;
  answered: boolean;
  /** The charges an answer can still change: on hold, not under review, nothing written down for them yet. */
  open: Payment[];
  /** With open charges: until when an answer costs nothing. */
  answerBy: Date | null;
  /** Nothing is on hold and nothing was charged for this call any more: there is nothing to refund. */
  nothingAtStake: boolean;
  /**
   * Money of this call is still on hold, but an answer here cannot change it right now: its record is
   * under review at Connect, or the charge is just being taken. It has not been taken yet.
   */
  beingDecided: boolean;
};

/** Whether any payment of this call is still on hold, whatever the reason. */
async function anyOnHold(reader: Reader, callId: string): Promise<boolean> {
  const [held] = await reader.select({ id: schema.payments.id }).from(schema.payments).where(and(eq(schema.payments.callId, callId), eq(schema.payments.status, "held"))).limit(1);
  return Boolean(held);
}

/** Whether any money of this call is on hold or was taken. */
async function moneyAtStake(reader: Reader, callId: string): Promise<boolean> {
  const [paid] = await reader
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(and(eq(schema.payments.callId, callId), inArray(schema.payments.status, ["held", "charged"])))
    .limit(1);
  return Boolean(paid);
}

/** The call's ordinary charges on hold for which nothing has been written down yet. */
async function openCharges(reader: Reader, callId: string): Promise<Payment[]> {
  const held = await heldOrdinary(reader, callId);
  if (held.length === 0) return [];
  const busy = await reader
    .select({ paymentId: schema.moneyOperations.paymentId })
    .from(schema.moneyOperations)
    .where(and(inArray(schema.moneyOperations.paymentId, held.map((p) => p.id)), eq(schema.moneyOperations.status, "started")));
  const taken = new Set(busy.map((row) => row.paymentId));
  return held.filter((payment) => !taken.has(payment.id));
}

export async function requestViewOf(call: Pick<Call, "id" | "startsAt">): Promise<RequestView | null> {
  const [request] = await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id));
  if (!request) return null;
  const answers = await db.select().from(schema.refundRequestAnswers).where(eq(schema.refundRequestAnswers.requestId, request.id));
  const open = request.status === "asked" ? await openCharges(db, call.id) : [];
  const expiry = open.length > 0 ? await commonExpiry(db, call.id) : null;
  return {
    request,
    answers: answers.map((a) => ({ paymentId: a.paymentId, choice: a.choice as Choice, maxCents: a.maxCents })),
    answered: await isAnswered(request),
    open,
    answerBy: expiry ? moneyTiming({ callStartsAt: call.startsAt, requestedAt: request.askedAt, holdExpiresAt: expiry }).answerBy : null,
    nothingAtStake: !(await moneyAtStake(db, call.id)),
    beingDecided: open.length === 0 && (await anyOnHold(db, call.id)),
  };
}

/**
 * Why each of these calls keeps its money from being collected, if it does: a
 * request that is not answered, or an answer that is still being applied to one
 * of the call's charges (so one charge is not collected while another is being adjusted).
 */
export async function requestHolds(reader: Reader, callIds: string[]): Promise<Map<string, "request" | "answer_applying">> {
  const holds = new Map<string, "request" | "answer_applying">();
  if (callIds.length === 0) return holds;
  const requests = await reader.select().from(schema.refundRequests).where(inArray(schema.refundRequests.callId, callIds));
  for (const request of requests) {
    if (request.status === "asked") {
      if (!(await refundedSince(reader, request.callId, request.askedAt))) holds.set(request.callId, "request");
    } else if (isDecided(request) && (await anyOnHold(reader, request.callId))) {
      // Also when a charge of the call has come under the founder's review meanwhile: the answer is not finished.
      holds.set(request.callId, "answer_applying");
    }
  }
  return holds;
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/**
 * Until when the customer of this call can ask, or null if they cannot (any
 * more): a paid call that took place, not cancelled, no request yet, inside
 * the 24 hours counted from its start. `now` may be up to 3 minutes past the moment shown, so a
 * request sent in the last seconds still counts.
 */
export async function askBy(call: Call, now: Date, reader: Reader = db): Promise<Date | null> {
  if (call.cancelledAt || now < call.endsAt) return null;
  const [existing] = await reader.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id));
  if (existing) return null;
  // Something must be at stake: money on hold or money taken.
  if (!(await moneyAtStake(reader, call.id))) return null;
  const expiry = (await heldOrdinary(reader, call.id)).length > 0 ? await commonExpiry(reader, call.id) : null;
  const until = expiry ? moneyTiming({ callStartsAt: call.startsAt, requestedAt: null, holdExpiresAt: expiry }).askBy : new Date(call.startsAt.getTime() + ASK_WINDOW_MS);
  return now.getTime() < until.getTime() + DEADLINE_CUSHION_MS ? until : null;
}

const clean = (text: string | null | undefined, max: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The customer asks. For "the connection was bad" the customer has looked at
 * the call's quality record first: `seen` is the mark of the summary their
 * page showed. If the record is no longer that one, nothing is sent and
 * "changed" comes back, so the page can show it as it now is and ask again.
 */
export async function askForRefund(input: { callId: string; customerId: string; reason: string; note: string; seen: string | null; now?: Date }): Promise<"sent" | "changed"> {
  if (input.reason !== "connection" && input.reason !== "other") throw new RequestError("Choose a reason.");
  const note = clean(input.note, NOTE_MAX);
  if (input.reason === "other" && note.length === 0) throw new RequestError("Please write a sentence about what went wrong.");

  return db.transaction(async (tx) => {
    const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, input.callId)).for("update");
    if (!call || call.customerId !== input.customerId) throw new RequestError("Call not found.");
    const now = input.now ?? new Date();
    if (!(await askBy(call, now, tx))) throw new RequestError("A refund can no longer be asked for on this call.");

    // Worked out once more at the moment of sending: a late message from the video service can still change it.
    const record = await loadSummary(call, tx);
    if (input.reason === "connection" && input.seen !== record.seen) return "changed";

    const [request] = await tx
      .insert(schema.refundRequests)
      .values({ callId: call.id, customerId: input.customerId, reason: input.reason, note, summary: record.json, askedAt: now })
      .returning();
    // Money of this call that was already taken (a charge the founder made after a review) had been given the
    // date of a call nobody asked about. Now somebody has asked: it waits the 2 days of a call with a request,
    // like a charge taken after the request. The date only ever moves later, and nothing of this call can have
    // been collected yet: that is not possible before asking is over.
    const withRequest = new Date(call.endsAt.getTime() + COLLECT_AFTER_REQUEST_MS);
    await tx
      .update(schema.payments)
      .set({ transferDueAt: withRequest })
      .where(and(eq(schema.payments.callId, call.id), eq(schema.payments.status, "charged"), inArray(schema.payments.transferStatus, ["not_due", "due"]), lt(schema.payments.transferDueAt, withRequest)));
    const expiry = (await openCharges(tx, call.id)).length > 0 ? await commonExpiry(tx, call.id) : null;
    const answerBy = expiry ? moneyTiming({ callStartsAt: call.startsAt, requestedAt: now, holdExpiresAt: expiry }).answerBy : null;
    await queueRequestEmail(tx, call, request, answerBy ? { answerBy } : (await anyOnHold(tx, call.id)) ? "being_decided" : "taken");
    return "sent";
  });
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

type GivenAnswer = { paymentId: string; choice: string; maxCents?: number | null };

/** The call and its request, both locked, for someone allowed to decide: the call's host, or the founder. */
async function lockedForDeciding(tx: Tx, input: { callId: string; by: string; as: "host" | "admin" }): Promise<{ call: Call; request: RefundRequest }> {
  // Always in this order: the call, then its payments, then the request.
  const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, input.callId)).for("update");
  if (!call || (input.as === "host" && call.hostId !== input.by)) throw new RequestError("Call not found.");
  const payments = await tx.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.callId, call.id)).orderBy(asc(schema.payments.id));
  for (const { id } of payments) await lockPayment(tx, id);
  const [request] = await tx.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id)).for("update");
  if (!request) throw new RequestError("There is no refund request on this call.");
  // The first answer stands. A later one cannot replace it or send a second email. A refund that went
  // through is an answer too (and with the payments locked, none can complete while this is decided).
  if (await isAnswered(request, tx)) throw new RequestError("This request has already been answered.");
  return { call, request };
}

/**
 * The answer before the money is taken: for each charge of the call, in full,
 * less, or nothing. It is saved first, in one locked step, and only then
 * carried out. If the money was already taken (or its taking already written
 * down), nothing is saved: an answer is then a refund or a "no".
 */
export async function answerRequest(input: { callId: string; by: string; as: "host" | "admin"; answers: GivenAnswer[]; message: string | null; now?: Date }): Promise<void> {
  const message = clean(input.message, MESSAGE_MAX) || null;
  await db.transaction(async (tx) => {
    const { call, request } = await lockedForDeciding(tx, input);
    const open = await openCharges(tx, call.id);
    if (open.length === 0) {
      throw new RequestError(
        (await anyOnHold(tx, call.id))
          ? "The charge for this call is being decided right now (its record is under review at Connect, or the money is just being taken), so it cannot be answered here at the moment."
          : "The money for this call has already been taken, so it can no longer be lowered. You can still give a refund, or say no.",
      );
    }

    const lines: AnswerLine[] = [];
    for (const [index, payment] of open.entries()) {
      const given = input.answers.find((a) => a.paymentId === payment.id);
      if (!given || !["full", "less", "nothing"].includes(given.choice)) throw new RequestError("Choose an answer for each charge.");
      const choice = given.choice as Choice;
      let maxCents: number | null = null;
      if (choice === "less") {
        maxCents = given.maxCents ?? NaN;
        // A card cannot be charged under 50 cents, and an amount is never rounded up.
        if (!Number.isInteger(maxCents) || maxCents < MIN_CHARGE_CENTS) throw new RequestError("A card cannot be charged less than 50 cents. Choose \"charge nothing\" instead.");
        if (maxCents >= payment.bookedCents) throw new RequestError("That is not less than the price of this charge. Choose \"charge in full\" instead.");
      }
      await tx.insert(schema.refundRequestAnswers).values({ requestId: request.id, paymentId: payment.id, choice, maxCents });
      lines.push({ label: payment.extensionId ? `The time added during the call (${index + 1})` : "The call itself", choice, maxCents });
    }
    await tx
      .update(schema.refundRequests)
      .set({ status: "answered", decidedBy: input.by, decidedAs: input.as, decidedAt: input.now ?? new Date(), message })
      .where(eq(schema.refundRequests.id, request.id));
    await queueAnswerEmail(tx, call, request, { by: input.as, lines, message });
  });
  // Carried out at once. If this fails or the app stops here, the helper carries the saved answer out: it is never replaced by "in full".
  await settleOrdinaryCharges(input.callId, input.now ?? new Date()).catch((error) => console.error(`[refunds] could not apply the answer on call ${input.callId} yet; the helper will`, error));
}

/** A "no" after the money was taken. (Before that, "no" is the answer "charge in full".) */
export async function declineRequest(input: { callId: string; by: string; as: "host" | "admin"; message: string | null; now?: Date }): Promise<void> {
  const message = clean(input.message, MESSAGE_MAX) || null;
  await db.transaction(async (tx) => {
    const { call, request } = await lockedForDeciding(tx, input);
    if ((await openCharges(tx, call.id)).length > 0) throw new RequestError("The money for this call has not been taken yet. Answer for each charge instead.");
    if (await anyOnHold(tx, call.id)) throw new RequestError("The charge for this call is still being decided, so there is nothing to say no to yet.");
    await tx
      .update(schema.refundRequests)
      .set({ status: "declined", decidedBy: input.by, decidedAs: input.as, decidedAt: input.now ?? new Date(), message })
      .where(eq(schema.refundRequests.id, request.id));
    await queueClosedEmail(tx, call, request, { how: "declined", by: input.as, message });
  });
}

/** The founder closes a request, for a host who has gone silent for good. The host's payment can then go ahead. */
export async function closeRequest(input: { callId: string; adminId: string; now?: Date }): Promise<void> {
  await db.transaction(async (tx) => {
    const { call, request } = await lockedForDeciding(tx, { callId: input.callId, by: input.adminId, as: "admin" });
    await tx
      .update(schema.refundRequests)
      .set({ status: "closed", decidedBy: input.adminId, decidedAs: "admin", decidedAt: input.now ?? new Date() })
      .where(eq(schema.refundRequests.id, request.id));
    await queueClosedEmail(tx, call, request, { how: "closed", by: "admin", message: null });
  });
  // If the money was still on hold, it is now taken in full.
  await settleOrdinaryCharges(input.callId, input.now ?? new Date()).catch((error) => console.error(`[refunds] could not take the money on call ${input.callId} yet; the helper will`, error));
}

// ---------------------------------------------------------------------------
// The helper's part, and the founder's list
// ---------------------------------------------------------------------------

/** One reminder to the host, halfway through their time, while their answer can still lower the charge. */
export async function writeAnswerReminders(now: Date): Promise<void> {
  const waiting = await db
    .select({ request: schema.refundRequests, call: schema.calls })
    .from(schema.refundRequests)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.refundRequests.callId))
    .where(and(eq(schema.refundRequests.status, "asked"), gt(schema.refundRequests.askedAt, new Date(now.getTime() - 3 * 24 * 3_600_000))));
  for (const { request, call } of waiting) {
    const expiry = (await openCharges(db, call.id)).length > 0 ? await commonExpiry(db, call.id) : null;
    if (!expiry) continue; // the money was taken: nothing left to hurry for
    const answerBy = moneyTiming({ callStartsAt: call.startsAt, requestedAt: request.askedAt, holdExpiresAt: expiry }).answerBy!;
    const halfway = (request.askedAt.getTime() + answerBy.getTime()) / 2;
    if (now.getTime() < halfway || now >= answerBy) continue;
    await queueRequestReminder(db, call, request, answerBy);
  }
}

/** Every request still waiting for an answer, oldest first, read on its own. For the founder. */
export async function unansweredRequests(): Promise<Array<{ request: RefundRequest; call: Call; view: RequestView }>> {
  const rows = await db
    .select({ request: schema.refundRequests, call: schema.calls })
    .from(schema.refundRequests)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.refundRequests.callId))
    .where(eq(schema.refundRequests.status, "asked"))
    .orderBy(asc(schema.refundRequests.askedAt));
  const list = [];
  for (const { request, call } of rows) {
    const view = await requestViewOf(call);
    // A request on a call for which nothing was charged in the end (a hold released after a review) needs no answer.
    if (view && !view.answered && !view.nothingAtStake) list.push({ request, call, view });
  }
  return list;
}

/** The summary saved with a request, and the two short texts, are kept for one year. */
export async function forgetOldRequests(now: Date): Promise<void> {
  // In one step: if removing the copies in the emails fails, the request keeps its texts and the whole
  // removal is tried again next time. Otherwise the copies would never be found again.
  await db.transaction(async (tx) => {
    const old = await tx
      .update(schema.refundRequests)
      .set({ summary: null, note: "", message: null })
      .where(
        and(
          lt(schema.refundRequests.askedAt, new Date(now.getTime() - 365 * 24 * 3_600_000)),
          or(sql`${schema.refundRequests.summary} is not null`, ne(schema.refundRequests.note, ""), sql`${schema.refundRequests.message} is not null`),
        ),
      )
      .returning({ id: schema.refundRequests.id });
    // The emails about the request quote the two texts. Their words go too; that each was sent stays on record.
    for (const { id } of old) await tx.update(schema.emailOutbox).set({ body: REMOVED }).where(like(schema.emailOutbox.dedupeKey, `refund-request:${id}:%`));
  });
}
