/**
 * Testing tool for taking a share back after a lost bank dispute (plans/47-bank-disputes.md, part 3), and for
 * the 14 days from the notice really sent and the host's objection (plans/46-part-3-money-owed.md, decision 6).
 *
 * It makes real charges, disputes, transfers and reversals in Stripe's test area and checks every
 * result at Stripe and in the local database. No real money moves. It makes its own host and
 * customers. The shares it sends go to the test host's payout account (host@test.local) straight
 * from this script, so that account's owner is not changed; whatever is left of those transfers at
 * the end is taken back, and the messages and emails about its own disputes are removed.
 *
 * Stripe's test area cannot turn a lost dispute into a won one, so "the bank decided the other way
 * after all" is tried by writing that into the local record.
 *
 * Usage: npx tsx scripts/dispute-takeback-check.ts
 *        npx tsx scripts/dispute-takeback-check.ts --demo       host@test.local gets one take-back that has its notice
 *        npx tsx scripts/dispute-takeback-check.ts --demo-off   calls it off and takes its messages and emails away
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
  const { applyTransferSent, currentSplit, transferAtStripe } = await import("../src/lib/payments/actions");
  const { MoneyError, runMoneyOperation, startMoneyOperation } = await import("../src/lib/payments/operations");
  const { reconcileOperations } = await import("../src/lib/payments/jobs");
  const { getHostSettings, refreshPayoutsReady } = await import("../src/lib/payments/hosts");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { lookAtOpenDisputes } = await import("../src/lib/disputes/record");
  const { answerObjection, cancelDebt, countHandReversal, DebtError, holdDebt, objectToDebt, reverseAtStripe, sendNoticeAgain, settleOutside, takeBackPass, takePlan, debtsOfDispute, debtsOfHost } = await import("../src/lib/disputes/takeback");
  const { recordEmailEvent } = await import("../src/lib/notifications/provider-events");
  const { AFTER_ANSWER_MS, NOTICE_MS, RETRY_MS, TELL_FOUNDER_AFTER_MS } = await import("../src/lib/disputes/takeback-rules");

  const [seeded] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  const account = seeded ? (await getHostSettings(seeded.id))?.stripeAccountId : null;
  if (!seeded || !account || !(await refreshPayoutsReady(seeded.id))) throw new Error("Set up payouts for host@test.local on the Hosting page first (`npm run seed`).");

  const RUN = randomUUID().slice(0, 8);
  const stamp = new Date();
  let people = 0;
  const person = async (label: string) => {
    const id = `tb-${RUN}-${++people}`;
    const [row] = await db
      .insert(schema.user)
      .values({ id, name: `Takeback check ${label} ${people}`, email: `takebackcheck-${RUN}-${people}@example.test`, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" })
      .returning();
    return row;
  };
  type Person = Awaited<ReturnType<typeof person>>;
  const admins = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
  const made: string[] = [];
  const transfers: string[] = [];
  const debts = schema.hostDebts;

  const reload = async (id: string) => (await db.select().from(schema.payments).where(eq(schema.payments.id, id)))[0];
  const disputeRow = async (id: string) => (await db.select().from(schema.disputes).where(eq(schema.disputes.id, id)))[0];
  const debtsFor = (disputeId: string) => db.select().from(debts).where(eq(debts.disputeId, disputeId));
  const debtOf = async (disputeId: string) => (await debtsFor(disputeId))[0];
  const messagesOf = (debtId: string) => db.select().from(schema.messages).where(like(schema.messages.key, `takeback:${debtId}:%`));
  const emailsOf = (debtId: string) => db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `takeback:${debtId}:%`));
  const operationsOf = (paymentId: string) => db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, paymentId), eq(schema.moneyOperations.kind, "take_back"))).orderBy(schema.moneyOperations.createdAt);
  const ledgerOf = async (paymentId: string, kind: string) => (await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.paymentId, paymentId), eq(schema.ledgerEntries.kind, kind)))).reduce((sum, line) => sum + line.amountCents, 0);
  const transferAt = (id: string) => stripe().transfers.retrieve(id);
  const pause = (ms = 2000) => new Promise((resolve) => setTimeout(resolve, ms));
  const message = (type: string, disputeId: string) => ({ type, data: { object: { id: disputeId } } });
  let looks = 0;
  const helperLooks = (...disputeIds: string[]) => lookAtOpenDisputes(new Date(Date.now() + 120_000 * ++looks), { disputeIds });
  /** The helper's pass alone, with nothing sent: a take-back gets its due day only once its notice email has gone out. */
  const passOnly = (at: Date, ...disputeIds: string[]) => takeBackPass(at, { disputeIds });
  /**
   * In the place of the sending service: the notice (or the answer to an objection) of these disputes' take-backs that
   * is still waiting is marked as sent and as reported delivered, at the moment the row was written (or the answer
   * was given) unless a moment is named. Exactly those emails, by their own numbers; no other email in the database is touched.
   */
  async function sendNotices(disputeIds: string[], sentAt?: Date) {
    const waiting = await db.select().from(debts).where(and(inArray(debts.disputeId, disputeIds), isNull(debts.dueAt), inArray(debts.status, ["told", "answered"])));
    for (const row of waiting) {
      const emailId = row.status === "answered" ? row.answerEmailId : row.noticeEmailId;
      if (!emailId) continue;
      await db
        .update(schema.emailOutbox)
        .set((() => {
          const at = sentAt ?? (row.status === "answered" ? (row.answeredAt ?? new Date()) : row.toldAt);
          return { status: "sent", sentAt: at, deliveredAt: at };
        })())
        .where(and(eq(schema.emailOutbox.id, emailId), eq(schema.emailOutbox.status, "queued")));
    }
  }
  /** One pass as it goes with a sending service that works: what is owed is written, its notice goes out, and it gets its day. */
  const pass = async (at: Date, ...disputeIds: string[]) => {
    await passOnly(at, ...disputeIds);
    await sendNotices(disputeIds);
    // The helper's own pass once more, as of long ago: it gives the due days (which is part of every pass), and
    // nothing can be due or be tried at Stripe at that moment. So one `pass` stays one try at Stripe, and the due
    // days still come from the real pass: if the helper stopped giving them, every check below would fail.
    await passOnly(new Date(0), ...disputeIds);
  };
  /**
   * The taking itself, without the helper's look before it. That look holds a take-back whose transfer has a reversal
   * made by hand that nobody has accounted for; these checks want Stripe's own "no", as it comes when such a reversal
   * is made in the moment between that look and the app's request. A refusal for a reason a person can read (not due,
   * refused by Stripe) is the expected end and is not an error here.
   */
  const takeDirect = (debt: { id: string; paymentId: string }, at: Date) =>
    runMoneyOperation(takePlan(debt, at)).catch((error) => {
      if (!(error instanceof MoneyError)) throw error;
    });
  /** Makes an unanswered money action look older, as if the helper had been away. */
  const age = (operationId: string, ms: number) => db.update(schema.moneyOperations).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.moneyOperations.id, operationId));

  /** A charged call paid with one of Stripe's dispute cards. Nothing is told to the app about the dispute yet. */
  async function charged(host: Person, customer: Person, card: string) {
    const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + 10 * 60_000);
    const { call, payment } = await db.transaction(async (tx) => {
      const [newCall] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt, roomName: `takebackcheck-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
      await createPaymentForCall(tx, newCall);
      const [paid] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, newCall.id));
      return { call: newCall, payment: paid };
    });
    await startHold({ payment, call, customer, now: new Date() });
    await stripe().paymentIntents.confirm((await reload(payment.id)).stripePaymentIntentId!, { payment_method: card, return_url: "https://example.com/return" });
    await syncHold(payment.id, new Date());
    for (const [who, identity] of [["host", host.id], ["customer", customer.id]] as const) {
      const session = `PA_${who}_${randomUUID().slice(0, 6)}`;
      const row = (type: string, time: Date) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_takebackcheck", participantIdentity: identity, participantSessionId: session, providerTime: time, payload: "{}" });
      await db.insert(schema.attendanceEvents).values([row("participant_joined", startsAt), row("participant_left", endsAt)]);
    }
    await db.update(schema.calls).set({ closedAt: new Date(endsAt.getTime() + 60_000) }).where(eq(schema.calls.id, call.id));
    await settleOrdinaryCharges(call.id, new Date(startsAt.getTime() + (24 * 60 + 3) * 60_000));
    const taken = await reload(payment.id);
    if (taken.status !== "charged") throw new Error(`The test call was not charged (${taken.status}).`);
    return { call, payment: taken };
  }

  /** The disputes Stripe opened on a charge (it takes a moment), at least this many. */
  async function disputesOn(intentId: string, atLeast = 1) {
    let found: string[] = [];
    for (let i = 0; i < 30 && found.length < atLeast; i++) {
      found = (await stripe().disputes.list({ payment_intent: intentId, limit: 10 })).data.map((dispute) => dispute.id);
      if (found.length < atLeast) await pause();
    }
    if (found.length < atLeast) throw new Error("Stripe opened no dispute on the test charge.");
    made.push(...found);
    return found;
  }

  /** The host collects: the share is really sent at Stripe (to the test payout account) and recorded as the app records it. */
  async function collect(paymentId: string) {
    const payment = await reload(paymentId);
    const params = { amountCents: currentSplit(payment).hostShareCents, payoutFeeCents: 0, destination: account!, group: payment.callId! };
    const transferId = await transferAtStripe(payment, params, `takebackcheck:${payment.id}`);
    await db.transaction((tx) => applyTransferSent(payment, params, transferId, tx));
    transfers.push(transferId!);
    return { transferId: transferId!, sentCents: params.amountCents };
  }

  /** The app is told of the dispute, the dispute is given up at Stripe, and the app's look records the loss. */
  async function lose(disputeId: string) {
    await handleStripeEvent(message("charge.dispute.created", disputeId));
    await stripe().disputes.close(disputeId);
    await handleStripeEvent(message("charge.dispute.closed", disputeId));
    await helperLooks(disputeId);
    const row = await disputeRow(disputeId);
    if (row?.outcome !== "lost") throw new Error(`The test dispute was not recorded as lost (${row?.status}).`);
    return row;
  }

  /** A share that was collected, and a dispute over its payment that is lost afterwards. */
  async function collectedThenLost(host: Person, customer: Person) {
    const paid = await charged(host, customer, "pm_card_createDispute");
    const [disputeId] = await disputesOn(paid.payment.stripePaymentIntentId!);
    const sent = await collect(paid.payment.id);
    await lose(disputeId);
    return { ...paid, disputeId, ...sent };
  }

  // For a look in the browser: host@test.local collected a share, the dispute over it was lost, and the take-back has
  // its notice. And taking that away again. What the demo made is known by its host and its room name.
  if (process.argv.includes("--demo") || process.argv.includes("--demo-off")) {
    const [seededCustomer] = await db.select().from(schema.user).where(eq(schema.user.email, "customer@test.local"));
    if (!seededCustomer) throw new Error("Run `npm run seed` first.");
    if (process.argv.includes("--demo")) {
      const c = await collectedThenLost(seeded, seededCustomer);
      await pass(new Date(), c.disputeId);
      const debt = await debtOf(c.disputeId);
      console.log(`Made: a lost dispute whose share (${debt?.amountCents} cents) is taken back from host@test.local from ${debt?.dueAt!.toISOString()}: /disputes/${c.disputeId}, and "Your earnings" on /host.`);
    } else {
      const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(and(eq(schema.calls.hostId, seeded.id), like(schema.calls.roomName, "takebackcheck-%")));
      for (const call of calls) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
        if (!payment) continue;
        const rows = await db.select().from(debts).where(eq(debts.paymentId, payment.id));
        // Nothing of the demo is left for the helper to take, and what is left of the share it sent is taken back here.
        await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(debts.paymentId, payment.id), inArray(debts.status, ["told", "objected", "answered"])));
        if (payment.stripeTransferId) {
          const transfer = await stripe().transfers.retrieve(payment.stripeTransferId).catch(() => null);
          const left = transfer ? transfer.amount - transfer.amount_reversed : 0;
          if (left > 0) await stripe().transfers.createReversal(payment.stripeTransferId, { amount: left }).catch(() => undefined);
        }
        const disputes = await db.select({ id: schema.disputes.id }).from(schema.disputes).where(eq(schema.disputes.paymentId, payment.id));
        const keys = [...disputes.map((dispute) => `dispute:${dispute.id}:%`), ...rows.map((row) => `takeback:${row.id}:%`)];
        if (keys.length > 0) {
          await db.delete(schema.messages).where(or(...keys.map((key) => like(schema.messages.key, key))));
          await db.delete(schema.emailOutbox).where(or(...keys.map((key) => like(schema.emailOutbox.dedupeKey, key))));
        }
        console.log(`Taken away: the demo's take-back${rows.length === 1 ? "" : "s"} for call ${call.id} (${rows.length}), with the messages and emails.`);
      }
    }
    process.exit(0);
  }

  try {
    const host = await person("host");
    const customerOfNobody = await person("somebody else");
    const NOW = new Date();

    // ----------------------------------------------------------------------
    console.log("\n1. A share was collected, then its dispute is lost: told once, taken after 14 days and not before");
    {
      const customer = await person("customer");
      const c = await collectedThenLost(host, customer);
      check("(the share was really sent: $12.38)", c.sentCents === 1238 && (await transferAt(c.transferId)).amount === 1238 && (await reload(c.payment.id)).transferStatus === "sent");
      await pass(NOW, c.disputeId);
      await pass(NOW, c.disputeId);
      const rows = await debtsFor(c.disputeId);
      const debt = rows[0];
      check("one take-back for the dispute and the share, however often the look runs", rows.length === 1 && debt.status === "told" && debt.paymentId === c.payment.id && debt.hostId === host.id && debt.stripeTransferId === c.transferId, `${rows.length} ${debt?.status}`);
      check("the whole share is owed: the bank took the whole payment", debt.amountCents === 1238 && JSON.parse(debt.basis).disputedCents === 1333 && JSON.parse(debt.basis).chargeLeftCents === 1333 && JSON.parse(debt.basis).transferLeftCents === 1238, debt.basis);
      check("it is due 14 days after its notice email went out (here: at the moment the notice was written)", debt.dueAt!.getTime() === debt.toldAt.getTime() + NOTICE_MS && debt.firstDueAt?.getTime() === debt.dueAt!.getTime() && debt.noticeEmailId !== null && debt.toldAt.getTime() >= NOW.getTime() && debt.toldAt.getTime() - NOW.getTime() < 60_000);
      const told = await messagesOf(debt.id);
      check("the host is told once, in the app and by email: which payment, how much, from when, and where to object", told.length === 1 && told[0].userId === host.id && told[0].body.includes("$12.38") && told[0].body.includes("You had already collected your share") && told[0].body.includes("Until then nothing is taken") && told[0].body.includes("write to us at") && told[0].path === `/disputes/${c.disputeId}` && (await emailsOf(debt.id)).filter((mail) => mail.dedupeKey === told[0].key).length === 1, told[0]?.body.slice(0, 200));
      check("the customer is told nothing about it", told.every((one) => one.userId !== customer.id));
      const toFounders = (await emailsOf(debt.id)).filter((mail) => mail.dedupeKey?.includes(":owed:founder:"));
      check("each admin gets one email: what the app will do, and that it can be cancelled", toFounders.length === admins.length && toFounders.every((mail) => mail.body.includes("cancel the take-back on the dispute's page") && mail.body.includes("The host can object with a button") && mail.body.includes(`/disputes/${c.disputeId}`)), toFounders.length);
      check("the host's earnings and the dispute's page show it", (await debtsOfHost(host.id)).some((one) => one.id === debt.id && one.path === `/disputes/${c.disputeId}`) && (await debtsOfDispute(c.disputeId)).length === 1);

      await pass(new Date(debt.dueAt!.getTime() - 1000), c.disputeId);
      check("a second before the 14 days are over, nothing is taken", (await transferAt(c.transferId)).amount_reversed === 0 && (await debtOf(c.disputeId)).status === "told" && (await operationsOf(c.payment.id)).length === 0);
      await pass(debt.dueAt!, c.disputeId);
      const after = await debtOf(c.disputeId);
      const atStripe = await transferAt(c.transferId);
      const reversals = (await stripe().transfers.listReversals(c.transferId, { limit: 10 })).data;
      check("at 14 days it is taken: the row says so, with Stripe's reversal", after.status === "taken" && after.takenAt !== null && after.stripeReversalId === reversals[0]?.id, `${after.status} ${after.refusal ?? ""}`);
      check("the reversal is real at Stripe: the right amount, out of the right transfer, with the take-back's id on it", atStripe.amount_reversed === 1238 && reversals.length === 1 && reversals[0].amount === 1238 && reversals[0].metadata?.debtId === debt.id, `${atStripe.amount_reversed} ${reversals.length}`);
      const operations = await operationsOf(c.payment.id);
      check("it went through the steps of a money action: one, succeeded, under the take-back's own label", operations.length === 1 && operations[0].status === "succeeded" && operations[0].label === `takeback:${debt.id}:1` && operations[0].stripeId === after.stripeReversalId);
      check("the money record adds up: $12.38 sent, $12.38 taken back", (await ledgerOf(c.payment.id, "host_transfer")) === -1238 && (await ledgerOf(c.payment.id, "host_takeback")) === 1238);
      check("the host is told that it was taken", (await messagesOf(debt.id)).some((one) => one.key.includes(":taken:") && one.body.includes("Stripe has taken $12.38 back")));
      await pass(new Date(debt.dueAt!.getTime() + 3 * RETRY_MS), c.disputeId);
      check("nothing is ever taken a second time", (await transferAt(c.transferId)).amount_reversed === 1238 && (await operationsOf(c.payment.id)).length === 1 && (await debtsFor(c.disputeId)).length === 1);
      check("a take-back that was taken cannot be cancelled", (await cancelDebt({ debtId: debt.id, adminId: admins[0]?.id ?? host.id })) === false && (await debtOf(c.disputeId)).status === "taken");

      // Taken, and then the bank decides the other way (written into the local record: the test area cannot do it).
      await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, c.disputeId));
      await pass(new Date(debt.dueAt!.getTime() + 4 * RETRY_MS), c.disputeId);
      await pass(new Date(debt.dueAt!.getTime() + 5 * RETRY_MS), c.disputeId);
      const leftover = await messagesOf(debt.id);
      check("taken, and then the dispute is won: the app gives nothing back by itself, and the host is told once that a person will", (await debtOf(c.disputeId)).status === "taken" && (await debtOf(c.disputeId)).leftoverToldAt !== null && leftover.filter((one) => one.key.includes(":leftover:")).length === 1 && leftover.some((one) => one.key.includes(":leftover:") && one.body.includes("A person at Connect will look at this")) && (await transferAt(c.transferId)).amount_reversed === 1238);
      check("and each admin is told once that this one needs them", (await emailsOf(debt.id)).filter((mail) => mail.dedupeKey?.includes(":leftover:founder:") && mail.body.includes("This one needs you")).length === admins.length);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. What makes no take-back: a share that was not collected, one whose collection sent nothing, a dispute Stripe does not show as lost");
    {
      const customer = await person("customer");
      const paid = await charged(host, customer, "pm_card_createDispute");
      const [disputeId] = await disputesOn(paid.payment.stripePaymentIntentId!);
      await lose(disputeId);
      await pass(NOW, disputeId);
      check("a share that was never collected has no take-back: it simply stays held back", (await debtsFor(disputeId)).length === 0 && (await reload(paid.payment.id)).disputeOpen === true);
      await db.update(schema.payments).set({ transferStatus: "sent", transferCents: 0, stripeTransferId: null }).where(eq(schema.payments.id, paid.payment.id));
      await pass(NOW, disputeId);
      check("nor has a share whose collection sent nothing", (await debtsFor(disputeId)).length === 0);
      await db.update(schema.payments).set({ transferStatus: "not_due", transferCents: null }).where(eq(schema.payments.id, paid.payment.id));

      // A loss that arrives while the transfer is still written down and not yet sent: the row appears once the transfer is through.
      const sent = await collect(paid.payment.id);
      await pass(NOW, disputeId);
      const late = await debtOf(disputeId);
      check("a share whose transfer went through only after the loss is found on a later look", late?.status === "told" && late.amountCents === sent.sentCents && (await messagesOf(late.id)).length === 1, late?.status);

      // A dispute the local record calls lost, while Stripe still shows it open (the record was wrong, or an appeal began).
      const customer2 = await person("customer");
      const open = await charged(host, customer2, "pm_card_createDispute");
      const [openId] = await disputesOn(open.payment.stripePaymentIntentId!);
      await collect(open.payment.id);
      await handleStripeEvent(message("charge.dispute.created", openId));
      await db.update(schema.disputes).set({ outcome: "lost", status: "lost", endedAt: new Date(), lookAgain: false }).where(eq(schema.disputes.id, openId));
      await pass(NOW, openId);
      check("nothing is written for a dispute Stripe does not show as lost; the record is marked to be read again", (await debtsFor(openId)).length === 0 && (await disputeRow(openId)).lookAgain === true);
      await stripe().disputes.close(openId);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Two lost disputes on one charge: together never more than was sent");
    {
      const customer = await person("customer");
      const paid = await charged(host, customer, "pm_card_createMultipleDisputes");
      const both = await disputesOn(paid.payment.stripePaymentIntentId!, 2);
      const sent = await collect(paid.payment.id);
      for (const id of both) await lose(id);
      await pass(NOW, ...both);
      await pass(NOW, ...both);
      const rows = (await db.select().from(debts).where(inArray(debts.disputeId, both))).sort((a, b) => b.amountCents - a.amountCents);
      check("(Stripe opened two disputes on the charge, both lost)", both.length === 2);
      // Stripe's test card disputes a part of the charge with each of the two.
      const parts = rows.map((row) => JSON.parse(row.basis) as { disputedCents: number; chargeLeftCents: number; sentCents: number });
      check("each dispute was over a part of the charge, and takes the same part of the share, rounded down", rows.length === 2 && rows.every((row, i) => row.status === "told" && parts[i].disputedCents < parts[i].chargeLeftCents && row.amountCents === Math.floor((sent.sentCents * parts[i].disputedCents) / parts[i].chargeLeftCents)), rows.map((row, i) => `${row.status}:${row.amountCents} of ${parts[i].disputedCents}/${parts[i].chargeLeftCents}`).join(" "));
      check("the second was worked out with the first one still to take: together never more than was sent", rows[0].amountCents + rows[1].amountCents <= sent.sentCents && parts.some((part) => (part as { othersOpenCents?: number }).othersOpenCents === rows[0].amountCents || (part as { othersOpenCents?: number }).othersOpenCents === rows[1].amountCents));
      check("the host is told of each, and how the part is worked out", (await messagesOf(rows[0].id)).length === 1 && (await messagesOf(rows[1].id)).length === 1 && (await messagesOf(rows[0].id))[0].body.includes("the same part of the"));
      await pass(rows[0].dueAt!, ...both);
      await pass(new Date(rows[0].dueAt!.getTime() + 1000), ...both);
      const taken = await db.select().from(debts).where(inArray(debts.disputeId, both));
      check("both are taken, one after the other, each with its own reversal; what is taken is never more than was sent", taken.every((row) => row.status === "taken") && (await transferAt(sent.transferId)).amount_reversed === rows[0].amountCents + rows[1].amountCents && (await transferAt(sent.transferId)).amount_reversed <= sent.sentCents && (await ledgerOf(paid.payment.id, "host_takeback")) === rows[0].amountCents + rows[1].amountCents && (await stripe().transfers.listReversals(sent.transferId, { limit: 10 })).data.length === 2, taken.map((row) => row.status).join(" "));
    }

    // ----------------------------------------------------------------------
    console.log("\n3b. An amount set aside for one dispute, which is then cancelled, is owed for the other after all");
    {
      const customer = await person("customer");
      const paid = await charged(host, customer, "pm_card_createMultipleDisputes");
      const both = await disputesOn(paid.payment.stripePaymentIntentId!, 2);
      const sent = await collect(paid.payment.id);
      for (const id of both) await lose(id);
      // Most of the transfer is taken back in Stripe by hand first, so that only one dispute's part is left of it.
      const part = Math.floor(sent.sentCents / 2) - 1;
      const gone = await stripe().transfers.createReversal(sent.transferId, { amount: sent.sentCents - part });
      // (As the founder says it on a take-back's page: that reversal had nothing to do with a take-back. Written
      // here by the script, because this share has no take-back yet to say it on. A reversal made by hand that
      // nobody has accounted for does NOT lower what a take-back is written for.)
      if (admins.length === 0) throw new Error("This check needs an admin (`npm run seed`).");
      await db.insert(schema.handReversalCounts).values({ stripeReversalId: gone.id, stripeTransferId: sent.transferId, paymentId: paid.payment.id, kind: "other", cents: gone.amount, decidedBy: admins[0].id });
      await pass(NOW, ...both);
      let rows = (await db.select().from(debts).where(inArray(debts.disputeId, both))).sort((a, b) => b.amountCents - a.amountCents);
      check("one dispute gets what is left of the transfer; the other is told nothing, because nothing more can be taken", rows.length === 2 && rows[0].status === "told" && rows[0].amountCents === part && rows[1].status === "nothing" && (await messagesOf(rows[1].id)).length === 0, rows.map((row) => `${row.status}:${row.amountCents}`).join(" "));
      if (admins.length > 0) {
        await cancelDebt({ debtId: rows[0].id, adminId: admins[0].id });
        await pass(NOW, ...both);
        rows = await db.select().from(debts).where(inArray(debts.disputeId, both));
        const freed = rows.find((row) => row.status === "told");
        check("the first is cancelled: the other dispute's share is worked out afresh, and gets a notice of its own with 14 days", rows.length === 2 && rows.some((row) => row.status === "cancelled") && freed !== undefined && freed.amountCents === part && (await messagesOf(freed.id)).length === 1 && freed.dueAt!.getTime() === freed.toldAt.getTime() + NOTICE_MS, rows.map((row) => `${row.status}:${row.amountCents}`).join(" "));
      }
    }

    // ----------------------------------------------------------------------
    console.log("\n4. The founder cancels; and a dispute that is won before anything was taken");
    {
      const customer = await person("customer");
      const c = await collectedThenLost(host, customer);
      await pass(NOW, c.disputeId);
      const debt = await debtOf(c.disputeId);
      if (admins.length > 0) {
        check("a take-back cannot be cancelled from another dispute's page", (await cancelDebt({ debtId: debt.id, adminId: admins[0].id, disputeId: "du_another_one" })) === false && (await debtOf(c.disputeId)).status === "told");
        check("the founder cancels a take-back that only has its notice", (await cancelDebt({ debtId: debt.id, adminId: admins[0].id, disputeId: c.disputeId })) === true && (await debtOf(c.disputeId)).status === "cancelled" && (await debtOf(c.disputeId)).cancelledBy === admins[0].id);
        check("it is written down as an admin action, and the host is told it is called off", (await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetId, debt.id))).length === 1 && (await messagesOf(debt.id)).some((one) => one.key.includes(":cancelled:") && one.body.includes("Nothing is taken for this take-back")));
        check("a second press changes nothing", (await cancelDebt({ debtId: debt.id, adminId: admins[0].id })) === false);
        await pass(new Date(debt.dueAt!.getTime() + RETRY_MS), c.disputeId);
        check("a cancelled take-back is never taken, and no new one is written for the same share", (await transferAt(c.transferId)).amount_reversed === 0 && (await debtsFor(c.disputeId)).length === 1 && (await operationsOf(c.payment.id)).length === 0);
        check("Connect carries what the founder waived, in the books once", (await ledgerOf(c.payment.id, "connect_cost")) === debt.amountCents && (await debtOf(c.disputeId)).costBookedCents === debt.amountCents);
        // The bank decides the other way after the waiver: nothing was lost after all, so that cost is taken off again, once.
        await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, c.disputeId));
        await pass(new Date(debt.dueAt!.getTime() + 2 * RETRY_MS), c.disputeId);
        await pass(new Date(debt.dueAt!.getTime() + 3 * RETRY_MS), c.disputeId);
        check("the dispute is won after a waiver: the cost is taken off the books again, once, and nobody is told to give anything back", (await ledgerOf(c.payment.id, "connect_cost")) === 0 && (await debtOf(c.disputeId)).costBookedCents === 0 && (await messagesOf(debt.id)).every((one) => !one.key.includes(":leftover:")));

        // Settled outside the app: she paid most of it to Connect's bank account, the rest was let go. Then the bank decides the other way.
        const s2 = await collectedThenLost(host, await person("customer"));
        await pass(NOW, s2.disputeId);
        const owed = await debtOf(s2.disputeId);
        check("a dispute's take-back cannot be settled from another dispute's page", (await settleOutside({ debtId: owed.id, adminId: admins[0].id, repaidCents: 0, note: "From the wrong page.", disputeId: "du_another_one" })) === false);
        // First $2.00 of it is taken by a reversal made by hand at Stripe, which the founder counts for it.
        const hand = await stripe().transfers.createReversal(s2.transferId, { amount: 200 });
        check("a reversal made by hand is counted for a dispute's take-back: $2.00 less is owed, and it is in the books as taken back", (await countHandReversal({ debtId: owed.id, adminId: admins[0].id, reversalId: hand.id, as: "paid" })) === true && (await debtOf(s2.disputeId)).amountCents === owed.amountCents - 200 && (await debtOf(s2.disputeId)).byHandCents === 200 && (await ledgerOf(s2.payment.id, "host_takeback")) === 200);
        const repaid = owed.amountCents - 200 - 100;
        check("the founder records that the rest was settled outside the app", (await settleOutside({ debtId: owed.id, adminId: admins[0].id, repaidCents: repaid, note: "Paid by bank transfer; the last dollar was let go.", disputeId: s2.disputeId })) === true);
        check("the books: what she paid back, and the dollar Connect carries; nothing more is taken at Stripe", (await debtOf(s2.disputeId)).status === "settled" && (await ledgerOf(s2.payment.id, "host_repaid")) === repaid && (await ledgerOf(s2.payment.id, "connect_cost")) === 100 && (await messagesOf(owed.id)).some((one) => one.key.includes(":settled:")));
        await pass(new Date(owed.dueAt!.getTime() + RETRY_MS), s2.disputeId);
        check("a settled take-back is never taken", (await transferAt(s2.transferId)).amount_reversed === 200 && (await operationsOf(s2.payment.id)).length === 0);
        await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, s2.disputeId));
        await pass(new Date(owed.dueAt!.getTime() + 2 * RETRY_MS), s2.disputeId);
        await pass(new Date(owed.dueAt!.getTime() + 3 * RETRY_MS), s2.disputeId);
        const backToHer = (await messagesOf(owed.id)).filter((one) => one.key.includes(":leftover:"));
        const backMail = (await emailsOf(owed.id)).filter((mail) => mail.dedupeKey?.includes(":leftover:founder:"));
        // What she really paid back, both ways together: the $2.00 taken by hand and what she paid to the bank account.
        const giveBack = `$${((repaid + 200) / 100).toFixed(2)}`;
        check("then the dispute is won: Connect's dollar is taken off the books again, and she and each admin are told once the exact amount that goes back to her", (await ledgerOf(s2.payment.id, "connect_cost")) === 0 && backToHer.length === 1 && backToHer[0].body.includes(`You had paid ${giveBack} back`) && backMail.length === admins.length && backMail.every((mail) => mail.body.includes(`send ${giveBack} to the host in Stripe`)), `${giveBack} ${backToHer.length} ${backMail.length} ${backToHer[0]?.body.slice(0, 60)}`);
      }

      const customer2 = await person("customer");
      const w = await collectedThenLost(host, customer2);
      await pass(NOW, w.disputeId);
      const waiting = await debtOf(w.disputeId);
      await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, w.disputeId));
      await pass(waiting.dueAt!, w.disputeId);
      check("the bank decided the other way before anything was taken: the take-back is called off by itself, and the host is told why", (await debtOf(w.disputeId)).status === "cancelled" && (await debtOf(w.disputeId)).cancelledBy === null && (await messagesOf(waiting.id)).some((one) => one.key.includes(":cancelled:") && one.body.includes("let the payment stand")) && (await transferAt(w.transferId)).amount_reversed === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Stripe refuses: back to the notice each time, tried again a day later, the founder told after 30 days");
    {
      const customer = await person("customer");
      const c = await collectedThenLost(host, customer);
      await pass(NOW, c.disputeId);
      const debt = await debtOf(c.disputeId);
      // Somebody takes the whole transfer back in Stripe meanwhile, so the app's request cannot be met.
      await stripe().transfers.createReversal(c.transferId, { amount: c.sentCents });
      // While nobody has said what that reversal was for, the app does not even ask Stripe: it may have paid this very take-back.
      await pass(debt.dueAt!, c.disputeId);
      const heldMail = (await emailsOf(debt.id)).filter((mail) => mail.dedupeKey?.includes(":hand:") && mail.dedupeKey.includes(":founder:"));
      check("a reversal made by hand that nobody has accounted for: the app asks Stripe for nothing, holds the take-back, and tells each admin once", (await debtOf(c.disputeId)).status === "told" && (await debtOf(c.disputeId)).handToldAt !== null && (await operationsOf(c.payment.id)).length === 0 && admins.length > 0 && heldMail.length === admins.length && heldMail.every((mail) => mail.body.includes("the same money could be taken twice")), `${heldMail.length}`);
      await takeDirect(debt, debt.dueAt!);
      let row = await debtOf(c.disputeId);
      let operations = await operationsOf(c.payment.id);
      check("a clear \"no\" from Stripe: the action is marked as not done, and the row is back at its notice with what Stripe said", row.status === "told" && Boolean(row.refusal) && row.refusedAt !== null && row.firstRefusedAt !== null && operations.length === 1 && operations[0].status === "failed", `${row.status} ${row.refusal}`);
      // As if that refusal had come at the moment the notice ended.
      await db.update(debts).set({ refusedAt: debt.dueAt!, firstRefusedAt: debt.dueAt! }).where(eq(debts.id, debt.id));
      await takeDirect(debt, new Date(debt.dueAt!.getTime() + RETRY_MS - 1000));
      check("it is not tried again within a day", (await operationsOf(c.payment.id)).length === 1);
      await takeDirect(debt, new Date(debt.dueAt!.getTime() + RETRY_MS));
      row = await debtOf(c.disputeId);
      operations = await operationsOf(c.payment.id);
      check("a day later it is tried again, under a new label, and is back at its notice once more", operations.length === 2 && operations[1].label === `takeback:${debt.id}:2` && operations[1].status === "failed" && row.status === "told", `${operations.length} ${row.status}`);
      check("the first refusal's date is kept", row.firstRefusedAt?.getTime() === debt.dueAt!.getTime());
      await db.update(debts).set({ refusedAt: new Date(debt.dueAt!.getTime() + TELL_FOUNDER_AFTER_MS) }).where(eq(debts.id, debt.id));
      await pass(new Date(debt.dueAt!.getTime() + TELL_FOUNDER_AFTER_MS - 1000), c.disputeId);
      check("before 30 days of refusals the founder is not told", (await emailsOf(debt.id)).every((mail) => !mail.dedupeKey?.includes(":refused:")));
      await pass(new Date(debt.dueAt!.getTime() + TELL_FOUNDER_AFTER_MS), c.disputeId);
      await pass(new Date(debt.dueAt!.getTime() + TELL_FOUNDER_AFTER_MS + 1000), c.disputeId);
      const toldRefused = (await emailsOf(debt.id)).filter((mail) => mail.dedupeKey?.includes(":refused:founder:"));
      check("after 30 days each admin is told once, with what Stripe last said", toldRefused.length === admins.length && toldRefused.every((mail) => mail.body.includes("For 30 days Stripe has refused") && mail.body.includes("What Stripe last said")), toldRefused.length);
      check("the host is told nothing about refusals", (await messagesOf(debt.id)).every((one) => !one.key.includes(":refused:")));
      // Not left to be tried for ever by later runs of the helper.
      if (admins.length > 0) await cancelDebt({ debtId: debt.id, adminId: admins[0].id });
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The helper stops in the middle: a row is never left \"being taken\", and nothing is taken twice");
    {
      /** A take-back whose notice is over, written down as a money action and not yet asked of Stripe. */
      const writtenDown = async () => {
        const c = await collectedThenLost(host, await person("customer"));
        await pass(NOW, c.disputeId);
        const debt = await debtOf(c.disputeId);
        const started = await db.transaction((tx) => startMoneyOperation(tx, takePlan(debt, debt.dueAt!)));
        if (started === "already_done") throw new Error("The take-back was already done.");
        return { ...c, debt, started };
      };

      // Written down, never sent, and too old to send again: Stripe's own list shows it did not happen.
      const never = await writtenDown();
      check("writing the action down moves the row to \"being taken\"", (await debtOf(never.disputeId)).status === "taking");
      check("a take-back that is being taken cannot be cancelled", (await cancelDebt({ debtId: never.debt.id, adminId: admins[0]?.id ?? host.id })) === false && (await debtOf(never.disputeId)).status === "taking");
      await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, never.disputeId));
      await pass(new Date(never.debt.dueAt!.getTime() + RETRY_MS), never.disputeId);
      check("the dispute is won while it is under way: the row waits for its action", (await debtOf(never.disputeId)).status === "taking");
      // The helper comes back two minutes later. A repeat could be the first time Stripe really does it, and the dispute
      // is no longer lost: nothing is sent, and nothing is concluded yet either.
      await age(never.started.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [never.started.operationId] });
      check("no request is sent again for a dispute that is no longer lost, and nothing is concluded while the first could still be on its way", (await debtOf(never.disputeId)).status === "taking" && (await operationsOf(never.payment.id))[0].status === "started" && (await transferAt(never.transferId)).amount_reversed === 0);
      await age(never.started.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [never.started.operationId] });
      let row = await debtOf(never.disputeId);
      let [operation] = await operationsOf(never.payment.id);
      check("the helper's check finds \"it did not happen\": the action is failed and the row is back at its notice, never left \"being taken\"", operation.status === "failed" && row.status === "told" && /did not happen/.test(row.refusal ?? "") && (await transferAt(never.transferId)).amount_reversed === 0, `${operation.status} ${row.status}`);
      await pass(new Date(never.debt.dueAt!.getTime() + 2 * RETRY_MS), never.disputeId);
      check("and then, the dispute being won, it is called off", (await debtOf(never.disputeId)).status === "cancelled" && (await transferAt(never.transferId)).amount_reversed === 0);

      // Stripe did it and the reply was lost: the same request again gives the first reply back.
      const lost = await writtenDown();
      await reverseAtStripe(lost.started.params, lost.started.label);
      await age(lost.started.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [lost.started.operationId] });
      row = await debtOf(lost.disputeId);
      [operation] = await operationsOf(lost.payment.id);
      check("Stripe did it and the reply was lost: the helper finishes it, recorded once, taken once", operation.status === "succeeded" && row.status === "taken" && (await transferAt(lost.transferId)).amount_reversed === lost.sentCents && (await stripe().transfers.listReversals(lost.transferId, { limit: 10 })).data.length === 1 && (await ledgerOf(lost.payment.id, "host_takeback")) === lost.sentCents, `${operation.status} ${row.status}`);

      // The same, found too late to send again: the reversal is found in the transfer's own list by the take-back's id.
      const old = await writtenDown();
      await reverseAtStripe(old.started.params, old.started.label);
      await age(old.started.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [old.started.operationId] });
      row = await debtOf(old.disputeId);
      [operation] = await operationsOf(old.payment.id);
      check("found too late to repeat: the reversal is found by the take-back's id, and recorded once", operation.status === "succeeded" && row.status === "taken" && row.stripeReversalId !== null && (await transferAt(old.transferId)).amount_reversed === old.sentCents && (await ledgerOf(old.payment.id, "host_takeback")) === old.sentCents, `${operation.status} ${row.status}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n8. The 14 days count from the notice really sent, and an objection stops the taking (plans/46-part-3, decision 6)");
    {
      check("(there is an admin in this database to tell: the checks of what the founder is told need one)", admins.length > 0);
      const admin = admins[0]?.id ?? host.id;
      const DAYS = 24 * 3_600_000;
      const founderMail = async (debtId: string, what: string) => (await emailsOf(debtId)).filter((mail) => mail.dedupeKey?.includes(`:${what}`) && mail.dedupeKey.includes(":founder:"));
      const toldEachAdmin = (mails: Awaited<ReturnType<typeof founderMail>>) => admins.length > 0 && mails.length === admins.length && admins.every((one) => mails.some((mail) => mail.to === one.email));
      const mailRow = async (id: string) => (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, id)))[0];
      const setMail = (id: string, values: Partial<typeof schema.emailOutbox.$inferInsert>) => db.update(schema.emailOutbox).set(values).where(eq(schema.emailOutbox.id, id));
      const refused = async (attempt: Promise<unknown>) => attempt.then(() => null, (error: Error) => (error instanceof DebtError ? error.message : `not a DebtError: ${error.message}`));

      // ---- A. The notice has to have gone out; then an objection, an answer, and the taking.
      const c = await collectedThenLost(host, await person("customer"));
      await passOnly(NOW, c.disputeId);
      let debt = await debtOf(c.disputeId);
      const noticeId = debt.noticeEmailId!;
      const notice = await mailRow(noticeId);
      check("a take-back whose notice has not gone out has no due day, and its notice names none", debt.status === "told" && debt.dueAt === null && notice?.status === "queued" && notice.to === host.email && notice.body.includes("From 14 days after this message reached you by email"), `${debt.dueAt} ${notice?.status}`);
      check("the notice says what each way of objecting does: the button at once, an email only once a person at Connect has put a hold on it", notice.body.includes("From the moment you press it, nothing is taken") && notice.body.includes("An email does not stop the taking by itself: it stops only when a person at Connect has put a hold on it"));
      await passOnly(new Date(NOW.getTime() + 10 * NOTICE_MS), c.disputeId);
      check("it is never taken while that is so, however much time passes", (await debtOf(c.disputeId)).status === "told" && (await transferAt(c.transferId)).amount_reversed === 0 && (await operationsOf(c.payment.id)).length === 0);

      // The email fails: the founder is told once, and there is still no day.
      await setMail(noticeId, { status: "failed", lastError: "422 made up for this check" });
      await passOnly(NOW, c.disputeId);
      await passOnly(NOW, c.disputeId);
      debt = await debtOf(c.disputeId);
      const undelivered = await founderMail(debt.id, "undelivered:");
      check("a notice that could not be sent leaves it without a day, and each admin is told once", debt.dueAt === null && debt.noticeProblemToldAt !== null && toldEachAdmin(undelivered) && undelivered.every((mail) => mail.subject.includes("is not confirmed as delivered") && mail.body.includes("is not confirmed as delivered by email: 422 made up for this check") && mail.body.includes("nothing is taken while this is so")), `${undelivered.length}`);

      // It goes out after all, two days later. Accepted by the sending service is not yet arrived.
      const sentAt = new Date(NOW.getTime() + 2 * DAYS);
      await setMail(noticeId, { status: "sent", sentAt, lastError: null, providerId: `takebackcheck-${RUN}-a` });
      await passOnly(NOW, c.disputeId);
      check("sent, and not yet reported as delivered: still no day", (await debtOf(c.disputeId)).dueAt === null && (await debtOf(c.disputeId)).noticeProblemToldAt === null);
      // The sending service's own report, through the same door the real reports come through.
      check("a report about an email the app does not know records nothing", (await recordEmailEvent(`takebackcheck-${RUN}-unknown`, "delivered", null)) === false);
      // Reported as delivered a day after it was sent: the days count from that arrival.
      const arrivedAt = new Date(sentAt.getTime() + DAYS);
      check("the sending service reports it as delivered, a day after the sending", (await recordEmailEvent(`takebackcheck-${RUN}-a`, "delivered", null, arrivedAt)) === true && (await mailRow(noticeId)).deliveredAt?.getTime() === arrivedAt.getTime());
      await passOnly(NOW, c.disputeId);
      debt = await debtOf(c.disputeId);
      const firstDue = new Date(arrivedAt.getTime() + NOTICE_MS);
      check("it is due 14 days after it arrived: not after the row was written, and not after the sending alone", debt.dueAt?.getTime() === firstDue.getTime() && debt.firstDueAt?.getTime() === firstDue.getTime() && debt.noticeProblemToldAt === null, `${debt.dueAt?.toISOString()}`);

      // "I think this is wrong", a second before the day.
      check("somebody else cannot object to it", /not one of your take-backs/.test((await refused(objectToDebt({ debtId: debt.id, hostId: customerOfNobody.id, objection: "This is not mine to object to at all." }))) ?? ""));
      check("nor can its own host through another dispute's page", /not one of your take-backs/.test((await refused(objectToDebt({ debtId: debt.id, hostId: host.id, disputeId: "du_another_one", objection: "Named with another dispute's page." }))) ?? ""));
      check("an objection needs a reason", /why you think this is wrong/.test((await refused(objectToDebt({ debtId: debt.id, hostId: host.id, objection: "no" }))) ?? ""));
      await objectToDebt({ debtId: debt.id, hostId: host.id, disputeId: c.disputeId, objection: "The call took place in full. The customer told me so afterwards.", now: new Date(firstDue.getTime() - 1000) });
      await passOnly(firstDue, c.disputeId);
      await passOnly(new Date(firstDue.getTime() + 30 * DAYS), c.disputeId);
      debt = await debtOf(c.disputeId);
      check("an objection a second before the day stops it: nothing is taken at the day, or a month later", debt.status === "objected" && debt.dueAt === null && (await transferAt(c.transferId)).amount_reversed === 0 && (await operationsOf(c.payment.id)).length === 0, debt.status);
      const objected = await founderMail(debt.id, "objected");
      check("the host is told it is with a person, and each admin gets the host's own words", (await messagesOf(debt.id)).some((one) => one.key.includes(":objected:") && one.body.includes("nothing is taken for this take-back")) && toldEachAdmin(objected) && objected.every((mail) => mail.body.includes("The call took place in full.")), `${objected.length}`);
      check("the host cannot object a second time while it is open", /already have your objection/.test((await refused(objectToDebt({ debtId: debt.id, hostId: host.id, objection: "Once more, with other words this time." }))) ?? ""));
      check("the earnings page still lists it, as objected", (await debtsOfHost(host.id)).some((one) => one.id === debt.id && one.status === "objected"));

      // The founder answers: taken after all, but not before the answer has gone out and 3 days have passed.
      check("an answer needs words", /Write the answer/.test((await refused(answerObjection({ debtId: debt.id, adminId: admin, answer: "no" }))) ?? ""));
      const answeredAt = new Date(firstDue.getTime() + 5 * DAYS);
      check("the founder answers the objection", (await answerObjection({ debtId: debt.id, adminId: admin, answer: "The bank's decision stands whatever happened in the call. We sent it your record of the call.", now: answeredAt })) === true);
      debt = await debtOf(c.disputeId);
      check("answered: the host has the answer in writing, and there is no day until that answer has gone out", debt.status === "answered" && debt.dueAt === null && debt.answerEmailId !== null && debt.answeredBy === admin && (await messagesOf(debt.id)).some((one) => one.key.includes(":answered:") && one.body.includes("The bank's decision stands whatever happened in the call.")));
      await passOnly(new Date(answeredAt.getTime() + 60 * DAYS), c.disputeId);
      check("and it is not taken while the answer has not gone out", (await debtOf(c.disputeId)).status === "answered" && (await debtOf(c.disputeId)).dueAt === null && (await transferAt(c.transferId)).amount_reversed === 0);
      // The answer is sent at once and reported as delivered four days later: its 3 days count from the arrival.
      const answerArrived = new Date(answeredAt.getTime() + 4 * DAYS);
      await setMail(debt.answerEmailId!, { status: "sent", sentAt: answeredAt, deliveredAt: answerArrived });
      await passOnly(answeredAt, c.disputeId);
      debt = await debtOf(c.disputeId);
      const dueAgain = new Date(answerArrived.getTime() + AFTER_ANSWER_MS);
      check("its day is 3 days after the answer arrived, not after it was sent (the first day has passed by then)", debt.dueAt?.getTime() === dueAgain.getTime(), debt.dueAt?.toISOString());
      check("an answered take-back cannot be objected to again in the app", /We have answered your objection/.test((await refused(objectToDebt({ debtId: debt.id, hostId: host.id, objection: "I still think that this is wrong, please look again." }))) ?? ""));
      await passOnly(new Date(dueAgain.getTime() - 1000), c.disputeId);
      check("a second before that day nothing is taken", (await transferAt(c.transferId)).amount_reversed === 0);
      await passOnly(dueAgain, c.disputeId);
      debt = await debtOf(c.disputeId);
      check("at that day it is taken, really, at Stripe", debt.status === "taken" && (await transferAt(c.transferId)).amount_reversed === c.sentCents, `${debt.status} ${debt.refusal ?? ""}`);

      // ---- B. A bounce reported for this very email; an answer that comes early; a refusal; a dispute won after all.
      const early = await collectedThenLost(host, await person("customer"));
      await pass(NOW, early.disputeId);
      let second = await debtOf(early.disputeId);
      const itsFirstDay = second.dueAt!;
      check("(it has its day: 14 days after its notice went out)", itsFirstDay.getTime() === second.toldAt.getTime() + NOTICE_MS);
      // The sending service says later that this email bounced. (Another email bouncing at the same address would not count.)
      await db.insert(schema.emailSuppressions).values({ address: host.email, reason: "bounced (made up: another email)" });
      await passOnly(NOW, early.disputeId);
      check("an address that is only known to bounce for another email does not take the day away", (await debtOf(early.disputeId)).dueAt?.getTime() === itsFirstDay.getTime());
      await db.delete(schema.emailSuppressions).where(eq(schema.emailSuppressions.address, host.email));
      await setMail(second.noticeEmailId!, { providerId: `takebackcheck-${RUN}-b` });
      await recordEmailEvent(`takebackcheck-${RUN}-b`, "bounced", "bounced: Permanent General");
      await passOnly(NOW, early.disputeId);
      await passOnly(NOW, early.disputeId);
      second = await debtOf(early.disputeId);
      const bounced = await founderMail(second.id, "undelivered:");
      check("when the sending service says later that this very email bounced, the day is taken away again and each admin is told once", second.dueAt === null && second.noticeProblemToldAt !== null && toldEachAdmin(bounced) && bounced.every((mail) => mail.body.includes("it bounced (bounced: Permanent General)")), `${second.dueAt} ${bounced.length}`);
      await passOnly(new Date(itsFirstDay.getTime() + DAYS), early.disputeId);
      check("and nothing is taken while that is so, also after its old day", (await debtOf(early.disputeId)).status === "told" && (await transferAt(early.transferId)).amount_reversed === 0 && (await operationsOf(early.payment.id)).length === 0);
      // A "delivered" that arrives late, or out of order, does not undo the bounce.
      await recordEmailEvent(`takebackcheck-${RUN}-b`, "delivered", null);
      await passOnly(NOW, early.disputeId);
      check("a report of delivery that arrives after the bounce does not bring the day back", (await debtOf(early.disputeId)).dueAt === null && (await mailRow(second.noticeEmailId!)).bouncedAt !== null);
      // The founder sends the notice again: a new message and a new email, and the days count from that one arriving.
      check("the founder sends the notice again", (await sendNoticeAgain({ debtId: second.id, adminId: admin })) === true);
      second = await debtOf(early.disputeId);
      const again = (await messagesOf(second.id)).filter((one) => one.key.includes(":owed:again:"));
      check("the second notice says why it comes again, and still shows the way to object", again.length === 1 && again[0].body.startsWith("We are sending this again because we could not confirm that our first message about it reached you by email.") && again[0].body.includes('press "I think this is wrong"'));
      check("a second message is on the host's Messages page, and there is no day until its email has arrived", again.length === 1 && second.dueAt === null && second.noticeProblemToldAt === null && (await mailRow(second.noticeEmailId!)).status === "queued");
      const sentAgain = new Date(NOW.getTime() + 3 * DAYS);
      await setMail(second.noticeEmailId!, { status: "sent", sentAt: sentAgain, deliveredAt: sentAgain });
      await passOnly(NOW, early.disputeId);
      second = await debtOf(early.disputeId);
      const itsDay = new Date(sentAgain.getTime() + NOTICE_MS);
      check("its day is 14 days after the second notice arrived", second.dueAt?.getTime() === itsDay.getTime() && second.firstDueAt?.getTime() === itsFirstDay.getTime(), second.dueAt?.toISOString());
      check("one that has its day cannot be sent again", (await sendNoticeAgain({ debtId: second.id, adminId: admin })) === false);

      await objectToDebt({ debtId: second.id, hostId: host.id, objection: "Please look at this one again, I think it is wrong.", now: new Date(NOW.getTime() + DAYS) });
      await answerObjection({ debtId: second.id, adminId: admin, answer: "We looked at it again and the bank's decision stands.", now: new Date(NOW.getTime() + 2 * DAYS) });
      second = await debtOf(early.disputeId);
      await setMail(second.answerEmailId!, { status: "sent", sentAt: new Date(NOW.getTime() + 2 * DAYS), deliveredAt: new Date(NOW.getTime() + 2 * DAYS) });
      await passOnly(NOW, early.disputeId);
      second = await debtOf(early.disputeId);
      check("an objection answered early does not bring the day forward: it stays the notice's own day", second.status === "answered" && second.dueAt?.getTime() === itsDay.getTime(), second.dueAt?.toISOString());
      // Stripe refuses the reversal (somebody took the whole transfer back by hand): through the money action, as it really goes.
      await stripe().transfers.createReversal(early.transferId, { amount: early.sentCents });
      await takeDirect(second, itsDay);
      second = await debtOf(early.disputeId);
      const itsOperations = await operationsOf(early.payment.id);
      check("a reversal Stripe refuses puts an answered take-back back to answered, not to told, with the refusal noted", second.status === "answered" && Boolean(second.refusal) && second.refusedAt !== null && itsOperations.length === 1 && itsOperations[0].status === "failed", `${second.status} ${itsOperations.map((one) => one.status)}`);
      check("so it still cannot be objected to a second time", /We have answered your objection/.test((await refused(objectToDebt({ debtId: second.id, hostId: host.id, objection: "Trying to object again after the refusal." }))) ?? ""));
      // The bank decides the other way while it is answered: called off by itself.
      await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, early.disputeId));
      await passOnly(new Date(itsDay.getTime() + 2 * RETRY_MS), early.disputeId);
      second = await debtOf(early.disputeId);
      check("an answered take-back whose dispute is then won is called off by itself, and nothing was taken by the app", second.status === "cancelled" && (await ledgerOf(early.payment.id, "host_takeback")) === 0 && (await operationsOf(early.payment.id)).length === 1 && (await messagesOf(second.id)).some((one) => one.key.includes(":cancelled:") && one.body.includes("let the payment stand")));

      // ---- C. An objection that came by email: the founder holds it, and then calls it off.
      const byMail = await collectedThenLost(host, await person("customer"));
      await pass(NOW, byMail.disputeId);
      let third = await debtOf(byMail.disputeId);
      check("the founder holds a take-back for an objection that came by email", (await holdDebt({ debtId: third.id, adminId: admin, note: "She wrote to support on Monday: the customer was happy." })) === true && (await debtOf(byMail.disputeId)).status === "objected");
      await passOnly(new Date(third.dueAt!.getTime() + RETRY_MS), byMail.disputeId);
      check("held: nothing is taken at its day", (await debtOf(byMail.disputeId)).status === "objected" && (await transferAt(byMail.transferId)).amount_reversed === 0);
      check("one that is held cannot be held again", (await holdDebt({ debtId: third.id, adminId: admin, note: "again" })) === false);
      check("the founder calls an objected take-back off", (await cancelDebt({ debtId: third.id, adminId: admin })) === true);
      await passOnly(new Date(third.dueAt!.getTime() + 5 * RETRY_MS), byMail.disputeId);
      third = await debtOf(byMail.disputeId);
      check("called off: never taken, and the host is told", third.status === "cancelled" && (await transferAt(byMail.transferId)).amount_reversed === 0 && (await messagesOf(third.id)).some((one) => one.key.includes(":cancelled:")));
      check("there is nothing to answer on a take-back that was called off", (await answerObjection({ debtId: third.id, adminId: admin, answer: "Too late to answer this one, it was called off." })) === false);

      // ---- D. An objection before the day was ever given; and a take-back that is being taken when its notice bounces.
      const fast = await collectedThenLost(host, await person("customer"));
      await passOnly(NOW, fast.disputeId);
      let fourth = await debtOf(fast.disputeId);
      // The host objects from the Messages page at once, and the founder answers at once: all on day zero.
      await objectToDebt({ debtId: fourth.id, hostId: host.id, objection: "Objecting at once, before any day was given.", now: NOW });
      await answerObjection({ debtId: fourth.id, adminId: admin, answer: "Answered at once: the bank's decision stands.", now: NOW });
      fourth = await debtOf(fast.disputeId);
      await setMail(fourth.answerEmailId!, { status: "sent", sentAt: NOW, deliveredAt: NOW });
      await passOnly(NOW, fast.disputeId);
      check("answered on day zero, with the notice itself not out yet: no day at all", (await debtOf(fast.disputeId)).status === "answered" && (await debtOf(fast.disputeId)).dueAt === null);
      await passOnly(new Date(NOW.getTime() + 60 * DAYS), fast.disputeId);
      check("and nothing is taken, however long it is left", (await transferAt(fast.transferId)).amount_reversed === 0 && (await operationsOf(fast.payment.id)).length === 0);
      await setMail(fourth.noticeEmailId!, { status: "sent", sentAt: NOW, deliveredAt: NOW });
      await passOnly(NOW, fast.disputeId);
      fourth = await debtOf(fast.disputeId);
      const fourteen = new Date(NOW.getTime() + NOTICE_MS);
      check("an objection and an answer on day zero do not make it 3 days: it is the notice's own 14", fourth.dueAt?.getTime() === fourteen.getTime(), fourth.dueAt?.toISOString());
      await passOnly(new Date(NOW.getTime() + 4 * DAYS), fast.disputeId);
      check("on day 4 nothing is taken", (await transferAt(fast.transferId)).amount_reversed === 0 && (await operationsOf(fast.payment.id)).length === 0);

      // Two requests to Stripe that got no answer, both really due by the real clock (their emails arrived 20 days
      // ago): one has to be sent again by the helper, the other must not be, because its notice bounced meanwhile.
      const longAgo = new Date(Date.now() - 20 * DAYS);
      await setMail(fourth.noticeEmailId!, { sentAt: longAgo, deliveredAt: longAgo });
      await setMail(fourth.answerEmailId!, { sentAt: longAgo, deliveredAt: longAgo });
      await passOnly(new Date(0), fast.disputeId);
      fourth = await debtOf(fast.disputeId);
      check("(it is due by the real clock now)", fourth.dueAt !== null && fourth.dueAt.getTime() < Date.now() - 5 * DAYS);
      const begun = await db.transaction((tx) => startMoneyOperation(tx, takePlan(fourth, new Date())));
      if (begun === "already_done") throw new Error("The take-back was already done.");
      check("(it is being taken)", (await debtOf(fast.disputeId)).status === "taking");
      check("while it is being taken it cannot be objected to", /can no longer be objected to here/.test((await refused(objectToDebt({ debtId: fourth.id, hostId: host.id, objection: "Objecting while it is being taken." }))) ?? ""));
      await age(begun.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [begun.operationId] });
      let [itsOperation] = await operationsOf(fast.payment.id);
      fourth = await debtOf(fast.disputeId);
      check("a request that got no answer, with everything still in order: the helper sends it again, and it is taken once", itsOperation.status === "succeeded" && fourth.status === "taken" && (await transferAt(fast.transferId)).amount_reversed === fast.sentCents, `${itsOperation.status} ${fourth.status}`);

      const stopped = await collectedThenLost(host, await person("customer"));
      await pass(NOW, stopped.disputeId);
      let sixth = await debtOf(stopped.disputeId);
      await setMail(sixth.noticeEmailId!, { sentAt: longAgo, deliveredAt: longAgo, providerId: `takebackcheck-${RUN}-d` });
      await db.update(debts).set({ firstDueAt: null }).where(eq(debts.id, sixth.id));
      await passOnly(new Date(0), stopped.disputeId);
      sixth = await debtOf(stopped.disputeId);
      check("(the second one is due by the real clock too)", sixth.dueAt !== null && sixth.dueAt.getTime() < Date.now() - 5 * DAYS);
      const begunToo = await db.transaction((tx) => startMoneyOperation(tx, takePlan(sixth, new Date())));
      if (begunToo === "already_done") throw new Error("The take-back was already done.");
      // Now the sending service reports that the notice bounced. The helper finds the unanswered request.
      await recordEmailEvent(`takebackcheck-${RUN}-d`, "bounced", "bounced: Permanent General");
      await age(begunToo.operationId, 2 * 60_000);
      await reconcileOperations(new Date(), { operationIds: [begunToo.operationId] });
      [itsOperation] = await operationsOf(stopped.payment.id);
      check("the same, but its notice bounced meanwhile: the request is NOT sent to Stripe after all", (await transferAt(stopped.transferId)).amount_reversed === 0 && itsOperation.status === "started", `${itsOperation.status}`);
      await age(begunToo.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date(), { operationIds: [begunToo.operationId] });
      [itsOperation] = await operationsOf(stopped.payment.id);
      sixth = await debtOf(stopped.disputeId);
      check("once it can no longer be on its way it is closed as not done: nothing taken, and the take-back is back at its notice", itsOperation.status === "failed" && sixth.status === "told" && (await transferAt(stopped.transferId)).amount_reversed === 0, `${itsOperation.status} ${sixth.status}`);
      await passOnly(new Date(), stopped.disputeId);
      sixth = await debtOf(stopped.disputeId);
      check("and with its notice bounced it has no day, and is not taken", sixth.dueAt === null && sixth.status === "told" && (await transferAt(stopped.transferId)).amount_reversed === 0 && (await operationsOf(stopped.payment.id)).length === 1);

      // The same take-back: objected and answered while its notice has still not arrived, and then the answer fails too.
      await objectToDebt({ debtId: sixth.id, hostId: host.id, objection: "Objecting from the Messages page: the email never came." });
      await answerObjection({ debtId: sixth.id, adminId: admin, answer: "We looked at it: the bank's decision stands." });
      sixth = await debtOf(stopped.disputeId);
      const failedAnswer = sixth.answerEmailId!;
      await setMail(failedAnswer, { status: "failed", lastError: "422 made up for the answer" });
      await passOnly(new Date(), stopped.disputeId);
      await passOnly(new Date(), stopped.disputeId);
      const bothTold = await founderMail(sixth.id, "undelivered:");
      check("with the notice AND the answer not arrived, each admin is told about each of the two emails, once", admins.length > 0 && bothTold.length === 2 * admins.length && bothTold.some((mail) => mail.dedupeKey?.includes(`:undelivered:${failedAnswer}:`) && mail.body.includes("422 made up for the answer")) && bothTold.some((mail) => mail.dedupeKey?.includes(`:undelivered:${sixth.noticeEmailId}:`)), `${bothTold.length}`);
      // The founder sends again: first the notice, in words that fit a take-back whose objection is answered.
      check("the founder sends the notice again", (await sendNoticeAgain({ debtId: sixth.id, adminId: admin })) === true);
      const noticeAgain = (await messagesOf(sixth.id)).filter((one) => one.key.includes(":owed:again:"));
      check("sent again to a host whose objection was answered, the notice repeats the answer and points to no button", noticeAgain.length === 1 && noticeAgain[0].body.includes("You told us this is wrong, and we answered:") && noticeAgain[0].body.includes("the bank's decision stands") && !noticeAgain[0].body.includes("press"), noticeAgain[0]?.body.slice(0, 120));
      check("then the answer, which had failed too", (await sendNoticeAgain({ debtId: sixth.id, adminId: admin })) === true && (await messagesOf(sixth.id)).filter((one) => one.key.includes(":answered:again:")).length === 1);
      sixth = await debtOf(stopped.disputeId);
      const bothAt = new Date();
      await setMail(sixth.noticeEmailId!, { status: "sent", sentAt: bothAt, deliveredAt: bothAt });
      await setMail(sixth.answerEmailId!, { status: "sent", sentAt: bothAt, deliveredAt: bothAt });
      await passOnly(new Date(), stopped.disputeId);
      sixth = await debtOf(stopped.disputeId);
      check("with both arrived, its day is 14 days after the new notice", sixth.status === "answered" && sixth.dueAt?.getTime() === bothAt.getTime() + NOTICE_MS && sixth.noticeProblemToldAt === null, sixth.dueAt?.toISOString());

      // A take-back whose notice is still waiting cannot even be written down as a money action.
      const waitingOne = await collectedThenLost(host, await person("customer"));
      await passOnly(NOW, waitingOne.disputeId);
      const fifth = await debtOf(waitingOne.disputeId);
      // (As a take-back from before this rule would look: a day on the row, and an email that never went out.)
      await db.update(debts).set({ dueAt: new Date(NOW.getTime() - DAYS), firstDueAt: new Date(NOW.getTime() - DAYS) }).where(eq(debts.id, fifth.id));
      const notStarted = await db.transaction((tx) => startMoneyOperation(tx, takePlan(fifth, NOW))).then(() => "started", (error: Error) => error.message);
      check("a day on the row is not enough: with its notice not confirmed as delivered, the taking refuses at the last moment", /not confirmed as delivered/.test(notStarted) && (await debtOf(waitingOne.disputeId)).status === "told", notStarted);
      await passOnly(NOW, waitingOne.disputeId);
      check("and the helper's pass takes that day away again", (await debtOf(waitingOne.disputeId)).dueAt === null && (await operationsOf(waitingOne.payment.id)).length === 0);
      // Sent long ago, and the sending service never said that it arrived (as every email from before this rule).
      await setMail(fifth.noticeEmailId!, { status: "sent", sentAt: new Date(NOW.getTime() - 20 * DAYS), providerId: `takebackcheck-${RUN}-e` });
      await passOnly(NOW, waitingOne.disputeId);
      const unconfirmed = await founderMail(fifth.id, "undelivered:");
      check("an email the sending service never reported as delivered gives no day, and after two days each admin is told", (await debtOf(waitingOne.disputeId)).dueAt === null && toldEachAdmin(unconfirmed) && unconfirmed.every((mail) => mail.body.includes("has not confirmed that it was delivered")), `${unconfirmed.length}`);
      await recordEmailEvent(`takebackcheck-${RUN}-e`, "delivered", null, new Date(NOW.getTime() - 20 * DAYS));
      await passOnly(new Date(0), waitingOne.disputeId);
      check("once it is reported as delivered, an old take-back keeps the day its notice named as the earliest", (await debtOf(waitingOne.disputeId)).dueAt?.getTime() === NOW.getTime() - DAYS && (await debtOf(waitingOne.disputeId)).noticeProblemToldAt === null);
    }
  } finally {
    // What THIS run made, by the exact ids: open test disputes are ended, what is left of the shares it sent is taken
    // back, and the messages, emails and admin actions about its own disputes and take-backs are removed.
    for (const id of made) {
      const current = await stripe().disputes.retrieve(id).catch(() => null);
      if (current?.status === "needs_response") await stripe().disputes.close(id).catch(() => undefined);
    }
    for (const id of transfers) {
      const transfer = await stripe().transfers.retrieve(id).catch(() => null);
      const left = transfer ? transfer.amount - transfer.amount_reversed : 0;
      if (left > 0) await stripe().transfers.createReversal(id, { amount: left }).catch(() => undefined);
    }
    if (made.length > 0) {
      const mine = await db.select({ id: debts.id }).from(debts).where(inArray(debts.disputeId, made));
      const keys = [...made.map((id) => `dispute:${id}:%`), ...mine.map((row) => `takeback:${row.id}:%`)];
      await db.delete(schema.messages).where(or(...keys.map((key) => like(schema.messages.key, key))));
      await db.delete(schema.emailOutbox).where(or(...keys.map((key) => like(schema.emailOutbox.dedupeKey, key))));
      if (mine.length > 0) await db.delete(schema.adminActions).where(inArray(schema.adminActions.targetId, mine.map((row) => row.id)));
      // Nothing of this run is left for the helper to act on later.
      await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(inArray(debts.disputeId, made), inArray(debts.status, ["told", "objected", "answered"])));
      await db.delete(schema.emailSuppressions).where(like(schema.emailSuppressions.address, `takebackcheck-${RUN}-%`));
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
