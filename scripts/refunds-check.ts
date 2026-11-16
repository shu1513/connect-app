/**
 * Testing tool: refund requests, taking the money later, the hold on a host's
 * collection, the call-quality notes and the health answer, against the Stripe
 * sandbox and the local database. No real money moves.
 *
 * It creates its own test calls, pretends the calls happened by adding
 * attendance messages, and uses a pretend "now" so nothing has to wait a day.
 * One part (collecting while a request is open) needs the test host's payout
 * account and is skipped with a note without it.
 *
 * Usage: npx tsx scripts/refunds-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  // The jobs below act on every call in the database, with a pretend "now". Never run them on shared data.
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
  const { capturePayment, refundPayment } = await import("../src/lib/payments/actions");
  const { settleFinishedCalls, reconcileOperations } = await import("../src/lib/payments/jobs");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { cancelCall } = await import("../src/lib/payments/cancel");
  const { collectEarnings, unsentEarnings } = await import("../src/lib/payments/collect");
  const { refreshPayoutsReady, getHostSettings } = await import("../src/lib/payments/hosts");
  const R = await import("../src/lib/refunds/requests");
  const { RequestError } = R;
  const { callOverdue, healthProblems, recordBeat } = await import("../src/lib/health");
  const { receiveNotes, removeOldNotes } = await import("../src/lib/quality/notes");

  const [host] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  const [customer] = await db.select().from(schema.user).where(eq(schema.user.email, "customer@test.local"));
  const [founder] = await db.select().from(schema.user).where(eq(schema.user.email, "admin@test.local"));
  if (!host || !customer || !founder) throw new Error("Run `npm run seed` first.");

  const PRICE = 2000; // $20 per 15 minutes
  const MINUTES = 10; // booked total: $13.33
  const HOUR = 60;
  const DAY = 24 * HOUR;

  /** Creates a paid call starting in 10 minutes, with its payment record. */
  async function newCall(hostId: string = host.id) {
    const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + MINUTES * 60_000);
    return db.transaction(async (tx) => {
      const [call] = await tx
        .insert(schema.calls)
        .values({ hostId, customerId: customer.id, startsAt, endsAt, roomName: `refundcheck-${randomUUID()}`, pricePer15Cents: PRICE })
        .returning();
      await createPaymentForCall(tx, call);
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
      return { call, payment };
    });
  }
  type Made = Awaited<ReturnType<typeof newCall>>;

  /** Places the hold the way the customer's browser would, using one of Stripe's test cards. */
  async function hold(call: Made["call"], paymentId: string) {
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
    const started = await startHold({ payment, call, customer, now: new Date() });
    if (!("alreadyHeld" in started)) {
      const [withIntent] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
      await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    }
    return syncHold(paymentId, new Date());
  }

  /** Adds attendance messages as if the video service had sent them. Offsets are seconds from the call's start. */
  async function attend(call: { id: string; startsAt: Date; endsAt: Date; hostId: string; customerId: string }, visits: Array<["host" | "customer", number, number | null]>) {
    let n = 0;
    for (const [who, from, to] of visits) {
      const identity = who === "host" ? call.hostId : call.customerId;
      const session = `PA_${who}_${n++}_${randomUUID().slice(0, 6)}`;
      const at = (offset: number) => new Date(call.startsAt.getTime() + offset * 1000);
      const row = (type: string, time: Date) => ({
        provider: "livekit",
        providerEventId: `EV_${randomUUID()}`,
        callId: call.id,
        type,
        roomSessionId: "RM_refundcheck",
        participantIdentity: identity,
        participantSessionId: session,
        providerTime: time,
        payload: JSON.stringify({ event: type, participant: { identity, disconnectReason: "CLIENT_INITIATED" } }),
      });
      await db.insert(schema.attendanceEvents).values(row("participant_joined", at(from)));
      if (to !== null) await db.insert(schema.attendanceEvents).values(row("participant_left", at(to)));
    }
    await db.update(schema.calls).set({ closedAt: new Date(call.endsAt.getTime() + 60_000) }).where(eq(schema.calls.id, call.id));
  }

  const FULL: Parameters<typeof attend>[1] = [["host", 0, 600], ["customer", 0, 600]];
  /** A paid call that took place in full: $13.33 on hold. */
  async function paid(hostId: string = host.id, visits = FULL): Promise<Made> {
    const made = await newCall(hostId);
    await hold(made.call, made.payment.id);
    await attend(made.call, visits);
    return made;
  }

  const after = (c: Made, minutes: number) => new Date(c.call.endsAt.getTime() + minutes * 60_000);
  const settle = (c: Made, minutes: number) => settleFinishedCalls(after(c, minutes));
  const reload = async (id: string) => (await db.select().from(schema.payments).where(eq(schema.payments.id, id)))[0];
  const reloadCall = async (id: string) => (await db.select().from(schema.calls).where(eq(schema.calls.id, id)))[0];
  const received = async (id: string) => (await stripe().paymentIntents.retrieve((await reload(id)).stripePaymentIntentId!));
  const requestOf = async (c: Made) => (await db.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, c.call.id)))[0];
  const mail = async (key: string) => (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, key)))[0];
  const problem = <T,>(work: Promise<T>) => work.then(() => null, (e: unknown) => e as Error);
  const ask = (c: Made, minutes: number, reason = "other", note = "The picture kept freezing.", seen: string | null = null, customerId = customer.id) =>
    R.askForRefund({ callId: c.call.id, customerId, reason, note, seen, now: after(c, minutes) });
  const answer = (c: Made, minutes: number, answers: Array<{ paymentId: string; choice: string; maxCents?: number }>, as: "host" | "admin" = "host", message: string | null = null, by?: string) =>
    R.answerRequest({ callId: c.call.id, by: by ?? (as === "admin" ? founder.id : host.id), as, answers, message, now: after(c, minutes) });
  const holdOn = async (c: Made) => (await R.requestHolds(db, [c.call.id])).get(c.call.id) ?? null;
  const soon = () => new Date(Date.now() + 5 * 60_000);

  // ------------------------------------------------------------------------
  console.log("\n1. Who may ask, and when");
  {
    const a = await paid();
    const before = await problem(R.askForRefund({ callId: a.call.id, customerId: customer.id, reason: "other", note: "x", seen: null, now: new Date(a.call.endsAt.getTime() - 1000) }));
    check("not before the call has ended", before instanceof RequestError, before?.message);
    check("not by the host, and not by a stranger", (await problem(ask(a, 60, "other", "x", null, host.id))) instanceof RequestError && (await problem(ask(a, 60, "other", "x", null, founder.id))) instanceof RequestError);
    check("a reason is needed, and \"something else\" needs a sentence", (await problem(ask(a, 60, "because"))) instanceof RequestError && (await problem(ask(a, 60, "other", "  "))) instanceof RequestError);
    check("until 24 hours after the call the customer can ask", (await R.askBy(a.call, after(a, DAY - 1)))?.getTime() === after(a, DAY).getTime() && (await ask(a, DAY - 1)) === "sent");
    check("one request per call", (await problem(ask(a, DAY - 1))) instanceof RequestError && (await R.askBy(a.call, after(a, 60))) === null);

    const b = await paid();
    check("a request sent in the last seconds still counts: up to 10 minutes after the 24 hours", (await ask(b, DAY + 9)) === "sent");
    const c = await paid();
    const late = await problem(ask(c, DAY + 10));
    check("after that it is refused", late instanceof RequestError && !(await requestOf(c)), late?.message);

    const cancelled = await newCall();
    await hold(cancelled.call, cancelled.payment.id);
    await cancelCall({ call: cancelled.call, payment: await reload(cancelled.payment.id), by: "host", now: new Date() });
    check("not for a cancelled call", (await problem(ask(cancelled, 60))) instanceof RequestError);

    const empty = await paid(host.id, [["customer", 0, 600]]); // the host never came
    await settle(empty, 5);
    check("not when nothing was charged and nothing is on hold", (await reload(empty.payment.id)).status === "closed_uncharged" && (await problem(ask(empty, 60))) instanceof RequestError);
  }

  console.log("\n2. The two reasons, and \"what is sent is what was seen\"");
  {
    const a = await paid();
    const first = await R.loadSummary(a.call);
    check("with no notes from the browsers the record says quality is unknown, and still shows the connections", !first.summary.anyNotes && first.summary.host.connections.length === 1 && first.summary.host.ownBrowser.unknown === 600);
    check("a connection request without having seen the record sends nothing", (await ask(a, 60, "connection", "", "not-what-was-shown")) === "changed" && !(await requestOf(a)));
    // A late message from the video service: the customer had in fact left at minute 6.
    await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: a.call.id, type: "participant_left", roomSessionId: "RM_refundcheck", participantIdentity: customer.id, participantSessionId: "PA_late", providerTime: new Date(a.call.startsAt.getTime() + 360_000), payload: "{}" });
    await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: a.call.id, type: "participant_joined", roomSessionId: "RM_refundcheck", participantIdentity: customer.id, participantSessionId: "PA_late", providerTime: new Date(a.call.startsAt.getTime() + 300_000), payload: "{}" });
    const second = await R.loadSummary(a.call);
    check("when the record changed after the customer looked, nothing is sent and they are asked again", second.seen !== first.seen && (await ask(a, 60, "connection", "", first.seen)) === "changed" && !(await requestOf(a)));
    check("with the record as it now stands, the request is sent", (await ask(a, 60, "connection", "It froze for minutes.", second.seen)) === "sent");
    const saved = await requestOf(a);
    check("the record saved with the request is the one the customer confirmed", saved.reason === "connection" && saved.summary === second.json && saved.note === "It froze for minutes.");
    const toHost = await mail(`refund-request:${saved.id}:host`);
    check("the host is told at once, with the reason and the time by which an answer costs nothing", toHost?.to === host.email && toHost.body.includes("The connection was bad.") && toHost.body.includes("It froze for minutes.") && toHost.body.includes("If you answer by"));

    const b = await paid();
    await ask(b, 60, "other", "The host was rude.");
    const other = await requestOf(b);
    check("\"something else\" saves the summary too, for the founder (who may open it is a rule with its own tests)", other.reason === "other" && other.summary !== null);
    const view = (await R.requestViewOf(b.call))!;
    check("the host has 24 hours from the request", view.open.length === 1 && view.answerBy?.getTime() === after(b, 60 + DAY).getTime() && !view.answered);
  }

  console.log("\n3. The host's three answers, on a call with one charge");
  {
    const one = (c: Made, choice: string, maxCents?: number) => [{ paymentId: c.payment.id, choice, maxCents }];
    const full = await paid();
    await settle(full, 5);
    await ask(full, 60);
    check("a stranger cannot answer, and an answer must be given for the charge", (await problem(answer(full, 120, one(full, "full"), "host", null, customer.id))) instanceof RequestError && (await problem(answer(full, 120, []))) instanceof RequestError);
    check("an amount from 1 to 49 cents is not accepted, and never rounded up", (await problem(answer(full, 120, one(full, "less", 49)))) instanceof RequestError && (await problem(answer(full, 120, one(full, "less", 0)))) instanceof RequestError);
    check("\"less\" must be less than the price", (await problem(answer(full, 120, one(full, "less", 1333)))) instanceof RequestError && (await requestOf(full)).status === "asked" && (await reload(full.payment.id)).status === "held");
    await answer(full, 120, one(full, "full"), "host", "Everything worked on my side.");
    let p = await reload(full.payment.id);
    check("in full: the money is taken at once, as the record gives it", p.status === "charged" && p.chargedCents === 1333 && p.loweredBy === null && (await received(full.payment.id)).amount_received === 1333, `${p.status} ${p.chargedCents}`);
    const req = await requestOf(full);
    const toCustomer = await mail(`refund-request:${req.id}:answer`);
    check("the answer is saved with who gave it, and the customer is told, with the message", req.status === "answered" && req.decidedBy === host.id && req.decidedAs === "host" && toCustomer?.to === customer.email && toCustomer.body.includes("Everything worked on my side."));
    check("with a refund request on the call, the host's share is ready 2 days after it, not 1", p.transferDueAt?.getTime() === after(full, 2 * DAY).getTime(), String(p.transferDueAt?.toISOString()));
    check("the first answer stands", (await problem(answer(full, 130, one(full, "nothing")))) instanceof RequestError && (await problem(R.declineRequest({ callId: full.call.id, by: host.id, as: "host", message: null }))) instanceof RequestError);

    const less = await paid();
    await settle(less, 5);
    await ask(less, 60);
    await answer(less, 120, one(less, "less", 500));
    p = await reload(less.payment.id);
    check("less: exactly that amount is taken, and it says who lowered it and what the record gave", p.status === "charged" && p.chargedCents === 500 && p.recordCents === 1333 && p.loweredBy === "host" && (await received(less.payment.id)).amount_received === 500, `${p.status} ${p.chargedCents} ${p.recordCents} ${p.loweredBy}`);
    check("our fee and the host's share follow the amount taken", p.originalFeeCents === 55 && p.originalHostShareCents === 445, `${p.originalFeeCents} ${p.originalHostShareCents}`);

    const nothing = await paid();
    await settle(nothing, 5);
    await ask(nothing, 60);
    await answer(nothing, 120, one(nothing, "nothing"));
    p = await reload(nothing.payment.id);
    check("nothing: the hold is let go and nothing is taken", p.status === "closed_uncharged" && p.chargedCents === null && p.loweredBy === "host" && p.recordCents === 1333 && (await received(nothing.payment.id)).status === "canceled", `${p.status}`);

    // The host was there 8 of the 10 minutes: the record gives $10.67.
    const capped = await paid(host.id, [["host", 60, 540], ["customer", 0, 600]]);
    await settle(capped, 5);
    await ask(capped, 60);
    await answer(capped, 120, one(capped, "less", 1200));
    p = await reload(capped.payment.id);
    check("\"at most $12\" when the record gives $10.67: the lower amount is taken, and nothing was lowered", p.status === "charged" && p.chargedCents === 1067 && p.loweredBy === null, `${p.chargedCents} ${p.loweredBy}`);

    for (const c of [full, less, nothing, capped]) await settle(c, DAY + 2 * HOUR + 30);
    check("running the helper for days afterwards takes nothing more", (await received(full.payment.id)).amount_received === 1333 && (await received(less.payment.id)).amount_received === 500 && (await received(capped.payment.id)).amount_received === 1067 && (await received(nothing.payment.id)).status === "canceled");
  }

  /** A call to which 10 minutes were added: its own payment, and one for the added time, both on hold. */
  async function withAddedTime() {
    const made = await newCall();
    await hold(made.call, made.payment.id);
    const oldEnd = made.call.endsAt;
    const newEnd = new Date(oldEnd.getTime() + 10 * 60_000);
    // As in a real call: the customer asks (the request is open), the money for it is held, then the host accepts and the end moves.
    const [extension] = await db.insert(schema.callExtensions).values({ callId: made.call.id, minutes: 10, oldEndsAt: oldEnd, newEndsAt: newEnd, priceCents: 1333 }).returning();
    const [extra] = await db
      .insert(schema.payments)
      .values({ callId: made.call.id, extensionId: extension.id, coversFrom: oldEnd, coversUntil: newEnd, pricePer15Cents: PRICE, bookedCents: 1333, feePercentBps: made.payment.feePercentBps, feeFixedCents: made.payment.feeFixedCents, feeForeignCardBps: made.payment.feeForeignCardBps })
      .returning();
    await hold(made.call, extra.id);
    await db.update(schema.callExtensions).set({ status: "accepted", decidedAt: new Date() }).where(eq(schema.callExtensions.id, extension.id));
    await db.update(schema.calls).set({ endsAt: newEnd }).where(eq(schema.calls.id, made.call.id));
    const call = await reloadCall(made.call.id);
    await attend(call, [["host", 0, 1200], ["customer", 0, 1200]]);
    return { call: await reloadCall(call.id), payment: made.payment, extra };
  }

  console.log("\n4. A call with time added: one answer for each charge");
  {
    const c = await withAddedTime();
    await settle(c, 5);
    check("both charges stay on hold after the call", (await reload(c.payment.id)).status === "held" && (await reload(c.extra.id)).status === "held");
    await ask(c, 60);
    const view = (await R.requestViewOf(c.call))!;
    check("the host is asked about both", view.open.length === 2);
    check("an answer for only one of them is not accepted", (await problem(answer(c, 120, [{ paymentId: c.payment.id, choice: "full" }]))) instanceof RequestError && (await requestOf(c)).status === "asked");
    await answer(c, 120, [{ paymentId: c.payment.id, choice: "less", maxCents: 800 }, { paymentId: c.extra.id, choice: "nothing" }]);
    const [own, extra] = [await reload(c.payment.id), await reload(c.extra.id)];
    check("each is carried out as its own payment: $8.00 taken for the call, nothing for the added time", own.status === "charged" && own.chargedCents === 800 && own.loweredBy === "host" && extra.status === "closed_uncharged" && extra.loweredBy === "host", `${own.status} ${own.chargedCents} ${extra.status}`);
    check("Stripe took exactly that, once", (await received(c.payment.id)).amount_received === 800 && (await received(c.extra.id)).status === "canceled");
  }

  console.log("\n5. An answer and the automatic moment at the same instant");
  {
    const c = await paid();
    await settle(c, 5);
    await ask(c, 60);
    const moment = 60 + DAY + 10; // the host's 24 hours, plus the 10 minutes
    await settle(c, moment - 1);
    check("a minute before, the money is still on hold", (await reload(c.payment.id)).status === "held");
    const [answered] = await Promise.allSettled([answer(c, moment, [{ paymentId: c.payment.id, choice: "nothing" }]), settle(c, moment)]);
    await reconcileOperations(soon());
    const p = await reload(c.payment.id);
    const req = await requestOf(c);
    const answerWon = answered.status === "fulfilled" && req.status === "answered" && p.status === "closed_uncharged";
    const takingWon = answered.status === "rejected" && req.status === "asked" && p.status === "charged" && p.chargedCents === 1333;
    check("whichever was written down first is what happens, and never both", answerWon !== takingWon, `${answered.status} ${req.status} ${p.status} ${p.chargedCents}`);
    console.log(`        (this time ${answerWon ? "the answer" : "the automatic charge"} was first)`);

    console.log("   …and each order on purpose, at the very same moment");
    const first = await paid();
    await settle(first, 5);
    await ask(first, 60);
    await answer(first, moment, [{ paymentId: first.payment.id, choice: "nothing" }]);
    await settle(first, moment);
    const pf = await reload(first.payment.id);
    check("the answer written first: it is carried out, and the automatic charge does nothing", pf.status === "closed_uncharged" && pf.loweredBy === "host" && (await requestOf(first)).status === "answered", pf.status);

    const second = await paid();
    await settle(second, 5);
    await ask(second, 60);
    await settle(second, moment);
    const tooLate = await problem(answer(second, moment, [{ paymentId: second.payment.id, choice: "nothing" }]));
    const ps = await reload(second.payment.id);
    check("the automatic charge written first: it stands in full, and the answer is refused as too late", ps.status === "charged" && ps.chargedCents === 1333 && tooLate instanceof RequestError && (await requestOf(second)).status === "asked", `${ps.status} ${tooLate?.message}`);
  }

  console.log("\n6. An answer given before the call's record is final: saved first, carried out later by the helper");
  {
    // The host answers in the first minute after the call, before its record is final: nothing can be carried out yet.
    const c = await paid();
    await ask(c, 0.5);
    await answer(c, 0.6, [{ paymentId: c.payment.id, choice: "less", maxCents: 700 }]);
    check("the answer is saved, the money still on hold", (await requestOf(c)).status === "answered" && (await reload(c.payment.id)).status === "held");
    check("the whole call is kept from collection while the answer is being applied", (await holdOn(c)) === "answer_applying");
    await settle(c, 5);
    const p = await reload(c.payment.id);
    check("the helper carries the saved answer out: $7.00, not the full amount", p.status === "charged" && p.chargedCents === 700 && p.loweredBy === "host" && (await received(c.payment.id)).amount_received === 700, `${p.status} ${p.chargedCents}`);
    await settle(c, DAY + 30);
    check("and nothing more is taken later", (await received(c.payment.id)).amount_received === 700 && (await holdOn(c)) === null);
  }

  console.log("\n7. Two charges: one goes through; for the other a charge was written down and Stripe's answer never came back");
  {
    const c = await withAddedTime();
    await ask(c, 0.5);
    await answer(c, 0.6, [{ paymentId: c.payment.id, choice: "less", maxCents: 600 }, { paymentId: c.extra.id, choice: "less", maxCents: 900 }]);
    // For the added time the state is put in place by hand, exactly as the app leaves it when it has written the
    // charge down, Stripe has made it, and the app stops before hearing back.
    const label = `capture:${c.extra.id}:1`;
    const params = { amountCents: 900, reason: "attendance", frozen: { hostSeconds: 600, customerSeconds: 600, togetherSeconds: 600 }, callEndsAt: c.call.endsAt.toISOString(), pricedThroughEventId: null, lowered: { recordCents: 1333, by: "host" } };
    await db.insert(schema.moneyOperations).values({ paymentId: c.extra.id, kind: "capture", label, params: JSON.stringify(params), createdAt: new Date(Date.now() - 10 * 60_000) });
    await stripe().paymentIntents.capture((await reload(c.extra.id)).stripePaymentIntentId!, { amount_to_capture: 900 }, { idempotencyKey: label });
    await settle(c, 5);
    const own = await reload(c.payment.id);
    check("the first charge goes through as answered; the second waits to be checked", own.status === "charged" && own.chargedCents === 600 && (await reload(c.extra.id)).status === "held", `${own.status} ${own.chargedCents}`);
    check("the call stays held from collection until both are done", (await holdOn(c)) === "answer_applying");
    await reconcileOperations(soon());
    await settle(c, 6);
    const extra = await reload(c.extra.id);
    check("the helper records the second as it was written down: $9.00, once", extra.status === "charged" && extra.chargedCents === 900 && extra.loweredBy === "host" && extra.recordCents === 1333 && (await received(c.extra.id)).amount_received === 900, `${extra.status} ${extra.chargedCents}`);
    check("then nothing holds the call any more", (await holdOn(c)) === null);
  }

  /** A call whose request the host never answered: the money was taken in full when their time was up. */
  async function unanswered(hostId: string = host.id) {
    const c = await paid(hostId);
    await settle(c, 5);
    await ask(c, 60);
    await settle(c, 60 + DAY + 10);
    return c;
  }
  /** Stores a refund's start as a moment after the request (the calls here end in the pretended future). */
  const startedAfterRequest = async (c: Made, refundId: string) => db.update(schema.refunds).set({ createdAt: new Date((await requestOf(c)).askedAt.getTime() + 60_000) }).where(eq(schema.refunds.id, refundId));

  console.log("\n8. No answer in time: the money is taken in full, and the request stays open");
  {
    const c = await paid();
    await settle(c, 5);
    await ask(c, 60);
    await settle(c, 60 + DAY + 9);
    check("the host's time is 24 hours from the request: a minute before the end the money is still on hold", (await reload(c.payment.id)).status === "held");
    await settle(c, 60 + DAY + 10);
    const p = await reload(c.payment.id);
    check("then it is taken in full", p.status === "charged" && p.chargedCents === 1333 && p.loweredBy === null, `${p.status} ${p.chargedCents}`);
    check("the request is still open, and nothing was refused or refunded by itself", (await requestOf(c)).status === "asked" && p.refundedCents === 0 && !(await R.requestViewOf(c.call))!.answered);
    check("the host cannot collect the money for that call", (await holdOn(c)) === "request");
    const tooLate = await problem(answer(c, 60 + DAY + 20, [{ paymentId: c.payment.id, choice: "nothing" }]));
    check("an answer now can no longer lower the charge", tooLate instanceof RequestError && /already been taken/.test(tooLate.message), tooLate?.message);

    console.log("   …a late \"no\"");
    await R.declineRequest({ callId: c.call.id, by: host.id, as: "host", message: "The call went fine on my side." });
    const declined = await requestOf(c);
    check("is saved, the customer is told, and the hold on collecting is gone", declined.status === "declined" && (await mail(`refund-request:${declined.id}:declined`))?.body.includes("The call went fine on my side.") === true && (await holdOn(c)) === null);

    console.log("   …a late refund of part of it");
    const part = await unanswered();
    const refundId = randomUUID();
    await refundPayment({ paymentId: part.payment.id, amountCents: 400, decidedBy: host.id, decidedAs: "host", reason: "Sorry about the sound.", requestId: refundId });
    await startedAfterRequest(part, refundId);
    const refundMail = await mail(`refund:${refundId}`);
    check("answers the request, whatever the amount", (await R.requestViewOf(part.call))!.answered && (await requestOf(part)).status === "asked" && (await holdOn(part)) === null);
    check("the customer gets the message that came with the refund", refundMail?.to === customer.email && refundMail.body.includes("Sorry about the sound.") && refundMail.subject.includes("$4.00"));
    const staleNo = await problem(R.declineRequest({ callId: part.call.id, by: host.id, as: "host", message: "No." }));
    const staleClose = await problem(R.closeRequest({ callId: part.call.id, adminId: founder.id }));
    const partRequest = await requestOf(part);
    check("a \"no\" or a close arriving after that refund changes nothing and sends no second answer", staleNo instanceof RequestError && staleClose instanceof RequestError && partRequest.status === "asked" && !(await mail(`refund-request:${partRequest.id}:declined`)) && !(await mail(`refund-request:${partRequest.id}:closed`)));

    console.log("   …a late refund in full");
    const whole = await unanswered();
    const wholeId = randomUUID();
    await refundPayment({ paymentId: whole.payment.id, amountCents: 1333, decidedBy: host.id, decidedAs: "host", reason: null, requestId: wholeId });
    await startedAfterRequest(whole, wholeId);
    check("answers it too", (await R.requestViewOf(whole.call))!.answered && (await reload(whole.payment.id)).refundedCents === 1333);

    console.log("   …refunds that do not count as an answer");
    const none = await unanswered();
    const asked = (await requestOf(none)).askedAt;
    const onItsWay = randomUUID();
    await db.insert(schema.refunds).values({ id: onItsWay, paymentId: none.payment.id, amountCents: 100, decidedBy: host.id, decidedAs: "host", createdAt: new Date(asked.getTime() + 60_000) });
    check("one that is still on its way", !(await R.requestViewOf(none.call))!.answered);
    await db.update(schema.refunds).set({ status: "failed", finishedAt: new Date() }).where(eq(schema.refunds.id, onItsWay));
    check("one that failed", !(await R.requestViewOf(none.call))!.answered);
    await db.insert(schema.refunds).values({ paymentId: none.payment.id, amountCents: 100, decidedBy: host.id, decidedAs: "host", status: "done", createdAt: new Date(asked.getTime() - 3_600_000) });
    check("one that was started before the request", !(await R.requestViewOf(none.call))!.answered && (await holdOn(none)) === "request");
    check("the founder's list shows what is still waiting, and not what was answered", (await R.unansweredRequests()).some((r) => r.call.id === none.call.id) && !(await R.unansweredRequests()).some((r) => [c.call.id, part.call.id, whole.call.id].includes(r.call.id)));
  }

  console.log("\n9. The founder, for a host who has gone silent");
  {
    const a = await paid();
    await settle(a, 5);
    await ask(a, 60);
    await answer(a, 120, [{ paymentId: a.payment.id, choice: "less", maxCents: 500 }], "admin", "Connect looked at this call.");
    const p = await reload(a.payment.id);
    const req = await requestOf(a);
    check("answers in the host's place before the money is taken: lowered \"by Connect\"", p.status === "charged" && p.chargedCents === 500 && p.loweredBy === "admin" && req.decidedAs === "admin" && req.decidedBy === founder.id, `${p.chargedCents} ${p.loweredBy}`);
    check("the customer's email says it was Connect", (await mail(`refund-request:${req.id}:answer`))?.subject === "Connect answered your refund request");

    const b = await paid();
    await settle(b, 5);
    await ask(b, 60);
    await R.closeRequest({ callId: b.call.id, adminId: founder.id, now: after(b, 120) });
    const q = await reload(b.payment.id);
    check("closes a request before the money is taken: it is then taken in full at once", (await requestOf(b)).status === "closed" && q.status === "charged" && q.chargedCents === 1333 && q.loweredBy === null, `${q.status} ${q.chargedCents}`);

    const c = await unanswered();
    await R.closeRequest({ callId: c.call.id, adminId: founder.id });
    const closed = await requestOf(c);
    check("closes one after the money was taken: the host's payment can go ahead, and the customer is told", closed.status === "closed" && (await holdOn(c)) === null && Boolean(await mail(`refund-request:${closed.id}:closed`)));
  }

  console.log("\n10. A call under the founder's review, with a request open");
  {
    const c = await paid(host.id, [["host", 0, null], ["customer", 0, 600]]); // the host's "disconnected" message is missing
    await settle(c, 5);
    check("the charge waits for the founder's review", (await reload(c.payment.id)).needsReview === true);
    check("the customer can still ask", (await ask(c, 60)) === "sent");
    const refused = await problem(answer(c, 120, [{ paymentId: c.payment.id, choice: "nothing" }]));
    check("the host's answer cannot decide a charge that is under review", refused instanceof RequestError && /review/.test(refused.message) && (await requestOf(c)).status === "asked", refused?.message);
    const during = (await R.requestViewOf(c.call))!;
    const early = await problem(R.declineRequest({ callId: c.call.id, by: host.id, as: "host", message: null }));
    check("the request is shown as \"being decided\", not as \"the money was taken\", and cannot be declined yet", during.beingDecided && !during.nothingAtStake && during.open.length === 0 && early instanceof RequestError && (await mail(`refund-request:${during.request.id}:host`))?.body.includes("still being decided") === true);
    await settle(c, 60 + DAY + 30);
    check("it is never taken automatically, also not when the host's time is up", (await reload(c.payment.id)).status === "held");
    await settle(c, 3 * DAY + 1);
    const p = await reload(c.payment.id);
    const view = (await R.requestViewOf(c.call))!;
    check("nobody decides in time: the hold is released, as today, and that is not shown as the host's answer", p.status === "closed_uncharged" && p.loweredBy === null && view.request.status === "asked" && view.nothingAtStake);
    check("such a request needs no answer any more", !(await R.unansweredRequests()).some((r) => r.call.id === c.call.id));
  }

  console.log("\n10a. A charge the founder makes early can never be collected while the customer could still ask");
  {
    const c = await paid(host.id, [["host", 0, null], ["customer", 0, 600]]);
    await settle(c, 5);
    // The founder decides an hour after the call. Nobody has asked for a refund.
    await capturePayment({ paymentId: c.payment.id, amountCents: 700, reason: "admin", frozen: null, callEndsAt: c.call.endsAt, now: after(c, 60) });
    const p = await reload(c.payment.id);
    check("its share is ready only when asking is over: 24 hours and 10 minutes after the call", p.status === "charged" && p.transferDueAt?.getTime() === after(c, DAY + 10).getTime(), String(p.transferDueAt?.toISOString()));
    const waiting = (await unsentEarnings(after(c, DAY + 9), host.id)).find((e) => e.payment.id === c.payment.id);
    check("a minute before that it cannot be collected yet", waiting?.heldBack === "not_yet");
    check("a request sent in the last seconds is still accepted, and then holds the money", (await ask(c, DAY + 9)) === "sent" && (await holdOn(c)) === "request");
    const held = (await unsentEarnings(after(c, DAY + 10), host.id)).find((e) => e.payment.id === c.payment.id);
    check("so when its moment comes the host is told to answer first", held?.heldBack === "request");
    check("and the request moves that charge's date to the 2 days of a call with a request", (await reload(c.payment.id)).transferDueAt?.getTime() === after(c, 2 * DAY).getTime(), String((await reload(c.payment.id)).transferDueAt?.toISOString()));
    await R.declineRequest({ callId: c.call.id, by: host.id, as: "host", message: null });
    const answered = async (minutes: number) => (await unsentEarnings(after(c, minutes), host.id)).find((e) => e.payment.id === c.payment.id)?.heldBack;
    check("after the host's answer it still waits for the 2 days, and is ready exactly then", (await answered(DAY + 30)) === "not_yet" && (await answered(2 * DAY - 1)) === "not_yet" && (await answered(2 * DAY)) === null);
  }

  console.log("\n10b. An answer was accepted, and then the charge comes under the founder's review");
  {
    const reviewed = async (choice: string, maxCents?: number) => {
      const c = await paid();
      await ask(c, 0.5);
      await answer(c, 0.6, [{ paymentId: c.payment.id, choice, maxCents }]);
      // A late message from the video service: a connection of the host that never ended. The record no longer adds up.
      await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: c.call.id, type: "participant_joined", roomSessionId: "RM_refundcheck", participantIdentity: host.id, participantSessionId: `PA_never_left_${randomUUID().slice(0, 6)}`, providerTime: new Date(c.call.startsAt.getTime() + 500_000), payload: "{}" });
      await settle(c, 5);
      return c;
    };
    const decide = (c: Made, amountCents: number) => problem(capturePayment({ paymentId: c.payment.id, amountCents, reason: "admin", frozen: null, callEndsAt: c.call.endsAt, now: after(c, 30) }));

    const capped = await reviewed("less", 700);
    check("the answer cannot override the review: the charge waits for the founder", (await reload(capped.payment.id)).needsReview === true && (await reload(capped.payment.id)).status === "held");
    check("the call stays held from collection while that answer is not finished", (await holdOn(capped)) === "answer_applying");
    const over = await decide(capped, 1333);
    check("and the review cannot undo the answer: the founder cannot charge more than the host's \"at most $7\"", over instanceof MoneyError && /at most \$7\.00/.test(over.message) && (await reload(capped.payment.id)).status === "held", over?.message);
    const within = await decide(capped, 700);
    check("the founder can charge up to it", within === null && (await reload(capped.payment.id)).chargedCents === 700 && (await holdOn(capped)) === null, within?.message);

    const free = await reviewed("nothing");
    const any = await decide(free, 500);
    check("after \"charge nothing\" the founder cannot charge at all; the hold can only be let go", any instanceof MoneyError && /charge nothing/.test(any.message) && (await reload(free.payment.id)).status === "held", any?.message);
  }

  console.log("\n10c. Two charges whose holds end at different times share one moment, also after one of them went through");
  {
    const c = await withAddedTime();
    await settle(c, 5);
    // The call's own hold ends early: 32 hours after the call. So the money is due 12 hours before that, at hour 20.
    await db.update(schema.payments).set({ holdExpiresAt: after(c, 32 * HOUR) }).where(eq(schema.payments.id, c.payment.id));
    await settle(c, 20 * HOUR - 1);
    check("a minute before that moment both are still on hold", (await reload(c.payment.id)).status === "held" && (await reload(c.extra.id)).status === "held");
    // Stripe has just refused the charge for the added time (put in place by hand), so the app waits an hour before trying it again.
    await db.insert(schema.moneyOperations).values({ paymentId: c.extra.id, kind: "capture", label: `capture:${c.extra.id}:1`, params: "{}", status: "failed", error: "refused", finishedAt: after(c, 20 * HOUR) });
    await settle(c, 20 * HOUR);
    check("at the moment, the first is taken and the refused one waits", (await reload(c.payment.id)).status === "charged" && (await reload(c.extra.id)).status === "held");
    await settle(c, 21 * HOUR + 5);
    const extra = await reload(c.extra.id);
    check("an hour later the second is tried again; the moment has not moved to its own, later, hold", extra.status === "charged" && extra.chargedCents === 1333, `${extra.status} ${extra.chargedCents}`);
  }

  console.log("\n11. Collecting while a request is not answered");
  const mine = await getHostSettings(host.id);
  if (!mine.stripeAccountId || !(await refreshPayoutsReady(host.id))) {
    console.log("   SKIPPED: this part needs the test host's payout account (set up payouts for host@test.local on the Hosting page).");
  } else {
    // A new host with nothing behind them takes over the test payout account for this part (one account belongs to one host at a time).
    const account = mine.stripeAccountId;
    const h = `rc-${randomUUID().slice(0, 8)}`;
    const stamp = new Date();
    await db.insert(schema.user).values({ id: h, name: "Refund check host", email: `refundcheck-${h}@example.test`, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
    await db.transaction(async (tx) => {
      await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, host.id));
      await tx.insert(schema.hostSettings).values({ userId: h, stripeAccountId: account, payoutsReady: true });
    });
    try {
      const c = await unanswered(h);
      const ready = (await reload(c.payment.id)).transferDueAt!;
      const press = () => problem(collectEarnings({ collectionId: randomUUID(), hostId: h, startedBy: h, now: ready }));
      const refused = await press();
      const shown = await unsentEarnings(ready, h);
      check("the press takes nothing for that call, and the host is told why", refused instanceof MoneyError && shown.length === 1 && shown[0].heldBack === "request" && (await reload(c.payment.id)).transferStatus === "not_due", refused?.message);
      await R.declineRequest({ callId: c.call.id, by: h, as: "host", message: null });
      const accepted = await press();
      check("once the host has answered, it can be collected", accepted === null && (await reload(c.payment.id)).transferStatus === "sent", accepted?.message);
    } finally {
      await db.transaction(async (tx) => {
        await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, h));
        await tx.update(schema.hostSettings).set({ stripeAccountId: account }).where(eq(schema.hostSettings.userId, host.id));
      });
      await refreshPayoutsReady(host.id).catch(() => undefined);
    }
  }

  console.log("\n12. The health answer");
  {
    const c = await paid();
    await settle(c, 5);
    const call = await reloadCall(c.call.id);
    check("a charge is not late 4 minutes after its moment, and is late 6 minutes after it", !(await callOverdue(call, after(c, DAY + 14))) && (await callOverdue(call, after(c, DAY + 16))));
    await ask(c, 60);
    check("with a request it is not late while the host still has time", !(await callOverdue(call, after(c, DAY + 16))) && (await callOverdue(call, after(c, 60 + DAY + 16))));

    const review = await paid(host.id, [["host", 0, null], ["customer", 0, 600]]);
    await settle(review, 5);
    check("a charge waiting for the founder's review never counts as late", !(await callOverdue(await reloadCall(review.call.id), after(review, 2 * DAY))));

    const waiting = await paid();
    await ask(waiting, 0.5);
    await answer(waiting, 0.6, [{ paymentId: waiting.payment.id, choice: "full" }]);
    const answeredCall = await reloadCall(waiting.call.id);
    check("an answer that has only just been accepted is not late; one with nothing started after 5 minutes is", !(await callOverdue(answeredCall, after(waiting, 5))) && (await callOverdue(answeredCall, after(waiting, 6))));
    await db.insert(schema.moneyOperations).values({ paymentId: waiting.payment.id, kind: "capture", label: `capture:${waiting.payment.id}:1`, params: "{}", status: "started" });
    check("a charge that was started is not counted here (unanswered actions are watched on their own)", !(await callOverdue(answeredCall, after(waiting, 6))));
    await db.delete(schema.moneyOperations).where(eq(schema.moneyOperations.label, `capture:${waiting.payment.id}:1`));
    await settle(waiting, 5);

    const helper = async (now: Date) => (await healthProblems(now)).some((line) => line.includes("helper"));
    const now = new Date();
    await recordBeat("payments", new Date(now.getTime() - 11 * 60_000));
    check("not healthy when the helper has not finished a round of payment work for more than 10 minutes", await helper(now));
    await recordBeat("payments", new Date(now.getTime() - 9 * 60_000));
    check("and that reason is gone once it has", !(await helper(now)));
  }

  console.log("\n13. The notes about connection quality");
  {
    const { call } = await newCall();
    type Headers = { get(name: string): string | null };
    const ours: Headers = { get: (name) => (name === "sec-fetch-site" ? "same-origin" : null) };
    const theirs: Headers = { get: (name) => (name === "sec-fetch-site" ? "cross-site" : null) };
    const during = new Date(call.startsAt.getTime() + 60_000);
    const batch = (seqs: number[], connectionId = "connection-one") => JSON.stringify({ connectionId, notes: seqs.flatMap((seq) => [{ about: "me", grade: "good", seenAt: during.getTime() - 1000, seq: seq * 2 }, { about: "other", grade: "poor", seenAt: during.getTime() - 1000, seq: seq * 2 + 1 }]) });
    const send = (userId: string | null, text: string, now = during, headers = ours, callId = call.id) => receiveNotes({ userId, callId, headers, text, now });
    const count = async (reporterId: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.qualityNotes).where(and(eq(schema.qualityNotes.callId, call.id), eq(schema.qualityNotes.reporterId, reporterId))))[0].n;

    check("refused from another website", (await send(customer.id, batch([0]), during, theirs)) === 403);
    check("refused from someone who is not logged in", (await send(null, batch([0]))) === 401);
    check("refused from someone who is not on the call, with the same answer as for a call that does not exist", (await send(founder.id, batch([0]))) === 404 && (await send(customer.id, batch([0]), during, ours, randomUUID())) === 404);
    check("refused before the room opens and after the call's end", (await send(customer.id, batch([0]), new Date(call.startsAt.getTime() - 6 * 60_000))) === 409 && (await send(customer.id, batch([0]), call.endsAt)) === 409);
    check("refused when it is not what the call screen sends", (await send(customer.id, "{}")) === 400 && (await send(customer.id, "not json")) === 400 && (await send(customer.id, "")) === 400);
    check("nothing was kept from any of those", (await count(customer.id)) === 0);

    check("accepted from the customer during the call", (await send(customer.id, batch([0, 1]))) === 204 && (await count(customer.id)) === 4);
    const kept = await db.select().from(schema.qualityNotes).where(eq(schema.qualityNotes.callId, call.id));
    check("who a note is about is worked out on the server: \"me\" is the sender, \"other\" the other person of the call, nobody else", kept.every((n) => n.reporterId === customer.id && (n.grade === "good" ? n.aboutId === customer.id : n.aboutId === host.id)));
    check("a batch that arrives twice is counted once", (await send(customer.id, batch([0, 1]))) === 204 && (await count(customer.id)) === 4);

    // Fill the customer's allowance for this call almost to the top.
    await db.execute(sql`insert into quality_notes (call_id, reporter_id, about_id, grade, connection_id, seq, seen_at) select ${call.id}::uuid, ${customer.id}, ${customer.id}, 'good', 'filler-connection', g, ${during.toISOString()}::timestamptz from generate_series(1, 3990) g`);
    check("a person's notes for one call stop at the limit", (await send(customer.id, batch([10, 11, 12, 13, 14]))) === 204 && (await count(customer.id)) === 4000 && (await send(customer.id, batch([20]))) === 429);
    check("one person's limit does not use up the other's", (await send(host.id, batch([0]))) === 204 && (await count(host.id)) === 2);

    const cancelled = await newCall();
    await db.update(schema.calls).set({ cancelledAt: new Date(), cancelledBy: "host" }).where(eq(schema.calls.id, cancelled.call.id));
    check("refused for a cancelled call", (await send(customer.id, batch([0]), new Date(cancelled.call.startsAt.getTime() + 60_000), ours, cancelled.call.id)) === 409);

    await removeOldNotes(new Date(call.endsAt.getTime() + 61 * DAY * 60_000));
    check("the notes are removed 60 days after the call", (await count(customer.id)) === 0 && (await count(host.id)) === 0);
  }

  console.log("\n14. The reminder to the host, and what is kept for a year");
  {
    const c = await paid();
    await settle(c, 5);
    await ask(c, 60);
    const req = await requestOf(c);
    const key = `refund-request:${req.id}:reminder`;
    await R.writeAnswerReminders(after(c, 60 + 12 * HOUR - 1));
    check("no reminder before half of the host's time has passed", !(await mail(key)));
    await R.writeAnswerReminders(after(c, 60 + 12 * HOUR + 1));
    await R.writeAnswerReminders(after(c, 60 + 13 * HOUR));
    const reminders = await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `refund-request:${req.id}:reminder%`));
    check("one reminder halfway, and only one", reminders.length === 1 && reminders[0].to === host.email);
    await R.forgetOldRequests(new Date(req.askedAt.getTime() + 366 * DAY * 60_000));
    const old = await requestOf(c);
    check("after a year the saved summary and the two short texts are gone; the request itself stays", old.summary === null && old.note === "" && old.status === "asked");
    const toHost = await mail(`refund-request:${req.id}:host`);
    check("and so are their copies in the emails about the request, while the record that they were sent stays", Boolean(toHost) && !toHost.body.includes("The picture kept freezing.") && toHost.subject.length > 0);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
