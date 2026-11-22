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
 *   3. gives each take-back its due day once its notice has really gone out by email: 14 days after
 *      the sending service accepted it (plans/46-part-3-money-owed.md, decision 6). A notice that
 *      did not arrive leaves it without a day, and the founder is told;
 *   4. takes what is due: a money action of its own kind ("take_back") on the share's payment asks
 *      Stripe to reverse that amount of that transfer;
 *   5. tells the founder when Stripe has refused for 30 days.
 *
 * The host can say "I think this is wrong" while the take-back has its notice. It is then
 * "objected" and nothing is taken until the founder has decided: call it off, or answer in
 * writing and have it taken after all ("answered"), no earlier than the first due day and 3 days
 * after that answer went out.
 *
 * The order of locks: the share's payment first (the money action locks it, and so does every step
 * here), then the take-back's row. A dispute is read here and never locked.
 *
 * A reversal cannot be undone by the app, so it goes through the steps every money action takes
 * (operations.ts): written down under a label, asked of Stripe with that label, recorded. A row is
 * "taking" exactly while its action is unanswered; every way that action can end as "not done"
 * puts the row back to where it stood ("told", or "answered") in the same step.
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
import { canAnswer, canCancel, canHold, canObject, CONFIRM_WITHIN_MS, dueDay, dueToTake, OPEN, owedCents, stateBeforeTaking, TAKEABLE, takebackLabel, tellFounderOfRefusals } from "./takeback-rules";
import { answeredWords, cancelledWords, leftoverWords, notDeliveredWords, objectedWords, objectedWordsForFounder, owedWords, owedWordsForFounder, refusedWords, takenWords, type DebtFacts } from "./takeback-words";

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
    dueOn: debt.dueAt ? whenFor(person, debt.dueAt) : null,
    hostName: people.hostName,
    customerName: people.customer.name,
    supportEmail: SUPPORT_EMAIL,
  });
  return { people, facts };
}

/**
 * One message to the host (in the app and by email, as a pair) under a key of this take-back. Gives back the email's
 * own number, for the two messages whose sending starts a count of days (the notice, the answer to an objection).
 */
async function tellHost(tx: Tx, debt: HostDebt, dispute: Dispute, what: string, words: (facts: DebtFacts) => { subject: string; text: string }): Promise<string | null> {
  const telling = await tellingFor(tx, debt, dispute);
  if (!telling) return null;
  const told = words(telling.facts("host", telling.people.host));
  const key = `takeback:${debt.id}:${what}:host:${telling.people.host.id}`;
  await tell(tx, { to: telling.people.host, key, subject: told.subject, text: told.text, path: disputePath(dispute.id) });
  // The email that pairs with the message is written under the same key (messages.ts).
  const [email] = await tx.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, key));
  return email?.id ?? null;
}

/** One email to each admin. What the founder is told names both people, so it is not on the Messages page. */
async function tellFounders(tx: Tx, debt: HostDebt, dispute: Dispute, what: string, words: (facts: DebtFacts) => { subject: string; text: string }): Promise<number> {
  const telling = await tellingFor(tx, debt, dispute);
  if (!telling) return 0;
  for (const founder of telling.people.founders) {
    const told = words(telling.facts("founder", founder));
    await queueEmail(tx, { to: founder.email, key: `takeback:${debt.id}:${what}:founder:${founder.id}`, subject: told.subject, text: `${told.text}\n\nThe dispute's page (admin login):\n${appUrl()}${disputePath(dispute.id)}\n` });
  }
  return telling.people.founders.length;
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
    // One dispute can reach several shares (a member's month pays for several calls). Their amounts are worked out
    // one after the other, never at the same moment: each must see what the others already owe. Taken after the
    // share's payment, and never the other way round, so two helpers on two shares cannot wait for each other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`takeback-dispute:${dispute.id}`}))`);
    if (share.transferStatus !== "sent" || !share.stripeTransferId || (share.transferCents ?? 0) <= 0) return false;
    const [current] = await tx.select({ outcome: schema.disputes.outcome }).from(schema.disputes).where(eq(schema.disputes.id, dispute.id));
    if (current?.outcome !== "lost") return false;
    const others = await tx.select().from(debts).where(eq(debts.paymentId, paymentId));
    if (others.some((other) => other.disputeId === dispute.id) || others.some((other) => other.status === "taking")) return false;
    // What other shares under the same dispute already owe or have paid back (a membership's month has several):
    // all of them together never owe more than the bank took back in this dispute.
    const sameDispute = await tx.select({ amountCents: debts.amountCents }).from(debts).where(and(eq(debts.disputeId, dispute.id), inArray(debts.status, [...OPEN, "taking", "taken"])));

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
      othersOpenCents: others.filter((other) => OPEN.includes(other.status)).reduce((sum, other) => sum + other.amountCents, 0),
      sameDisputeCents: sameDispute.reduce((sum, other) => sum + other.amountCents, 0),
    };
    const amountCents = owedCents(basis);
    // When the notice is written, not when this pass began. The 14 days do not count from here: they count from the
    // notice email really going out, so the row has no due day yet (dateNotices gives it one).
    const toldAt = now.getTime() > Date.now() ? now : new Date();
    const [debt] = await tx
      .insert(debts)
      .values({ disputeId: dispute.id, paymentId, hostId: dispute.hostId, stripeTransferId: share.stripeTransferId, amountCents, currency: share.currency, basis: JSON.stringify(basis), status: amountCents > 0 ? "told" : "nothing", toldAt, dueAt: null })
      .onConflictDoNothing()
      .returning();
    if (!debt || amountCents === 0) return false;
    const noticeEmailId = await tellHost(tx, debt, dispute, "owed", owedWords);
    await tx.update(debts).set({ noticeEmailId }).where(eq(debts.id, debt.id));
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
    .where(and(eq(schema.disputes.outcome, "won"), or(inArray(debts.status, [...OPEN]), and(eq(debts.status, "taken"), isNull(debts.leftoverToldAt))), only ? inArray(debts.disputeId, only.disputeIds) : undefined));
  for (const { debt, dispute } of rows) {
    await db
      .transaction(async (tx) => {
        await lockPayment(tx, debt.paymentId);
        const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
        if (!fresh) return;
        // With its notice only, objected to, or answered: all called off. Nothing was lost after all.
        if (OPEN.includes(fresh.status)) {
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
// 3. The due day: from the notice really sent
// ---------------------------------------------------------------------------

type Reader = Pick<typeof db, "select">;

/**
 * What became of one email: the moment it was sent, counted only once it has really arrived, or why it has not.
 * Both are empty while it is still on its way.
 *
 * "Arrived" is judged by this very email, not by its address: the sending service accepted it, reported it as
 * delivered, and never reported it as bounced (provider-events.ts; neither mark is ever emptied, so the order of the
 * service's reports cannot matter). An email from before those reports were kept has neither mark and so has not
 * arrived as far as the app can show: the founder sends it again.
 */
async function deliveryOf(reader: Reader, emailId: string | null, now: Date): Promise<{ sentAt: Date | null; problem: string | null }> {
  const mail = schema.emailOutbox;
  const [email] = emailId ? await reader.select({ status: mail.status, sentAt: mail.sentAt, deliveredAt: mail.deliveredAt, bouncedAt: mail.bouncedAt, lastError: mail.lastError }).from(mail).where(eq(mail.id, emailId)) : [];
  if (!email) return { sentAt: null, problem: "there is no email for it" };
  if (email.bouncedAt) return { sentAt: null, problem: `it bounced${email.lastError ? ` (${email.lastError})` : ""}` };
  if (email.status === "failed") return { sentAt: null, problem: email.lastError ?? "it could not be sent" };
  if (email.status !== "sent") return { sentAt: null, problem: null };
  if (!email.sentAt) return { sentAt: null, problem: "it is marked as sent, with no time of sending" };
  if (email.deliveredAt) return { sentAt: email.sentAt, problem: null };
  // Sent, and the sending service has not said that it was delivered. For a while that is simply waiting.
  return { sentAt: null, problem: now.getTime() - email.sentAt.getTime() > CONFIRM_WITHIN_MS ? "the sending service has not confirmed that it was delivered" : null };
}

/**
 * The day a take-back should have as things stand, worked out from its emails (takeback-rules.ts, dueDay), and what
 * is wrong with them, if anything. `as` is the state it is judged in: for one that is being taken, the state it had
 * before.
 */
async function dayOf(reader: Reader, debt: HostDebt, now: Date, as: string = debt.status): Promise<{ day: Date | null; problem: string | null; which: "notice" | "answer" }> {
  const notice = await deliveryOf(reader, debt.noticeEmailId, now);
  const answer = as === "answered" ? await deliveryOf(reader, debt.answerEmailId, now) : null;
  return {
    day: dueDay({ status: as, promisedAt: debt.firstDueAt, noticeSentAt: notice.sentAt, answerSentAt: answer?.sentAt ?? null }),
    problem: notice.problem ?? answer?.problem ?? null,
    which: notice.problem || !answer ? "notice" : "answer",
  };
}

const sameDay = (a: Date | null, b: Date | null): boolean => (a === null ? b === null : b !== null && a.getTime() === b.getTime());

/**
 * Gives a take-back its due day, and takes it away again. The day is never kept by itself: every pass works it out
 * afresh from the emails (dueDay). So:
 *   - no day while the notice (or the answer to an objection) is still on its way, or not yet reported as delivered,
 *     as in a copy of the app with no sending service;
 *   - no day when that email failed, bounced, or was not reported as delivered within two days: the founder is told,
 *     once for each such email, and can send it again or call the take-back off;
 *   - a day that was given is taken away again when its email turns out to have bounced;
 *   - a take-back from before this rule keeps the day its notice named as the earliest, and gets a day only once a
 *     notice of it has provably arrived.
 * Everything is read and written with the share's payment held, the same lock the taking starts under and the same
 * lock a report from the sending service is written under.
 */
export async function dateNotices(now: Date, only?: Only): Promise<void> {
  const rows = await db
    .select({ debt: debts, dispute: schema.disputes })
    .from(debts)
    .innerJoin(schema.disputes, eq(schema.disputes.id, debts.disputeId))
    .where(and(inArray(debts.status, [...TAKEABLE]), only ? inArray(debts.disputeId, only.disputeIds) : undefined));
  for (const { debt, dispute } of rows) {
    // A first look without the lock, only to leave alone what needs nothing. What is written is decided under it.
    const seen = await dayOf(db, debt, now);
    if (sameDay(seen.day, debt.dueAt) && seen.problem === null && debt.noticeProblemToldAt === null) continue;
    await db
      .transaction(async (tx) => {
        await lockPayment(tx, debt.paymentId);
        const [fresh] = await tx.select().from(debts).where(eq(debts.id, debt.id)).for("update");
        if (!fresh || !TAKEABLE.includes(fresh.status)) return;
        const { day, problem, which } = await dayOf(tx, fresh, now);
        let toldAt = problem === null ? null : fresh.noticeProblemToldAt;
        if (problem !== null) {
          // Told once for each email that has something wrong (the key names the email, so a second email with a
          // problem of its own is told too, and the same one is never told twice). Marked only when somebody was
          // there to tell: with no admin in the database, the next pass tries again.
          const emailId = which === "answer" ? fresh.answerEmailId : fresh.noticeEmailId;
          const told = await tellFounders(tx, fresh, dispute, `undelivered:${emailId ?? "none"}`, (facts) => notDeliveredWords(facts, which, problem));
          if (told > 0) toldAt = toldAt ?? now;
        }
        const firstDueAt = fresh.firstDueAt ?? (fresh.status === "told" ? day : null);
        if (sameDay(day, fresh.dueAt) && sameDay(firstDueAt, fresh.firstDueAt) && sameDay(toldAt, fresh.noticeProblemToldAt)) return;
        await tx.update(debts).set({ dueAt: day, firstDueAt, noticeProblemToldAt: toldAt, updatedAt: now }).where(eq(debts.id, fresh.id));
      })
      .catch((error) => log(`could not give take-back ${debt.id} its due day`, error));
  }
}

// ---------------------------------------------------------------------------
// 4. An objection, and the founder's answer
// ---------------------------------------------------------------------------

export class DebtError extends Error {}

const tidy = (text: string): string => text.replace(/\r\n/g, "\n").trim();

/** One take-back with its dispute, both read with the share's payment held and the row locked. */
async function lockedDebt(tx: Tx, debtId: string): Promise<{ debt: HostDebt; dispute: Dispute } | null> {
  const [found] = await tx.select({ paymentId: debts.paymentId }).from(debts).where(eq(debts.id, debtId));
  if (!found) return null;
  await lockPayment(tx, found.paymentId);
  const [debt] = await tx.select().from(debts).where(eq(debts.id, debtId)).for("update");
  if (!debt) return null;
  const [dispute] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, debt.disputeId));
  return dispute ? { debt, dispute } : null;
}

/**
 * "I think this is wrong", pressed by the host: nothing is taken until the founder has decided. Judged with the share's
 * payment held, the same lock the taking starts under, so an objection made a moment before the due day always wins.
 * Only while the take-back has its notice: one whose objection was answered cannot be objected to again here.
 */
export async function objectToDebt(input: { debtId: string; hostId: string; objection: string; disputeId?: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const objection = tidy(input.objection);
  if (objection.length < 10) throw new DebtError("Please say in a sentence or two why you think this is wrong.");
  if (objection.length > 2000) throw new DebtError("Please keep it under 2,000 characters.");
  await db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    // (A take-back named together with another dispute's page is not that page's to object to.)
    if (!found || found.debt.hostId !== input.hostId || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId)) throw new DebtError("This is not one of your take-backs.");
    const { debt, dispute } = found;
    if (!canObject(debt)) throw new DebtError(debt.status === "objected" ? "We already have your objection. Nothing is taken until we have answered you." : debt.status === "answered" ? "We have answered your objection. If you still think this is wrong, please write to us." : "This can no longer be objected to here. Please write to us.");
    const [held] = await tx.update(debts).set({ status: "objected", objectedAt: now, objection, dueAt: null, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
    await tellHost(tx, held, dispute, "objected", objectedWords);
    await tellFounders(tx, held, dispute, "objected", (facts) => objectedWordsForFounder(facts, objection));
  });
}

/** The founder holds a take-back for an objection that came by email: the same as the host's own button, from this moment. */
export async function holdDebt(input: { debtId: string; adminId: string; note: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const note = tidy(input.note) || "The host objected by email.";
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId) || !canHold(found.debt)) return false;
    await tx.update(debts).set({ status: "objected", objectedAt: now, objection: note.slice(0, 2000), dueAt: null, updatedAt: now }).where(eq(debts.id, found.debt.id));
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: "take-back held for an objection", targetUserId: found.debt.hostId, targetId: found.debt.id });
    return true;
  });
}

/**
 * The founder has read the objection and it is taken after all. The answer goes to the host in writing; the take-back
 * gets no due day here: that comes from the answer's email really going out (3 days after it, and never before the
 * first due day).
 */
export async function answerObjection(input: { debtId: string; adminId: string; answer: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const answer = tidy(input.answer);
  if (answer.length < 10) throw new DebtError("Write the answer the host will read: why it is taken after all.");
  if (answer.length > 2000) throw new DebtError("Please keep the answer under 2,000 characters.");
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId) || !canAnswer(found.debt)) return false;
    const { debt, dispute } = found;
    const [answered] = await tx.update(debts).set({ status: "answered", answer, answeredAt: now, answeredBy: input.adminId, dueAt: null, noticeProblemToldAt: null, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
    const answerEmailId = await tellHost(tx, answered, dispute, "answered", (facts) => answeredWords(facts, answer));
    await tx.update(debts).set({ answerEmailId }).where(eq(debts.id, debt.id));
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: "objection to a take-back answered: taken after all", targetUserId: debt.hostId, targetId: debt.id });
    return true;
  });
}

/**
 * The founder sends the notice (or the answer to an objection) again, when the first one did not arrive: it failed,
 * it bounced, or the sending service never said that it was delivered. A new message and a new email, with the same
 * words; the days count from this one arriving, and never end before a day an earlier notice named. Only for a
 * take-back that has something wrong with its email: one that has its day needs no second notice.
 */
export async function sendNoticeAgain(input: { debtId: string; adminId: string; disputeId?: string; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const found = await lockedDebt(tx, input.debtId);
    if (!found || (input.disputeId !== undefined && found.debt.disputeId !== input.disputeId) || !TAKEABLE.includes(found.debt.status)) return false;
    const { debt, dispute } = found;
    const { problem, which } = await dayOf(tx, debt, now);
    if (problem === null) return false;
    const [waiting] = await tx.update(debts).set({ dueAt: null, noticeProblemToldAt: null, updatedAt: now }).where(eq(debts.id, debt.id)).returning();
    // A key of its own, so that it is a new message and a new email beside the first.
    const again = `again:${now.getTime()}`;
    if (which === "answer") {
      const answerEmailId = await tellHost(tx, waiting, dispute, `answered:${again}`, (facts) => answeredWords(facts, debt.answer ?? ""));
      await tx.update(debts).set({ answerEmailId }).where(eq(debts.id, debt.id));
    } else {
      const noticeEmailId = await tellHost(tx, waiting, dispute, `owed:${again}`, owedWords);
      await tx.update(debts).set({ noticeEmailId }).where(eq(debts.id, debt.id));
    }
    await tx.insert(schema.adminActions).values({ adminId: input.adminId, action: `take-back: the ${which} was sent again`, targetUserId: debt.hostId, targetId: debt.id });
    return true;
  });
}

// ---------------------------------------------------------------------------
// 5. Taking it
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

/**
 * It did not happen: the row is back where it stood (at its notice, or "answered" if an objection had been answered,
 * so that it cannot be objected to a second time), with what Stripe said. Tried again a day later. With the share's
 * payment held.
 */
export async function backToTold(tx: Tx, debtId: string, message: string): Promise<void> {
  const now = new Date();
  await tx
    .update(debts)
    .set({ status: sql`case when ${debts.answer} is not null then 'answered' else 'told' end`, refusal: message, refusedAt: now, firstRefusedAt: sql`coalesce(${debts.firstRefusedAt}, ${now.toISOString()}::timestamptz)`, updatedAt: now })
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
      // The day on the row was worked out a moment ago. Here, with the share's payment held, the emails are read once
      // more: a notice that bounced since, or that turns out not to have gone out, stops it at the last moment.
      const { day } = await dayOf(tx, row, now);
      if (day === null || now < day) throw new MoneyError("The notice of this take-back is not confirmed as delivered, or its day has not come.");
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
  // A repeat can be the first time Stripe really does it. So it is sent only while everything that allowed the
  // first request still holds: the dispute is still lost, and the notice (and an answer) still counts as sent and
  // its day has come. A reversal Stripe already made is found and booked below either way.
  const [whole] = row ? await db.select().from(debts).where(eq(debts.id, params.debtId)) : [];
  const stillDue = whole ? (await dayOf(db, whole, new Date(), whole.status === "taking" ? stateBeforeTaking(whole) : whole.status)).day : null;
  let resend = canRepeat && dispute?.outcome === "lost" && stillDue !== null && stillDue.getTime() <= Date.now();
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
    .where(and(inArray(debts.status, [...TAKEABLE]), isNotNull(debts.firstRefusedAt), isNull(debts.founderToldAt), only ? inArray(debts.disputeId, only.disputeIds) : undefined));
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
  await dateNotices(now, only);
  const told = await db
    .select()
    .from(debts)
    .where(and(inArray(debts.status, [...TAKEABLE]), lte(debts.dueAt, now), only ? inArray(debts.disputeId, only.disputeIds) : undefined))
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
  const open = await db.select().from(debts).where(and(eq(debts.hostId, hostId), inArray(debts.status, [...OPEN, "taking"]))).orderBy(sql`${debts.dueAt} asc nulls last`, asc(debts.toldAt));
  const taken = await db.select().from(debts).where(and(eq(debts.hostId, hostId), eq(debts.status, "taken"))).orderBy(sql`${debts.takenAt} desc`).limit(takenShown);
  // (One that was taken between the two reads is shown once, as taken.)
  const settled = new Set(taken.map((row) => row.id));
  return [...open.filter((row) => !settled.has(row.id)), ...taken].map((row) => ({ ...row, path: disputePath(row.disputeId) }));
}
