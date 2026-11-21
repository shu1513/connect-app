/**
 * The app answers the bank (plans/47-bank-disputes.md, decision 6). The helper's job, every few
 * seconds, for each dispute that waits for an answer.
 *
 * An answer cannot be changed or added to once Stripe has passed it on, so this follows the rule
 * every money action in the app follows:
 *   1. With the dispute's row held: is an answer due, and does Stripe still show this stage waiting?
 *      Then the request is written down, with its label and its exact words.
 *   2. Stripe is asked, with that label. Stripe refuses to do the same thing twice under one label.
 *   3. With the row held again: Stripe's reply is recorded, if the dispute is still in that stage.
 *
 * An answer counts as the app's own only on Stripe's reply to that very request, for that very stage. A request written
 * down and left without a reply is sent again under the same label, which is safe for 23 hours
 * (Stripe then gives the first reply back, or does it now). After that, or when Stripe shows the
 * dispute no longer waiting, the record says what Stripe shows and that it is not known who
 * answered. Nothing is concluded from Stripe's count of submissions, or from the status alone.
 */
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import type { Dispute } from "@/db/schema";
import { errorSummary } from "@/lib/email";
import { inTime } from "@/lib/payments/disputes";
import { isDefiniteRefusal, stripe, stripeErrorMessage } from "@/lib/payments/stripe";
import { gatherFacts } from "./evidence";
import { proofFrom } from "./proof";
import { aboutOwner, ownerOf, seenIn, tellAll, type Only } from "./record";
import { answerLabel, dueNow, LABEL_SAFE_MS, LATE_MS, planFor, RETRY_AFTER_NO_MS, sameStage, waits } from "./rules";
import { isAppeal } from "./status";

const WAITING = ["needs_response", "warning_needs_response"];

type Kind = "proof" | "give_in";
/** What is asked of Stripe: the evidence to submit, or nothing more than "close". Kept as written, so a repeat sends the same. */
type Request = { kind: Kind; evidence?: Record<string, unknown> };
type Written = { id: string; stage: string; kind: Kind; attempt: number; request: Request };

/** The request for the proof: what the record shows, and for a compliance dispute the fee Stripe wants acknowledged. */
async function proofRequest(dispute: Dispute, fresh: Stripe.Dispute): Promise<Request | null> {
  // The bank's reason and the amount as Stripe shows them now: the letter answers what the bank says today.
  const facts = await gatherFacts(db, { ...dispute, reason: fresh.reason, amountCents: fresh.amount }, ownerOf(dispute));
  if (!facts) return null;
  const evidence: Record<string, unknown> = { ...proofFrom(facts) };
  // Only ever reached for a compliance dispute at or above the founder's line (planFor): Stripe passes the answer
  // on only when the 500-dollar fee is acknowledged in the request.
  const types = fresh.enhanced_eligibility_types ?? [];
  if (types.includes("visa_compliance")) evidence.enhanced_evidence = { visa_compliance: { fee_acknowledged: true } };
  if (types.includes("mastercard_compliance")) evidence.enhanced_evidence = { mastercard_compliance: { fee_acknowledged: true } };
  return { kind: "proof", evidence };
}

/**
 * Step 1. Gives back the request to send, or null when there is nothing to send now. Everything it
 * decides is written to the row before it lets go of it.
 */
async function writeDown(disputeId: string, now: Date, proofForCheck?: Record<string, string>): Promise<Written | null> {
  return db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId)).for("update");
    if (!dispute) return null;
    // A request that is written down is settled whatever has become of the dispute since (the record may already
    // show it with the bank, or decided): only so is it known whether the answer was the app's own.
    const sending = dispute.answer === "sending";
    if (!sending) {
      if (dispute.outcome || !waits(dispute.status)) return null;
      // A dispute recorded before the app answered banks: its stage is begun by the record's own look, within the minute.
      if (dispute.stageBeganAt === null) {
        await tx.update(schema.disputes).set({ lookAgain: true }).where(eq(schema.disputes.id, dispute.id));
        return null;
      }
      if (dispute.answer !== "none") return null;
      // After a clear "no" from Stripe, the next request comes an hour later.
      if (dispute.answerError && dispute.answerStartedAt && now.getTime() - dispute.answerStartedAt.getTime() < RETRY_AFTER_NO_MS) return null;
      if (!dueNow({ plan: planFor(dispute), choice: dispute.choice, askUntil: dispute.askUntil, now })) return null;
    }

    // Stripe is read before every sending, the first and each repeat (one try, never for long), and what the app
    // does is decided on what Stripe shows NOW, not on the row: a bank that has stopped taking an answer, a dispute
    // newly marked as a compliance one, or another amount, all count from this read.
    const fresh = await inTime(stripe().disputes.retrieve(dispute.id, {}, { maxNetworkRetries: 0 }));
    const plan = planFor({ ...seenIn(fresh, now), stage: dispute.stage });
    const stillWaiting = waits(fresh.status) && sameStage(fresh.status, dispute.stage);

    if (sending) {
      const age = now.getTime() - (dispute.answerStartedAt?.getTime() ?? 0);
      // While the dispute still waits, the repeat may be the first time Stripe really does it: then the rule for a
      // dispute the app leaves alone holds as for a new request.
      const mayNotSend = stillWaiting && plan === "leave";
      // An appeal is the same dispute's later round, which the app never answers: nothing is sent into one, not even
      // a repeat (if the first request never arrived, the repeat would be a first answer to the appeal).
      if (age < LABEL_SAFE_MS && sameStage(fresh.status, dispute.stage) && !isAppeal(fresh.status) && dispute.answerKind && dispute.proof && !mayNotSend) {
        // No reply came to the request that is written down: the same request again, under the same label, also when
        // the dispute no longer waits. If the first one went through, Stripe gives its reply back and the answer is
        // known to be the app's own. If it never arrived and somebody else has answered since, Stripe refuses this
        // one, and that is recorded. Never for a dispute that has moved to another stage: a question's answer is not
        // sent as a chargeback's.
        return { id: dispute.id, stage: dispute.stage, kind: dispute.answerKind as Kind, attempt: dispute.answerAttempt, request: JSON.parse(dispute.proof) as Request };
      }
      if (stillWaiting) {
        // Still waiting, and the request cannot go: too old for a repeat to be safe (it never went through), or the
        // app now leaves this dispute alone. Closed as not sent; if an answer is still due, the next pass writes a
        // new one, with the next number.
        const why = mayNotSend ? "A request was written down and not sent: the app leaves this dispute alone." : "A request was written down and never confirmed; it was closed as not sent.";
        await tx.update(schema.disputes).set({ answer: "none", proof: null, answerStartedAt: null, answerError: why, lookAgain: true }).where(eq(schema.disputes.id, dispute.id));
        return null;
      }
      // The dispute stopped waiting and no reply to the app's request ever came: not known who answered.
      await tx.update(schema.disputes).set({ answer: "unknown", proof: null, lookAgain: true }).where(eq(schema.disputes.id, dispute.id));
      return null;
    }

    const kind = stillWaiting ? dueNow({ plan, choice: dispute.choice, askUntil: dispute.askUntil, now }) : null;
    if (!kind) {
      // Not waiting in this stage any more (answered from outside, or it moved on), or Stripe now shows a dispute
      // the app leaves alone: the record's look brings the row up to date.
      await tx.update(schema.disputes).set({ lookAgain: true }).where(eq(schema.disputes.id, dispute.id));
      return null;
    }
    const request: Request | null = kind === "give_in" ? { kind } : proofForCheck ? { kind, evidence: proofForCheck } : await proofRequest(dispute, fresh);
    if (!request) {
      await tx.update(schema.disputes).set({ answerError: "The record of this payment could not be read, so no proof could be written.", answerStartedAt: now }).where(eq(schema.disputes.id, dispute.id));
      return null;
    }
    const attempt = dispute.answerAttempt + 1;
    await tx
      .update(schema.disputes)
      .set({
        // Nobody chose in time, or nobody was asked: that counts as "fight".
        ...(plan === "ask" && !dispute.choice ? { choice: "fight", chosenAs: "silence", chosenAt: now } : {}),
        answer: "sending",
        answerKind: kind,
        answerAttempt: attempt,
        answerStartedAt: now,
        answerError: null,
        proof: JSON.stringify(request),
      })
      .where(eq(schema.disputes.id, dispute.id));
    return { id: dispute.id, stage: dispute.stage, kind, attempt, request };
  });
}

/** Step 2. Asks Stripe. The label makes a repeat give the first reply back. */
async function send(written: Written): Promise<Stripe.Dispute> {
  const label = answerLabel(written, written.kind, written.attempt);
  return written.kind === "give_in"
    ? stripe().disputes.close(written.id, {}, { idempotencyKey: label })
    : stripe().disputes.update(written.id, { evidence: written.request.evidence as Stripe.DisputeUpdateParams.Evidence, submit: true }, { idempotencyKey: label });
}

/** Step 3. Records Stripe's reply as the app's own answer, if the row still holds that very request for that stage. */
async function recordReply(written: Written, reply: Stripe.Dispute, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, written.id)).for("update");
    if (!dispute) return;
    if (dispute.answer !== "sending" || dispute.answerAttempt !== written.attempt || dispute.stage !== written.stage || !sameStage(reply.status, written.stage) || isAppeal(reply.status)) {
      // A reply for a stage that is over (or a request already settled) changes nothing; it is only noted. So is a
      // reply that shows the dispute in another stage than the request was written for: the app does not call that
      // answer its own (the next pass settles the request as "not known who answered").
      const history = [...(JSON.parse(dispute.stageHistory) as unknown[]), { late: true, stage: written.stage, kind: written.kind, attempt: written.attempt, at: now }];
      await tx.update(schema.disputes).set({ stageHistory: JSON.stringify(history) }).where(eq(schema.disputes.id, dispute.id));
      return;
    }
    await tx
      .update(schema.disputes)
      .set({
        answer: written.kind === "proof" ? "proof" : "given_in",
        answeredAt: now,
        answerError: null,
        // What is kept as "the proof that was sent" is what Stripe's reply shows the evidence to be.
        proof: written.kind === "proof" ? JSON.stringify(reply.evidence ?? {}) : null,
        // Stripe now shows another status (with the bank, or lost): the record's look tells people.
        lookAgain: true,
      })
      .where(eq(schema.disputes.id, dispute.id));
  });
}

/**
 * A clear "no" from Stripe: noted, and the request is settled as not done. While the dispute still waits, the next
 * one comes an hour later. If the record already shows it past waiting, somebody else answered it and the app's
 * request was never confirmed: not known who answered.
 */
async function recordRefusal(written: Written, message: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [dispute] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, written.id)).for("update");
    if (!dispute || dispute.answer !== "sending" || dispute.answerAttempt !== written.attempt || dispute.stage !== written.stage) return;
    await tx
      .update(schema.disputes)
      .set({ answer: waits(dispute.status) ? "none" : "unknown", proof: null, answerError: message, answerStartedAt: now, lookAgain: true })
      .where(eq(schema.disputes.id, dispute.id));
  });
}

/**
 * For the check script only. `cut` stops where a crash would: after the request is written down, or after
 * Stripe did its part. `proof` is sent in place of the app's own proof: Stripe's test area decides a test
 * dispute on two exact texts, and no other way.
 */
export type ForCheck = { cut?: "before_stripe" | "after_stripe"; proof?: Record<string, string> };

/** One dispute: the three steps. */
export async function answerOne(disputeId: string, now: Date, check: ForCheck = {}): Promise<void> {
  const { cut } = check;
  const written = await writeDown(disputeId, now, check.proof);
  if (!written || cut === "before_stripe") return;
  let reply: Stripe.Dispute;
  try {
    reply = await send(written);
  } catch (error) {
    // A clear "no" is recorded. Anything else leaves the request written down: the next pass sends it again.
    if (isDefiniteRefusal(error)) await recordRefusal(written, stripeErrorMessage(error), now);
    else console.error(`[disputes] no clear answer from Stripe for dispute ${written.id}; the request stays written down (${errorSummary(error)})`);
    return;
  }
  if (cut === "after_stripe") return;
  await recordReply(written, reply, now);
}

/** The founder is told, once, of a dispute that still waits for the app's answer a day before the bank's deadline. */
async function tellIfLate(disputeId: string, now: Date): Promise<void> {
  // Read now, after the try to answer it: a dispute that was just answered is not late.
  const [dispute] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId));
  if (!dispute || dispute.outcome || !waits(dispute.status) || !["none", "sending"].includes(dispute.answer)) return;
  // The row is marked to be read from Stripe again (the try just now may have seen it answered): the next pass decides.
  if (dispute.lookAgain) return;
  if (!dispute.dueBy || dispute.dueBy <= now || dispute.dueBy.getTime() - now.getTime() > LATE_MS || planFor(dispute) === "leave") return;
  const about = await aboutOwner(db, ownerOf(dispute));
  if (!about) return;
  await db.transaction((tx) => tellAll(tx, about, dispute, { late: dispute.answerError }));
}

/**
 * The helper's job: every dispute that waits for an answer and has none from the app yet, and every
 * request that is written down and not yet confirmed (whatever its dispute has become since). Each
 * is looked at on its own; one that fails does not stop the others. All of them, each pass: one
 * that is not due costs one look at its row and nothing at Stripe.
 */
export async function answerDisputes(now: Date, only?: Only): Promise<void> {
  const began = Date.now();
  // The clock moves on while the list is worked through: each dispute is judged at its own moment.
  const moment = () => new Date(now.getTime() + (Date.now() - began));
  const rows = await db
    .select({ id: schema.disputes.id })
    .from(schema.disputes)
    .where(and(or(eq(schema.disputes.answer, "sending"), and(isNull(schema.disputes.outcome), inArray(schema.disputes.status, WAITING), eq(schema.disputes.answer, "none"))), only ? inArray(schema.disputes.id, only.disputeIds) : undefined))
    .orderBy(asc(schema.disputes.dueBy));
  for (const { id } of rows) {
    await answerOne(id, moment()).catch((error) => console.error(`[disputes] could not answer dispute ${id} (${errorSummary(error)}); will retry`));
    await tellIfLate(id, moment()).catch((error) => console.error(`[disputes] could not tell the founder about dispute ${id} (${errorSummary(error)})`));
  }
}

/** For the health address: a dispute still waiting for the app's answer inside the last day before the bank's deadline. */
export async function disputeHealthProblems(now: Date): Promise<string[]> {
  const waiting = await db
    .select()
    .from(schema.disputes)
    .where(and(isNull(schema.disputes.outcome), inArray(schema.disputes.status, WAITING), inArray(schema.disputes.answer, ["none", "sending"])));
  const late = waiting.filter((dispute) => dispute.dueBy && dispute.dueBy.getTime() - now.getTime() <= LATE_MS && dispute.dueBy > now && planFor(dispute) !== "leave");
  return late.length > 0 ? ["a bank dispute still has no answer from the app, a day or less before the bank's deadline"] : [];
}
