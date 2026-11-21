/**
 * Testing tool for the answer to a bank (plans/47-bank-disputes.md, part 2): the host's choice,
 * what the app sends to Stripe, and the customer's stop.
 *
 * It makes real disputes in Stripe's test area with Stripe's test cards, and checks every result at
 * Stripe and in the local database. No real money moves. It makes its own host and customers, takes
 * the money only of the calls it made itself, and at the end ends the test disputes it left open
 * and removes the messages and emails about them.
 *
 * Stripe's test area decides a test dispute only on two exact texts ("winning_evidence",
 * "losing_evidence"). So one journey sends the app's own proof and looks at what Stripe received,
 * and the journeys that need a decision send one of those texts in the proof's place (answer.ts,
 * `ForCheck`).
 *
 * Usage: npx tsx scripts/dispute-answers-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, like, or } from "drizzle-orm";
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
  const { settleOrdinaryCharges } = await import("../src/lib/payments/take");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { lookAtOpenDisputes, recordDisputesOf, refreshOwner } = await import("../src/lib/disputes/record");
  const { answerDisputes, answerOne, disputeHealthProblems } = await import("../src/lib/disputes/answer");
  const { chooseAnswer, ChoiceError } = await import("../src/lib/disputes/choose");
  const { allowPayingAgain, STOPPED_AFTER_LOSS, STOPPED_WHILE_OPEN, whyNoNewPayment } = await import("../src/lib/disputes/paying");
  const { canChoose, ASK_MS } = await import("../src/lib/disputes/rules");

  const RUN = randomUUID().slice(0, 8);
  const stamp = new Date();
  let people = 0;
  const person = async (label: string) => {
    const id = `da-${RUN}-${++people}`;
    const [row] = await db
      .insert(schema.user)
      .values({ id, name: `Answer check ${label} ${people}`, email: `answercheck-${RUN}-${people}@example.test`, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" })
      .returning();
    return row;
  };
  type Person = Awaited<ReturnType<typeof person>>;
  const admins = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
  const made: string[] = [];

  const reload = async (id: string) => (await db.select().from(schema.payments).where(eq(schema.payments.id, id)))[0];
  const rowOf = async (disputeId: string) => (await db.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId)))[0];
  const messagesAbout = (disputeId: string) => db.select().from(schema.messages).where(like(schema.messages.key, `dispute:${disputeId}:%`));
  const emailsAbout = (disputeId: string) => db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `dispute:${disputeId}:%`));
  const atStripe = (disputeId: string) => stripe().disputes.retrieve(disputeId);
  const pause = (ms = 2000) => new Promise((resolve) => setTimeout(resolve, ms));
  const message = (type: string, disputeId: string) => ({ type, data: { object: { id: disputeId } } });
  /** The helper's look, as it runs a minute or two after something marked a dispute "look again". */
  // Each look is a later one than the last: a dispute marked "look again" is asked about a minute after its last turn.
  let looks = 0;
  const helperLooks = (...disputeIds: string[]) => lookAtOpenDisputes(new Date(Date.now() + 120_000 * ++looks), { disputeIds });
  const refused = async (work: Promise<unknown>) => work.then(() => null, (error: unknown) => (error instanceof ChoiceError ? error.message : `unexpected: ${String(error)}`));

  /** A charged call paid with one of Stripe's test cards, and the dispute Stripe opens on it, recorded as a message from Stripe would. */
  async function disputed(host: Person, customer: Person, card: string, record = true) {
    const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + 10 * 60_000);
    const { call, payment } = await db.transaction(async (tx) => {
      const [newCall] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt, roomName: `answercheck-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
      await createPaymentForCall(tx, newCall);
      const [paid] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, newCall.id));
      return { call: newCall, payment: paid };
    });
    await startHold({ payment, call, customer, now: new Date() });
    await stripe().paymentIntents.confirm((await reload(payment.id)).stripePaymentIntentId!, { payment_method: card, return_url: "https://example.com/return" });
    await syncHold(payment.id, new Date());
    for (const [who, identity] of [["host", host.id], ["customer", customer.id]] as const) {
      const session = `PA_${who}_${randomUUID().slice(0, 6)}`;
      const row = (type: string, time: Date) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_answercheck", participantIdentity: identity, participantSessionId: session, providerTime: time, payload: "{}" });
      await db.insert(schema.attendanceEvents).values([row("participant_joined", startsAt), row("participant_left", endsAt)]);
    }
    await db.update(schema.calls).set({ closedAt: new Date(endsAt.getTime() + 60_000) }).where(eq(schema.calls.id, call.id));
    // Only this call's money (the job that settles every finished call would act on other people's test calls).
    await settleOrdinaryCharges(call.id, new Date(startsAt.getTime() + (24 * 60 + 3) * 60_000));
    const charged = await reload(payment.id);
    if (charged.status !== "charged") throw new Error(`The test call was not charged (${charged.status}).`);
    let id: string | undefined;
    for (let i = 0; i < 30 && !id; i++) {
      id = (await stripe().disputes.list({ payment_intent: charged.stripePaymentIntentId!, limit: 1 })).data[0]?.id;
      if (!id) await pause();
    }
    if (!id) throw new Error("Stripe opened no dispute on the test charge.");
    made.push(id);
    if (record) await handleStripeEvent(message("charge.dispute.created", id));
    return { id, call, payment: charged };
  }

  /** Waits until Stripe shows one of these statuses for a test dispute. */
  async function becomes(disputeId: string, ...statuses: string[]) {
    let status = "";
    for (let i = 0; i < 30 && !statuses.includes(status); i++) {
      status = (await atStripe(disputeId)).status;
      if (!statuses.includes(status)) await pause();
    }
    return status;
  }
  const WIN = { uncategorized_text: "winning_evidence" };
  const LOSE = { uncategorized_text: "losing_evidence" };

  try {
    const host = await person("host");
    const stranger = await person("stranger");

    // ----------------------------------------------------------------------
    console.log("\n1. The host is asked, and fights: the app sends its own proof");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      let row = await rowOf(d.id);
      const due = row.dueBy!;
      check("the stage began when the dispute was first seen waiting", row.stageBeganAt !== null && row.stage === "chargeback" && row.answer === "none" && row.choice === null);
      check("the host has 24 hours to choose (the bank's deadline is far off)", row.askUntil !== null && Math.abs(row.askUntil.getTime() - (row.stageBeganAt!.getTime() + ASK_MS)) < 1000 && row.askUntil < due, `${row.askUntil?.toISOString()} of ${due.toISOString()}`);
      const toHost = (await messagesAbout(d.id)).find((m) => m.userId === host.id)!;
      check("the host's message says they choose, by when, and that no choice means Connect fights", toHost.body.includes("You choose what Connect does") && toHost.body.includes("Choose by") && toHost.body.includes("If you do not choose by then, Connect fights it") && toHost.path === `/disputes/${d.id}`, toHost.body.slice(0, 200));
      const hostMail = (await emailsAbout(d.id)).find((mail) => mail.dedupeKey === toHost.key)!;
      check("the email that asks them is not sent any more once their time is up", hostMail.expiresAt !== null && hostMail.expiresAt.getTime() === row.askUntil!.getTime());
      const toCustomer = (await messagesAbout(d.id)).find((m) => m.userId === customer.id)!;
      check("the customer's message says what they cannot do while it is open, and what stays", toCustomer.body.includes("you cannot start anything new that costs money") && toCustomer.body.includes("changes nothing about calls you have already booked"));
      const toFounder = (await emailsAbout(d.id)).find((mail) => mail.dedupeKey?.includes(":founder:"));
      if (admins.length > 0) check("the founder is told that the host chooses and that nothing is needed from them", Boolean(toFounder?.body.includes("The host can choose until") && toFounder.body.includes("Nothing is needed from you") && !toFounder.body.includes("by hand")), toFounder?.body.slice(0, 200));
      check("the customer cannot start a new payment while it is open", (await whyNoNewPayment(db, customer.id)) === STOPPED_WHILE_OPEN);
      check("the host, and nobody else, is not stopped", (await whyNoNewPayment(db, host.id)) === null && (await whyNoNewPayment(db, stranger.id)) === null);

      await answerDisputes(new Date(), { disputeIds: [d.id] });
      check("while the host's time runs and they have not chosen, nothing is sent", (await atStripe(d.id)).evidence_details?.submission_count === 0 && (await rowOf(d.id)).answer === "none");

      check("a stranger cannot choose", (await refused(chooseAnswer({ disputeId: d.id, by: stranger.id, choice: "fight" }))) === "Dispute not found.");
      check("nor the customer", (await refused(chooseAnswer({ disputeId: d.id, by: customer.id, choice: "give_back" }))) === "Dispute not found.");
      check("something that is neither of the two is refused", (await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "refund" }))) !== null && (await rowOf(d.id)).choice === null);
      check("the host chooses \"fight\"", (await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "fight" }))) === null && (await rowOf(d.id)).choice === "fight" && (await rowOf(d.id)).chosenAs === "host");
      check("a second choice is refused: the first stands", /first choice stands/.test((await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "give_back" }))) ?? "") && (await rowOf(d.id)).choice === "fight");

      await answerDisputes(new Date(), { disputeIds: [d.id] });
      const stripeSide = await atStripe(d.id);
      row = await rowOf(d.id);
      check("after the choice the app sends its proof at once: Stripe shows one submission", stripeSide.evidence_details?.submission_count === 1 && stripeSide.status === "under_review", `${stripeSide.evidence_details?.submission_count} ${stripeSide.status}`);
      check("Stripe has the app's own fields: the customer, the call, and the record of who was in it", stripeSide.evidence.customer_name === customer.name && stripeSide.evidence.customer_email_address === customer.email && Boolean(stripeSide.evidence.product_description?.includes("private one-to-one video call")) && Boolean(stripeSide.evidence.access_activity_log?.includes("The host joined at")) && Boolean(stripeSide.evidence.service_date));
      check("the letter puts the bank's reason first and names what was taken", Boolean(stripeSide.evidence.uncategorized_text?.startsWith("The cardholder says they did not make")) && Boolean(stripeSide.evidence.uncategorized_text?.includes("$13.33 was taken")), stripeSide.evidence.uncategorized_text?.slice(0, 120));
      check("the letter has no link and no internet address in it", !/https?:\/\//.test(JSON.stringify(stripeSide.evidence)) && stripeSide.evidence.customer_purchase_ip === null);
      check("the answer is recorded as the app's own, with what Stripe's reply showed", row.answer === "proof" && row.answeredAt !== null && Boolean(row.proof?.includes("private one-to-one video call")) && row.answerAttempt === 1);
      await answerDisputes(new Date(), { disputeIds: [d.id] });
      await answerOne(d.id, new Date());
      check("nothing is ever sent a second time", (await atStripe(d.id)).evidence_details?.submission_count === 1 && (await rowOf(d.id)).answerAttempt === 1);
      await helperLooks(d.id);
      row = await rowOf(d.id);
      check("the helper's look then shows the bank deciding; the money stays held and the customer stopped", row.status === "under_review" && row.outcome === null && row.answer === "proof" && (await reload(d.payment.id)).disputeOpen === true && (await whyNoNewPayment(db, customer.id)) === STOPPED_WHILE_OPEN);
      check("the host can no longer choose", !canChoose(row, new Date()) && (await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "give_back" }))) !== null);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Nobody answers: the app fights when the host's time is up, and not a second earlier. Then the bank decides for the customer");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      const until = (await rowOf(d.id)).askUntil!;
      await answerOne(d.id, new Date(until.getTime() - 1000), { proof: LOSE });
      check("a second before the host's time is up, nothing is sent", (await atStripe(d.id)).evidence_details?.submission_count === 0 && (await rowOf(d.id)).answer === "none" && (await rowOf(d.id)).choice === null);
      await answerOne(d.id, until, { proof: LOSE });
      let row = await rowOf(d.id);
      check("exactly then it is sent, and \"no answer\" is written down as fight", row.answer === "proof" && row.choice === "fight" && row.chosenAs === "silence" && (await atStripe(d.id)).evidence_details?.submission_count === 1, `${row.answer} ${row.choice} ${row.chosenAs}`);
      check("the host can no longer choose after their time", (await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "give_back", now: new Date(until.getTime() + 1000) }))) !== null);
      check("Stripe says the bank decided for the customer", (await becomes(d.id, "lost")) === "lost");
      await handleStripeEvent(message("charge.dispute.closed", d.id));
      await helperLooks(d.id);
      row = await rowOf(d.id);
      check("the loss is recorded, after the app's own proof", row.outcome === "lost" && row.answer === "proof");
      check("the customer stays stopped, with the sentence for that", (await whyNoNewPayment(db, customer.id)) === STOPPED_AFTER_LOSS);
      const ended = (await messagesAbout(d.id)).filter((m) => m.key.includes(":ended:lost:"));
      check("the customer is told it stays off, why, and where to write", ended.some((m) => m.userId === customer.id && m.body.includes("stays switched off for your account") && m.body.includes("write to us at")));
      if (admins.length > 0) check("the founder is told the customer stays stopped until they allow it", (await emailsAbout(d.id)).some((mail) => mail.dedupeKey?.includes(":ended:lost:founder:") && mail.body.includes("until you allow it again")));
      check("allowing it for another dispute changes nothing", (await allowPayingAgain({ disputeId: "du_not_this_one", adminId: admins[0]?.id ?? host.id })) === false && (await whyNoNewPayment(db, customer.id)) === STOPPED_AFTER_LOSS);
      if (admins.length > 0) {
        check("the founder allows paying again", (await allowPayingAgain({ disputeId: d.id, adminId: admins[0].id })) === true && (await whyNoNewPayment(db, customer.id)) === null);
        check("a second press changes nothing more", (await allowPayingAgain({ disputeId: d.id, adminId: admins[0].id })) === false);
      }
    }

    // ----------------------------------------------------------------------
    console.log("\n3. The host gives the money back");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      check("the host chooses \"give the money back\"", (await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "give_back" }))) === null);
      await answerDisputes(new Date(), { disputeIds: [d.id] });
      const stripeSide = await atStripe(d.id);
      let row = await rowOf(d.id);
      check("the app tells the bank it does not contest: Stripe shows the dispute as lost, with no proof sent", stripeSide.status === "lost" && stripeSide.evidence_details?.submission_count === 0, `${stripeSide.status} ${stripeSide.evidence_details?.submission_count}`);
      check("recorded as given in by the app", row.answer === "given_in" && row.answeredAt !== null && row.proof === null);
      await helperLooks(d.id);
      row = await rowOf(d.id);
      check("the ending is recorded, and the money stays held (the bank keeps it for the customer)", row.outcome === "lost" && (await reload(d.payment.id)).disputeOpen === true);
      check("the customer may pay again: the host chose this, nobody fought", (await whyNoNewPayment(db, customer.id)) === null);
      check("and is told so", (await messagesAbout(d.id)).some((m) => m.userId === customer.id && m.key.includes(":ended:lost:") && m.body.includes("This dispute no longer keeps you from starting new bookings and payments")));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. The host fights and the bank lets the payment stand");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDisputeProductNotReceived");
      await chooseAnswer({ disputeId: d.id, by: host.id, choice: "fight" });
      await answerOne(d.id, new Date(), { proof: WIN });
      check("Stripe says the dispute was won", (await becomes(d.id, "won")) === "won");
      await handleStripeEvent(message("charge.dispute.closed", d.id));
      await helperLooks(d.id);
      const row = await rowOf(d.id);
      check("won after the app's answer: the money can move again and the customer can pay again", row.outcome === "won" && row.answer === "proof" && (await reload(d.payment.id)).disputeOpen === false && (await whyNoNewPayment(db, customer.id)) === null);
      check("the customer is told both", (await messagesAbout(d.id)).some((m) => m.userId === customer.id && m.key.includes(":ended:won:") && m.body.includes("let the payment stand") && m.body.includes("This dispute no longer keeps you from starting new bookings and payments")));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The host's press and \"time is up\" at the same moment: one decision");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      const until = (await rowOf(d.id)).askUntil!;
      const [pressed] = await Promise.all([refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "give_back", now: new Date(until.getTime() - 1) })), answerOne(d.id, until, { cut: "before_stripe", proof: WIN })]);
      const row = await rowOf(d.id);
      const hostWon = pressed === null && row.choice === "give_back" && row.chosenAs === "host";
      const clockWon = pressed !== null && row.choice === "fight" && row.chosenAs === "silence" && row.answerKind === "proof";
      check("either the host's choice stands or the clock's, never a mix", hostWon !== clockWon, `${pressed ?? "accepted"} | ${row.choice} ${row.chosenAs} ${row.answer} ${row.answerKind}`);
      // Carried out, whichever it was.
      await answerOne(d.id, new Date(until.getTime() + 1000), { proof: WIN });
      await answerOne(d.id, new Date(until.getTime() + 2000), { proof: WIN });
      const after = await rowOf(d.id);
      check("and what is sent to the bank is that one decision", (hostWon && after.answer === "given_in") || (clockWon && after.answer === "proof"), `${after.answer}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. A bank's question: answered at once, nobody asked, nothing stopped");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDisputeInquiry");
      let row = await rowOf(d.id);
      check("recorded as a question that waits; the host is not asked", row.stage === "question" && row.askUntil === null && row.stageBeganAt !== null && !canChoose(row, new Date()));
      check("the host cannot choose about a question", (await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "give_back" }))) !== null);
      check("a question stops nothing for the customer", (await whyNoNewPayment(db, customer.id)) === null);
      check("the host is told Connect answers it", (await messagesAbout(d.id)).some((m) => m.userId === host.id && m.body.includes("Connect is answering it now")));
      await answerDisputes(new Date(), { disputeIds: [d.id] });
      row = await rowOf(d.id);
      const stripeSide = await atStripe(d.id);
      check("the app answers it at once with its own proof, and nobody chose anything", row.answer === "proof" && row.choice === null && row.chosenAs === null && stripeSide.evidence_details?.submission_count === 1 && stripeSide.evidence.customer_name === customer.name, `${row.answer} ${stripeSide.status}`);
      check("the shorter letter of a question still says what was paid for", Boolean(stripeSide.evidence.uncategorized_text?.includes("What was paid for")));
    }

    // ----------------------------------------------------------------------
    console.log("\n7. A question that became a chargeback: a new stage, a new choice, a second answer");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute", false);
      // Stripe's test area has no card for this. The row is written as the question it would have been, answered by the
      // app, and the next look finds what Stripe really shows: a chargeback that waits.
      await db.insert(schema.disputes).values({ id: d.id, paymentId: d.payment.id, hostId: host.id, customerId: customer.id, amountCents: 1333, reason: "fraudulent", stage: "question", status: "warning_under_review", openedAt: new Date(), stageBeganAt: new Date(Date.now() - 3 * 86_400_000), answer: "proof", answerKind: "proof", answerAttempt: 1, answeredAt: new Date(Date.now() - 3 * 86_400_000), proof: "{}" });
      check("as a question it stopped nothing", (await whyNoNewPayment(db, customer.id)) === null);
      await recordDisputesOf({ kind: "payment", id: d.payment.id });
      const row = await rowOf(d.id);
      check("the look finds a chargeback that waits: a new stage, with nothing chosen or sent in it", row.stage === "chargeback" && row.status === "needs_response" && row.answer === "none" && row.choice === null && row.answerAttempt === 0 && row.proof === null && row.askUntil !== null);
      const history = JSON.parse(row.stageHistory) as Array<{ stage: string; answer: string }>;
      check("what became of the question is kept", history.length === 1 && history[0].stage === "question" && history[0].answer === "proof");
      const told = await messagesAbout(d.id);
      check("the host is told of the chargeback and asked to choose", told.some((m) => m.userId === host.id && m.key.includes(":chargeback:began:") && m.body.includes("You choose what Connect does")));
      check("the customer is told, and is stopped from now on", told.some((m) => m.userId === customer.id && m.key.includes(":chargeback:began:")) && (await whyNoNewPayment(db, customer.id)) === STOPPED_WHILE_OPEN);
      await chooseAnswer({ disputeId: d.id, by: host.id, choice: "fight" });
      await answerOne(d.id, new Date(), { proof: WIN });
      const after = await rowOf(d.id);
      check("the chargeback gets an answer of its own, under its own label", after.answer === "proof" && after.answerAttempt === 1 && (await atStripe(d.id)).evidence_details?.submission_count === 1);
      await becomes(d.id, "won");
    }

    // ----------------------------------------------------------------------
    console.log("\n7b. A question the app answered, next seen as a chargeback the bank has already decided");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute", false);
      await stripe().disputes.update(d.id, { evidence: LOSE });
      check("(answered in Stripe, and lost)", (await becomes(d.id, "lost")) === "lost");
      await db.insert(schema.disputes).values({ id: d.id, paymentId: d.payment.id, hostId: host.id, customerId: customer.id, amountCents: 1333, reason: "fraudulent", stage: "question", status: "warning_under_review", openedAt: new Date(), stageBeganAt: new Date(Date.now() - 3 * 86_400_000), answer: "proof", answerKind: "proof", answerAttempt: 1, answeredAt: new Date(Date.now() - 3 * 86_400_000), proof: "{}" });
      await recordDisputesOf({ kind: "payment", id: d.payment.id });
      const row = await rowOf(d.id);
      check("the chargeback is recorded as lost, and the question's answer is not carried into it", row.stage === "chargeback" && row.outcome === "lost" && row.answer === "not_ours" && row.proof === null && row.answerAttempt === 0 && row.askUntil === null && row.choice === null, `${row.stage} ${row.outcome} ${row.answer}`);
      const history = JSON.parse(row.stageHistory) as Array<{ stage: string; answer: string }>;
      check("what became of the question is kept", history.length === 1 && history[0].stage === "question" && history[0].answer === "proof");
      check("so the customer is not kept from paying after a chargeback the app never fought", (await whyNoNewPayment(db, customer.id)) === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n8. A dispute recorded before the app answered banks: its host can now choose");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      // As part 1 left such a row: no stage begun, nobody asked.
      await db.update(schema.disputes).set({ stageBeganAt: null, askUntil: null, updatedAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(schema.disputes.id, d.id));
      await answerDisputes(new Date(), { disputeIds: [d.id] });
      check("the answer job sends nothing for it, and marks it for the look", (await atStripe(d.id)).evidence_details?.submission_count === 0 && (await rowOf(d.id)).lookAgain === true);
      await helperLooks(d.id);
      const row = await rowOf(d.id);
      check("the look begins its stage and gives the host their time", row.stageBeganAt !== null && row.askUntil !== null && canChoose(row, new Date()));
      const told = (await messagesAbout(d.id)).filter((m) => m.key.includes(":chargeback:choice:"));
      check("the host is told once that they can now choose; the customer is not told again", told.length === 1 && told[0].userId === host.id && told[0].body.includes("Choose by"));
      await helperLooks(d.id);
      check("another look tells nobody again", (await messagesAbout(d.id)).filter((m) => m.key.includes(":chargeback:choice:")).length === 1);
      await chooseAnswer({ disputeId: d.id, by: host.id, choice: "give_back" });
      await answerDisputes(new Date(), { disputeIds: [d.id] });
    }

    // ----------------------------------------------------------------------
    console.log("\n9. A dispute the app does not fight, and a bank that takes no answer");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      // As a compliance dispute under the founder's line would be recorded (Stripe's test card for one needs a card number).
      await db.update(schema.disputes).set({ compliance: true, askUntil: null }).where(eq(schema.disputes.id, d.id));
      const farLater = new Date(Date.now() + 5 * 86_400_000);
      await answerDisputes(farLater, { disputeIds: [d.id] });
      check("a compliance dispute under the line: nothing is ever sent, whenever the job runs", (await atStripe(d.id)).evidence_details?.submission_count === 0 && (await rowOf(d.id)).answer === "none" && (await atStripe(d.id)).status === "needs_response");
      check("and its host is not asked", !canChoose(await rowOf(d.id), new Date()) && (await refused(chooseAnswer({ disputeId: d.id, by: host.id, choice: "fight" }))) !== null);
      await db.update(schema.disputes).set({ compliance: false, noAnswer: true }).where(eq(schema.disputes.id, d.id));
      await answerDisputes(farLater, { disputeIds: [d.id] });
      check("a bank that takes no answer: nothing is sent either", (await atStripe(d.id)).evidence_details?.submission_count === 0 && (await rowOf(d.id)).answer === "none");
      await db.update(schema.disputes).set({ noAnswer: false }).where(eq(schema.disputes.id, d.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n10. Answered from outside the app, and the request that never left");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      // A person answers it in Stripe (here: the script), before the host's time is up.
      await stripe().disputes.update(d.id, { evidence: LOSE });
      check("Stripe says it was lost", (await becomes(d.id, "lost")) === "lost");
      await answerOne(d.id, new Date((await rowOf(d.id)).askUntil!.getTime() + 1000));
      await helperLooks(d.id);
      let row = await rowOf(d.id);
      check("the app sends nothing and records that the answer was not its own", row.answer === "not_ours" && row.outcome === "lost" && row.answerAttempt === 0);
      check("after such a loss the customer is not kept from paying", (await whyNoNewPayment(db, customer.id)) === null);

      const customer2 = await person("customer");
      const e = await disputed(host, customer2, "pm_card_createDispute");
      await chooseAnswer({ disputeId: e.id, by: host.id, choice: "fight" });
      await answerOne(e.id, new Date(), { cut: "before_stripe" });
      row = await rowOf(e.id);
      check("a request is written down and never leaves (the helper stops there)", row.answer === "sending" && row.answerAttempt === 1 && (await atStripe(e.id)).evidence_details?.submission_count === 0);
      await stripe().disputes.update(e.id, { evidence: LOSE });
      await becomes(e.id, "lost");
      await answerOne(e.id, new Date());
      await helperLooks(e.id);
      row = await rowOf(e.id);
      check("somebody else answers meanwhile: it is never recorded as the app's own", row.answer === "unknown" && row.outcome === "lost", `${row.answer} ${row.outcome} ${row.answerError ?? ""}`);
      check("and the customer is not kept from paying on an answer that was not the app's", (await whyNoNewPayment(db, customer2.id)) === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n11. Stripe did it and the reply was lost: nothing twice, and still the app's own");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      await chooseAnswer({ disputeId: d.id, by: host.id, choice: "fight" });
      await answerOne(d.id, new Date(), { cut: "after_stripe", proof: LOSE });
      let row = await rowOf(d.id);
      check("Stripe has the answer; here it is still only written down", (await atStripe(d.id)).evidence_details?.submission_count === 1 && row.answer === "sending");
      // The helper comes back when the bank has already decided, and its look runs before its answer job.
      check("(Stripe's test area decides at once: lost)", (await becomes(d.id, "lost")) === "lost");
      await handleStripeEvent(message("charge.dispute.closed", d.id));
      await helperLooks(d.id);
      row = await rowOf(d.id);
      check("the look does not record the ending while the request is unconfirmed, and tells nobody yet", row.outcome === null && row.answer === "sending" && row.lookAgain === true && (await messagesAbout(d.id)).every((m) => !m.key.includes(":ended:")), `${row.outcome} ${row.answer} ${row.lookAgain}`);
      check("the money was looked at all the same: it stays held", (await reload(d.payment.id)).disputeOpen === true);
      await answerDisputes(new Date(), { disputeIds: [d.id] });
      row = await rowOf(d.id);
      check("the answer job settles it although the dispute no longer waits: the same request again gives the first reply back, recorded as the app's own, and sent once", row.answer === "proof" && row.answerAttempt === 1 && (await atStripe(d.id)).evidence_details?.submission_count === 1, `${row.answer} ${row.answerError ?? ""}`);
      await helperLooks(d.id);
      check("then the loss is recorded, and it keeps the customer stopped, as after any answer of the app's own", (await rowOf(d.id)).outcome === "lost" && (await whyNoNewPayment(db, customer.id)) === STOPPED_AFTER_LOSS);
      check("and the customer is told that, not that they can pay again", (await messagesAbout(d.id)).some((m) => m.userId === customer.id && m.key.includes(":ended:lost:") && m.body.includes("stays switched off for your account")));
    }

    // ----------------------------------------------------------------------
    console.log("\n12. A fault: no answer could be sent and the bank's deadline is near");
    {
      const customer = await person("customer");
      const d = await disputed(host, customer, "pm_card_createDispute");
      // As after a "no" from Stripe a moment ago, with the bank's deadline 12 hours away.
      const soon = new Date(Date.now() + 12 * 3_600_000);
      await db.update(schema.disputes).set({ dueBy: soon, askUntil: null, answerError: "No such dispute", answerStartedAt: new Date() }).where(eq(schema.disputes.id, d.id));
      await answerDisputes(new Date(), { disputeIds: [d.id] });
      await answerDisputes(new Date(), { disputeIds: [d.id] });
      const late = (await emailsAbout(d.id)).filter((mail) => mail.dedupeKey?.includes(":chargeback:late:founder:"));
      check("the founder is told once, plainly, with what Stripe said", late.length === admins.length && late.every((mail) => mail.body.includes("This one needs you") && mail.body.includes("No such dispute")), `${late.length}`);
      check("nobody else gets that message", (await messagesAbout(d.id)).every((m) => !m.key.includes(":late:")));
      check("the health address says so", (await disputeHealthProblems(new Date())).some((problem) => problem.includes("no answer from the app")));
      await db.update(schema.disputes).set({ answerError: null, answerStartedAt: null }).where(eq(schema.disputes.id, d.id));
      await answerOne(d.id, new Date(), { proof: WIN });
      check("an hour after the \"no\" it is tried again, and goes through", (await rowOf(d.id)).answer === "proof");
      await becomes(d.id, "won");

      // A dispute first seen 12 hours before the bank's deadline: answered in the same pass, and nobody is told it is late.
      const customer2 = await person("customer");
      const e = await disputed(host, customer2, "pm_card_createDispute");
      await db.update(schema.disputes).set({ dueBy: soon, askUntil: null }).where(eq(schema.disputes.id, e.id));
      await answerDisputes(new Date(), { disputeIds: [e.id] });
      check("a dispute answered in the pass that finds it close to the deadline makes no \"this one needs you\" email", (await rowOf(e.id)).answer === "proof" && (await emailsAbout(e.id)).every((mail) => !mail.dedupeKey?.includes(":late:")), `${(await rowOf(e.id)).answer}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n13. Where a customer with a chargeback is refused, and where not");
    {
      const asks = (file: string) => (readFileSync(file, "utf8").match(/whyNoNewPayment\(/g) ?? []).length;
      check("a new request for a call, booked or \"now\", asks", asks("src/lib/booking/bookings.ts") === 2);
      check("added time paid by card asks", asks("src/lib/extend/extend.ts") === 1);
      const agrees = (file: string) => (readFileSync(file, "utf8").match(/await mustBeFreeToAgree\(/g) ?? []).length;
      check("a new promise in a membership asks: joining and resuming, and renewals back on", asks("src/lib/membership/join.ts") === 1 && agrees("src/lib/membership/join.ts") === 2 && agrees("src/lib/membership/ending.ts") === 1);
      check("taking a host's new offer asks", asks("src/lib/membership/ending.ts") === 1);
      check("a new contribution and a new tip ask", asks("src/lib/contributions/start.ts") === 1 && asks("src/lib/contributions/tip-start.ts") === 1);
      check("what was already agreed never asks: paying for a booked call, a month or a payment that is written, booking from a membership, the helper's jobs", ["src/lib/payments/hold.ts", "src/lib/membership/charge.ts", "src/lib/membership/book.ts", "src/lib/booking/jobs.ts", "src/lib/membership/jobs.ts", "src/lib/contributions/jobs.ts", "src/lib/contributions/charge.ts"].every((file) => asks(file) === 0));
    }
  } finally {
    // What THIS run made, by the exact ids of its own disputes: those still open are ended at Stripe where Stripe allows it
    // (one that the bank is "deciding" in the test area stays so), brought up to date here, and their messages and emails removed.
    for (const id of made) {
      const current = await stripe().disputes.retrieve(id).catch(() => null);
      if (current?.status === "needs_response") await stripe().disputes.close(id).catch(() => undefined);
      if (current?.status === "warning_needs_response") await stripe().disputes.update(id, { evidence: { uncategorized_text: "winning_evidence" } }).catch(() => undefined);
    }
    await pause(4000);
    if (made.length > 0) {
      const rows = await db.select().from(schema.disputes).where(or(...made.map((id) => eq(schema.disputes.id, id))));
      for (const row of rows) if (!row.outcome && row.paymentId) await refreshOwner({ kind: "payment", id: row.paymentId }).catch(() => undefined);
      await db.delete(schema.messages).where(or(...made.map((id) => like(schema.messages.key, `dispute:${id}:%`))));
      await db.delete(schema.emailOutbox).where(or(...made.map((id) => like(schema.emailOutbox.dedupeKey, `dispute:${id}:%`))));
      await db.delete(schema.adminActions).where(or(...made.map((id) => eq(schema.adminActions.targetId, id))));
      // A test dispute the test area keeps "under review" for good would be asked about every hour for ever: its row is
      // taken away, with nothing else (the call and its payment stay, as a test call's do).
      const stuck = (await db.select().from(schema.disputes).where(or(...made.map((id) => eq(schema.disputes.id, id))))).filter((row) => !row.outcome);
      for (const row of stuck) {
        // Its payment forgets its payment at Stripe (in one step with the row), so the catch-up from Stripe's list cannot
        // find the owner and write the row again.
        await db.transaction(async (tx) => {
          if (row.paymentId) await tx.update(schema.payments).set({ stripePaymentIntentId: null }).where(eq(schema.payments.id, row.paymentId));
          await tx.delete(schema.disputes).where(eq(schema.disputes.id, row.id));
        });
      }
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
