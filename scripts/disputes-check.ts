/**
 * Testing tool for bank disputes (plans/47-bank-disputes.md, part 1): the app's record of each
 * dispute, the Messages page's content, and who is told what.
 *
 * It makes real disputes in Stripe's test area with Stripe's test cards, and checks every result
 * in the local database. No real money moves. It makes its own host and customer, so nothing it
 * writes lands in the seeded test accounts' messages, and at the end it removes the messages it
 * caused and closes the test disputes it left open.
 *
 * Usage: npx tsx scripts/disputes-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
  const { settleFinishedCalls } = await import("../src/lib/payments/jobs");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { refreshPaymentDispute } = await import("../src/lib/payments/disputes");
  const { catchUpFromStripe, lookAtOpenDisputes, recordDisputesOf, disputesForFounder } = await import("../src/lib/disputes/record");
  const { disputeForViewer, disputePagesOf } = await import("../src/lib/disputes/pages");
  const { markRead, messagesOf, unreadCount } = await import("../src/lib/messages/messages");

  const RUN = randomUUID().slice(0, 8);
  const PRICE = 2000; // $20 per 15 minutes
  const MINUTES = 10; // booked total: $13.33
  const stamp = new Date();
  let people = 0;
  /** A person nobody else uses, so their messages are only the ones this script caused. */
  const person = async (label: string) => {
    const id = `dc-${RUN}-${++people}`;
    const [row] = await db
      .insert(schema.user)
      .values({ id, name: `Dispute check ${label} ${people}`, email: `disputecheck-${RUN}-${people}@example.test`, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" })
      .returning();
    return row;
  };
  type Person = Awaited<ReturnType<typeof person>>;
  const admins = await db.select({ id: schema.user.id }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
  const madeDisputes: string[] = [];

  const reload = async (id: string) => (await db.select().from(schema.payments).where(eq(schema.payments.id, id)))[0];
  const rowOf = async (disputeId: string) => (await db.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId)))[0];
  const messagesAbout = (disputeId: string) => db.select().from(schema.messages).where(like(schema.messages.key, `dispute:${disputeId}:%`));
  const emailsAbout = (disputeId: string) => db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `dispute:${disputeId}:%`));
  const pause = (ms = 2000) => new Promise((resolve) => setTimeout(resolve, ms));

  /** A charged call paid with one of Stripe's test cards: host there the full 10 minutes, $13.33. */
  async function chargedCall(host: Person, customer: Person, card: string) {
    const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + MINUTES * 60_000);
    const { call, payment } = await db.transaction(async (tx) => {
      const [made] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt, roomName: `disputecheck-${randomUUID()}`, pricePer15Cents: PRICE }).returning();
      await createPaymentForCall(tx, made);
      const [paid] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, made.id));
      return { call: made, payment: paid };
    });
    await startHold({ payment, call, customer, now: new Date() });
    const withIntent = await reload(payment.id);
    await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, { payment_method: card, return_url: "https://example.com/return" });
    await syncHold(payment.id, new Date());
    for (const [who, identity] of [["host", host.id], ["customer", customer.id]] as const) {
      const session = `PA_${who}_${randomUUID().slice(0, 6)}`;
      const row = (type: string, time: Date) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_disputecheck", participantIdentity: identity, participantSessionId: session, providerTime: time, payload: "{}" });
      await db.insert(schema.attendanceEvents).values([row("participant_joined", startsAt), row("participant_left", endsAt)]);
    }
    await db.update(schema.calls).set({ closedAt: new Date(endsAt.getTime() + 60_000) }).where(eq(schema.calls.id, call.id));
    // The moment the money is taken when nobody asked for a refund: 24 hours and 3 minutes after the call's start.
    await settleFinishedCalls(new Date(startsAt.getTime() + (24 * 60 + 3) * 60_000));
    const charged = await reload(payment.id);
    if (charged.status !== "charged") throw new Error(`The test call was not charged (${charged.status}).`);
    return { call, payment: charged, intentId: charged.stripePaymentIntentId! };
  }

  /** Waits for Stripe to open disputes on a payment made with one of its always-disputed test cards. */
  async function disputesAtStripe(intentId: string, atLeast = 1, tries = 30) {
    for (let i = 0; i < tries; i++) {
      const found = (await stripe().disputes.list({ payment_intent: intentId, limit: 10 })).data;
      if (found.length >= atLeast) {
        for (const dispute of found) if (!madeDisputes.includes(dispute.id)) madeDisputes.push(dispute.id);
        return found;
      }
      await pause();
    }
    return [];
  }

  /** Has Stripe decide a test dispute: its test area takes these two exact texts as "won" and "lost". */
  async function decide(disputeId: string, how: "won" | "lost") {
    await stripe().disputes.update(disputeId, { evidence: { uncategorized_text: how === "won" ? "winning_evidence" : "losing_evidence" } });
    let status = "";
    for (let i = 0; i < 30 && status !== how; i++) {
      status = (await stripe().disputes.retrieve(disputeId)).status;
      if (status !== how) await pause();
    }
    return status;
  }

  const message = (type: string, disputeId: string) => ({ type, data: { object: { id: disputeId } } });
  const anHourLater = () => new Date(Date.now() + 3_600_000 + 60_000);

  try {
    const host = await person("host");
    const customer = await person("customer");
    const stranger = await person("stranger");
    const everyone = 2 + admins.length;

    // ----------------------------------------------------------------------
    console.log("\n1. A real dispute: recorded once, and the three are told once");
    const first = await chargedCall(host, customer, "pm_card_createDispute");
    const [d1] = await disputesAtStripe(first.intentId);
    check("Stripe opened a dispute on the charge", Boolean(d1));
    if (!d1) throw new Error("Stripe opened no dispute; the rest cannot run.");
    {
      await handleStripeEvent(message("charge.dispute.created", d1.id));
      const row = await rowOf(d1.id);
      check("the money is held back, as before", (await reload(first.payment.id)).disputeOpen === true);
      check("the dispute has a row of its own, for the call's payment", row?.paymentId === first.payment.id && row.monthId === null && row.contributionPaymentId === null, JSON.stringify(row ?? null).slice(0, 120));
      check("with its host, its customer and the disputed amount", row?.hostId === host.id && row.customerId === customer.id && row.amountCents === 1333 && row.currency === "usd", `${row?.amountCents}`);
      check("as a chargeback that waits for an answer, not ended", row?.stage === "chargeback" && row.status === "needs_response" && row.outcome === null && row.endedAt === null, `${row?.stage} ${row?.status}`);
      check("with the bank's reason and its deadline", row?.reason === "fraudulent" && row.compliance === false && row.dueBy !== null && row.dueBy > new Date(), `${row?.reason} ${row?.dueBy?.toISOString()}`);

      const told = await messagesAbout(d1.id);
      const mails = await emailsAbout(d1.id);
      check("the host, the customer and each admin got one message", told.length === everyone && told.filter((m) => m.userId === host.id).length === 1 && told.filter((m) => m.userId === customer.id).length === 1 && admins.every((a) => told.filter((m) => m.userId === a.id).length === 1), `${told.length} for ${everyone}`);
      check("and one email each, under the same key", mails.length === everyone && told.every((m) => mails.some((mail) => mail.dedupeKey === m.key)));
      check("the email carries the same subject and the same words as the message", told.every((m) => { const mail = mails.find((one) => one.dedupeKey === m.key)!; return mail.subject === m.subject && mail.body.startsWith(m.body); }));
      const toHost = told.find((m) => m.userId === host.id)!;
      const toCustomer = told.find((m) => m.userId === customer.id)!;
      check("the host is told whose bank, what for, how much, and that the money cannot be collected", toHost.body.includes(customer.name) && toHost.body.includes("$13.33") && toHost.body.includes("your call with") && toHost.body.includes("cannot be collected"), toHost.body.slice(0, 160));
      check("and is asked not to contact the customer", toHost.body.includes("do not contact the customer"));
      check("the host's message leads to the dispute's page", toHost.path === `/disputes/${d1.id}`);
      check("the customer is told their bank can withdraw it, and where to write", toCustomer.body.includes("withdraw") && toCustomer.body.includes("$13.33") && toCustomer.body.includes("write to us at"), toCustomer.body.slice(0, 160));
      check("the customer's message leads to the call's page, not to the dispute's", toCustomer.path === `/calls/${first.call.id}/results`);
      check("nothing in it promises what the app does not do yet (no answer to the bank, no taking back)", told.every((m) => !/we (will )?(fight|answer)|taken back from/i.test(m.body)));
      if (admins.length > 0) {
        const toFounder = told.find((m) => m.userId === admins[0].id)!;
        check("the founder is told the bank's reason and deadline, and that it is still answered by hand", toFounder.body.includes("did not make this payment") && toFounder.body.includes("wants an answer by") && toFounder.body.includes("by hand in Stripe"), toFounder.body.slice(0, 200));
      }

      await handleStripeEvent(message("charge.dispute.created", d1.id));
      await handleStripeEvent(message("charge.dispute.updated", d1.id));
      await recordDisputesOf({ kind: "payment", id: first.payment.id });
      check("handling Stripe's message again, and again, changes nothing", (await messagesAbout(d1.id)).length === everyone && (await emailsAbout(d1.id)).length === everyone && (await db.select().from(schema.disputes).where(eq(schema.disputes.paymentId, first.payment.id))).length === 1);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Messages: a person sees only their own, and they count as read once shown");
    {
      const mine = await messagesOf(host.id);
      check("the host's Messages page has the message", mine.length === 1 && mine[0].readAt === null && (await unreadCount(host.id)) === 1);
      check("someone else's page has none of it", (await messagesOf(stranger.id)).length === 0 && (await unreadCount(stranger.id)) === 0);
      await markRead(stranger.id, [mine[0].id]);
      check("nobody else can mark it as read", (await unreadCount(host.id)) === 1);
      await markRead(host.id, [mine[0].id]);
      const after = await messagesOf(host.id);
      check("once shown, it is read and no longer counted", after[0].readAt !== null && (await unreadCount(host.id)) === 0);
      const readAt = after[0].readAt!.getTime();
      await markRead(host.id, [mine[0].id], new Date(Date.now() + 60_000));
      check("the moment it was first read is kept", (await messagesOf(host.id))[0].readAt!.getTime() === readAt);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. The dispute's page: for its host and the founder, for nobody else");
    {
      check("the host may open it", (await disputeForViewer(d1.id, host, false))?.id === d1.id);
      check("the founder may open it", (await disputeForViewer(d1.id, stranger, true))?.id === d1.id);
      check("the customer may not", (await disputeForViewer(d1.id, customer, false)) === null);
      check("a stranger may not", (await disputeForViewer(d1.id, stranger, false)) === null);
      check("one that does not exist is the same \"not found\"", (await disputeForViewer("du_does_not_exist", host, true)) === null);
      const pages = await disputePagesOf([await reload(first.payment.id)]);
      check("the host's earnings line about this payment leads to that page", pages.get(first.payment.id) === `/disputes/${d1.id}`);
      const list = await disputesForFounder();
      check("it is on the founder's list of open disputes", list.open.some((d) => d.id === d1.id) && !list.ended.some((d) => d.id === d1.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. The dispute is lost, and Stripe's message about it never comes");
    {
      check("Stripe says the dispute was lost", (await decide(d1.id, "lost")) === "lost");
      await lookAtOpenDisputes(new Date(), { disputeIds: [d1.id] });
      check("within the hour the look leaves it alone", (await rowOf(d1.id)).outcome === null);
      await lookAtOpenDisputes(anHourLater(), { disputeIds: [d1.id] });
      const row = await rowOf(d1.id);
      check("an hour later the look records the ending", row.outcome === "lost" && row.endedAt !== null && row.status === "lost", `${row.outcome} ${row.status}`);
      check("the money stays held back after a lost dispute", (await reload(first.payment.id)).disputeOpen === true);
      const ended = (await messagesAbout(d1.id)).filter((m) => m.key.includes(":ended:lost:"));
      check("the three are told how it ended, once", ended.length === everyone && ended.some((m) => m.userId === host.id && m.body.includes("no longer yours")) && ended.some((m) => m.userId === customer.id && m.body.includes("returned $13.33 to you")), `${ended.length}`);
      check("the host is not promised a take-back the app does not make", ended.filter((m) => m.userId === host.id).every((m) => m.body.includes("Connect will write to you") && !/taken back/i.test(m.body)));
      await handleStripeEvent(message("charge.dispute.closed", d1.id));
      await lookAtOpenDisputes(anHourLater(), { disputeIds: [d1.id] });
      check("the late message and another look tell nobody twice", (await messagesAbout(d1.id)).length === 2 * everyone);
      const list = await disputesForFounder(500);
      check("on the founder's list it has moved to the ended ones", !list.open.some((d) => d.id === d1.id) && list.ended.some((d) => d.id === d1.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Two of Stripe's messages at the same moment");
    const second = await chargedCall(host, customer, "pm_card_createDisputeProductNotReceived");
    const [d2] = await disputesAtStripe(second.intentId);
    if (!d2) check("Stripe opened a dispute on the second charge", false);
    else {
      await Promise.all([handleStripeEvent(message("charge.dispute.created", d2.id)), handleStripeEvent(message("charge.dispute.created", d2.id)), handleStripeEvent(message("charge.dispute.updated", d2.id))]);
      const rows = await db.select().from(schema.disputes).where(eq(schema.disputes.paymentId, second.payment.id));
      check("one row", rows.length === 1 && rows[0].reason === "product_not_received", `${rows.length} ${rows[0]?.reason}`);
      check("one set of messages and emails", (await messagesAbout(d2.id)).length === everyone && (await emailsAbout(d2.id)).length === everyone, `${(await messagesAbout(d2.id)).length}`);
      check("the bank's reason is put in plain words for the host", (await messagesAbout(d2.id)).some((m) => m.userId === host.id && m.body.includes("did not get what they paid for")));

      console.log("\n6. The dispute is won: the money can move again, and the three are told");
      check("Stripe says the dispute was won", (await decide(d2.id, "won")) === "won");
      await handleStripeEvent(message("charge.dispute.closed", d2.id));
      const row = await rowOf(d2.id);
      check("the ending is recorded", row.outcome === "won" && row.endedAt !== null);
      check("the money is no longer held back", (await reload(second.payment.id)).disputeOpen === false);
      const ended = (await messagesAbout(d2.id)).filter((m) => m.key.includes(":ended:won:"));
      check("the host is told it can be collected again, the customer that the payment stands", ended.length === everyone && ended.some((m) => m.userId === host.id && m.body.includes("can be collected again")) && ended.some((m) => m.userId === customer.id && m.body.includes("the payment stands")));
      check("it has left the founder's list of open disputes", (await disputesForFounder()).open.every((d) => d.id !== d2.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n7. A dispute no message ever announced: found from Stripe's own list");
    const third = await chargedCall(host, customer, "pm_card_createDispute");
    const [d3] = await disputesAtStripe(third.intentId);
    if (!d3) check("Stripe opened a dispute on the third charge", false);
    else {
      check("the app knows nothing of it yet", (await rowOf(d3.id)) === undefined && (await reload(third.payment.id)).disputeOpen === false);
      await catchUpFromStripe(new Date(), 1, { disputeIds: [d3.id] });
      const row = await rowOf(d3.id);
      check("catching up records it, and holds the money back", row?.paymentId === third.payment.id && row.outcome === null && (await reload(third.payment.id)).disputeOpen === true);
      check("and the three are told", (await messagesAbout(d3.id)).length === everyone);
      await catchUpFromStripe(new Date(), 1, { disputeIds: [d3.id] });
      check("catching up again changes nothing", (await messagesAbout(d3.id)).length === everyone);

      console.log("\n8. A known dispute that changed at Stripe with no message: catching up sees the difference");
      check("Stripe says the dispute was won", (await decide(d3.id, "won")) === "won");
      await catchUpFromStripe(new Date(), 1, { disputeIds: [d3.id] });
      check("the new status is recorded, and the money can move again", (await rowOf(d3.id)).outcome === "won" && (await reload(third.payment.id)).disputeOpen === false);
    }

    // ----------------------------------------------------------------------
    console.log("\n9. A fault while writing the record does not leave Stripe's message unhandled");
    const fourth = await chargedCall(host, customer, "pm_card_createDispute");
    const [d4] = await disputesAtStripe(fourth.intentId);
    if (!d4) check("Stripe opened a dispute on the fourth charge", false);
    else {
      // The database refuses this one row, as a fault of ours would. Only this dispute's id is affected; it is taken away again below.
      const trigger = `disputecheck_${RUN}`;
      await db.execute(sql.raw(`create function ${trigger}() returns trigger language plpgsql as $$ begin if new.id = '${d4.id.replace(/[^A-Za-z0-9_]/g, "")}' then raise exception 'dispute check: refused on purpose'; end if; return new; end $$`));
      await db.execute(sql.raw(`create trigger ${trigger} before insert on disputes for each row execute function ${trigger}()`));
      const quiet = console.error;
      let logged = 0;
      console.error = () => void logged++;
      let thrown: unknown = null;
      try {
        await handleStripeEvent(message("charge.dispute.created", d4.id)).catch((error) => (thrown = error));
      } finally {
        console.error = quiet;
        await db.execute(sql.raw(`drop trigger if exists ${trigger} on disputes`));
        await db.execute(sql.raw(`drop function if exists ${trigger}()`));
      }
      check("handling the message does not fail", thrown === null, String(thrown));
      check("the money is held back all the same", (await reload(fourth.payment.id)).disputeOpen === true);
      check("the record is missing, nobody was told half a story, and the fault was logged", (await rowOf(d4.id)) === undefined && (await messagesAbout(d4.id)).length === 0 && logged > 0);
      await catchUpFromStripe(new Date(), 1, { disputeIds: [d4.id] });
      check("the helper's catch-up writes the record and tells the three", (await rowOf(d4.id))?.paymentId === fourth.payment.id && (await messagesAbout(d4.id)).length === everyone);
    }

    // ----------------------------------------------------------------------
    console.log("\n10. A bank's question (an inquiry)");
    const fifth = await chargedCall(host, customer, "pm_card_createDisputeInquiry");
    const [d5] = await disputesAtStripe(fifth.intentId);
    if (!d5) check("Stripe opened a question on the fifth charge", false);
    else {
      await handleStripeEvent(message("charge.dispute.created", d5.id));
      const row = await rowOf(d5.id);
      check("recorded as a question, waiting for an answer", row?.stage === "question" && row.status === "warning_needs_response" && row.outcome === null, `${row?.stage} ${row?.status}`);
      check("the money is held back while it is open, as before", (await reload(fifth.payment.id)).disputeOpen === true);
      const told = await messagesAbout(d5.id);
      check("the host is told it is a question, not yet a dispute", told.some((m) => m.userId === host.id && m.key.includes(":question:began:") && m.body.includes("not yet a dispute")));
      check("the customer is told they need not do anything", told.some((m) => m.userId === customer.id && m.body.includes("do not need to do anything")));
    }

    // ----------------------------------------------------------------------
    console.log("\n11. A bank that disputes one charge more than once");
    const sixth = await chargedCall(host, customer, "pm_card_createMultipleDisputes");
    let several = await disputesAtStripe(sixth.intentId, 2, 20);
    if (several.length < 2) {
      // Stripe may open the second only once the first has been decided.
      const [only] = await disputesAtStripe(sixth.intentId);
      if (only) {
        await handleStripeEvent(message("charge.dispute.created", only.id));
        await decide(only.id, "won");
        several = await disputesAtStripe(sixth.intentId, 2, 30);
      }
    }
    check("Stripe opened more than one dispute on the charge", several.length >= 2, `${several.length}`);
    if (several.length >= 2) {
      for (const dispute of several) await handleStripeEvent(message("charge.dispute.created", dispute.id));
      const rows = await db.select().from(schema.disputes).where(eq(schema.disputes.paymentId, sixth.payment.id));
      check("each has a row of its own", rows.length === several.length, `${rows.length} of ${several.length}`);
      const stillOpen = several.find((dispute) => dispute.status === "needs_response") ?? several[0];
      const other = several.find((dispute) => dispute.id !== stillOpen.id)!;
      if ((await stripe().disputes.retrieve(other.id)).status === "needs_response") await decide(other.id, "won");
      // Stripe's message is about the one that was won. Before plan 47 this alone unfroze the money.
      await handleStripeEvent(message("charge.dispute.closed", other.id));
      const now = (await stripe().disputes.list({ payment_intent: sixth.intentId, limit: 10 })).data.map((dispute) => dispute.status).sort().join(", ");
      check("one is won and another still open: the money stays held back", (await reload(sixth.payment.id)).disputeOpen === true, now);
      for (const dispute of (await stripe().disputes.list({ payment_intent: sixth.intentId, limit: 10 })).data) {
        if (dispute.status === "needs_response") await decide(dispute.id, "won");
      }
      await refreshPaymentDispute(sixth.payment.id);
      check("once every one of them is won, it can move again", (await reload(sixth.payment.id)).disputeOpen === false);
    }
  } finally {
    // Take away what this script caused: the messages and emails about its disputes, and the test disputes it left open.
    if (madeDisputes.length > 0) {
      const mine = or(...madeDisputes.map((id) => like(schema.messages.key, `dispute:${id}:%`)));
      await db.delete(schema.messages).where(mine);
      await db.delete(schema.emailOutbox).where(or(...madeDisputes.map((id) => like(schema.emailOutbox.dedupeKey, `dispute:${id}:%`))));
      // Also what an earlier run of this script left open, if it stopped half way: its hosts are named "dc-...".
      const left = await db.select({ id: schema.disputes.id }).from(schema.disputes).where(and(like(schema.disputes.hostId, "dc-%"), sql`${schema.disputes.outcome} is null`));
      for (const id of new Set([...madeDisputes, ...left.map((row) => row.id)])) {
        const current = await stripe().disputes.retrieve(id).catch(() => null);
        if (current?.status === "needs_response") await stripe().disputes.close(id).catch(() => undefined);
        // A bank's question cannot be closed; Stripe's test area ends it when it gets this text as the answer.
        if (current?.status === "warning_needs_response") await stripe().disputes.update(id, { evidence: { uncategorized_text: "winning_evidence" } }).catch(() => undefined);
      }
      await pause(4000);
      // Their rows are brought up to date, so the helper's hourly look has nothing left to ask about them.
      const rows = await db.select().from(schema.disputes).where(and(or(inArray(schema.disputes.id, madeDisputes), like(schema.disputes.hostId, "dc-%")), sql`${schema.disputes.outcome} is null`));
      for (const row of rows) if (row.paymentId) await recordDisputesOf({ kind: "payment", id: row.paymentId }).catch(() => undefined);
      await db.delete(schema.messages).where(like(schema.messages.userId, "dc-%"));
      await db.delete(schema.messages).where(mine);
      await db.delete(schema.emailOutbox).where(or(...madeDisputes.map((id) => like(schema.emailOutbox.dedupeKey, `dispute:${id}:%`))));
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
