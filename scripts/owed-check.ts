/**
 * Testing tool for a refund Connect gives after the host has collected, and what the host then owes
 * (plans/46-part-3-money-owed.md, part 3a, step 2).
 *
 * It makes real charges, transfers, refunds and reversals in Stripe's test area and checks every result at Stripe
 * and in the local database. No real money moves. It makes its own hosts and customers. The shares it sends go to
 * the test host's payout account (host@test.local) straight from this script, so that account's owner is not
 * changed; whatever is left of those transfers at the end is taken back, and what the run wrote is removed.
 *
 * Two things are stand-ins, and each says so where it is used:
 *   - the sending service: the script marks a notice email as sent and as reported delivered;
 *   - in part 6 only, the refund's line. Stripe's dispute test cards dispute a charge the moment it is taken, and a
 *     disputed charge cannot be refunded, so in the test area a real refund can never come before a dispute on the
 *     same payment. There the refund's line is written by the script and points at a real, confirmed refund of
 *     another test charge (the charge, the transfer, the dispute and the reversals are real). A part dispute cannot
 *     be made there at all; its sums are in takeback-rules.test.ts.
 * A refund that is still on its way, and one that fails after Stripe confirmed it, are real: Stripe's own test cards
 * for those two change about two minutes after the refund, so they are started first and looked at last.
 *
 * Usage: npx tsx scripts/owed-check.ts
 *        npx tsx scripts/owed-check.ts --demo       (for a look in the browser as host@test.local)
 *        npx tsx scripts/owed-check.ts --demo-off   (takes the demo away again)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail !== "" ? `  (${String(detail)})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
  const { settleOrdinaryCharges } = await import("../src/lib/payments/take");
  const { applyRefundDone, applyTransferSent, currentSplit, refundPayment, refundPlan, transferAtStripe } = await import("../src/lib/payments/actions");
  const { completeMoneyOperation, lockPayment, MoneyError, OutcomeUnknownError, runMoneyOperation, startMoneyOperation } = await import("../src/lib/payments/operations");
  const { reconcileOperations } = await import("../src/lib/payments/jobs");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { lookAtOpenDisputes } = await import("../src/lib/disputes/record");
  const { getHostSettings, refreshPayoutsReady } = await import("../src/lib/payments/hosts");
  const { refundAnswer, refundEstimate, refundOutcome, refundReason, refundSearchFor, paymentsForRefund } = await import("../src/lib/payments/founder-refund");
  const { answerObjection, cancelDebt, countHandReversal, DebtError, debtForPage, debtsForFounder, debtsOfHost, handReversalsOpen, objectToDebt, reversalSeenOnTransfer, reverseAtStripe, settleOutside, takeBackPass, takePlan } = await import("../src/lib/disputes/takeback");
  const { NOTICE_MS } = await import("../src/lib/disputes/takeback-rules");
  const { DOCUMENTS } = await import("../src/legal/versions");
  const { formatMoney } = await import("../src/lib/payments/access");

  const [seeded] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  const account = seeded ? (await getHostSettings(seeded.id))?.stripeAccountId : null;
  if (!seeded || !account || !(await refreshPayoutsReady(seeded.id))) throw new Error("Set up payouts for host@test.local on the Hosting page first (`npm run seed`).");

  const RUN = randomUUID().slice(0, 8);
  const stamp = new Date();
  let people = 0;
  const person = async (label: string) => {
    const id = `ow-${RUN}-${++people}`;
    const [row] = await db
      .insert(schema.user)
      .values({ id, name: `Owed check ${label} ${people}`, email: `owedcheck-${RUN}-${people}@example.test`, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" })
      .returning();
    return row;
  };
  type Person = Awaited<ReturnType<typeof person>>;
  const admins = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
  const transfers: string[] = [];
  const debts = schema.hostDebts;

  const reload = async (id: string) => (await db.select().from(schema.payments).where(eq(schema.payments.id, id)))[0];
  const refundRow = async (id: string) => (await db.select().from(schema.refunds).where(eq(schema.refunds.id, id)))[0];
  const debtsFor = (...refundIds: string[]) => db.select().from(debts).where(inArray(debts.refundId, refundIds)).orderBy(debts.createdAt);
  const debtOf = async (refundId: string) => (await debtsFor(refundId))[0];
  const messagesOf = (debtId: string) => db.select().from(schema.messages).where(like(schema.messages.key, `takeback:${debtId}:%`));
  const emailsOf = (debtId: string) => db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `takeback:${debtId}:%`));
  const founderMail = async (debtId: string, what: string) => (await emailsOf(debtId)).filter((mail) => mail.dedupeKey?.includes(`:${what}:founder:`));
  const toldEachAdmin = (mails: Awaited<ReturnType<typeof founderMail>>) => mails.length === admins.length && admins.every((one) => mails.some((mail) => mail.to === one.email));
  const hostTold = async (debtId: string, what: string) => (await messagesOf(debtId)).filter((one) => one.key.includes(`:${what}:host:`));
  const operationsOf = (paymentId: string) => db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, paymentId), eq(schema.moneyOperations.kind, "take_back"))).orderBy(schema.moneyOperations.createdAt);
  const ledgerOf = async (paymentId: string, kind: string) => (await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.paymentId, paymentId), eq(schema.ledgerEntries.kind, kind)))).reduce((sum, line) => sum + line.amountCents, 0);
  const linesOf = async (paymentId: string, kind: string) => (await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.paymentId, paymentId), eq(schema.ledgerEntries.kind, kind)))).length;
  const transferAt = (id: string) => stripe().transfers.retrieve(id);
  const said = (run: Promise<unknown>) => run.then(() => "done", (error: Error) => `${error instanceof MoneyError ? "money" : error instanceof DebtError ? "debt" : error instanceof OutcomeUnknownError ? "unknown" : "other"}: ${error.message}`);
  /** The helper's pass on these refunds' take-backs alone. Nothing is sent: a take-back gets its due day only once its notice email has arrived. */
  const passOnly = (at: Date, ...refundIds: string[]) => takeBackPass(at, { disputeIds: [], refundIds });
  /**
   * In the place of the sending service: the notice (or the answer to an objection) of these refunds' take-backs that
   * is still waiting is marked as sent and as reported delivered, at the moment the row was written (or the answer
   * was given). Exactly those emails, by their own numbers; no other email in the database is touched.
   */
  async function sendNotices(...refundIds: string[]) {
    const waiting = await db.select().from(debts).where(and(inArray(debts.refundId, refundIds), isNull(debts.dueAt), inArray(debts.status, ["told", "answered"])));
    for (const row of waiting) {
      const emailId = row.status === "answered" ? row.answerEmailId : row.noticeEmailId;
      if (!emailId) continue;
      const at = row.status === "answered" ? (row.answeredAt ?? new Date()) : row.toldAt;
      await db.update(schema.emailOutbox).set({ status: "sent", sentAt: at, deliveredAt: at }).where(and(eq(schema.emailOutbox.id, emailId), eq(schema.emailOutbox.status, "queued")));
    }
  }
  /** One pass as it goes with a sending service that works: what is owed is written, its notice goes out, and it gets its day (the second pass is as of long ago, so nothing can be due in it). */
  const pass = async (...refundIds: string[]) => {
    await passOnly(new Date(), ...refundIds);
    await sendNotices(...refundIds);
    await passOnly(new Date(0), ...refundIds);
  };

  // A published Host Agreement, made up for this run and known to this process only: the real one is still a draft,
  // and a refund's take-back is only "told" (and ever taken) under a published version accepted before the charge.
  const today = new Date().toISOString().slice(0, 10);
  const published = { version: `check-${RUN}`, effectiveFrom: today, addedOn: today, draft: false, summary: "" };
  DOCUMENTS["host-agreement"].versions.push(published);
  const accept = (who: Person, at: Date) => db.insert(schema.agreementAcceptances).values({ userId: who.id, document: "host-agreement", version: published.version, occasion: "host_application", acceptedAt: at });
  const admin = admins[0]?.id;
  if (!admin) throw new Error("This check needs an admin (`npm run seed`).");
  const refundIds: string[] = [];
  const WHY = "Checked by the owed check.";
  /** A refund asked for as the founder's page asks for it (or as a host would). Gives back its row as it then stands. */
  async function refund(paymentId: string, amountCents: number, as: { host: string } | "founder" = "founder", afterCollection = true, reason: string | null = refundReason("host_absent", WHY)) {
    const requestId = randomUUID();
    refundIds.push(requestId);
    await refundPayment({ paymentId, amountCents, decidedBy: as === "founder" ? admin! : as.host, decidedAs: as === "founder" ? "admin" : "host", reason, afterCollection, requestId });
    return refundRow(requestId);
  }
  const CARD = "pm_card_visa";
  const DAYS = 24 * 3_600_000;
  const pause = (ms = 2000) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Makes an unanswered money action look older, as if the helper had been away. */
  const age = (operationId: string, ms: number) => db.update(schema.moneyOperations).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.moneyOperations.id, operationId));

  // For part 6: a real dispute on a real charge, lost at Stripe, as scripts/dispute-takeback-check.ts makes them.
  const disputes: string[] = [];
  const event = (type: string, disputeId: string) => ({ type, data: { object: { id: disputeId } } });
  let looks = 0;
  async function disputedAndCollected(host: Person) {
    const paid = await charged(host, await person("customer"), "pm_card_createDispute");
    let found: string[] = [];
    for (let i = 0; i < 30 && found.length < 1; i++) {
      found = (await stripe().disputes.list({ payment_intent: paid.payment.stripePaymentIntentId!, limit: 10 })).data.map((dispute) => dispute.id);
      if (found.length < 1) await pause();
    }
    if (found.length < 1) throw new Error("Stripe opened no dispute on the test charge.");
    disputes.push(...found);
    return { ...paid, disputeId: found[0], ...(await collect(paid.payment.id)) };
  }
  /** The app is told of the dispute, the dispute is given up at Stripe, and the app's look records the loss. */
  async function lose(disputeId: string) {
    await handleStripeEvent(event("charge.dispute.created", disputeId));
    await stripe().disputes.close(disputeId);
    await handleStripeEvent(event("charge.dispute.closed", disputeId));
    await lookAtOpenDisputes(new Date(Date.now() + 120_000 * ++looks), { disputeIds: [disputeId] });
    const [row] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId));
    if (row?.outcome !== "lost") throw new Error(`The test dispute was not recorded as lost (${row?.status}).`);
  }
  const disputeDebt = async (disputeId: string) => (await db.select().from(debts).where(eq(debts.disputeId, disputeId)))[0];
  const both = (at: Date, disputeId: string, ...ids: string[]) => takeBackPass(at, { disputeIds: [disputeId], refundIds: ids });
  /** In the place of the sending service, for every take-back of one payment whose notice is still waiting. */
  async function sendOn(paymentId: string) {
    const waiting = await db.select().from(debts).where(and(eq(debts.paymentId, paymentId), isNull(debts.dueAt), eq(debts.status, "told")));
    for (const row of waiting) if (row.noticeEmailId) await db.update(schema.emailOutbox).set({ status: "sent", sentAt: row.toldAt, deliveredAt: row.toldAt }).where(and(eq(schema.emailOutbox.id, row.noticeEmailId), eq(schema.emailOutbox.status, "queued")));
  }
  /** Part 6's stand-in: a refund's line as the app writes it when Stripe confirms a refund after collection, with no refund at Stripe. */
  let realRefund = "";
  async function refundLine(paymentId: string, sentCents: number, lostCents: number) {
    if (!realRefund) throw new Error("Part 1 has to run first: part 6's lines point at its confirmed refund.");
    const id = randomUUID();
    refundIds.push(id);
    await db.insert(schema.refunds).values({ id, paymentId, amountCents: lostCents, decidedBy: admin!, decidedAs: "admin", reason: refundReason("mistake", WHY), status: "done", stripeRefundId: realRefund, finishedAt: new Date(), afterCollection: true, afterCollectionNo: 1, shareBeforeCents: sentCents, shareAfterCents: sentCents - lostCents, feeBeforeCents: 0, feeAfterCents: 0, hostOwesCents: lostCents });
    return id;
  }
  /** Waits until Stripe shows a refund in this state (its test cards change a refund by themselves after about two minutes). */
  async function stripeShows(stripeRefundId: string, status: string) {
    for (let i = 0; i < 100; i++) {
      if ((await stripe().refunds.retrieve(stripeRefundId)).status === status) return true;
      await pause(3000);
    }
    return false;
  }
  const failedLateMail = (refundId: string) => db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `refund-failed-late:${refundId}:founder:%`));
  const books = async (paymentId: string) => ({ refund: await ledgerOf(paymentId, "customer_refund"), fee: await ledgerOf(paymentId, "platform_fee"), share: await ledgerOf(paymentId, "host_share") });

  /** A call that took place and was charged to a test card. */
  async function charged(host: Person, customer: Person, card: string) {
    const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + 10 * 60_000);
    const { call, payment } = await db.transaction(async (tx) => {
      const [newCall] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt, roomName: `owedcheck-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
      await createPaymentForCall(tx, newCall);
      const [paid] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, newCall.id));
      return { call: newCall, payment: paid };
    });
    await startHold({ payment, call, customer, now: new Date() });
    await stripe().paymentIntents.confirm((await reload(payment.id)).stripePaymentIntentId!, { payment_method: card, return_url: "https://example.com/return" });
    await syncHold(payment.id, new Date());
    for (const [who, identity] of [["host", host.id], ["customer", customer.id]] as const) {
      const session = `PA_${who}_${randomUUID().slice(0, 6)}`;
      const row = (type: string, time: Date) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_owedcheck", participantIdentity: identity, participantSessionId: session, providerTime: time, payload: "{}" });
      await db.insert(schema.attendanceEvents).values([row("participant_joined", startsAt), row("participant_left", endsAt)]);
    }
    await db.update(schema.calls).set({ closedAt: new Date(endsAt.getTime() + 60_000) }).where(eq(schema.calls.id, call.id));
    await settleOrdinaryCharges(call.id, new Date(startsAt.getTime() + (24 * 60 + 3) * 60_000));
    const taken = await reload(payment.id);
    if (taken.status !== "charged") throw new Error(`The test call was not charged (${taken.status}).`);
    return { call, payment: taken };
  }

  /** The host collects: the share is really sent at Stripe (to the test payout account) and recorded as the app records it. */
  async function collect(paymentId: string, feeCents = 0) {
    const payment = await reload(paymentId);
    const params = { amountCents: currentSplit(payment).hostShareCents - feeCents, payoutFeeCents: feeCents, destination: account!, group: payment.callId! };
    const transferId = await transferAtStripe(payment, params, `owedcheck:${payment.id}`);
    // Noted for the clean-up at once: also if writing it down below fails, what was sent is taken back at the end.
    if (transferId) transfers.push(transferId);
    await db.transaction((tx) => applyTransferSent(payment, params, transferId, tx));
    return { transferId: transferId!, sentCents: params.amountCents };
  }


  // For a look in the browser: host@test.local collected a call's share, and the founder then refunded the customer
  // twice. The first take-back is told and has its day; the second waits (as every one does while the agreements are
  // drafts). And taking that away again. What the demo made is known by its host and its room name.
  if (process.argv.includes("--demo") || process.argv.includes("--demo-off")) {
    const [seededCustomer] = await db.select().from(schema.user).where(eq(schema.user.email, "customer@test.local"));
    if (!seededCustomer) throw new Error("Run `npm run seed` first.");
    if (process.argv.includes("--demo")) {
      await accept(seeded, new Date(Date.now() - 3_600_000));
      const paid = await charged(seeded, seededCustomer, CARD);
      await collect(paid.payment.id);
      const one = await refund(paid.payment.id, 500);
      await pass(one.id);
      await db.delete(schema.agreementAcceptances).where(eq(schema.agreementAcceptances.version, published.version));
      const two = await refund(paid.payment.id, 300);
      await pass(two.id);
      const [told, waiting] = [await debtOf(one.id), await debtOf(two.id)];
      console.log(`Made for host@test.local: /debts/${told?.id} (${told?.status}, ${told?.amountCents} cents, from ${told?.dueAt?.toISOString()}) and /debts/${waiting?.id} (${waiting?.status}, ${waiting?.amountCents} cents). Also "Your earnings" on /host, and /admin/debts.`);
    } else {
      const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(and(eq(schema.calls.hostId, seeded.id), like(schema.calls.roomName, "owedcheck-%")));
      for (const call of calls) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
        if (!payment) continue;
        const rows = await db.select().from(debts).where(eq(debts.paymentId, payment.id));
        // Nothing of the demo is left for the helper to take, and what is left of the share it sent is taken back here.
        await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(debts.paymentId, payment.id), inArray(debts.status, ["told", "objected", "answered", "waiting"])));
        await db.update(schema.refunds).set({ debtLookedAt: new Date() }).where(and(eq(schema.refunds.paymentId, payment.id), isNull(schema.refunds.debtLookedAt)));
        if (payment.stripeTransferId) {
          const transfer = await stripe().transfers.retrieve(payment.stripeTransferId).catch(() => null);
          const left = transfer ? transfer.amount - transfer.amount_reversed : 0;
          if (left > 0) await stripe().transfers.createReversal(payment.stripeTransferId, { amount: left }).catch(() => undefined);
        }
        if (rows.length > 0) {
          const keys = rows.map((row) => `takeback:${row.id}:%`);
          await db.delete(schema.messages).where(or(...keys.map((key) => like(schema.messages.key, key))));
          await db.delete(schema.emailOutbox).where(or(...keys.map((key) => like(schema.emailOutbox.dedupeKey, key))));
          await db.delete(schema.adminActions).where(inArray(schema.adminActions.targetId, rows.map((row) => row.id)));
        }
        console.log(`Taken away: the demo's take-back${rows.length === 1 ? "" : "s"} for call ${call.id} (${rows.length}), with the messages and emails.`);
      }
    }
    process.exit(0);
  }

  try {
    const host = await person("host");
    await accept(host, new Date(Date.now() - 3_600_000));
    const reader = { timeZone: "America/New_York" };

    // Started first, looked at last (parts 8 and 9): three payments on Stripe's test cards whose refunds change by
    // themselves about two minutes after they are made.
    const slow = async (card: string) => {
      const paid = await charged(host, await person("customer"), card);
      const sent = await collect(paid.payment.id);
      const before = { payment: await reload(paid.payment.id), books: await books(paid.payment.id) };
      const first = await refund(paid.payment.id, 500);
      return { ...paid, ...sent, before, first, refundId: first.id };
    };
    const failsOpen = await slow("pm_card_refundFail");
    const failsTaken = await slow("pm_card_refundFail");
    const failsTaking = await slow("pm_card_refundFail");
    const pending = await slow("pm_card_pendingRefund");
    // At once, before anything else is set up: Stripe's test card fails these refunds about two minutes after they
    // were made, and their take-backs have to be written (and one taken, one being taken) while they still stand.
    // While Stripe still shows the three as paid: their take-backs are written and told, and the second is taken (as if its 14 days were over).
    await pass(failsOpen.refundId, failsTaken.refundId, failsTaking.refundId);
    // The third is being taken: written down, the reversal made at Stripe, and its answer not yet recorded.
    const takingDebt = await debtOf(failsTaking.refundId);
    const takingStarted = await db.transaction((tx) => startMoneyOperation(tx, takePlan(takingDebt, takingDebt.dueAt!)));
    if (takingStarted === "already_done") throw new Error("The take-back was already done.");
    await reverseAtStripe(takingStarted.params, takingStarted.label);
    const openDebt = await debtOf(failsOpen.refundId);
    const takenDebt = await debtOf(failsTaken.refundId);
    if (takenDebt?.dueAt) await passOnly(new Date(takenDebt.dueAt.getTime() + 60_000), failsTaken.refundId);
    const takenEarly = { status: (await debtOf(failsTaken.refundId))?.status, reversed: (await transferAt(failsTaken.transferId)).amount_reversed };
    // The third is still on its way at Stripe.
    await passOnly(new Date(), pending.refundId);
    const pendingEarly = { answer: refundAnswer(await refundOutcome(pending.refundId), "founder"), debts: (await debtsFor(pending.refundId)).length, underWay: (await paymentsForRefund({ callId: pending.call.id }))[0]?.refundUnderWay };
    // A refund given BEFORE the host collects, on the card whose refunds fail later: she then collects the smaller share.
    const earlyPaid = await charged(host, await person("customer"), "pm_card_refundFail");
    const earlyBefore = { share: currentSplit(earlyPaid.payment).hostShareCents, books: await books(earlyPaid.payment.id) };
    const earlyRefund = await refund(earlyPaid.payment.id, 300);
    const earlySent = await collect(earlyPaid.payment.id);
    // And one more refund after she collected (a take-back of its own), so that both kinds meet on one payment.
    const earlyAfter = await refund(earlyPaid.payment.id, 300);
    await pass(earlyAfter.id);
    const earlyAfterDebt = await debtOf(earlyAfter.id);
    // Two payments with two small refunds each after she collected, 8 cents and then 50 cents. Together the second
    // takes 47 cents off her share; alone it takes 46. In one her take-back for the second is settled (she pays all
    // 47 cents outside the app), in the other the founder calls it off.
    const twoSmall = async () => {
      const paid = await charged(host, await person("customer"), "pm_card_refundFail");
      const sent = await collect(paid.payment.id);
      const a = await refund(paid.payment.id, 8);
      await pass(a.id);
      const b = await refund(paid.payment.id, 50);
      await pass(b.id);
      return { ...paid, ...sent, a, b, debtB: await debtOf(b.id) };
    };
    const centSettled = await twoSmall();
    await settleOutside({ debtId: centSettled.debtB.id, adminId: admin, repaidCents: centSettled.debtB.amountCents, note: "Paid in full by bank transfer." });
    const centWaived = await twoSmall();
    await cancelDebt({ debtId: centWaived.debtB.id, adminId: admin });
    // A full refund after she collected, whose take-back she pays in full to Connect's bank account (the founder
    // records it); on the card whose refunds fail later.
    const repaidPaid = await charged(host, await person("customer"), "pm_card_refundFail");
    const repaidSent = await collect(repaidPaid.payment.id);
    const repaidRefund = await refund(repaidPaid.payment.id, repaidPaid.payment.chargedCents!);
    await pass(repaidRefund.id);
    const repaidDebt = await debtOf(repaidRefund.id);
    await settleOutside({ debtId: repaidDebt.id, adminId: admin, repaidCents: repaidDebt.amountCents, note: "Paid in full by bank transfer." });
    // A refund Stripe has taken and whose line says "on its way" with Stripe's number (as when Stripe first answers
    // "pending"), on the card whose refunds fail later. Written by the script: the first answer of this card is "paid".
    const knownPaid = await charged(host, await person("customer"), "pm_card_refundFail");
    const knownId = randomUUID();
    refundIds.push(knownId);
    const knownPlan = refundPlan({ paymentId: knownPaid.payment.id, amountCents: 500, decidedBy: admin, decidedAs: "admin", reason: refundReason("mistake", WHY), afterCollection: true, requestId: knownId }, knownId);
    const knownStarted = await db.transaction((tx) => startMoneyOperation(tx, knownPlan));
    if (knownStarted === "already_done") throw new Error("The refund was already done.");
    const knownAtStripe = await stripe().refunds.create({ payment_intent: knownPaid.payment.stripePaymentIntentId!, amount: 500, metadata: { paymentId: knownPaid.payment.id, refundId: knownId } }, { idempotencyKey: knownStarted.label });
    await db.update(schema.moneyOperations).set({ status: "succeeded", stripeId: knownAtStripe.id, finishedAt: new Date() }).where(eq(schema.moneyOperations.id, knownStarted.operationId));
    await db.update(schema.refunds).set({ stripeRefundId: knownAtStripe.id }).where(eq(schema.refunds.id, knownId));
    // A refund that is written down and sent to Stripe, and whose answer is never recorded (as when the one who
    // sent it dies in between), on the card whose refunds fail later.
    const lostPaid = await charged(host, await person("customer"), "pm_card_refundFail");
    const lostId = randomUUID();
    refundIds.push(lostId);
    const lostPlan = refundPlan({ paymentId: lostPaid.payment.id, amountCents: 500, decidedBy: admin, decidedAs: "admin", reason: refundReason("mistake", WHY), afterCollection: true, requestId: lostId }, lostId);
    const lostStarted = await db.transaction((tx) => startMoneyOperation(tx, lostPlan));
    if (lostStarted === "already_done") throw new Error("The refund was already done.");
    const lostAtStripe = await stripe().refunds.create({ payment_intent: lostPaid.payment.stripePaymentIntentId!, amount: 500, metadata: { paymentId: lostPaid.payment.id, refundId: lostId } }, { idempotencyKey: lostStarted.label });

    // ----------------------------------------------------------------------
    console.log("\n1. The founder refunds a collected call in two parts: told once each, no day before the notice arrived, taken after 14 days and not before");
    {
      const customer = await person("customer");
      const paid = await charged(host, customer, CARD);
      const early = await refund(paid.payment.id, 300);
      check("before the host collected, the founder's refund is an ordinary one: the host owes nothing for it", early.status === "done" && early.afterCollection === false && early.hostOwesCents === 0, `${early.status} ${early.hostOwesCents}`);
      const sent = await collect(paid.payment.id);
      check("(the share, less that early refund's part, was really sent)", sent.sentCents > 0 && (await transferAt(sent.transferId)).amount === sent.sentCents && (await reload(paid.payment.id)).transferStatus === "sent", sent.sentCents);

      // (The host sends the founder's flag herself: it gives her nothing.)
      const hers = await said(refund(paid.payment.id, 200, { host: host.id }, true, "The customer asked me for this."));
      const plain = await said(refund(paid.payment.id, 200, "founder", false));
      const silent = await said(refund(paid.payment.id, 200, "founder", true, "  "));
      check("after collection the host cannot refund, nor the founder by the ordinary way, nor without a reason", /^money: .*already been paid/.test(hers) && /^money: .*already been paid/.test(plain) && /^money: Say why/.test(silent), `${hers} | ${plain} | ${silent}`);
      check("and those refusals wrote no refund and asked Stripe for nothing", (await db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, paid.payment.id))).length === 1 && (await stripe().refunds.list({ payment_intent: paid.payment.stripePaymentIntentId!, limit: 10 })).data.length === 1);

      const byCall = await refundSearchFor(` ${paid.call.id} `);
      const byAddress = await refundSearchFor(customer.email.toUpperCase());
      const found = byCall ? await paymentsForRefund(byCall) : [];
      const byEmail = byAddress ? await paymentsForRefund(byAddress) : [];
      check("the founder's page finds the payment by the call and by the customer's address, and knows the host has collected", found.length === 1 && found[0].collected && found[0].payment.id === paid.payment.id && byEmail.some((one) => one.payment.id === paid.payment.id) && (await refundSearchFor("nobody@example.test")) === null && (await paymentsForRefund({ callId: "not-an-id" })).length === 0);
      check("an email address is turned into the account's number, so the page's address never holds it", byAddress !== null && "customerId" in byAddress && byAddress.customerId === customer.id);
      const estimate = refundEstimate(await reload(paid.payment.id), 500);
      const first = await refund(paid.payment.id, 500);
      const atStripe = first.stripeRefundId ? await stripe().refunds.retrieve(first.stripeRefundId) : null;
      check("the founder's refund after collection really goes back to the customer at Stripe", first.status === "done" && atStripe?.status === "succeeded" && atStripe.amount === 500, `${first.status} ${atStripe?.status}`);
      check("it is written down as one after collection, with the host's share before and after, and what her share lost", first.afterCollection && first.hostOwesCents > 0 && first.hostOwesCents === estimate.hostOwesCents && first.shareBeforeCents === sent.sentCents && first.shareAfterCents === sent.sentCents - first.hostOwesCents && first.feeBeforeCents !== null && first.feeAfterCents !== null && first.reason?.includes(WHY) === true, `${first.hostOwesCents} of ${first.shareBeforeCents}`);
      realRefund = first.stripeRefundId ?? "";
      const outcome = await refundOutcome(first.id);
      const answer = refundAnswer(outcome, "founder");
      check("the founder's page reads back what really happened, from what was written down", outcome?.status === "done" && outcome.paymentId === paid.payment.id && outcome.amountCents === 500 && outcome.hostOwesCents === first.hostOwesCents && outcome.afterCollection && outcome.takeBack === "not_yet" && answer.includes("$5.00 was given back to the customer from Connect's money") && answer.includes(`never more than is left of the ${formatMoney(sent.sentCents)} that was sent to them`) && (await refundOutcome(randomUUID())) === null, answer);
      // The same form sent again with another amount typed in: nothing more is refunded, and the answer is the amount that was written down.
      const again = await said(refundPayment({ paymentId: paid.payment.id, amountCents: 900, decidedBy: admin, decidedAs: "admin", reason: refundReason("mistake", WHY), afterCollection: true, requestId: first.id }));
      const answerAgain = refundAnswer(await refundOutcome(first.id), "founder", again);
      check("a form sent a second time with another amount refunds nothing more, and is answered with the amount that was really refunded", (await stripe().refunds.list({ payment_intent: paid.payment.stripePaymentIntentId!, limit: 10 })).data.length === 2 && (await reload(paid.payment.id)).refundedCents === 800 && (await refundRow(first.id)).amountCents === 500 && answerAgain.includes("$5.00 was given back") && !answerAgain.includes("$9.00"), `${again} | ${answerAgain.slice(0, 60)}`);
      check("(nothing was taken from the host by the refund itself)", (await transferAt(sent.transferId)).amount_reversed === 0);

      await passOnly(new Date(), early.id, first.id);
      await passOnly(new Date(), early.id, first.id);
      const rows = await debtsFor(early.id, first.id);
      const debt = rows[0];
      const charge = await stripe().charges.retrieve((await reload(paid.payment.id)).stripeChargeId!);
      check("one take-back for the refund, however often the look runs; none for the early refund", rows.length === 1 && debt.refundId === first.id && debt.disputeId === null && debt.status === "told" && debt.amountCents === first.hostOwesCents && debt.hostId === host.id && debt.stripeTransferId === sent.transferId, `${rows.length} ${debt?.status} ${debt?.amountCents}`);
      check("it names the agreement she had accepted before the charge, and Stripe's time of the charge", debt.agreementVersion === published.version && debt.chargeAt?.getTime() === charge.created * 1000, `${debt.agreementVersion} ${debt.chargeAt?.toISOString()}`);
      const notices = await hostTold(debt.id, "owed");
      check("the host is told once, with the amount, the reason and the page of the take-back", notices.length === 1 && notices[0].body.includes(formatMoney(debt.amountCents)) && notices[0].body.includes(WHY) && notices[0].path === `/debts/${debt.id}` && debt.noticeEmailId !== null, notices[0]?.body.slice(0, 160));
      check("each admin is told once", admins.length > 0 && toldEachAdmin(await founderMail(debt.id, "owed")));
      check("no day while its notice has not gone out", debt.dueAt === null);
      check("the founder's page now says what the host owes, and that they were told", refundAnswer(await refundOutcome(first.id), "founder").includes(`The host owes ${formatMoney(debt.amountCents)} and has been told.`));
      await passOnly(new Date(Date.now() + 30 * DAYS), first.id);
      check("and so nothing is taken, however much time passes", (await debtOf(first.id)).status === "told" && (await debtOf(first.id)).dueAt === null && (await transferAt(sent.transferId)).amount_reversed === 0 && (await operationsOf(paid.payment.id)).length === 0);
      // The sending service takes the email an hour after it was written, and reports it as delivered an hour after that.
      const HOUR = 3_600_000;
      await db.update(schema.emailOutbox).set({ status: "sent", sentAt: new Date(debt.toldAt.getTime() + HOUR) }).where(eq(schema.emailOutbox.id, debt.noticeEmailId!));
      await passOnly(new Date(0), first.id);
      check("sent, and not yet reported as delivered: still no day", (await debtOf(first.id)).dueAt === null);
      await db.update(schema.emailOutbox).set({ deliveredAt: new Date(debt.toldAt.getTime() + 2 * HOUR) }).where(eq(schema.emailOutbox.id, debt.noticeEmailId!));
      await passOnly(new Date(0), first.id);
      const dated = await debtOf(first.id);
      check("once the notice is reported as delivered, its day is 14 days after it arrived, not after it was written or sent", dated.dueAt?.getTime() === dated.toldAt.getTime() + 2 * HOUR + NOTICE_MS, dated.dueAt?.toISOString());
      await passOnly(new Date(dated.dueAt!.getTime() - DAYS), first.id);
      check("a day before that day nothing is taken", (await debtOf(first.id)).status === "told" && (await transferAt(sent.transferId)).amount_reversed === 0);
      const page = await debtForPage(debt.id, "host", reader);
      const mine = await debtsOfHost(host.id);
      check("the host's pages show it: the take-back's own page and her earnings", page?.debt.id === debt.id && page.what.length > 0 && mine.some((row) => row.id === debt.id && row.path === `/debts/${debt.id}`) && (await debtsForFounder()).open.some((row) => row.id === debt.id));

      // The rest of the charge is refunded too, while the first take-back is still open.
      const now = await reload(paid.payment.id);
      const rest = await refund(paid.payment.id, now.chargedCents! - now.refundedCents);
      await pass(rest.id);
      const second = await debtOf(rest.id);
      check("a second refund gets its own take-back, for what her share lost this time: together never more than was sent", second?.status === "told" && second.amountCents === rest.hostOwesCents && debt.amountCents + second.amountCents === sent.sentCents && (await reload(paid.payment.id)).refundedCents === now.chargedCents, `${debt.amountCents} + ${second?.amountCents} of ${sent.sentCents}`);
      const due = new Date(Math.max(dated.dueAt!.getTime(), (await debtOf(rest.id)).dueAt!.getTime()) + 60_000);
      await passOnly(due, first.id, rest.id);
      const taken = await debtsFor(first.id, rest.id);
      const reversals = (await stripe().transfers.listReversals(sent.transferId, { limit: 10 })).data;
      check("after their days both are really taken back at Stripe, each with its own reversal", taken.every((row) => row.status === "taken" && row.stripeReversalId !== null) && reversals.length === 2 && (await transferAt(sent.transferId)).amount_reversed === sent.sentCents, taken.map((row) => row.status).join(" "));
      check("the money record adds up: what was sent, and what was taken back", (await ledgerOf(paid.payment.id, "host_transfer")) === -sent.sentCents && (await ledgerOf(paid.payment.id, "host_takeback")) === sent.sentCents && (await ledgerOf(paid.payment.id, "connect_cost")) === 0);
      check("the host is told that it was taken, once for each", (await hostTold(debt.id, "taken")).length === 1 && (await hostTold(second.id, "taken")).length === 1);
      await passOnly(new Date(due.getTime() + 40 * DAYS), first.id, rest.id);
      check("and never twice", (await stripe().transfers.listReversals(sent.transferId, { limit: 10 })).data.length === 2 && (await operationsOf(paid.payment.id)).length === 2);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. A share that paid a collection charge; the host objects; the founder answers, then calls it off");
    {
      const paid = await charged(host, await person("customer"), CARD);
      const sent = await collect(paid.payment.id, 100);
      const whole = await refund(paid.payment.id, paid.payment.chargedCents!);
      await pass(whole.id);
      const debt = await debtOf(whole.id);
      check("her share lost all of it, and she owes only what was really sent to her (the charge for collecting is not asked back)", whole.hostOwesCents === sent.sentCents + 100 && debt?.status === "told" && debt.amountCents === sent.sentCents, `${whole.hostOwesCents} lost, ${debt?.amountCents} owed, ${sent.sentCents} sent`);
      const other = await person("another host");
      const notHers = await said(objectToDebt({ debtId: debt.id, hostId: other.id, objection: "This is not right at all, I think." }));
      check("another person cannot object to it", /^debt: This is not one of your take-backs/.test(notHers) && (await debtOf(whole.id)).status === "told", notHers);
      await objectToDebt({ debtId: debt.id, hostId: host.id, objection: "The call took place in full, as it was booked." });
      const held = await debtOf(whole.id);
      check("the host says it is wrong: it is held, it has no day, and each admin is told", held.status === "objected" && held.dueAt === null && toldEachAdmin(await founderMail(debt.id, "objected")) && (await hostTold(debt.id, "objected")).length === 1);
      await passOnly(new Date(Date.now() + 40 * DAYS), whole.id);
      check("nothing is taken while it is held", (await debtOf(whole.id)).status === "objected" && (await transferAt(sent.transferId)).amount_reversed === 0);
      check("the founder answers in writing", (await answerObjection({ debtId: debt.id, adminId: admin, answer: "The customer was charged by mistake, so the refund stands." })) === true);
      check("an answer with its email not yet arrived gives no day", (await debtOf(whole.id)).status === "answered" && (await debtOf(whole.id)).dueAt === null);
      await sendNotices(whole.id);
      await passOnly(new Date(0), whole.id);
      const answered = await debtOf(whole.id);
      check("once the answer arrived: not before the notice's 14 days, and not before 3 days after the answer", answered.dueAt?.getTime() === answered.toldAt.getTime() + NOTICE_MS && answered.dueAt.getTime() >= answered.answeredAt!.getTime() + 3 * DAYS, answered.dueAt?.toISOString());
      check("the founder calls it off", (await cancelDebt({ debtId: debt.id, adminId: admin })) === true && (await cancelDebt({ debtId: debt.id, adminId: admin })) === false);
      check("Connect carries it, written down once as a cost of Connect's own; the host is told", (await debtOf(whole.id)).status === "cancelled" && (await ledgerOf(paid.payment.id, "connect_cost")) === debt.amountCents && (await linesOf(paid.payment.id, "connect_cost")) === 1 && (await hostTold(debt.id, "cancelled")).length === 1);
      await passOnly(new Date(Date.now() + 60 * DAYS), whole.id);
      check("and nothing is ever taken for it", (await transferAt(sent.transferId)).amount_reversed === 0 && (await operationsOf(paid.payment.id)).length === 0 && (await ledgerOf(paid.payment.id, "host_takeback")) === 0);

      // A share whose charge for collecting was all of it: the app recorded a collection, and nothing was sent.
      const none = await charged(host, await person("customer"), CARD);
      const empty = await collect(none.payment.id, currentSplit(none.payment).hostShareCents);
      const lost = await refund(none.payment.id, 500);
      await passOnly(new Date(), lost.id);
      await passOnly(new Date(), lost.id);
      check("a share that was collected with nothing sent: her share lost something, there is nothing to take back, and it is looked at once", empty.sentCents === 0 && lost.status === "done" && lost.afterCollection && lost.hostOwesCents > 0 && (await debtsFor(lost.id)).length === 0 && (await refundRow(lost.id)).debtLookedAt !== null, `${lost.hostOwesCents}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Settled outside the app; a later refund on the same share is still taken, and only for its own part");
    {
      const paid = await charged(host, await person("customer"), CARD);
      const sent = await collect(paid.payment.id);
      const part = await refund(paid.payment.id, 400);
      // (As if Stripe knew of one more refund on this charge than the app has confirmed: the two totals differ.)
      const real = (await reload(paid.payment.id)).refundedCents;
      await db.update(schema.payments).set({ refundedCents: real - 100 }).where(eq(schema.payments.id, paid.payment.id));
      await passOnly(new Date(), part.id);
      const notAgreeing = await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `refund-totals:${paid.payment.id}:%`));
      check("while Stripe's total of refunds on the charge is not the app's, nothing is worked out, it is asked again, and each admin is told once", (await debtsFor(part.id)).length === 0 && (await refundRow(part.id)).debtLookedAt === null && notAgreeing.length === admins.length && notAgreeing.every((mail) => mail.body.includes("the app works out no take-back")), `${notAgreeing.length}`);
      await db.update(schema.payments).set({ refundedCents: real }).where(eq(schema.payments.id, paid.payment.id));
      await pass(part.id);
      const debt = await debtOf(part.id);
      check("once the two totals agree, the take-back is written", debt?.status === "told" && debt.amountCents === part.hostOwesCents);
      const tooMuch = await said(settleOutside({ debtId: debt.id, adminId: admin, repaidCents: debt.amountCents + 1, note: "Paid by bank transfer." }));
      const noNote = await said(settleOutside({ debtId: debt.id, adminId: admin, repaidCents: 0, note: "ok" }));
      check("the founder cannot record more as paid back than is owed, nor without a note", /^debt: What the host paid back/.test(tooMuch) && /^debt: Note how it was settled/.test(noNote) && (await debtOf(part.id)).status === "told", `${tooMuch} | ${noNote}`);
      const repaid = debt.amountCents - 100;
      check("(the take-back is big enough for this check)", repaid > 0, debt.amountCents);
      check("the founder records that the host paid back all but $1.00 herself", (await settleOutside({ debtId: debt.id, adminId: admin, repaidCents: repaid, note: "Paid by bank transfer on the day of this check." })) === true && (await settleOutside({ debtId: debt.id, adminId: admin, repaidCents: repaid, note: "Paid by bank transfer, a second time." })) === false);
      const settled = await debtOf(part.id);
      check("the books say so, once: what she paid back, and the $1.00 Connect carries", settled.status === "settled" && settled.repaidCents === repaid && settled.dueAt === null && (await ledgerOf(paid.payment.id, "host_repaid")) === repaid && (await linesOf(paid.payment.id, "host_repaid")) === 1 && (await ledgerOf(paid.payment.id, "connect_cost")) === 100 && (await linesOf(paid.payment.id, "connect_cost")) === 1 && (await hostTold(debt.id, "settled")).length === 1, `${settled.status} ${settled.repaidCents}`);
      // (Other test runs leave ended take-backs dated in the future in the shared test database, so the founder's list is asked for in full.)
      check("her earnings page still shows it, as settled, and so does the founder's list", (await debtsOfHost(host.id)).some((row) => row.id === debt.id && row.status === "settled") && (await debtsForFounder(100_000)).ended.some((row) => row.id === debt.id));
      const now = await reload(paid.payment.id);
      const rest = await refund(paid.payment.id, now.chargedCents! - now.refundedCents);
      await pass(rest.id);
      const second = await debtOf(rest.id);
      check("the rest of the charge is refunded: the new take-back is for what her share lost this time only", second?.status === "told" && second.amountCents === sent.sentCents - debt.amountCents, `${second?.amountCents} of ${sent.sentCents}`);
      await passOnly(new Date(second.dueAt!.getTime() + 60_000), part.id, rest.id);
      check("it is taken; what was settled outside the app is not taken a second time at Stripe", (await debtOf(rest.id)).status === "taken" && (await debtOf(part.id)).status === "settled" && (await transferAt(sent.transferId)).amount_reversed === sent.sentCents - debt.amountCents && (await ledgerOf(paid.payment.id, "host_takeback")) === sent.sentCents - debt.amountCents);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. A host with no published Host Agreement accepted before the charge: written down, told, and never taken by the app");
    {
      const later = await person("host");
      const paid = await charged(later, await person("customer"), CARD);
      const sent = await collect(paid.payment.id);
      const one = await refund(paid.payment.id, 500);
      await pass(one.id);
      const debt = await debtOf(one.id);
      check("it waits: no agreement is named, it has no notice and no day", debt?.status === "waiting" && debt.amountCents === one.hostOwesCents && debt.agreementVersion === null && debt.chargeAt !== null && debt.noticeEmailId === null && debt.dueAt === null, `${debt?.status}`);
      const told = await hostTold(debt.id, "waiting");
      check("the host is told what Connect asks of her, and each admin is told that the app will not take it", told.length === 1 && told[0].body.includes(formatMoney(debt.amountCents)) && (await hostTold(debt.id, "owed")).length === 0 && toldEachAdmin(await founderMail(debt.id, "waiting")), told[0]?.body.slice(0, 160));
      await passOnly(new Date(Date.now() + 90 * DAYS), one.id);
      check("nothing is taken, however much time passes", (await debtOf(one.id)).status === "waiting" && (await transferAt(sent.transferId)).amount_reversed === 0 && (await operationsOf(paid.payment.id)).length === 0);
      // She accepts the agreement now, after the charge: that does not reach back.
      await accept(later, new Date());
      const two = await refund(paid.payment.id, 300);
      await pass(two.id);
      const next = await debtOf(two.id);
      check("an agreement accepted after the charge does not reach back: a later refund of that charge waits too", next?.status === "waiting" && next.agreementVersion === null && next.amountCents === two.hostOwesCents, `${next?.status}`);
      check("the founder's list shows both as open", (await debtsForFounder()).open.filter((row) => row.id === debt.id || row.id === next.id).length === 2);
      check("the founder lets the first go, with nothing paid back: Connect carries all of it", (await settleOutside({ debtId: debt.id, adminId: admin, repaidCents: 0, note: "Agreed by email with the host that Connect carries it." })) === true && (await debtOf(one.id)).status === "settled" && (await ledgerOf(paid.payment.id, "connect_cost")) === debt.amountCents && (await linesOf(paid.payment.id, "host_repaid")) === 0);
      const mine = and(eq(schema.agreementAcceptances.userId, later.id), eq(schema.agreementAcceptances.version, published.version));
      await db.update(schema.agreementAcceptances).set({ acceptedAt: debt.chargeAt! }).where(mine);
      const three = await refund(paid.payment.id, 100);
      await pass(three.id);
      check("accepted in the very second of the charge: that is not before it, so it waits", (await debtOf(three.id))?.status === "waiting");
      await db.update(schema.agreementAcceptances).set({ acceptedAt: new Date(debt.chargeAt!.getTime() - 1000) }).where(mine);
      const four = await refund(paid.payment.id, 100);
      await pass(four.id);
      const told4 = await debtOf(four.id);
      check("accepted a second before the charge: told, with the version named and a day once its notice arrived", told4?.status === "told" && told4.agreementVersion === published.version && told4.dueAt !== null, `${told4?.status}`);
      // A host who accepted the Host Agreement as it really is today, a draft. (For this one look the made-up published
      // version is taken away, so the version in force at the charge is the draft she accepted.)
      const draft = DOCUMENTS["host-agreement"].versions.find((one) => one.draft);
      const drafted = await person("host");
      const draftPaid = await charged(drafted, await person("customer"), CARD);
      await db.insert(schema.agreementAcceptances).values({ userId: drafted.id, document: "host-agreement", version: draft!.version, occasion: "host_application", acceptedAt: new Date(Date.now() - 3_600_000) });
      await collect(draftPaid.payment.id);
      const five = await refund(draftPaid.payment.id, 500);
      DOCUMENTS["host-agreement"].versions.splice(DOCUMENTS["host-agreement"].versions.indexOf(published), 1);
      try {
        await pass(five.id);
      } finally {
        DOCUMENTS["host-agreement"].versions.push(published);
      }
      const underDraft = await debtOf(five.id);
      check("a host who accepted the agreement while it is a draft, an hour before the charge: a draft is not in force, so it waits", draft !== undefined && underDraft?.status === "waiting" && underDraft.agreementVersion === null && underDraft.chargeAt !== null, `${underDraft?.status}`);
      // A charge Stripe says, for good, that it does not have (the number the app saved leads nowhere): there is no
      // proof of the bank's time, so it waits for the founder, although this host had accepted the agreement in time.
      const lostCharge = await charged(host, await person("customer"), CARD);
      await collect(lostCharge.payment.id);
      const six = await refund(lostCharge.payment.id, 500);
      await db.update(schema.payments).set({ stripeChargeId: `ch_owedcheck_${RUN}_none` }).where(eq(schema.payments.id, lostCharge.payment.id));
      await pass(six.id);
      await db.update(schema.payments).set({ stripeChargeId: lostCharge.payment.stripeChargeId }).where(eq(schema.payments.id, lostCharge.payment.id));
      const noProof = await debtOf(six.id);
      check("Stripe has no such charge: the take-back is written all the same, and waits for the founder", noProof?.status === "waiting" && noProof.chargeAt === null && noProof.agreementVersion === null && noProof.amountCents === six.hostOwesCents, `${noProof?.status}`);
      check("and calls the second off: Connect carries that too", (await cancelDebt({ debtId: next.id, adminId: admin })) === true && (await debtOf(two.id)).status === "cancelled" && (await ledgerOf(paid.payment.id, "connect_cost")) === debt.amountCents + next.amountCents && (await transferAt(sent.transferId)).amount_reversed === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. A reversal made by hand at Stripe: never taken twice; Stripe's refusal; and room that comes free");
    {
      const paid = await charged(host, await person("customer"), CARD);
      // (As if her share were on its way at this moment: a sending written down and not yet answered.)
      const [sending] = await db.insert(schema.moneyOperations).values({ paymentId: paid.payment.id, kind: "transfer", label: `owedcheck-sending:${paid.payment.id}`, params: "{}" }).returning();
      const midway = await said(refund(paid.payment.id, 200));
      await db.delete(schema.moneyOperations).where(eq(schema.moneyOperations.id, sending.id));
      check("while the share is on its way to the host, no refund is started", /already in progress/.test(midway) && (await db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, paid.payment.id))).length === 0, midway);
      const sent = await collect(paid.payment.id);
      const one = await refund(paid.payment.id, 500);
      // (As if a second refund of this payment were still with Stripe: a line the script writes, with no request to Stripe.
      // What a real refund on its way does is part 8.)
      const moving = randomUUID();
      refundIds.push(moving);
      await db.insert(schema.refunds).values({ id: moving, paymentId: paid.payment.id, amountCents: 100, decidedBy: admin, decidedAs: "admin", reason: WHY, status: "in_progress", afterCollection: true });
      await passOnly(new Date(), one.id, moving);
      check("while another refund of the payment is still on its way, nothing is worked out, and the founder's page says \"on its way\"", (await debtsFor(one.id, moving)).length === 0 && (await refundRow(one.id)).debtLookedAt === null && (await refundOutcome(moving))?.status === "in_progress");
      await db.update(schema.refunds).set({ status: "failed", finishedAt: new Date() }).where(eq(schema.refunds.id, moving));
      await pass(one.id, moving);
      check("once that one is refused: no take-back for it, the page says \"refused\", and the confirmed refund gets its own", (await debtsFor(moving)).length === 0 && (await refundOutcome(moving))?.status === "failed" && (await debtOf(one.id))?.status === "told");
      const debt = await debtOf(one.id);
      // Somebody reverses $2.00 of the transfer by hand at Stripe, meaning it for this take-back, and tells the app nothing.
      const byHand = await stripe().transfers.createReversal(sent.transferId, { amount: 200 });
      const due = new Date(debt.dueAt!.getTime() + 60_000);
      await passOnly(due, one.id);
      await passOnly(new Date(due.getTime() + 60_000), one.id);
      const held = await debtOf(one.id);
      check("a reversal made by hand that nobody has accounted for: the app takes nothing more from that transfer, and tells each admin once", held.status === "told" && held.handToldAt !== null && (await transferAt(sent.transferId)).amount_reversed === 200 && (await operationsOf(paid.payment.id)).length === 0 && admins.length > 0 && toldEachAdmin(await founderMail(debt.id, `hand:${byHand.id}`)), `${held.status} ${(await founderMail(debt.id, `hand:${byHand.id}`)).length}`);
      const seen = await handReversalsOpen(held);
      check("the founder's page finds that reversal at Stripe, with its amount", seen.length === 1 && seen[0].id === byHand.id && seen[0].amountCents === 200);
      check("the founder says it paid this take-back; a second press finds nothing left to account for", (await countHandReversal({ debtId: debt.id, adminId: admin, reversalId: byHand.id, as: "paid" })) === true && /^debt: That reversal is not one that is waiting/.test(await said(countHandReversal({ debtId: debt.id, adminId: admin, reversalId: byHand.id, as: "paid" }))));
      const counted = await debtOf(one.id);
      check("it is counted once: $2.00 less is owed, the books have it as taken back, and the host is told", counted.status === "told" && counted.amountCents === debt.amountCents - 200 && counted.byHandCents === 200 && (await ledgerOf(paid.payment.id, "host_takeback")) === 200 && (await hostTold(debt.id, `hand:${byHand.id}:0`)).length === 1, `${counted.amountCents}`);
      await passOnly(new Date(due.getTime() + 2 * 60_000), one.id);
      const after = await debtOf(one.id);
      check("then the app takes only what is left: together exactly what was owed, and not a cent more", after.status === "taken" && after.handToldAt === null && (await transferAt(sent.transferId)).amount_reversed === debt.amountCents && (await ledgerOf(paid.payment.id, "host_takeback")) === debt.amountCents, `${after.status} ${(await transferAt(sent.transferId)).amount_reversed} of ${debt.amountCents}`);

      // After it has ended, somebody reverses another $1.00 by hand, meaning it for this take-back. Stripe's message
      // about a reversed transfer arrives (twice, as messages do).
      const second = await stripe().transfers.createReversal(sent.transferId, { amount: 100 });
      await reversalSeenOnTransfer(sent.transferId);
      await reversalSeenOnTransfer(sent.transferId);
      const seenLate = await founderMail(debt.id, `hand:${second.id}`);
      check("a reversal made by hand after the take-back had ended: each admin is told once that the host may have paid twice", admins.length > 0 && toldEachAdmin(seenLate) && seenLate.every((mail) => mail.subject.includes("had ended") && mail.body.includes("has paid twice")), `${seenLate.length}`);
      check("it cannot be counted as having paid a take-back that has ended", /^debt: This take-back is no longer open/.test(await said(countHandReversal({ debtId: debt.id, adminId: admin, reversalId: second.id, as: "paid" }))));
      check("the founder records that the host has paid twice; a second press finds nothing left", (await countHandReversal({ debtId: debt.id, adminId: admin, reversalId: second.id, as: "twice" })) === true && /^debt: That reversal is not one that is waiting/.test(await said(countHandReversal({ debtId: debt.id, adminId: admin, reversalId: second.id, as: "twice" }))));
      const twice = await debtOf(one.id);
      const owedBack = await hostTold(debt.id, `twice:${second.id}:0`);
      check("it is owed back to her: on the row, in the books as taken, and she and each admin are told once", twice.status === "taken" && twice.overpaidCents === 100 && (await ledgerOf(paid.payment.id, "host_takeback")) === debt.amountCents + 100 && owedBack.length === 1 && owedBack[0].subject === "Connect owes you $1.00 back" && toldEachAdmin(await founderMail(debt.id, `twice:${second.id}:0`)), `${twice.overpaidCents} ${owedBack.length}`);

      // A reversal made by hand BEFORE the take-back is written does not make the take-back smaller: it is counted
      // once, when the founder says what it was for.
      const paidB = await charged(host, await person("customer"), CARD);
      const sentB = await collect(paidB.payment.id);
      const before = await stripe().transfers.createReversal(sentB.transferId, { amount: 300 });
      const rb = await refund(paidB.payment.id, 500);
      await pass(rb.id);
      const written = await debtOf(rb.id);
      check("reversed by hand before the take-back was written: it is written for all her share lost, not $3.00 less", written?.status === "told" && written.amountCents === rb.hostOwesCents, `${written?.amountCents} of ${rb.hostOwesCents}`);
      await passOnly(new Date(written.dueAt!.getTime() + 60_000), rb.id);
      check("and it is held when its day comes: nothing is taken", (await debtOf(rb.id)).status === "told" && (await debtOf(rb.id)).handToldAt !== null && (await transferAt(sentB.transferId)).amount_reversed === 300);
      await countHandReversal({ debtId: written.id, adminId: admin, reversalId: before.id, as: "paid" });
      await passOnly(new Date(written.dueAt!.getTime() + 120_000), rb.id);
      const settledB = await debtOf(rb.id);
      check("counted once: $3.00 by hand and the rest by the app, together exactly what was owed", settledB.status === "taken" && settledB.byHandCents === 300 && (await transferAt(sentB.transferId)).amount_reversed === rb.hostOwesCents && (await ledgerOf(paidB.payment.id, "host_takeback")) === rb.hostOwesCents, `${(await transferAt(sentB.transferId)).amount_reversed} of ${rb.hostOwesCents}`);

      // The same when the WHOLE transfer was reversed by hand first: the take-back is written, not "nothing".
      const paidW = await charged(host, await person("customer"), CARD);
      const sentW = await collect(paidW.payment.id);
      await stripe().transfers.createReversal(sentW.transferId, { amount: sentW.sentCents });
      const rw = await refund(paidW.payment.id, paidW.payment.chargedCents!);
      await pass(rw.id);
      const whole = await debtOf(rw.id);
      check("the whole transfer reversed by hand first: the take-back is still written, for all that was sent", whole?.status === "told" && whole.amountCents === sentW.sentCents, `${whole?.status} ${whole?.amountCents}`);
      for (const open of await handReversalsOpen(whole)) await countHandReversal({ debtId: whole.id, adminId: admin, reversalId: open.id, as: "paid" });
      const inFull = await debtOf(rw.id);
      check("the founder counts it: paid in full by hand, in the books once, and nothing is left for the app to take", inFull.status === "taken" && inFull.amountCents === 0 && inFull.byHandCents === sentW.sentCents && inFull.stripeReversalId === null && (await ledgerOf(paidW.payment.id, "host_takeback")) === sentW.sentCents && (await handReversalsOpen(whole)).length === 0, `${inFull.status} ${inFull.byHandCents}`);

      // One reversal made by hand that was meant for two take-backs of one share.
      const paidT = await charged(host, await person("customer"), CARD);
      const sentT = await collect(paidT.payment.id);
      const t1 = await refund(paidT.payment.id, 300);
      await pass(t1.id);
      const t2 = await refund(paidT.payment.id, 400);
      await pass(t2.id);
      const [d1, d2] = [await debtOf(t1.id), await debtOf(t2.id)];
      const forBoth = await stripe().transfers.createReversal(sentT.transferId, { amount: d1.amountCents + 100 });
      await countHandReversal({ debtId: d1.id, adminId: admin, reversalId: forBoth.id, as: "paid" });
      const leftOver = await handReversalsOpen(d2);
      check("one reversal for two take-backs: counted for the first up to what it owed, and the rest of the reversal stays unaccounted for", (await debtOf(t1.id)).status === "taken" && leftOver.length === 1 && leftOver[0].id === forBoth.id && leftOver[0].openCents === 100, `${leftOver[0]?.openCents}`);
      const dueT = new Date(Math.max(d1.dueAt!.getTime(), d2.dueAt!.getTime()) + 60_000);
      await passOnly(dueT, t1.id, t2.id);
      check("so the second take-back is held: the app takes nothing for it", (await debtOf(t2.id)).status === "told" && (await debtOf(t2.id)).handToldAt !== null && (await transferAt(sentT.transferId)).amount_reversed === d1.amountCents + 100);
      // Of the $1.00 that is left of it, the founder says: 40 cents paid the second take-back, and 60 cents were
      // taken for the first although it was already paid. Neither order of saying so changes the sums.
      check("a part cannot be nothing, nor more than fits", /^debt: The part has to be between/.test(await said(countHandReversal({ debtId: d2.id, adminId: admin, reversalId: forBoth.id, as: "paid", cents: 101 }))) && /^debt: The part has to be between/.test(await said(countHandReversal({ debtId: d2.id, adminId: admin, reversalId: forBoth.id, as: "paid", cents: 0 }))));
      await countHandReversal({ debtId: d1.id, adminId: admin, reversalId: forBoth.id, as: "twice", cents: 60, openWasCents: 100 });
      // The same form once more (a second press): it was made when $1.00 was open, and that is no longer so.
      const again = await said(countHandReversal({ debtId: d1.id, adminId: admin, reversalId: forBoth.id, as: "twice", cents: 60, openWasCents: 100 }));
      check("60 cents of it are recorded as taken on top of the first, once, however often the form is sent; 40 cents are still unaccounted for", /^debt: Part of this reversal was accounted for since/.test(again) && (await debtOf(t1.id)).overpaidCents === 60 && (await handReversalsOpen(d2))[0]?.openCents === 40 && (await hostTold(d1.id, `twice:${forBoth.id}:${d1.amountCents}`)).length === 1, again);
      await countHandReversal({ debtId: d2.id, adminId: admin, reversalId: forBoth.id, as: "paid", cents: 40 });
      await passOnly(new Date(dueT.getTime() + 60_000), t1.id, t2.id);
      check("40 cents are counted for the second, and only then is what is left of it taken: she paid what the two owed, and the 60 cents that are owed back to her", (await debtOf(t2.id)).status === "taken" && (await debtOf(t2.id)).byHandCents === 40 && (await handReversalsOpen(d2)).length === 0 && (await transferAt(sentT.transferId)).amount_reversed === d1.amountCents + d2.amountCents + 60 && (await ledgerOf(paidT.payment.id, "host_takeback")) === d1.amountCents + d2.amountCents + 60, `${(await transferAt(sentT.transferId)).amount_reversed} of ${d1.amountCents + d2.amountCents + 60}`);

      // Stripe refuses: the whole transfer is reversed by hand in the moment between the app's look and its request
      // (so the taking itself is run here, without the look that would hold it).
      const takeDirect = (row: { id: string; paymentId: string }, at: Date) => said(runMoneyOperation(takePlan(row, at)));
      const paid2 = await charged(host, await person("customer"), CARD);
      const sent2 = await collect(paid2.payment.id);
      const two = await refund(paid2.payment.id, 500);
      await pass(two.id);
      const debt2 = await debtOf(two.id);
      await stripe().transfers.createReversal(sent2.transferId, { amount: sent2.sentCents });
      const due2 = new Date(debt2.dueAt!.getTime() + 60_000);
      const no = await takeDirect(debt2, due2);
      const refused = await debtOf(two.id);
      check("refused by Stripe: still owed, nothing recorded as taken, and the refusal is kept", /^money: /.test(no) && refused.status === "told" && refused.refusal !== null && refused.firstRefusedAt !== null && (await ledgerOf(paid2.payment.id, "host_takeback")) === 0 && (await operationsOf(paid2.payment.id)).length === 1, `${refused.status} ${refused.refusal}`);
      // (As if that refusal had come at the moment the notice ended.)
      await db.update(debts).set({ refusedAt: due2, firstRefusedAt: due2 }).where(eq(debts.id, debt2.id));
      check("it is not tried again within a day", /^money: This take-back is not waiting/.test(await takeDirect(debt2, new Date(due2.getTime() + 23 * 3_600_000))) && (await operationsOf(paid2.payment.id)).length === 1);
      await takeDirect(debt2, new Date(due2.getTime() + 31 * DAYS));
      await passOnly(new Date(due2.getTime() + 31 * DAYS), two.id);
      await passOnly(new Date(due2.getTime() + 33 * DAYS), two.id);
      const mails = await founderMail(debt2.id, "refused");
      check("it was tried again later, and after 30 days of refusals each admin is told, once, in words about a refund", (await operationsOf(paid2.payment.id)).length === 2 && toldEachAdmin(mails) && mails.every((mail) => /refund/i.test(mail.body) && !/bank dispute/i.test(mail.body)), `${mails.length}`);

      // No room left. She paid part of an earlier take-back to Connect's bank account; then a reversal made by hand
      // turns out to have had nothing to do with a take-back. Stripe would still let the app take all of the second
      // take-back: together she would pay more than was sent. The app's own record says no.
      const paidR = await charged(host, await person("customer"), CARD);
      const sentR = await collect(paidR.payment.id);
      const q1 = await refund(paidR.payment.id, 500);
      await pass(q1.id);
      const firstR = await debtOf(q1.id);
      await settleOutside({ debtId: firstR.id, adminId: admin, repaidCents: 300, note: "She paid $3.00 to the bank account; the rest was let go." });
      const nowR = await reload(paidR.payment.id);
      const q2 = await refund(paidR.payment.id, nowR.chargedCents! - nowR.refundedCents);
      await pass(q2.id);
      const secondR = await debtOf(q2.id);
      const strayed = await stripe().transfers.createReversal(sentR.transferId, { amount: 300 });
      await countHandReversal({ debtId: secondR.id, adminId: admin, reversalId: strayed.id, as: "other" });
      const roomLeft = sentR.sentCents - 300 - 300;
      await passOnly(new Date(secondR.dueAt!.getTime() + 60_000), q2.id);
      await passOnly(new Date(secondR.dueAt!.getTime() + 120_000), q2.id);
      const noRoom = await founderMail(secondR.id, "noroom");
      check("(the second take-back was written for more than can still be taken once that reversal is known to be something else)", secondR.amountCents > roomLeft, `${secondR.amountCents} > ${roomLeft}`);
      check("more is owed than can still be taken out of the transfer: the app takes nothing, asks Stripe for nothing, and tells each admin once what is left", (await debtOf(q2.id)).status === "told" && (await transferAt(sentR.transferId)).amount_reversed === 300 && (await operationsOf(paidR.payment.id)).length === 0 && toldEachAdmin(noRoom) && noRoom.every((mail) => mail.body.includes(`only ${formatMoney(roomLeft)} can still be taken`)), `${noRoom.length}`);
      check("the taking itself refuses it too", /^money: More is owed than can still be taken/.test(await takeDirect(secondR, new Date(secondR.dueAt!.getTime() + 180_000))));

      // The same, when the taking was already written down (and not sent) before the founder said so: the helper does
      // not send the old request for an amount that no longer fits.
      const paidK = await charged(host, await person("customer"), CARD);
      const sentK = await collect(paidK.payment.id);
      const k1 = await refund(paidK.payment.id, 500);
      await pass(k1.id);
      await settleOutside({ debtId: (await debtOf(k1.id)).id, adminId: admin, repaidCents: 300, note: "She paid $3.00 to the bank account; the rest was let go." });
      const nowK = await reload(paidK.payment.id);
      const k2 = await refund(paidK.payment.id, nowK.chargedCents! - nowK.refundedCents);
      await pass(k2.id);
      const debtK = await debtOf(k2.id);
      const startedK = await db.transaction((tx) => startMoneyOperation(tx, takePlan(debtK, debtK.dueAt!)));
      if (startedK === "already_done") throw new Error("The take-back was already done.");
      const strayK = await stripe().transfers.createReversal(sentK.transferId, { amount: 300 });
      await countHandReversal({ debtId: (await debtOf(k1.id)).id, adminId: admin, reversalId: strayK.id, as: "other" });
      await age(startedK.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [startedK.operationId] });
      check("a taking that was written down before the room was used up is not sent afterwards: nothing but the reversal by hand is at Stripe", (await debtOf(k2.id)).status === "taking" && (await transferAt(sentK.transferId)).amount_reversed === 300 && (await ledgerOf(paidK.payment.id, "host_takeback")) === 0);
      await age(startedK.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [startedK.operationId] });
      check("and once it is certain that it never happened, the take-back is back at its notice, with nothing taken", (await debtOf(k2.id)).status === "told" && (await transferAt(sentK.transferId)).amount_reversed === 300);

      // Room that comes free. Most of a transfer is gone (by hand, for a reason of its own), so a second refund's take-back finds no room.
      const paid3 = await charged(host, await person("customer"), CARD);
      const sent3 = await collect(paid3.payment.id);
      const r1 = await refund(paid3.payment.id, 500);
      await pass(r1.id);
      const a1 = await debtOf(r1.id);
      await stripe().transfers.createReversal(sent3.transferId, { amount: sent3.sentCents - a1.amountCents });
      // (The founder says it had nothing to do with a take-back: from then on it is room that is gone.)
      for (const open of await handReversalsOpen(a1)) await countHandReversal({ debtId: a1.id, adminId: admin, reversalId: open.id, as: "other" });
      const now3 = await reload(paid3.payment.id);
      const r2 = await refund(paid3.payment.id, now3.chargedCents! - now3.refundedCents);
      await passOnly(new Date(), r2.id);
      await passOnly(new Date(), r2.id);
      const none = await debtsFor(r2.id);
      check("no room is left on the transfer for the second refund's take-back: written as nothing, looked at once, and nobody is told", none.length === 1 && none[0].status === "nothing" && none[0].amountCents === 0 && (await messagesOf(none[0].id)).length === 0 && (await refundRow(r2.id)).debtLookedAt !== null && refundAnswer(await refundOutcome(r2.id), "founder").includes("Nothing can be taken back for it"), none.map((row) => `${row.status}:${row.amountCents}`).join(" "));
      check("the founder calls the first off", (await cancelDebt({ debtId: a1.id, adminId: admin })) === true);
      await pass(r2.id);
      const freed = await debtOf(r2.id);
      check("room is free again: the second is worked out afresh, for no more than that room, and its host is told then", freed?.status === "told" && freed.amountCents === a1.amountCents && freed.amountCents < r2.hostOwesCents && (await hostTold(freed.id, "owed")).length === 1, `${freed?.status} ${freed?.amountCents}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. A refund and a lost bank dispute on the same share (the refund's line is the script's; the rest is real): never asked twice for the same money");
    {
      const LOST = 600;
      // The refund's take-back is open; then the dispute over the payment is lost.
      const a = await disputedAndCollected(host);
      const ra = await refundLine(a.payment.id, a.sentCents, LOST);
      await passOnly(new Date(), ra);
      await lose(a.disputeId);
      await both(new Date(), a.disputeId, ra);
      const first = await debtOf(ra);
      let other = await disputeDebt(a.disputeId);
      check("the refund's take-back is open, then the dispute is lost: the dispute's take-back starts from what her share still had", first?.status === "told" && first.amountCents === LOST && other?.status === "told" && other.amountCents === a.sentCents - LOST, `${first?.amountCents} + ${other?.amountCents} of ${a.sentCents}`);
      await sendOn(a.payment.id);
      await both(new Date(0), a.disputeId, ra);
      const dueA = new Date(Math.max((await debtOf(ra)).dueAt!.getTime(), (await disputeDebt(a.disputeId)).dueAt!.getTime()) + 60_000);
      await both(dueA, a.disputeId, ra);
      check("both are taken, together exactly what was sent", (await debtOf(ra)).status === "taken" && (await disputeDebt(a.disputeId)).status === "taken" && (await transferAt(a.transferId)).amount_reversed === a.sentCents && (await ledgerOf(a.payment.id, "host_takeback")) === a.sentCents);

      // Both are found in the same pass, the dispute first.
      const b = await disputedAndCollected(host);
      await lose(b.disputeId);
      const rb = await refundLine(b.payment.id, b.sentCents, LOST);
      await both(new Date(), b.disputeId, rb);
      other = await disputeDebt(b.disputeId);
      const second = await debtOf(rb);
      check("found in one pass, the dispute first: the same two amounts", other?.status === "told" && other.amountCents === b.sentCents - LOST && second?.status === "told" && second.amountCents === LOST, `${other?.amountCents} + ${second?.amountCents} of ${b.sentCents}`);
      check("the founder calls the refund's take-back off: Connect carries it, and the dispute's take-back stays as it is", (await cancelDebt({ debtId: second.id, adminId: admin })) === true && (await ledgerOf(b.payment.id, "connect_cost")) === LOST && (await disputeDebt(b.disputeId)).amountCents === b.sentCents - LOST && (await disputeDebt(b.disputeId)).status === "told");

      // The refund's take-back was settled outside the app for half; then the dispute is lost.
      const c = await disputedAndCollected(host);
      const rc = await refundLine(c.payment.id, c.sentCents, LOST);
      await passOnly(new Date(), rc);
      await settleOutside({ debtId: (await debtOf(rc)).id, adminId: admin, repaidCents: LOST / 2, note: "Half paid by bank transfer, the rest let go." });
      await lose(c.disputeId);
      await both(new Date(), c.disputeId, rc);
      other = await disputeDebt(c.disputeId);
      check("settled outside the app for half, then the dispute is lost: the dispute asks only for what her share still had", (await debtOf(rc)).status === "settled" && other?.status === "told" && other.amountCents === c.sentCents - LOST, `${other?.amountCents} of ${c.sentCents}`);
      await sendOn(c.payment.id);
      await both(new Date(0), c.disputeId, rc);
      await both(new Date((await disputeDebt(c.disputeId)).dueAt!.getTime() + 60_000), c.disputeId, rc);
      check("it is taken, and no more than that", (await disputeDebt(c.disputeId)).status === "taken" && (await transferAt(c.transferId)).amount_reversed === c.sentCents - LOST);

      // Refunds used up everything that was sent; then the dispute is lost.
      const d = await disputedAndCollected(host);
      const rd = await refundLine(d.payment.id, d.sentCents + 100, d.sentCents + 100);
      await passOnly(new Date(), rd);
      await lose(d.disputeId);
      await both(new Date(), d.disputeId, rd);
      other = await disputeDebt(d.disputeId);
      check("refunds took all that was sent (she owes what was sent, not more): a dispute lost afterwards asks for nothing", (await debtOf(rd))?.amountCents === d.sentCents && other?.status === "nothing" && other.amountCents === 0 && (await messagesOf(other.id)).length === 0, `${(await debtOf(rd))?.amountCents} and ${other?.amountCents}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n7. Stripe took it back and the answer was lost: found at Stripe and recorded once, never asked twice");
    {
      const paid = await charged(host, await person("customer"), CARD);
      const sent = await collect(paid.payment.id);
      const one = await refund(paid.payment.id, 500);
      await pass(one.id);
      const debt = await debtOf(one.id);
      const started = await db.transaction((tx) => startMoneyOperation(tx, takePlan(debt, debt.dueAt!)));
      if (started === "already_done") throw new Error("The take-back was already done.");
      check("(written down as being taken, and not yet asked of Stripe)", (await debtOf(one.id)).status === "taking" && (await transferAt(sent.transferId)).amount_reversed === 0);
      await reverseAtStripe(started.params, started.label);
      await age(started.operationId, 25 * 3_600_000);
      // (Only this run's own action: the helper's look is not let loose on other runs' money.)
      await reconcileOperations(new Date(), { operationIds: [started.operationId] });
      const row = await debtOf(one.id);
      const [operation] = await operationsOf(paid.payment.id);
      check("the app's reversal carries the label of the very attempt that asked for it", (await stripe().transfers.listReversals(sent.transferId, { limit: 10 })).data[0]?.metadata?.attempt === started.label);
      check("found too late to ask again: the reversal is found at Stripe by the take-back's own number, and recorded once", operation.status === "succeeded" && row.status === "taken" && row.stripeReversalId !== null && (await transferAt(sent.transferId)).amount_reversed === debt.amountCents && (await stripe().transfers.listReversals(sent.transferId, { limit: 10 })).data.length === 1 && (await ledgerOf(paid.payment.id, "host_takeback")) === debt.amountCents && (await hostTold(debt.id, "taken")).length === 1, `${operation.status} ${row.status}`);

      // A taking is written down and not sent. Somebody reverses another amount by hand and puts the take-back's id on
      // it. That is not the app's request: the helper does not send its own on top of it, and does not book it.
      const paidM = await charged(host, await person("customer"), CARD);
      const sentM = await collect(paidM.payment.id);
      const rm = await refund(paidM.payment.id, 500);
      await pass(rm.id);
      const dm = await debtOf(rm.id);
      const startedM = await db.transaction((tx) => startMoneyOperation(tx, takePlan(dm, dm.dueAt!)));
      if (startedM === "already_done") throw new Error("The take-back was already done.");
      await stripe().transfers.createReversal(sentM.transferId, { amount: dm.amountCents, metadata: { debtId: dm.id } });
      await age(startedM.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [startedM.operationId] });
      check("a reversal made by hand for the very same amount, carrying only the take-back's id: it is not the app's request (that carries its attempt's label), so the helper sends nothing of its own on top of it and books nothing", (await debtOf(rm.id)).status === "taking" && (await transferAt(sentM.transferId)).amount_reversed === dm.amountCents && (await ledgerOf(paidM.payment.id, "host_takeback")) === 0);
      await age(startedM.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [startedM.operationId] });
      const backM = await debtOf(rm.id);
      const waitingM = await handReversalsOpen(backM);
      check("once it is certain that the app's own request never happened, the take-back is back at its notice, and that reversal waits for the founder", backM.status === "told" && /did not happen/.test(backM.refusal ?? "") && waitingM.length === 1 && waitingM[0].openCents === dm.amountCents && (await transferAt(sentM.transferId)).amount_reversed === dm.amountCents, `${backM.status}`);
      await countHandReversal({ debtId: dm.id, adminId: admin, reversalId: waitingM[0].id, as: "paid", openWasCents: waitingM[0].openCents });
      check("the founder says it paid the take-back: she has paid exactly once", (await debtOf(rm.id)).status === "taken" && (await transferAt(sentM.transferId)).amount_reversed === dm.amountCents && (await ledgerOf(paidM.payment.id, "host_takeback")) === dm.amountCents);
    }

    // ----------------------------------------------------------------------
    console.log("\n8. A refund that is still on its way at Stripe (its test card for that): nothing is worked out until it is confirmed");
    {
      check("(Stripe took the refund and had not finished it)", pending.first.status === "in_progress" && pending.first.stripeRefundId !== null && pending.first.hostOwesCents === 0, `${pending.first.status}`);
      check("the founder is told that it is on its way, not that it was given back; no take-back is written; the page offers no second refund meanwhile", /on its way: Stripe has accepted it and has not confirmed it yet/.test(pendingEarly.answer) && !/was given back/.test(pendingEarly.answer) && pendingEarly.debts === 0 && pendingEarly.underWay === "accepted", pendingEarly.answer);
      check("(Stripe confirmed it by itself)", await stripeShows(pending.first.stripeRefundId!, "succeeded"));
      await reconcileOperations(new Date(), { operationIds: [], refundIds: [pending.refundId] });
      const confirmed = await refundRow(pending.refundId);
      check("the helper finishes it: confirmed, with what her share lost and its place among this payment's refunds", confirmed.status === "done" && confirmed.afterCollection && confirmed.hostOwesCents > 0 && confirmed.afterCollectionNo === 1 && (await reload(pending.payment.id)).refundedCents === 500, `${confirmed.status} ${confirmed.hostOwesCents}`);
      await pass(pending.refundId);
      const written = await debtOf(pending.refundId);
      check("and only then is the host's take-back written and told", written?.status === "told" && written.amountCents === confirmed.hostOwesCents && (await hostTold(written.id, "owed")).length === 1 && refundAnswer(await refundOutcome(pending.refundId), "founder").includes("and has been told"));
    }

    // ----------------------------------------------------------------------
    console.log("\n9. A refund that Stripe confirmed and that then failed (its test card for that): the host never pays for it");
    {
      check("(Stripe confirmed both refunds at first; both take-backs were written, and one was taken at once)", failsOpen.first.status === "done" && failsTaken.first.status === "done" && openDebt?.status === "told" && takenEarly.status === "taken" && takenEarly.reversed === takenDebt?.amountCents, `${openDebt?.status} ${takenEarly.status}`);
      check("(Stripe then failed both refunds by itself)", (await stripeShows(failsOpen.first.stripeRefundId!, "failed")) && (await stripeShows(failsTaken.first.stripeRefundId!, "failed")));

      // The first: its take-back is still open. The helper asks Stripe about the refund at the moment it would take the money.
      await passOnly(new Date(openDebt.dueAt!.getTime() + 60_000), failsOpen.refundId);
      await passOnly(new Date(openDebt.dueAt!.getTime() + 2 * DAYS), failsOpen.refundId);
      const undone = await refundRow(failsOpen.refundId);
      const called = await debtOf(failsOpen.refundId);
      check("nothing is taken for a refund that failed after all: the take-back is called off by the app, at no cost to anyone", called.status === "cancelled" && called.cancelledBy === null && (await transferAt(failsOpen.transferId)).amount_reversed === 0 && (await operationsOf(failsOpen.payment.id)).length === 0 && (await ledgerOf(failsOpen.payment.id, "connect_cost")) === 0 && (await ledgerOf(failsOpen.payment.id, "host_takeback")) === 0, `${called.status}`);
      const booksNow = await books(failsOpen.payment.id);
      check("the app's record of the refund is undone: the line says failed with Stripe's reason, the payment counts as not refunded again, and the books are as before it", undone.status === "failed" && undone.failedLateAt !== null && Boolean(undone.failure) && (await reload(failsOpen.payment.id)).refundedCents === failsOpen.before.payment.refundedCents && booksNow.refund === failsOpen.before.books.refund && booksNow.fee === failsOpen.before.books.fee && booksNow.share === failsOpen.before.books.share, `${undone.status} ${undone.failure}`);
      const fell = await hostTold(called.id, "fell-away");
      const toFounders = await failedLateMail(failsOpen.refundId);
      check("the host is told once that nothing is owed after all; each admin is told once that the customer did not get the money", fell.length === 1 && fell[0].body.includes("Nothing is taken for it") && toFounders.length === admins.length && toFounders.every((mail) => mail.body.includes("The customer did not get the money") && mail.body.includes("nothing was taken")), `${fell.length} ${toFounders.length}`);
      check("the founder's page now says that Stripe refused it, with Stripe's reason", /^Stripe refused the refund of \$5\.00 \(.+\)\. Nothing was given back\./.test(refundAnswer(await refundOutcome(failsOpen.refundId), "founder")), refundAnswer(await refundOutcome(failsOpen.refundId), "founder"));

      // The second: already taken from her when the refund failed. Stripe's message about it arrives (twice, as messages do).
      const message = { type: "refund.failed", data: { object: { id: failsTaken.first.stripeRefundId! } } };
      await handleStripeEvent(message);
      await handleStripeEvent(message);
      const kept = await debtOf(failsTaken.refundId);
      const owedToHer = await hostTold(kept.id, "fell-away");
      const toSend = await failedLateMail(failsTaken.refundId);
      check("already taken when the refund failed: Stripe's message undoes the refund, and the app gives nothing back by itself", (await refundRow(failsTaken.refundId)).status === "failed" && kept.status === "taken" && kept.leftoverToldAt !== null && (await transferAt(failsTaken.transferId)).amount_reversed === kept.amountCents && (await reload(failsTaken.payment.id)).refundedCents === failsTaken.before.payment.refundedCents, `${kept.status}`);
      check("she is told once that Connect owes it back to her, and each admin once to send it", owedToHer.length === 1 && owedToHer[0].subject.includes(`Connect owes you ${formatMoney(kept.amountCents)} back`) && toSend.length === admins.length && toSend.every((mail) => mail.body.includes(`send ${formatMoney(kept.amountCents)} to the host in Stripe`)), `${owedToHer.length} ${toSend.length}`);

      // The third: Stripe's message arrives while its take-back is being taken (the reversal was made at Stripe, its answer is not recorded yet).
      check("(Stripe failed the third refund too)", await stripeShows(failsTaking.first.stripeRefundId!, "failed"));
      await handleStripeEvent({ type: "refund.failed", data: { object: { id: failsTaking.first.stripeRefundId! } } });
      const waitingRow = await refundRow(failsTaking.refundId);
      check("the message comes while the take-back is being taken: nothing is undone at that moment, and the failure is kept on the refund's line", waitingRow.status === "done" && waitingRow.undoPendingAt !== null && Boolean(waitingRow.failure) && (await debtOf(failsTaking.refundId)).status === "taking", `${waitingRow.status}`);
      await age(takingStarted.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [takingStarted.operationId] });
      check("the helper finds the reversal Stripe had made and records it, and asks for nothing more for a refund that failed", (await debtOf(failsTaking.refundId)).status === "taken" && (await stripe().transfers.listReversals(failsTaking.transferId, { limit: 10 })).data.length === 1);
      await passOnly(new Date(), failsTaking.refundId);
      await passOnly(new Date(), failsTaking.refundId);
      const lateRow = await refundRow(failsTaking.refundId);
      const lateDebt = await debtOf(failsTaking.refundId);
      check("on the helper's next pass the kept failure is undone: the refund is failed, and she and each admin are told once that the money is owed back to her", lateRow.status === "failed" && lateRow.undoPendingAt === null && lateDebt.leftoverToldAt !== null && (await reload(failsTaking.payment.id)).refundedCents === failsTaking.before.payment.refundedCents && (await hostTold(lateDebt.id, "fell-away")).length === 1 && (await failedLateMail(failsTaking.refundId)).length === admins.length, `${lateRow.status}`);

      // The refund whose answer the app never recorded: Stripe paid it and then failed it.
      check("(Stripe failed the refund whose answer was never recorded)", await stripeShows(lostAtStripe.id, "failed"));
      const lostMessage = { type: "refund.failed", data: { object: { id: lostAtStripe.id, metadata: { refundId: lostId } } } };
      const keptForLater = await said(handleStripeEvent(lostMessage));
      const lostAtOnce = await refundRow(lostId);
      check("Stripe's message about a refund whose answer the app never recorded: it is failed for good at once, with Stripe's number and reason", keptForLater === "done" && lostAtOnce.status === "failed" && lostAtOnce.stripeRefundId === lostAtStripe.id && Boolean(lostAtOnce.failure), keptForLater);
      // (An older "paid", as the one who is still finding out would bring it, changes nothing.)
      await db.transaction(async (tx) => applyRefundDone(await lockPayment(tx, lostPaid.payment.id), lostId, lostAtStripe.id, tx));
      check("and an older \"paid\" for it is ignored", (await refundRow(lostId)).status === "failed" && (await reload(lostPaid.payment.id)).refundedCents === 0);
      await age(lostStarted.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [lostStarted.operationId] });
      const lostRow = await refundRow(lostId);
      const [lostAction] = await db.select().from(schema.moneyOperations).where(eq(schema.moneyOperations.id, lostStarted.operationId));
      check("the helper then ends the unanswered action as not done (it asks what the refund is NOW: failed). Nothing is recorded as refunded", lostAction.status === "failed" && lostRow.status === "failed" && Boolean(lostRow.failure) && (await reload(lostPaid.payment.id)).refundedCents === 0 && (await ledgerOf(lostPaid.payment.id, "customer_refund")) === 0, `${lostAction.status} ${lostRow.status} ${lostRow.failure}`);
      check("and the message, handled again, has nothing left to do", (await said(handleStripeEvent(lostMessage))) === "done");

      // The cents. The 8-cent refund fails first: the 50-cent refund then takes 46 cents off her share, not 47.
      const failed = (id: string) => handleStripeEvent({ type: "refund.failed", data: { object: { id } } });
      check("(the two take-backs were for 47 cents, and Stripe failed all four small refunds)", centSettled.debtB.amountCents === 47 && centWaived.debtB.amountCents === 47 && (await stripeShows(centSettled.a.stripeRefundId!, "failed")) && (await stripeShows(centSettled.b.stripeRefundId!, "failed")) && (await stripeShows(centWaived.a.stripeRefundId!, "failed")) && (await stripeShows(centWaived.b.stripeRefundId!, "failed")), `${centSettled.debtB.amountCents} ${centWaived.debtB.amountCents}`);
      // She had paid 47 cents: one cent is too much now, and only that cent is to give back.
      await failed(centSettled.a.stripeRefundId!);
      const oneCent = await failedLateMail(centSettled.a.id);
      check("she had settled the second for 47 cents: with the first gone 46 are owed, and each admin is told to give back the one cent, once", (await refundRow(centSettled.b.id)).hostOwesCents === 46 && (await debtOf(centSettled.b.id)).excessToldCents === 1 && oneCent.length === admins.length && oneCent.every((mail) => mail.body.includes("send $0.01 more to the host in Stripe")), `${(await refundRow(centSettled.b.id)).hostOwesCents} ${oneCent.length}`);
      // Then the second fails too: what is still to give back is 46 cents, not 47 again.
      await failed(centSettled.b.stripeRefundId!);
      const rest = await failedLateMail(centSettled.b.id);
      const restToHer = await hostTold(centSettled.debtB.id, "fell-away");
      check("then the second refund fails too: 46 cents more go back to her, so 47 in all and not 48", rest.length === admins.length && rest.every((mail) => mail.body.includes("send $0.46 to the host in Stripe")) && restToHer.length === 1 && restToHer[0].subject === "Connect owes you $0.46 back", `${rest.length} ${restToHer[0]?.subject}`);
      // The founder had called the second off: Connect's cost for it was 47 cents, and is 46 with the first gone.
      await failed(centWaived.a.stripeRefundId!);
      check("the founder had waived the second for 47 cents: with the first gone the books carry 46", (await ledgerOf(centWaived.payment.id, "connect_cost")) === 46 && (await debtOf(centWaived.b.id)).costBookedCents === 46 && (await failedLateMail(centWaived.a.id)).every((mail) => !mail.body.includes("more to the host")), `${await ledgerOf(centWaived.payment.id, "connect_cost")}`);
      await failed(centWaived.b.stripeRefundId!);
      check("and nothing once the second has failed too", (await ledgerOf(centWaived.payment.id, "connect_cost")) === 0 && (await ledgerOf(centWaived.payment.id, "host_takeback")) === 0);

      // She had paid a whole take-back to the bank account; the refund fails; the founder gives the money back and
      // refunds the customer a second time. The second refund's take-back is written for all of it again.
      check("(the take-back for all that was sent was settled in full outside the app, and Stripe failed the refund)", repaidDebt.amountCents === repaidSent.sentCents && (await debtOf(repaidRefund.id)).status === "settled" && (await stripeShows(repaidRefund.stripeRefundId!, "failed")));
      await failed(repaidRefund.stripeRefundId!);
      const backToHer = await hostTold(repaidDebt.id, "fell-away");
      check("she is told that all she paid is owed back to her", backToHer.length === 1 && backToHer[0].subject === `Connect owes you ${formatMoney(repaidDebt.amountCents)} back` && (await reload(repaidPaid.payment.id)).refundedCents === 0);
      // (Stripe's test card refuses a second refund of a charge whose refund failed. So the second refund's line is
      // the script's, as in part 6: it points at a real, confirmed refund of another test charge.)
      const secondTime = await refundLine(repaidPaid.payment.id, repaidSent.sentCents, repaidSent.sentCents);
      await pass(secondTime);
      const secondDebt = await debtOf(secondTime);
      check("the customer is refunded a second time: its take-back is for all that was sent again, not for nothing because of the payment that goes back to her", secondDebt?.status === "told" && secondDebt.amountCents === repaidSent.sentCents, `${secondDebt?.status} ${secondDebt?.amountCents}`);

      // The refund given before she collected: she was sent the smaller share, and then the refund failed.
      check("(the early refund was an ordinary one, and she collected the share it had made smaller)", earlyRefund.status === "done" && !earlyRefund.afterCollection && earlySent.sentCents > 0 && earlySent.sentCents < earlyBefore.share, `${earlySent.sentCents} of ${earlyBefore.share}`);
      check("(Stripe failed that refund too)", await stripeShows(earlyRefund.stripeRefundId!, "failed"));
      await handleStripeEvent({ type: "refund.failed", data: { object: { id: earlyRefund.stripeRefundId! } } });
      await handleStripeEvent({ type: "refund.failed", data: { object: { id: earlyRefund.stripeRefundId! } } });
      // What the collection was short of: her share with no refund, less what was sent. The later refund does not come into it.
      const underpaid = earlyBefore.share - earlySent.sentCents;
      const laterRow = await refundRow(earlyAfter.id);
      const laterDebt = await debtOf(earlyAfter.id);
      check("the refund given after she collected is worked out again without the failed one, and its take-back is not raised", laterRow.hostOwesCents === earlyBefore.share - currentSplit(await reload(earlyPaid.payment.id)).hostShareCents && laterDebt.amountCents <= earlyAfterDebt.amountCents && laterDebt.amountCents <= laterRow.hostOwesCents && ["told", "cancelled"].includes(laterDebt.status), `${earlyAfterDebt.amountCents} -> ${laterDebt.amountCents} (${laterRow.hostOwesCents})`);
      const earlyBooks = await books(earlyPaid.payment.id);
      const toHer = await db.select().from(schema.messages).where(like(schema.messages.key, `refund-failed-late:${earlyRefund.id}:host:%`));
      const toThem = await failedLateMail(earlyRefund.id);
      check("a refund given before she collected fails after all: the books are as before it, and her share is whole again there", (await refundRow(earlyRefund.id)).status === "failed" && (await reload(earlyPaid.payment.id)).refundedCents === 300 && earlyBooks.refund === earlyBefore.books.refund - 300 && (await refundRow(earlyRefund.id)).underpaidCents === underpaid);
      check("what was never sent to her is told, once, with the amount: to her, and to each admin to send it", toHer.length === 1 && toHer[0].subject === `Connect owes you ${formatMoney(underpaid)}` && toThem.length === admins.length && toThem.every((mail) => mail.body.includes(`so ${formatMoney(underpaid)} of their share was never sent to them`)) && (await debtsFor(earlyRefund.id)).length === 0, `${formatMoney(underpaid)} ${toHer.length} ${toThem.length}`);

      // The refund whose line said "on its way" with Stripe's number: Stripe's failure is written under the payment's
      // lock, and a "paid" that somebody read a moment earlier cannot be written over it afterwards.
      check("(Stripe failed that one too)", await stripeShows(knownAtStripe.id, "failed"));
      await handleStripeEvent({ type: "refund.failed", data: { object: { id: knownAtStripe.id } } });
      const knownRow = await refundRow(knownId);
      await db.transaction(async (tx) => applyRefundDone(await lockPayment(tx, knownPaid.payment.id), knownId, knownAtStripe.id, tx));
      check("a refund on its way that Stripe fails is marked failed at once; an older \"paid\" arriving afterwards changes nothing", knownRow.status === "failed" && Boolean(knownRow.failure) && (await refundRow(knownId)).status === "failed" && (await reload(knownPaid.payment.id)).refundedCents === 0 && (await ledgerOf(knownPaid.payment.id, "customer_refund")) === 0, `${knownRow.status}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n10. A stale answer, a request that was never sent, and a refund found on a later page of Stripe's list");
    {
      // A "paid" for a refund that has since been undone, as a second helper brings it who read Stripe a moment earlier.
      const was = { payment: await reload(failsOpen.payment.id), books: await books(failsOpen.payment.id) };
      await db.transaction(async (tx) => applyRefundDone(await lockPayment(tx, failsOpen.payment.id), failsOpen.refundId, failsOpen.first.stripeRefundId!, tx));
      const still = await books(failsOpen.payment.id);
      check("a late \"paid\" does not bring a failed refund back: its line, the payment and the books stay as they are", (await refundRow(failsOpen.refundId)).status === "failed" && (await reload(failsOpen.payment.id)).refundedCents === was.payment.refundedCents && still.refund === was.books.refund && still.fee === was.books.fee && still.share === was.books.share);

      // Written down, and then not sent within its time (as when the one who wrote it down hangs).
      const paidN = await charged(host, await person("customer"), CARD);
      const idN = randomUUID();
      refundIds.push(idN);
      const planN = refundPlan({ paymentId: paidN.payment.id, amountCents: 200, decidedBy: admin, decidedAs: "admin", reason: null, requestId: idN }, idN);
      const startedN = await db.transaction((tx) => startMoneyOperation(tx, planN));
      if (startedN === "already_done") throw new Error("The refund was already done.");
      const tooLate = await said(completeMoneyOperation({ ...startedN, params: { ...startedN.params, sendByMs: Date.now() - 1 } }, planN));
      check("a refund that was written down and not sent in time is not sent at all: Stripe is asked for nothing, and it is recorded as not done", /^money: The refund was not sent to Stripe in time/.test(tooLate) && (await refundRow(idN)).status === "failed" && (await stripe().refunds.list({ payment_intent: paidN.payment.stripePaymentIntentId!, limit: 3 })).data.length === 0, tooLate);

      // The same, as it really goes when the writer hangs for longer than its time: by then the action is no longer
      // young enough for the writer to call it "not done" by itself. It is left open, and the helper sends it.
      const idO = randomUUID();
      refundIds.push(idO);
      const planO = refundPlan({ paymentId: paidN.payment.id, amountCents: 150, decidedBy: admin, decidedAs: "admin", reason: null, requestId: idO }, idO);
      const startedO = await db.transaction((tx) => startMoneyOperation(tx, planO));
      if (startedO === "already_done") throw new Error("The refund was already done.");
      await age(startedO.operationId, 40_000);
      const hung = await said(completeMoneyOperation({ ...startedO, params: { ...startedO.params, sendByMs: Date.now() - 1 } }, planO));
      check("a writer that hangs past its time sends nothing and leaves the refund open: it is not known yet, and nothing is at Stripe", /^unknown: /.test(hung) && (await refundRow(idO)).status === "in_progress" && (await stripe().refunds.list({ payment_intent: paidN.payment.stripePaymentIntentId!, limit: 3 })).data.length === 0 && refundAnswer(await refundOutcome(idO), "founder").includes("what came of it at Stripe is not confirmed yet"), hung);
      await age(startedO.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [startedO.operationId] });
      check("the helper sends it under the same label, once, and records it", (await refundRow(idO)).status === "done" && (await stripe().refunds.list({ payment_intent: paidN.payment.stripePaymentIntentId!, limit: 3 })).data.length === 1 && (await reload(paidN.payment.id)).refundedCents === 150);

      // A refund whose answer was lost, with more than a hundred newer refunds of the same charge before it in Stripe's list.
      const idP = randomUUID();
      refundIds.push(idP);
      const planP = refundPlan({ paymentId: paidN.payment.id, amountCents: 100, decidedBy: admin, decidedAs: "admin", reason: null, requestId: idP }, idP);
      const startedP = await db.transaction((tx) => startMoneyOperation(tx, planP));
      if (startedP === "already_done") throw new Error("The refund was already done.");
      await stripe().refunds.create({ payment_intent: paidN.payment.stripePaymentIntentId!, amount: 100, metadata: { paymentId: paidN.payment.id, refundId: idP } }, { idempotencyKey: startedP.label });
      for (let made = 0; made < 101; made++) await stripe().refunds.create({ payment_intent: paidN.payment.stripePaymentIntentId!, amount: 1 });
      const firstPage = await stripe().refunds.list({ payment_intent: paidN.payment.stripePaymentIntentId!, limit: 100 });
      // Too old to ask again under its label: only Stripe's list can say what happened.
      await age(startedP.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [startedP.operationId] });
      const [finished] = await db.select().from(schema.moneyOperations).where(eq(schema.moneyOperations.id, startedP.operationId));
      check("a refund whose answer was lost is found on the second page of Stripe's list, and recorded as paid, once", firstPage.has_more && !firstPage.data.some((one) => one.metadata?.refundId === idP) && (await refundRow(idP)).status === "done" && finished.status === "succeeded" && (await reload(paidN.payment.id)).refundedCents === 250, `${(await refundRow(idP)).status} ${finished.status}`);

      // A refund that was written down and never reached Stripe, looked at when it is too old to be sent again but a
      // repeat somebody else sent at the last moment could still be on its way: not called failed yet.
      const idQ = randomUUID();
      refundIds.push(idQ);
      const planQ = refundPlan({ paymentId: paidN.payment.id, amountCents: 10, decidedBy: admin, decidedAs: "admin", reason: null, requestId: idQ }, idQ);
      const startedQ = await db.transaction((tx) => startMoneyOperation(tx, planQ));
      if (startedQ === "already_done") throw new Error("The refund was already done.");
      await age(startedQ.operationId, 23.5 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [startedQ.operationId] });
      const [openQ] = await db.select().from(schema.moneyOperations).where(eq(schema.moneyOperations.id, startedQ.operationId));
      check("too old to send again, and not found at Stripe: left open for an hour more, because a last repeat could still be on its way", openQ.status === "started" && (await refundRow(idQ)).status === "in_progress");
      await age(startedQ.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [startedQ.operationId] });
      const [closedQ] = await db.select().from(schema.moneyOperations).where(eq(schema.moneyOperations.id, startedQ.operationId));
      check("after that it is final: not done, and nothing was given back for it", closedQ.status === "failed" && (await refundRow(idQ)).status === "failed" && (await reload(paidN.payment.id)).refundedCents === 250);
    }
  } finally {
    // What THIS run made, by the exact ids: what is left of the shares it sent is taken back, the messages, emails and
    // admin actions about its own take-backs are removed, and nothing of it is left for the helper to act on later.
    for (const id of disputes) {
      const current = await stripe().disputes.retrieve(id).catch(() => null);
      if (current?.status === "needs_response") await stripe().disputes.close(id).catch(() => undefined);
    }
    if (disputes.length > 0) {
      const theirs = await db.select({ id: debts.id }).from(debts).where(inArray(debts.disputeId, disputes));
      const keys = [...disputes.map((id) => `dispute:${id}:%`), ...theirs.map((row) => `takeback:${row.id}:%`)];
      await db.delete(schema.messages).where(or(...keys.map((key) => like(schema.messages.key, key))));
      await db.delete(schema.emailOutbox).where(or(...keys.map((key) => like(schema.emailOutbox.dedupeKey, key))));
      await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(inArray(debts.disputeId, disputes), inArray(debts.status, ["told", "objected", "answered"])));
    }
    for (const id of transfers) {
      const transfer = await stripe().transfers.retrieve(id).catch(() => null);
      const left = transfer ? transfer.amount - transfer.amount_reversed : 0;
      if (left > 0) await stripe().transfers.createReversal(id, { amount: left }).catch(() => undefined);
    }
    if (refundIds.length > 0) {
      const mine = await db.select({ id: debts.id }).from(debts).where(inArray(debts.refundId, refundIds));
      if (mine.length > 0) {
        const keys = mine.map((row) => `takeback:${row.id}:%`);
        await db.delete(schema.messages).where(or(...keys.map((key) => like(schema.messages.key, key))));
        await db.delete(schema.emailOutbox).where(or(...keys.map((key) => like(schema.emailOutbox.dedupeKey, key))));
        await db.delete(schema.adminActions).where(inArray(schema.adminActions.targetId, mine.map((row) => row.id)));
        await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(inArray(debts.refundId, refundIds), inArray(debts.status, ["told", "objected", "answered", "waiting"])));
      }
      // A refund of this run that was never looked at is not left for the helper either.
      await db.update(schema.refunds).set({ debtLookedAt: new Date() }).where(and(inArray(schema.refunds.id, refundIds), isNull(schema.refunds.debtLookedAt)));
    }
    if (refundIds.length > 0) {
      // A money action of this run that is still unanswered (the run stopped in the middle, say) is ended here, with
      // its refund and its take-back: a helper that comes by later must find nothing of this run to send or to take.
      const paymentIds = [...new Set((await db.select({ paymentId: schema.refunds.paymentId }).from(schema.refunds).where(inArray(schema.refunds.id, refundIds))).map((row) => row.paymentId))];
      if (paymentIds.length > 0) {
        const left = await db
          .update(schema.moneyOperations)
          .set({ status: "failed", error: "left unanswered by the owed check; ended by its clean-up", finishedAt: new Date() })
          .where(and(inArray(schema.moneyOperations.paymentId, paymentIds), eq(schema.moneyOperations.status, "started")))
          .returning({ id: schema.moneyOperations.id, kind: schema.moneyOperations.kind });
        if (left.length > 0) console.log(`(The clean-up ended ${left.length} unanswered money action(s) of this run: ${left.map((one) => one.kind).join(", ")}. Look at Stripe's test area if one of them may have gone out.)`);
        await db.update(schema.refunds).set({ status: "failed", finishedAt: new Date() }).where(and(inArray(schema.refunds.id, refundIds), eq(schema.refunds.status, "in_progress")));
        await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(inArray(debts.paymentId, paymentIds), eq(debts.status, "taking")));
        await db.delete(schema.emailOutbox).where(or(...paymentIds.map((id) => like(schema.emailOutbox.dedupeKey, `refund-totals:${id}:%`))));
      }
      await db.delete(schema.emailOutbox).where(or(...refundIds.map((id) => like(schema.emailOutbox.dedupeKey, `refund-failed-late:${id}:%`))));
      await db.delete(schema.messages).where(or(...refundIds.map((id) => like(schema.messages.key, `refund-failed-late:${id}:%`))));
    }
    await db.delete(schema.agreementAcceptances).where(or(eq(schema.agreementAcceptances.version, published.version), like(schema.agreementAcceptances.userId, `ow-${RUN}-%`)));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
