/**
 * Taking a share back from a host after a lost bank dispute (plans/47-bank-disputes.md, decision
 * 10 and part 3). The rules are in takeback-rules.ts, the words in takeback-words.ts.
 *
 * A host can collect their share of a payment before the customer's bank disputes it. If the
 * dispute is lost, the bank has taken the money from Connect and the host still has their share.
 * The helper then, every pass:
 *   1. finds what is owed: for every lost dispute, every share under it that was really sent and
 *      has no row yet gets one, with the amount worked out from what Stripe shows at that moment,
 *      and the host is told in writing (and the founder by email);
 *   2. brings rows up to date when the bank decided the other way after all;
 *   3. takes what is due: 14 days after the notice, a money action of its own kind ("take_back")
 *      on the share's payment asks Stripe to reverse that amount of that transfer;
 *   4. tells the founder when Stripe has refused for 30 days.
 *
 * The order of locks: the share's payment first (the money action locks it, and so does every step
 * here), then the take-back's row. A dispute is read here and never locked.
 *
 * A reversal cannot be undone by the app, so it goes through the steps every money action takes
 * (operations.ts): written down under a label, asked of Stripe with that label, recorded. A row is
 * "taking" exactly while its action is unanswered; every way that action can end as "not done"
 * puts the row back to "told" in the same step.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Dispute, HostDebt } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import { errorSummary, queueEmail } from "@/lib/email";
import { appUrl, tell } from "@/lib/messages/messages";
import { formatMoney } from "@/lib/payments/access";
import { inTime } from "@/lib/payments/disputes";
import { addLedgerEntry, failOwnedOperation, finishOperation, lockPayment, MoneyError, OutcomeUnknownError, runMoneyOperation, type OperationPlan, type Tx } from "@/lib/payments/operations";
import { stripe } from "@/lib/payments/stripe";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { aboutOwner, disputePath, ownerOf, peopleFor, type Only } from "./record";
import { outcomeOf } from "./status";
import { canCancel, dueToTake, NOTICE_MS, owedCents, takebackLabel, tellFounderOfRefusals } from "./takeback-rules";
import { cancelledWords, leftoverWords, owedWords, owedWordsForFounder, refusedWords, takenWords, type DebtFacts } from "./takeback-words";

const debts = schema.hostDebts;

/** What the amount was worked out from, kept with the row. */
export type Basis = { sentCents: number; disputedCents: number; chargeLeftCents: number; transferLeftCents: number; othersOpenCents: number; sameDisputeCents: number };

/** What the money action carries: enough to send the very same request again. */
export type TakeParams = { debtId: string; transferId: string; amountCents: number };

const log = (what: string, error: unknown) => console.error(`[disputes] ${what} (${errorSummary(error)}); will retry`);

// ---------------------------------------------------------------------------
// Telling people
// ---------------------------------------------------------------------------

/** The people of a take-back and the words' facts for each reader. Null when the money or the people are gone. */
async function tellingFor(tx: Tx, debt: Pick<HostDebt, "amountCents" | "dueAt" | "basis">, dispute: Dispute) {
  const about = await aboutOwner(tx, ownerOf(dispute));
  if (!about) return null;
  const people = await peopleFor(tx, about);
  if (!people) return null;
  const basis = JSON.parse(debt.basis) as Partial<Basis>;
  const sent = basis.sentCents ?? debt.amountCents;
  const whole = !basis.chargeLeftCents || !basis.disputedCents || basis.disputedCents >= basis.chargeLeftCents;
  const part = whole ? sent : Math.floor((sent * basis.disputedCents!) / basis.chargeLeftCents!);
  const names = { host: people.hostName, customer: people.customer.name };
  const facts = (role: "host" | "founder", person: { timeZone: string | null }): DebtFacts => ({
    what: about.what(role, person, names),
    amount: formatMoney(debt.amountCents),
    sent: formatMoney(sent),
    part: whole ? null : { disputed: formatMoney(basis.disputedCents!), of: formatMoney(basis.chargeLeftCents!) },
    // Less than that part, and why: no more is owed than the bank took back, or no more is left of the transfer.
    capped: debt.amountCents >= part ? null : debt.amountCents >= Math.max(0, (basis.disputedCents ?? 0) - (basis.sameDisputeCents ?? 0)) ? "bank" : "transfer",
    dueOn: whenFor(person, debt.dueAt),
    hostName: people.hostName,
    customerName: people.customer.name,
    supportEmail: SUPPORT_EMAIL,
  });
  return { people, facts };
}

/** One message to the host (in the app and by email, as a pair) under a key of this take-back. */
async function tellHost(tx: Tx, debt: HostDebt, dispute: Dispute, what: string, words: (facts: DebtFacts) => { subject: string; text: string }): Promise<void> {
  const telling = await tellingFor(tx, debt, dispute);
  if (!telling) return;
  const told = words(telling.facts("host", telling.people.host));
  await tell(tx, { to: telling.people.host, key: `takeback:${debt.id}:${what}:host:${telling.people.host.id}`, subject: told.subject, text: told.text, path: disputePath(dispute.id) });
}

/** One email to each admin. What the founder is told names both people, so it is not on the Messages page. */
async function tellFounders(tx: Tx, debt: HostDebt, dispute: Dispute, what: string, words: (facts: DebtFacts) => { subject: string; text: string }): Promise<void> {
  const telling = await tellingFor(tx, debt, dispute);
  if (!telling) return;
  for (const founder of telling.people.founders) {
    const told = words(telling.facts("founder", founder));
    await queueEmail(tx, { to: founder.email, key: `takeback:${debt.id}:${what}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\nThe dispute's page (admin login):\n${appUrl()}${disputePath(dispute.id)}\n` });
  }
}

// ---------------------------------------------------------------------------
// 1. Finding what is owed
// ---------------------------------------------------------------------------

/**
 * Every lost dispute and every share under it that was sent with a real transfer and has no row
 * yet. A look the helper repeats: a transfer that was under way when the loss arrived, and went
 * through later, is found on a later pass.
 */
async function sharesWithoutRow(only?: Only): Promise<Array<{ dispute: Dispute; paymentId: string }>> {
  const missing = (under: SQL) =>
    db
      .select({ dispute: schema.disputes, paymentId: schema.payments.id })
      .from(schema.disputes)
      .innerJoin(schema.payments, under)
      .where(
        and(
          eq(schema.disputes.outcome, "lost"),
          eq(schema.payments.transferStatus, "sent"),
          gt(schema.payments.transferCents, 0),
          isNotNull(schema.payments.stripeTransferId),
          notExists(db.select({ one: sql`1` }).from(debts).where(and(eq(debts.disputeId, schema.disputes.id), eq(debts.paymentId, schema.payments.id)))),
          only ? inArray(schema.disputes.id, only.disputeIds) : undefined,
        ),
      );
  // A call's card payment is its own share; a membership's month and a contribution's payment reach the host
  // through the payments under them.
  return [
    ...(await missing(eq(schema.payments.id, schema.disputes.paymentId))),
    ...(await missing(eq(schema.payments.monthId, schema.disputes.monthId))),
    ...(await missing(eq(schema.payments.contributionPaymentId, schema.disputes.contributionPaymentId))),
  ];
}

/**
 * Writes the row for one dispute and one share, with the share's payment held, and tells the host
 * and the founder. The amount is worked out in this step from what Stripe shows now. While another
 * take-back on the same share is being taken, this one waits for the next pass: the amount is only
 * worked out when nothing on that transfer is under way, so one reversal is never counted twice.
 * A share that owes nothing gets a row that says so, so that Stripe is not asked again every pass.
 */
async function writeDebt(dispute: Dispute, paymentId: string, now: Date): Promise<void> {
  const notLostAtStripe = await db.transaction(async (tx) => {
    const share = await lockPayment(tx, paymentId);
    if (share.transferStatus !== "sent" || !share.stripeTransferId || (share.transferCents ?? 0) <= 0) return false;
    const [current] = await tx.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, dispute.id));
    if (current?.outcome !== "lost") return false;
    const others = await tx.select().from(debts).where(eq(debts.paymentId, paymentId));
    if (others.some((other) => other.disputeId === dispute.id) || others.some((other) => other.status === "taking")) return false;
    // What other shares under the same dispute already owe or have paid back (a membership's month has several):
    // all of them together never owe more than the bank took back in this dispute.
    const sameDispute = await tx.select({ amountCents: debts.amountCents }).from(debts).where(and(eq(debts.disputeId, dispute.id), inArray(debts.status, ["told", "taking", "taken"])));

    // Both reads at once, one try each, under one limit of time: the share's payment is held meanwhile.
    const [atStripe, transfer] = await inTime(
      Promise.all([stripe().disputes.retrieve(dispute.id, { expand: ["charge"] }, { maxNetworkRetries: 0 }), stripe().transfers.retrieve(share.stripeTransferId, {}, { maxNetworkRetries: 0 })]),
    );
    // Not lost at Stripe (an appeal, or decided the other way): nothing is written, and the record is read again.
    if (outcomeOf(atStripe.status) !== "lost") return true;
    // Without the charge, what was left of it is not known: nothing is worked out on a guess. The next pass asks again.
    const charge = typeof atStripe.charge === "string" ? null : atStripe.charge;
    if (!charge) return false;
    const basis: Basis = {
      sentCents: share.transferCents!,
      disputedCents: atStripe.amount,
      // What was left of the charge: what was taken, less what had been refunded.
      chargeLeftCents: charge.amount_captured - charge.amount_refunded,
      transferLeftCents: transfer.amount - transfer.amount_reversed,
      othersOpenCents: others.filter((other) => other.status === "told").reduce((sum, other) => sum + other.amountCents, 0),
      sameDisputeCents: sameDispute.reduce((sum, other) => sum + other.amountCents, 0),
    };
    const amountCents = owedCents(basis);
    // The 14 days count from the moment the notice is written, not from when this pass began.
    const toldAt = now.getTime() > Date.now() ? now : new Date();
    const [debt] = await tx
      .insert(debts)
      .values({ disputeId: dispute.id, paymentId, hostId: dispute.hostId, stripeTransferId: share.stripeTransferId, amountCents, currency: share.currency, basis: JSON.stringify(basis), status: amountCents > 0 ? "told" : "nothing", toldAt, dueAt: new Date(toldAt.getTime() + NOTICE_MS) })
      .onConflictDoNothing()
      .returning();
    if (!debt || amountCents === 0) return false;
    await tellHost(tx, debt, dispute, "owed", owedWords);
    await tellFounders(tx, debt, dispute, "owed", owedWordsForFounder);
    return false;
  });
  // Written after the share's payment is let go: a dispute's row is never asked for while a payment is held.
  if (notLostAtStripe) await db.update(schema.disputes).set({ lookAgain: true }).where(eq(schema.disputes.id, dispute.id));
}

/**
 * A take-back was called off. Another dispute over the same share may have been told "nothing is owed" only because
 * this one had the amount set aside: those rows are taken away, so the next look works them out afresh (and writes a
 * notice of its own if something is owed after all). With the share's payment held.
 */
async function freeSetAside(tx: Tx, paymentId: string): Promise<void> {
  await tx.delete(debts).where(and(eq(debts.paymentId, paymentId), eq(debts.status, "nothing")));
}

// ---------------------------------------------------------------------------
// 2. The bank decided the other way after all
// ---------------------------------------------------------------------------

/**
 * A lost dispute that Stripe now shows as won. A take-back that only has its notice is called off
 * by itself. One that is being taken is left alone until its action is finished, and is then either
 * back at its notice (and called off here) or taken. One that was taken is not given back by the
 * app: the founder and the host are told, once.
 */
async function settleChanged(now: Date, only?: Only): Promise<void> {
  const rows = await db
    .select({ debt: debts, dispute: schema.disputes })
    .from(debts)
    .innerJoin(schema.disputes, eq(schema.disputes.id, debts.disputeId))
    .where(and(eq(schema.disputes.outcome, "won"), or(eq(debts.status, "told"), and(eq(debts.status, "taken"), isNull(debts.leftoverToldAt))), only ? inArray(debts.disputeId, only.disputeIds) : undefined));
  for (const { debt, dispute } of rows) {
    await db
      .transaction(async (tx) => {
        await lockPayment(tx, debt.paymentId);
        const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
        if (!fresh) return;
        if (fresh.status === "told") {
          await tx.update(debts).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(debts.id, fresh.id));
          await freeSetAside(tx, fresh.paymentId);
          await tellHost(tx, fresh, dispute, "cancelled", (facts) => cancelledWords(facts, "won"));
        } else if (fresh.status === "taken" && fresh.leftoverToldAt === null) {
          await tx.update(debts).set({ leftoverToldAt: now, updatedAt: now }).where(eq(debts.id, fresh.id));
          await tellHost(tx, fresh, dispute, "leftover", (facts) => leftoverWords("host", facts));
          await tellFounders(tx, fresh, dispute, "leftover", (facts) => leftoverWords("founder", facts));
        }
      })
      .catch((error) => log(`could not settle take-back ${debt.id} after its dispute was won`, error));
  }
}

// ---------------------------------------------------------------------------
// 3. Taking it
// ---------------------------------------------------------------------------

/** Asks Stripe to take the amount back out of the transfer. The take-back's id goes with it, so it can be found again. */
export async function reverseAtStripe(params: TakeParams, label: string): Promise<{ id: string }> {
  return stripe().transfers.createReversal(params.transferId, { amount: params.amountCents, metadata: { debtId: params.debtId } }, { idempotencyKey: label });
}

/** Stripe did it: the row is "taken", the money record gets its line, and the host is told. With the share's payment held. */
export async function applyTaken(tx: Tx, params: TakeParams, reversalId: string): Promise<void> {
  const now = new Date();
  const [debt] = await tx
    .update(debts)
    .set({ status: "taken", stripeReversalId: reversalId, takenAt: now, updatedAt: now })
    .where(and(eq(debts.id, params.debtId), eq(debts.status, "taking")))
    .returning();
  if (!debt) return;
  await addLedgerEntry(tx, { paymentId: debt.paymentId, kind: "host_takeback", amountCents: debt.amountCents, stripeRef: reversalId, note: `Taken back from the host after a lost bank dispute (${debt.disputeId}).` });
  const [dispute] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, debt.disputeId));
  if (dispute) await tellHost(tx, debt, dispute, "taken", takenWords);
}

/** It did not happen: the row is back at its notice, with what Stripe said. Tried again a day later. With the share's payment held. */
export async function backToTold(tx: Tx, debtId: string, message: string): Promise<void> {
  const now = new Date();
  await tx
    .update(debts)
    .set({ status: "told", refusal: message, refusedAt: now, firstRefusedAt: sql`coalesce(${debts.firstRefusedAt}, ${now.toISOString()}::timestamptz)`, updatedAt: now })
    .where(and(eq(debts.id, debtId), eq(debts.status, "taking")));
}

/** The money action of one take-back, on its share's payment. `now` is the moment it is judged at (the helper's pass). */
export function takePlan(debt: Pick<HostDebt, "id" | "paymentId">, now: Date = new Date()): OperationPlan<TakeParams, null> {
  return {
    paymentId: debt.paymentId,
    kind: "take_back",
    labelBase: takebackLabel(debt.id),
    // With the share's payment held, everything is judged again on the row as it is now: only a take-back that has
    // its notice, whose 14 days are over and that was not refused within the last day is started, and only while
    // its dispute is still recorded as lost. One that was cancelled, is being taken or was taken is refused here,
    // and nothing is written down.
    prepare: async (_payment, tx) => {
      const [row] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
      if (!row || !dueToTake(row, now)) throw new MoneyError("This take-back is not waiting to be taken.");
      const [dispute] = await tx.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, row.disputeId));
      if (dispute?.outcome !== "lost") throw new MoneyError("The dispute of this take-back is not lost any more.");
      await tx.update(debts).set({ status: "taking", updatedAt: new Date() }).where(eq(debts.id, row.id));
      return { debtId: row.id, transferId: row.stripeTransferId, amountCents: row.amountCents };
    },
    execute: async (params, label) => ({ stripeId: (await reverseAtStripe(params, label)).id, result: null }),
    apply: (_payment, params, outcome, tx) => applyTaken(tx, params, outcome.stripeId),
    onRefused: (_payment, params, message, tx) => backToTold(tx, params.debtId, message),
  };
}

/** One take-back whose notice is over. First Stripe is asked whether the dispute is still lost. */
async function takeOne(debt: HostDebt, now: Date): Promise<void> {
  const [dispute] = await db.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, debt.disputeId));
  // Not lost in the record any more (an appeal is open, or it was won): nothing is taken while that is so.
  if (dispute?.outcome !== "lost") return;
  const atStripe = await stripe().disputes.retrieve(debt.disputeId);
  if (outcomeOf(atStripe.status) !== "lost") {
    await db.update(schema.disputes).set({ lookAgain: true }).where(eq(schema.disputes.id, debt.disputeId));
    return;
  }
  try {
    await runMoneyOperation(takePlan(debt, now));
  } catch (error) {
    // A clear "no" put the row back to its notice (tried again tomorrow). No clear answer leaves the action
    // written down: the helper's check of unfinished actions finds out what happened.
    if (error instanceof MoneyError || error instanceof OutcomeUnknownError) console.log(`[disputes] take-back ${debt.id} was not taken now: ${error.message}`);
    else throw error;
  }
}

/** Only after this long is "Stripe's list does not show it" taken as "it did not happen": an hour after the last moment the request may still have been sent. */
const SETTLED_AFTER_MS = 24 * 3_600_000;
/** A repeat under the same label is sent up to this age of the action (Stripe keeps a label for 24 hours). */
const RESEND_UNTIL_MS = 23 * 3_600_000;

/**
 * Asking Stripe what it has is not the action itself. If the asking fails, even with a clear "no" (no permission,
 * say), that proves nothing about the take-back: it stays unanswered and is looked at again.
 */
async function lookUp<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new Error(`Could not look this up at Stripe: ${errorSummary(error)}`);
  }
}

/**
 * For the helper's check of unfinished money actions (payments/jobs.ts): what became of a take-back that got no answer.
 *   - While a repeat is safe AND the dispute is still lost (here and at Stripe): the same request under the same
 *     label, which gives the first reply back, or does it now. A repeat can be the first time Stripe really does
 *     it, so it is never sent for a dispute that is no longer lost. A repeat that brings no reversal, whatever
 *     Stripe said to it, settles nothing by itself.
 *   - Then, and otherwise, every page of the transfer's own reversals is searched for this take-back's id.
 *   - "It did not happen" is concluded only from a search that was read to the end, and only once the request can no
 *     longer be on its way (24 hours; a repeat is sent up to 23). Before that, nothing is concluded.
 */
export async function recoverTakeback(operation: { id: string; paymentId: string | null; label: string; createdAt: Date }, params: TakeParams, canRepeat: boolean): Promise<void> {
  if (!operation.paymentId) return;
  const [row] = await db.select({ disputeId: debts.disputeId }).from(debts).where(eq(debts.id, params.debtId));
  const [dispute] = row ? await db.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, row.disputeId)) : [];
  const age = () => Date.now() - operation.createdAt.getTime();
  let resend = canRepeat && dispute?.outcome === "lost";
  if (resend) resend = outcomeOf((await lookUp(() => stripe().disputes.retrieve(row.disputeId))).status) === "lost";
  let reversalId: string | undefined;
  // The clock is read right before the request goes out: the reads above can take time, and a repeat is only safe
  // while Stripe still knows the label.
  if (resend && age() < RESEND_UNTIL_MS) {
    try {
      reversalId = (await reverseAtStripe(params, operation.label)).id;
    } catch (error) {
      // Whatever a repeat is answered with, a "no" included, proves nothing about the first request (it may have gone
      // through before, say, a permission was taken away): the transfer's own list is what settles it.
      console.error(`[disputes] the repeat of take-back ${params.debtId} got no reversal (${errorSummary(error)}); Stripe's list is searched instead`);
    }
  }
  // Only a search that BEGAN after the request could no longer be on its way can say "it did not happen".
  const conclusive = age() >= SETTLED_AFTER_MS;
  if (reversalId === undefined) {
    await lookUp(async () => {
      for await (const reversal of stripe().transfers.listReversals(params.transferId, { limit: 100 })) {
        if (reversal.metadata?.debtId === params.debtId) {
          reversalId = reversal.id;
          break;
        }
      }
    });
  }
  if (reversalId !== undefined) {
    const found = reversalId;
    await finishOperation(operation.id, operation.paymentId, found, (_payment, tx) => applyTaken(tx, params, found));
    return;
  }
  // Not found, but the request may still be on its way (or another helper may just be sending it): looked at again.
  if (!conclusive) return;
  await refuseTakeback(operation, params, "Stripe shows this take-back did not happen.");
}

/** An unanswered take-back that definitely did not happen: the action is marked failed and the row put back, in one step. */
export async function refuseTakeback(operation: { id: string; paymentId: string | null }, params: TakeParams, message: string): Promise<void> {
  if (!operation.paymentId) return;
  const paymentId = operation.paymentId;
  await failOwnedOperation(operation.id, { column: "paymentId", id: paymentId, lock: (tx) => lockPayment(tx, paymentId) }, message, (_payment, tx) => backToTold(tx, params.debtId, message));
}

// ---------------------------------------------------------------------------
// The founder
// ---------------------------------------------------------------------------

/**
 * The founder calls a take-back off, which is how a host's objection is honoured. Possible while
 * the host only has their notice; one the app has started cannot be cancelled. Written down as an
 * admin action in the same step, and the host is told.
 */
export async function cancelDebt(input: { debtId: string; adminId: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const [found] = await db.select({ paymentId: debts.paymentId, disputeId: debts.disputeId }).from(debts).where(eq(debts.id, input.debtId));
  // (A take-back named together with another dispute's page is not this page's to cancel.)
  if (!found || (input.disputeId !== undefined && found.disputeId !== input.disputeId)) return false;
  return db.transaction(async (tx) => {
    await lockPayment(tx, found.paymentId);
    const [debt] = await tx.select().from(debts).where(eq(debts.id, input.debtId)).for("update");
    if (!debt || !canCancel(debt)) return false;
    await tx.update(debts).set({ status: "cancelled", cancelledAt: now, cancelledBy: input.adminId, updatedAt: now }).where(eq(debts.id, debt.id));
    await freeSetAside(tx, debt.paymentId);
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: "take-back after a lost dispute cancelled", targetUserId: debt.hostId, targetId: debt.id });
    const [dispute] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, debt.disputeId));
    if (dispute) await tellHost(tx, debt, dispute, "cancelled", (facts) => cancelledWords(facts, "founder"));
    return true;
  });
}

/** After 30 days of refusals the founder is told, once. It keeps being tried. */
async function tellOfRefusals(now: Date, only?: Only): Promise<void> {
  const refused = await db
    .select({ debt: debts, dispute: schema.disputes })
    .from(debts)
    .innerJoin(schema.disputes, eq(schema.disputes.id, debts.disputeId))
    .where(and(eq(debts.status, "told"), isNotNull(debts.firstRefusedAt), isNull(debts.founderToldAt), only ? inArray(debts.disputeId, only.disputeIds) : undefined));
  for (const { debt, dispute } of refused) {
    if (!tellFounderOfRefusals(debt, now)) continue;
    await db
      .transaction(async (tx) => {
        // Judged again on the row as it is now: one that was cancelled or taken meanwhile is nothing to write about.
        await lockPayment(tx, debt.paymentId);
        const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
        if (!fresh || !tellFounderOfRefusals(fresh, now)) return;
        await tx.update(debts).set({ founderToldAt: now, updatedAt: now }).where(eq(debts.id, fresh.id));
        await tellFounders(tx, fresh, dispute, "refused", (facts) => refusedWords(facts, fresh.refusal));
      })
      .catch((error) => log(`could not tell the founder about take-back ${debt.id}`, error));
  }
}

// ---------------------------------------------------------------------------
// The helper's pass, and what the pages show
// ---------------------------------------------------------------------------

/** The helper's work on take-backs, each pass. Each step and each row on its own: one that fails does not stop the others. */
export async function takeBackPass(now: Date, only?: Only): Promise<void> {
  for (const { dispute, paymentId } of await sharesWithoutRow(only)) {
    await writeDebt(dispute, paymentId, now).catch((error) => log(`could not work out what is owed for dispute ${dispute.id}`, error));
  }
  await settleChanged(now, only);
  const told = await db
    .select()
    .from(debts)
    .where(and(eq(debts.status, "told"), lte(debts.dueAt, now), only ? inArray(debts.disputeId, only.disputeIds) : undefined))
    .orderBy(asc(debts.dueAt));
  for (const debt of told) {
    if (!dueToTake(debt, now)) continue;
    await takeOne(debt, now).catch((error) => log(`could not take back for take-back ${debt.id}`, error));
  }
  await tellOfRefusals(now, only);
}

/** The take-backs of one dispute, for its page. A share that owes nothing is not shown. */
export async function debtsOfDispute(disputeId: string): Promise<HostDebt[]> {
  return db.select().from(debts).where(and(eq(debts.disputeId, disputeId), sql`${debts.status} <> 'nothing'`)).orderBy(asc(debts.toldAt));
}

/** What a host owes or has paid back, for their earnings: everything still open, and the latest that were taken, with the page of each dispute. */
export async function debtsOfHost(hostId: string, takenShown = 10): Promise<Array<HostDebt & { path: string }>> {
  const open = await db.select().from(debts).where(and(eq(debts.hostId, hostId), inArray(debts.status, ["told", "taking"]))).orderBy(asc(debts.dueAt));
  const taken = await db.select().from(debts).where(and(eq(debts.hostId, hostId), eq(debts.status, "taken"))).orderBy(sql`${debts.takenAt} desc`).limit(takenShown);
  // (One that was taken between the two reads is shown once, as taken.)
  const settled = new Set(taken.map((row) => row.id));
  return [...open.filter((row) => !settled.has(row.id)), ...taken].map((row) => ({ ...row, path: disputePath(row.disputeId) }));
}
