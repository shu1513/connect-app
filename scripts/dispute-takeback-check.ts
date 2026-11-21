/**
 * Testing tool for taking a share back after a lost bank dispute (plans/47-bank-disputes.md, part 3).
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
import { and, eq, inArray, like, or } from "drizzle-orm";
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
  const { startMoneyOperation } = await import("../src/lib/payments/operations");
  const { reconcileOperations } = await import("../src/lib/payments/jobs");
  const { getHostSettings, refreshPayoutsReady } = await import("../src/lib/payments/hosts");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { lookAtOpenDisputes } = await import("../src/lib/disputes/record");
  const { cancelDebt, reverseAtStripe, takeBackPass, takePlan, debtsOfDispute, debtsOfHost } = await import("../src/lib/disputes/takeback");
  const { NOTICE_MS, RETRY_MS, TELL_FOUNDER_AFTER_MS } = await import("../src/lib/disputes/takeback-rules");

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
  const pass = (at: Date, ...disputeIds: string[]) => takeBackPass(at, { disputeIds });
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
      console.log(`Made: a lost dispute whose share (${debt?.amountCents} cents) is taken back from host@test.local from ${debt?.dueAt.toISOString()}: /disputes/${c.disputeId}, and "Your earnings" on /host.`);
    } else {
      const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(and(eq(schema.calls.hostId, seeded.id), like(schema.calls.roomName, "takebackcheck-%")));
      for (const call of calls) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
        if (!payment) continue;
        const rows = await db.select().from(debts).where(eq(debts.paymentId, payment.id));
        // Nothing of the demo is left for the helper to take, and what is left of the share it sent is taken back here.
        await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(debts.paymentId, payment.id), eq(debts.status, "told")));
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
      check("it is due 14 days after the moment the notice was written (not the moment the look began)", debt.dueAt.getTime() === debt.toldAt.getTime() + NOTICE_MS && debt.toldAt.getTime() >= NOW.getTime() && debt.toldAt.getTime() - NOW.getTime() < 60_000);
      const told = await messagesOf(debt.id);
      check("the host is told once, in the app and by email: which payment, how much, from when, and where to object", told.length === 1 && told[0].userId === host.id && told[0].body.includes("$12.38") && told[0].body.includes("You had already collected your share") && told[0].body.includes("Until then nothing is taken") && told[0].body.includes("write to us at") && told[0].path === `/disputes/${c.disputeId}` && (await emailsOf(debt.id)).filter((mail) => mail.dedupeKey === told[0].key).length === 1, told[0]?.body.slice(0, 200));
      check("the customer is told nothing about it", told.every((one) => one.userId !== customer.id));
      const toFounders = (await emailsOf(debt.id)).filter((mail) => mail.dedupeKey?.includes(":owed:founder:"));
      check("each admin gets one email: what the app will do, and that it can be cancelled", toFounders.length === admins.length && toFounders.every((mail) => mail.body.includes("you can cancel the take-back") && mail.body.includes(`/disputes/${c.disputeId}`)), toFounders.length);
      check("the host's earnings and the dispute's page show it", (await debtsOfHost(host.id)).some((one) => one.id === debt.id && one.path === `/disputes/${c.disputeId}`) && (await debtsOfDispute(c.disputeId)).length === 1);

      await pass(new Date(debt.dueAt.getTime() - 1000), c.disputeId);
      check("a second before the 14 days are over, nothing is taken", (await transferAt(c.transferId)).amount_reversed === 0 && (await debtOf(c.disputeId)).status === "told" && (await operationsOf(c.payment.id)).length === 0);
      await pass(debt.dueAt, c.disputeId);
      const after = await debtOf(c.disputeId);
      const atStripe = await transferAt(c.transferId);
      const reversals = (await stripe().transfers.listReversals(c.transferId, { limit: 10 })).data;
      check("at 14 days it is taken: the row says so, with Stripe's reversal", after.status === "taken" && after.takenAt !== null && after.stripeReversalId === reversals[0]?.id, `${after.status} ${after.refusal ?? ""}`);
      check("the reversal is real at Stripe: the right amount, out of the right transfer, with the take-back's id on it", atStripe.amount_reversed === 1238 && reversals.length === 1 && reversals[0].amount === 1238 && reversals[0].metadata?.debtId === debt.id, `${atStripe.amount_reversed} ${reversals.length}`);
      const operations = await operationsOf(c.payment.id);
      check("it went through the steps of a money action: one, succeeded, under the take-back's own label", operations.length === 1 && operations[0].status === "succeeded" && operations[0].label === `takeback:${debt.id}:1` && operations[0].stripeId === after.stripeReversalId);
      check("the money record adds up: $12.38 sent, $12.38 taken back", (await ledgerOf(c.payment.id, "host_transfer")) === -1238 && (await ledgerOf(c.payment.id, "host_takeback")) === 1238);
      check("the host is told that it was taken", (await messagesOf(debt.id)).some((one) => one.key.includes(":taken:") && one.body.includes("Stripe has taken $12.38 back")));
      await pass(new Date(debt.dueAt.getTime() + 3 * RETRY_MS), c.disputeId);
      check("nothing is ever taken a second time", (await transferAt(c.transferId)).amount_reversed === 1238 && (await operationsOf(c.payment.id)).length === 1 && (await debtsFor(c.disputeId)).length === 1);
      check("a take-back that was taken cannot be cancelled", (await cancelDebt({ debtId: debt.id, adminId: admins[0]?.id ?? host.id })) === false && (await debtOf(c.disputeId)).status === "taken");

      // Taken, and then the bank decides the other way (written into the local record: the test area cannot do it).
      await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, c.disputeId));
      await pass(new Date(debt.dueAt.getTime() + 4 * RETRY_MS), c.disputeId);
      await pass(new Date(debt.dueAt.getTime() + 5 * RETRY_MS), c.disputeId);
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
      await pass(rows[0].dueAt, ...both);
      await pass(new Date(rows[0].dueAt.getTime() + 1000), ...both);
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
      await stripe().transfers.createReversal(sent.transferId, { amount: sent.sentCents - part });
      await pass(NOW, ...both);
      let rows = (await db.select().from(debts).where(inArray(debts.disputeId, both))).sort((a, b) => b.amountCents - a.amountCents);
      check("one dispute gets what is left of the transfer; the other is told nothing, because nothing more can be taken", rows.length === 2 && rows[0].status === "told" && rows[0].amountCents === part && rows[1].status === "nothing" && (await messagesOf(rows[1].id)).length === 0, rows.map((row) => `${row.status}:${row.amountCents}`).join(" "));
      if (admins.length > 0) {
        await cancelDebt({ debtId: rows[0].id, adminId: admins[0].id });
        await pass(NOW, ...both);
        rows = await db.select().from(debts).where(inArray(debts.disputeId, both));
        const freed = rows.find((row) => row.status === "told");
        check("the first is cancelled: the other dispute's share is worked out afresh, and gets a notice of its own with 14 days", rows.length === 2 && rows.some((row) => row.status === "cancelled") && freed !== undefined && freed.amountCents === part && (await messagesOf(freed.id)).length === 1 && freed.dueAt.getTime() === freed.toldAt.getTime() + NOTICE_MS, rows.map((row) => `${row.status}:${row.amountCents}`).join(" "));
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
        await pass(new Date(debt.dueAt.getTime() + RETRY_MS), c.disputeId);
        check("a cancelled take-back is never taken, and no new one is written for the same share", (await transferAt(c.transferId)).amount_reversed === 0 && (await debtsFor(c.disputeId)).length === 1 && (await operationsOf(c.payment.id)).length === 0);
      }

      const customer2 = await person("customer");
      const w = await collectedThenLost(host, customer2);
      await pass(NOW, w.disputeId);
      const waiting = await debtOf(w.disputeId);
      await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, w.disputeId));
      await pass(waiting.dueAt, w.disputeId);
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
      await pass(debt.dueAt, c.disputeId);
      let row = await debtOf(c.disputeId);
      let operations = await operationsOf(c.payment.id);
      check("a clear \"no\" from Stripe: the action is marked as not done, and the row is back at its notice with what Stripe said", row.status === "told" && Boolean(row.refusal) && row.refusedAt !== null && row.firstRefusedAt !== null && operations.length === 1 && operations[0].status === "failed", `${row.status} ${row.refusal}`);
      // As if that refusal had come at the moment the notice ended.
      await db.update(debts).set({ refusedAt: debt.dueAt, firstRefusedAt: debt.dueAt }).where(eq(debts.id, debt.id));
      await pass(new Date(debt.dueAt.getTime() + RETRY_MS - 1000), c.disputeId);
      check("it is not tried again within a day", (await operationsOf(c.payment.id)).length === 1);
      await pass(new Date(debt.dueAt.getTime() + RETRY_MS), c.disputeId);
      row = await debtOf(c.disputeId);
      operations = await operationsOf(c.payment.id);
      check("a day later it is tried again, under a new label, and is back at its notice once more", operations.length === 2 && operations[1].label === `takeback:${debt.id}:2` && operations[1].status === "failed" && row.status === "told", `${operations.length} ${row.status}`);
      check("the first refusal's date is kept", row.firstRefusedAt?.getTime() === debt.dueAt.getTime());
      await db.update(debts).set({ refusedAt: new Date(debt.dueAt.getTime() + TELL_FOUNDER_AFTER_MS) }).where(eq(debts.id, debt.id));
      await pass(new Date(debt.dueAt.getTime() + TELL_FOUNDER_AFTER_MS - 1000), c.disputeId);
      check("before 30 days of refusals the founder is not told", (await emailsOf(debt.id)).every((mail) => !mail.dedupeKey?.includes(":refused:")));
      await pass(new Date(debt.dueAt.getTime() + TELL_FOUNDER_AFTER_MS), c.disputeId);
      await pass(new Date(debt.dueAt.getTime() + TELL_FOUNDER_AFTER_MS + 1000), c.disputeId);
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
        const started = await db.transaction((tx) => startMoneyOperation(tx, takePlan(debt, debt.dueAt)));
        if (started === "already_done") throw new Error("The take-back was already done.");
        return { ...c, debt, started };
      };

      // Written down, never sent, and too old to send again: Stripe's own list shows it did not happen.
      const never = await writtenDown();
      check("writing the action down moves the row to \"being taken\"", (await debtOf(never.disputeId)).status === "taking");
      check("a take-back that is being taken cannot be cancelled", (await cancelDebt({ debtId: never.debt.id, adminId: admins[0]?.id ?? host.id })) === false && (await debtOf(never.disputeId)).status === "taking");
      await db.update(schema.disputes).set({ outcome: "won", status: "won" }).where(eq(schema.disputes.id, never.disputeId));
      await pass(new Date(never.debt.dueAt.getTime() + RETRY_MS), never.disputeId);
      check("the dispute is won while it is under way: the row waits for its action", (await debtOf(never.disputeId)).status === "taking");
      // The helper comes back two minutes later. A repeat could be the first time Stripe really does it, and the dispute
      // is no longer lost: nothing is sent, and nothing is concluded yet either.
      await age(never.started.operationId, 2 * 60_000);
      await reconcileOperations(new Date());
      check("no request is sent again for a dispute that is no longer lost, and nothing is concluded while the first could still be on its way", (await debtOf(never.disputeId)).status === "taking" && (await operationsOf(never.payment.id))[0].status === "started" && (await transferAt(never.transferId)).amount_reversed === 0);
      await age(never.started.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date());
      let row = await debtOf(never.disputeId);
      let [operation] = await operationsOf(never.payment.id);
      check("the helper's check finds \"it did not happen\": the action is failed and the row is back at its notice, never left \"being taken\"", operation.status === "failed" && row.status === "told" && /did not happen/.test(row.refusal ?? "") && (await transferAt(never.transferId)).amount_reversed === 0, `${operation.status} ${row.status}`);
      await pass(new Date(never.debt.dueAt.getTime() + 2 * RETRY_MS), never.disputeId);
      check("and then, the dispute being won, it is called off", (await debtOf(never.disputeId)).status === "cancelled" && (await transferAt(never.transferId)).amount_reversed === 0);

      // Stripe did it and the reply was lost: the same request again gives the first reply back.
      const lost = await writtenDown();
      await reverseAtStripe(lost.started.params, lost.started.label);
      await age(lost.started.operationId, 2 * 60_000);
      await reconcileOperations(new Date());
      row = await debtOf(lost.disputeId);
      [operation] = await operationsOf(lost.payment.id);
      check("Stripe did it and the reply was lost: the helper finishes it, recorded once, taken once", operation.status === "succeeded" && row.status === "taken" && (await transferAt(lost.transferId)).amount_reversed === lost.sentCents && (await stripe().transfers.listReversals(lost.transferId, { limit: 10 })).data.length === 1 && (await ledgerOf(lost.payment.id, "host_takeback")) === lost.sentCents, `${operation.status} ${row.status}`);

      // The same, found too late to send again: the reversal is found in the transfer's own list by the take-back's id.
      const old = await writtenDown();
      await reverseAtStripe(old.started.params, old.started.label);
      await age(old.started.operationId, 25 * 3_600_000);
      await reconcileOperations(new Date());
      row = await debtOf(old.disputeId);
      [operation] = await operationsOf(old.payment.id);
      check("found too late to repeat: the reversal is found by the take-back's id, and recorded once", operation.status === "succeeded" && row.status === "taken" && row.stripeReversalId !== null && (await transferAt(old.transferId)).amount_reversed === old.sentCents && (await ledgerOf(old.payment.id, "host_takeback")) === old.sentCents, `${operation.status} ${row.status}`);
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
      await db.update(debts).set({ status: "cancelled", cancelledAt: new Date() }).where(and(inArray(debts.disputeId, made), inArray(debts.status, ["told"])));
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
