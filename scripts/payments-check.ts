/**
 * Testing tool: runs real payment journeys against the Stripe sandbox and the
 * local database, and checks every result. No real money moves.
 *
 * It creates its own test calls, pretends the calls happened by adding
 * attendance messages, and uses a pretend "now" so nothing has to wait.
 *
 * Usage: npx tsx scripts/payments-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
  const { capturePayment, refundPayment, currentSplit } = await import("../src/lib/payments/actions");
  const { settleFinishedCalls, reconcileOperations } = await import("../src/lib/payments/jobs");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { cancelCall } = await import("../src/lib/payments/cancel");
  const { settleCancelledCalls } = await import("../src/lib/payments/jobs");

  const [host] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  const [customer] = await db.select().from(schema.user).where(eq(schema.user.email, "customer@test.local"));
  if (!host || !customer) throw new Error("Run `npm run seed` first.");

  const PRICE = 2000; // $20 per 15 minutes
  const MINUTES = 10; // booked total: $13.33

  /** Creates a paid call starting in 2 minutes, with its payment record. */
  async function newCall() {
    const startsAt = new Date(Math.ceil((Date.now() + 120_000) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + MINUTES * 60_000);
    return db.transaction(async (tx) => {
      const [call] = await tx
        .insert(schema.calls)
        .values({ hostId: host.id, customerId: customer.id, startsAt, endsAt, roomName: `paycheck-${randomUUID()}`, pricePer15Cents: PRICE })
        .returning();
      await createPaymentForCall(tx, call);
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
      return { call, payment };
    });
  }

  /** Places the hold the way the customer's browser would, using one of Stripe's test cards. */
  async function hold(call: Awaited<ReturnType<typeof newCall>>["call"], paymentId: string, testCard: string) {
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
    const started = await startHold({ payment, call, customer, now: new Date() });
    if ("alreadyHeld" in started) return syncHold(paymentId, new Date());
    const [withIntent] = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
    try {
      await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, {
        payment_method: testCard,
        return_url: "https://example.com/return",
      });
    } catch {
      // A declined card throws. syncHold below records the real state.
    }
    return syncHold(paymentId, new Date());
  }

  /** Adds attendance messages as if LiveKit had sent them. Offsets are seconds from the call's start. */
  async function attend(call: { id: string; startsAt: Date; hostId: string; customerId: string }, visits: Array<["host" | "customer", number, number | null]>) {
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
        roomSessionId: "RM_paycheck",
        participantIdentity: identity,
        participantSessionId: session,
        providerTime: time,
        payload: "{}",
      });
      await db.insert(schema.attendanceEvents).values(row("participant_joined", at(from)));
      if (to !== null) await db.insert(schema.attendanceEvents).values(row("participant_left", at(to)));
    }
    await db.update(schema.calls).set({ closedAt: new Date(call.startsAt.getTime() + (MINUTES * 60 + 60) * 1000) }).where(eq(schema.calls.id, call.id));
  }

  const after = (call: { endsAt: Date }, minutes: number) => new Date(call.endsAt.getTime() + minutes * 60_000);
  const reload = async (id: string) => (await db.select().from(schema.payments).where(eq(schema.payments.id, id)))[0];
  const ledgerSum = async (id: string, kind: string) =>
    (
      await db
        .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amountCents}), 0)::int` })
        .from(schema.ledgerEntries)
        .where(sql`${schema.ledgerEntries.paymentId} = ${id} and ${schema.ledgerEntries.kind} = ${kind}`)
    )[0].total;
  const stripeIntent = async (id: string) => stripe().paymentIntents.retrieve((await reload(id)).stripePaymentIntentId!);

  // ------------------------------------------------------------------------
  console.log("\n1. A normal call: host there 8 of 10 minutes");
  {
    const { call, payment } = await newCall();
    check("booked total is $13.33", payment.bookedCents === 1333, String(payment.bookedCents));
    const held = await hold(call, payment.id, "pm_card_visa");
    check("hold placed", held.status === "held");
    check("hold expiry recorded", held.holdExpiresAt !== null && held.holdExpiresAt > call.endsAt);
    check("card country recorded as US", held.cardCountry === "US", String(held.cardCountry));
    check("Stripe holds the full booked price", (await stripeIntent(payment.id)).amount_capturable === 1333);

    await attend(call, [["host", 60, 540], ["customer", 0, 600]]);
    await settleFinishedCalls(after(call, 5));
    const p = await reload(payment.id);
    // 480 seconds at $20 per 15 minutes = $10.67
    check("charged $10.67 for 8 minutes", p.status === "charged" && p.chargedCents === 1067, `${p.status} ${p.chargedCents}`);
    check("fee 82 cents, host $9.85", p.originalFeeCents === 82 && p.originalHostShareCents === 985, `${p.originalFeeCents} ${p.originalHostShareCents}`);
    check("time totals frozen", p.frozenHostSeconds === 480 && p.frozenTogetherSeconds === 480);
    check("host share has a payday", p.transferStatus === "not_due" && p.transferDueAt !== null);
    const intent = await stripeIntent(payment.id);
    check("Stripe received exactly $10.67", intent.status === "succeeded" && intent.amount_received === 1067, `${intent.status} ${intent.amount_received}`);

    await settleFinishedCalls(after(call, 6));
    await capturePayment({ paymentId: payment.id, amountCents: 1067, reason: "attendance", frozen: null, callEndsAt: call.endsAt }).catch(() => "refused");
    check("running it all again charges nothing more", (await stripeIntent(payment.id)).amount_received === 1067);
    check("money record: one charge line", (await ledgerSum(payment.id, "customer_charge")) === 1067);

    console.log("   …then the host refunds half");
    await refundPayment({ paymentId: payment.id, amountCents: 533, decidedBy: host.id, decidedAs: "host", reason: "check" });
    const r = await reload(payment.id);
    check("refund recorded", r.refundedCents === 533);
    const split = currentSplit(r);
    check("fee and host share still add up to what the customer paid", split.feeCents + split.hostShareCents === 1067 - 533, `${split.feeCents}+${split.hostShareCents}`);
    check(
      "money record adds up",
      (await ledgerSum(payment.id, "platform_fee")) + (await ledgerSum(payment.id, "host_share")) ===
        (await ledgerSum(payment.id, "customer_charge")) + (await ledgerSum(payment.id, "customer_refund")),
    );
    const refused = await refundPayment({ paymentId: payment.id, amountCents: 600, decidedBy: host.id, decidedAs: "host", reason: null }).catch((e) => e);
    check("cannot refund more than is left", refused instanceof MoneyError);

    console.log("   …then the host refunds the rest");
    await refundPayment({ paymentId: payment.id, amountCents: 534, decidedBy: host.id, decidedAs: "host", reason: null });
    const f = await reload(payment.id);
    check("full refund is truly full", f.refundedCents === 1067 && currentSplit(f).hostShareCents === 0 && currentSplit(f).feeCents === 0);
    check("nothing is owed to the host any more", f.transferStatus === "not_owed");
    const refunded = (await stripe().refunds.list({ payment_intent: f.stripePaymentIntentId!, limit: 10 })).data.reduce((s, x) => s + x.amount, 0);
    check("Stripe refunded exactly $10.67 in total", refunded === 1067, String(refunded));
  }

  console.log("\n2. Two helpers try to charge the same call at the same moment");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    const results = await Promise.allSettled([
      capturePayment({ paymentId: payment.id, amountCents: 1333, reason: "attendance", frozen: null, callEndsAt: call.endsAt }),
      capturePayment({ paymentId: payment.id, amountCents: 1333, reason: "attendance", frozen: null, callEndsAt: call.endsAt }),
      settleFinishedCalls(after(call, 5)),
    ]);
    await reconcileOperations(new Date(Date.now() + 120_000));
    const p = await reload(payment.id);
    check("charged exactly once", p.status === "charged" && (await stripeIntent(payment.id)).amount_received === 1333, results.map((r) => r.status).join(","));
    check("one charge line in the money record", (await ledgerSum(payment.id, "customer_charge")) === 1333);
  }

  console.log("\n3. The host never shows up");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["customer", 0, 600]]);
    await settleFinishedCalls(after(call, 5));
    const p = await reload(payment.id);
    check("nothing charged, hold released", p.status === "closed_uncharged" && p.chargedCents === null);
    check("Stripe shows the hold cancelled", (await stripeIntent(payment.id)).status === "canceled");
  }

  console.log("\n4. The record is incomplete (the host's \"disconnected\" message is missing)");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, null], ["customer", 0, 600]]);
    await settleFinishedCalls(after(call, 5));
    let p = await reload(payment.id);
    check("not charged, waiting for review", p.status === "held" && p.needsReview === true, `${p.status} ${p.needsReview}`);
    await settleFinishedCalls(after(call, 60));
    check("still not charged an hour later", (await reload(payment.id)).status === "held");
    const blocked = await capturePayment({ paymentId: payment.id, amountCents: 1333, reason: "attendance", frozen: null, callEndsAt: call.endsAt }).catch((e) => e);
    check("the automatic charge is refused while it waits", blocked instanceof MoneyError);
    await settleFinishedCalls(after(call, 60 * 24 * 3 + 1));
    p = await reload(payment.id);
    check("released when nobody decided in time", p.status === "closed_uncharged");
    check("Stripe shows the hold cancelled", (await stripeIntent(payment.id)).status === "canceled");
  }

  console.log("\n5. The founder decides a call that needs review");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, null]]);
    await settleFinishedCalls(after(call, 5));
    await capturePayment({ paymentId: payment.id, amountCents: 700, reason: "admin", frozen: null, callEndsAt: call.endsAt });
    const p = await reload(payment.id);
    check("charged the amount the founder chose", p.status === "charged" && p.chargedCents === 700 && p.chargeReason === "admin");
    const tooMuch = await newCall();
    await hold(tooMuch.call, tooMuch.payment.id, "pm_card_visa");
    const refused = await capturePayment({ paymentId: tooMuch.payment.id, amountCents: 1334, reason: "attendance", frozen: null, callEndsAt: tooMuch.call.endsAt }).catch((e) => e);
    check("never more than the booked price", refused instanceof MoneyError && /more than the booked/.test(refused.message), refused?.message);
    const notReview = await capturePayment({ paymentId: tooMuch.payment.id, amountCents: 700, reason: "admin", frozen: null, callEndsAt: tooMuch.call.endsAt }).catch((e) => e);
    check("the founder cannot charge a call that is not waiting for review", notReview instanceof MoneyError && (await reload(tooMuch.payment.id)).status === "held");

    const late = await newCall();
    await hold(late.call, late.payment.id, "pm_card_visa");
    await attend(late.call, [["host", 0, null]]);
    await settleFinishedCalls(after(late.call, 5));
    const tooLate = await capturePayment({
      paymentId: late.payment.id,
      amountCents: 700,
      reason: "admin",
      frozen: null,
      callEndsAt: late.call.endsAt,
      now: after(late.call, 60 * 24 * 3 + 1),
    }).catch((e) => e);
    check("the founder cannot charge after the deadline", tooLate instanceof MoneyError && (await reload(late.payment.id)).status === "held", tooLate?.message);
  }

  console.log("\n6. A declined card");
  {
    const { call, payment } = await newCall();
    const p = await hold(call, payment.id, "pm_card_chargeDeclined");
    check("no hold, still waiting for payment", p.status === "awaiting_payment");
    await settleFinishedCalls(after(call, 5));
    check("closed without a charge once the call is over", (await reload(payment.id)).status === "closed_uncharged");
  }

  console.log("\n7. A card from outside the United States");
  {
    const { call, payment } = await newCall();
    const held = await hold(call, payment.id, "pm_card_gb");
    check("card country recorded as GB", held.cardCountry === "GB", String(held.cardCountry));
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    await settleFinishedCalls(after(call, 5));
    const p = await reload(payment.id);
    // 4.9% of $13.33 = 65 cents, + 30 cents, + 1.5% = 20 cents
    check("fee includes the foreign-card 1.5%", p.originalFeeCents === 115 && p.originalHostShareCents === 1218, `${p.originalFeeCents} ${p.originalHostShareCents}`);
  }

  const reloadCall = async (id: string) => (await db.select().from(schema.calls).where(eq(schema.calls.id, id)))[0];

  console.log("\n8. The customer cancels inside the free period (default rule: any time before the start)");
  {
    const { call, payment } = await newCall();
    const held = await hold(call, payment.id, "pm_card_visa");
    const outcome = await cancelCall({ call, payment: held, by: "customer", now: new Date() });
    check("cancelling is free", outcome === "free");
    check("hold released, nothing charged", (await reload(payment.id)).status === "closed_uncharged");
    check("Stripe shows the hold cancelled", (await stripeIntent(payment.id)).status === "canceled");
    const again = await cancelCall({ call: await reloadCall(call.id), payment: await reload(payment.id), by: "customer", now: new Date() }).catch((e) => e);
    check("cannot be cancelled twice", again instanceof MoneyError);
  }

  console.log("\n9. The customer cancels after the free period (host's rule: 24 hours)");
  {
    const { call, payment } = await newCall();
    await db.update(schema.calls).set({ freeCancelMinutes: 1440 }).where(eq(schema.calls.id, call.id));
    const held = await hold(call, payment.id, "pm_card_visa");
    const outcome = await cancelCall({ call: await reloadCall(call.id), payment: held, by: "customer", now: new Date() });
    check("cancelling is late", outcome === "late_charge");
    const p = await reload(payment.id);
    check("the full booked price is charged", p.status === "charged" && p.chargedCents === 1333 && p.chargeReason === "late_cancel", `${p.status} ${p.chargedCents}`);
    check("Stripe received the full booked price", (await stripeIntent(payment.id)).amount_received === 1333);
    await settleCancelledCalls();
    await settleFinishedCalls(after(call, 30));
    check("nothing more is charged afterwards", (await stripeIntent(payment.id)).amount_received === 1333);
    await refundPayment({ paymentId: payment.id, amountCents: 1333, decidedBy: host.id, decidedAs: "host", reason: "goodwill" });
    check("the host can still refund it in full", (await reload(payment.id)).refundedCents === 1333);
  }

  console.log("\n10. The host cancels, even late");
  {
    const { call, payment } = await newCall();
    await db.update(schema.calls).set({ freeCancelMinutes: 1440 }).where(eq(schema.calls.id, call.id));
    const held = await hold(call, payment.id, "pm_card_visa");
    const outcome = await cancelCall({ call: await reloadCall(call.id), payment: held, by: "host", now: new Date() });
    check("free for the customer", outcome === "free" && (await reload(payment.id)).status === "closed_uncharged");
  }

  console.log("\n11. Nobody can cancel once the call has started");
  {
    const { call, payment } = await newCall();
    const held = await hold(call, payment.id, "pm_card_visa");
    const refused = await cancelCall({ call, payment: held, by: "customer", now: new Date(call.startsAt.getTime() + 1000) }).catch((e) => e);
    check("refused", refused instanceof MoneyError && (await reload(payment.id)).status === "held");
    await cancelCall({ call, payment: held, by: "host", now: new Date() });
  }

  const soon = () => new Date(Date.now() + 5 * 60_000); // old enough for the helper to check unfinished actions
  const opsFor = async (id: string) => db.select().from(schema.moneyOperations).where(eq(schema.moneyOperations.paymentId, id));

  console.log("\n12. The app crashes right after Stripe made the charge");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    // Write the action down and ask Stripe, exactly as the app does, then "crash" before recording the result.
    const label = `capture:${payment.id}:1`;
    const params = { amountCents: 1333, reason: "attendance", frozen: { hostSeconds: 600, customerSeconds: 600, togetherSeconds: 600 }, callEndsAt: call.endsAt.toISOString() };
    await db.insert(schema.moneyOperations).values({ paymentId: payment.id, kind: "capture", label, params: JSON.stringify(params), createdAt: new Date(Date.now() - 10 * 60_000) });
    await stripe().paymentIntents.capture((await reload(payment.id)).stripePaymentIntentId!, { amount_to_capture: 1333 }, { idempotencyKey: label });
    check("before recovery: Stripe has the money, our record still says held", (await reload(payment.id)).status === "held");

    const blocked = await capturePayment({ paymentId: payment.id, amountCents: 1333, reason: "attendance", frozen: null, callEndsAt: call.endsAt }).catch((e) => e);
    check("nothing else may run on this payment until Stripe has been asked", blocked instanceof Error && (await reload(payment.id)).status === "held");

    await reconcileOperations(soon());
    const p = await reload(payment.id);
    check("after recovery: recorded as charged, with the right split", p.status === "charged" && p.chargedCents === 1333 && p.originalFeeCents === 95, `${p.status} ${p.chargedCents} ${p.originalFeeCents}`);
    await settleFinishedCalls(after(call, 5));
    check("charged exactly once", (await stripeIntent(payment.id)).amount_received === 1333 && (await ledgerSum(payment.id, "customer_charge")) === 1333);
  }

  console.log("\n13. The app crashes before the charge ever reached Stripe");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    const params = { amountCents: 1333, reason: "attendance", frozen: { hostSeconds: 600, customerSeconds: 600, togetherSeconds: 600 }, callEndsAt: call.endsAt.toISOString(), pricedThroughEventId: null };
    await db.insert(schema.moneyOperations).values({ paymentId: payment.id, kind: "capture", label: `capture:${payment.id}:1`, params: JSON.stringify(params), createdAt: new Date(Date.now() - 10 * 60_000) });
    check("before recovery: nothing charged at Stripe", (await stripeIntent(payment.id)).status === "requires_capture");
    // "Not charged yet" does not prove the request is not still on its way, so recovery sends it again under the same label.
    await reconcileOperations(soon());
    const ops = await opsFor(payment.id);
    const p = await reload(payment.id);
    check("recovery finishes the charge itself", ops.length === 1 && ops[0].status === "succeeded" && p.status === "charged", `${ops[0]?.status} ${p.status}`);
    await settleFinishedCalls(after(call, 5));
    check("charged exactly once", (await stripeIntent(payment.id)).amount_received === 1333 && (await ledgerSum(payment.id, "customer_charge")) === 1333);
  }

  console.log("\n14. The app crashes right after Stripe made a refund");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    await settleFinishedCalls(after(call, 5));
    const refundId = randomUUID();
    const label = `refund:${refundId}:1`;
    await db.insert(schema.refunds).values({ id: refundId, paymentId: payment.id, amountCents: 400, decidedBy: host.id, decidedAs: "host" });
    await db.insert(schema.moneyOperations).values({ paymentId: payment.id, kind: "refund", label, params: JSON.stringify({ refundId, amountCents: 400 }), createdAt: new Date(Date.now() - 10 * 60_000) });
    const intentId = (await reload(payment.id)).stripePaymentIntentId!;
    await stripe().refunds.create({ payment_intent: intentId, amount: 400, metadata: { paymentId: payment.id, refundId } }, { idempotencyKey: label });

    await reconcileOperations(soon());
    await reconcileOperations(soon());
    const p = await reload(payment.id);
    check("after recovery: the refund is recorded once", p.refundedCents === 400, String(p.refundedCents));
    const refunded = (await stripe().refunds.list({ payment_intent: intentId, limit: 10 })).data;
    check("Stripe made exactly one refund of $4.00", refunded.length === 1 && refunded[0].amount === 400, `${refunded.length}`);
    check("money record adds up", (await ledgerSum(payment.id, "platform_fee")) + (await ledgerSum(payment.id, "host_share")) === 1333 - 400);
  }

  console.log("\n15. A charge that goes through late, after recovery already looked");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    // The app's own record gave up on attempt 1 ("did not happen"), but the request then reached Stripe.
    await db.insert(schema.moneyOperations).values({ paymentId: payment.id, kind: "capture", label: `capture:${payment.id}:1`, params: "{}", status: "failed", finishedAt: new Date() });
    await stripe().paymentIntents.capture((await reload(payment.id)).stripePaymentIntentId!, { amount_to_capture: 1333 }, { idempotencyKey: `capture:${payment.id}:1` });
    await settleFinishedCalls(after(call, 5));
    const p = await reload(payment.id);
    check("the charge Stripe made is found and recorded, not lost", p.status === "charged" && p.chargedCents === 1333, `${p.status} ${p.chargedCents}`);
    check("charged exactly once", (await stripeIntent(payment.id)).amount_received === 1333 && (await ledgerSum(payment.id, "customer_charge")) === 1333);
  }

  console.log("\n16. The refund button is pressed twice");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    await settleFinishedCalls(after(call, 5));
    const requestId = randomUUID();
    const refund = () => refundPayment({ paymentId: payment.id, amountCents: 500, decidedBy: host.id, decidedAs: "host", reason: null, requestId });
    await refund();
    await refund().catch(() => undefined);
    await Promise.allSettled([refund(), refund()]);
    const p = await reload(payment.id);
    const made = (await stripe().refunds.list({ payment_intent: p.stripePaymentIntentId!, limit: 10 })).data;
    check("refunded once, not four times", p.refundedCents === 500 && made.length === 1 && made[0].amount === 500, `${p.refundedCents} ${made.length}`);
  }

  console.log("\n17. The customer pays and cancels late before our record has caught up");
  {
    const { call, payment } = await newCall();
    await db.update(schema.calls).set({ freeCancelMinutes: 1440 }).where(eq(schema.calls.id, call.id));
    // Place the hold at Stripe without telling our record (as if the page was closed straight after paying).
    const [fresh] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    await startHold({ payment: fresh, call, customer, now: new Date() });
    await stripe().paymentIntents.confirm((await reload(payment.id)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    check("our record does not know about the hold yet", (await reload(payment.id)).status === "awaiting_payment");
    const outcome = await cancelCall({ call: await reloadCall(call.id), payment: await reload(payment.id), by: "customer", now: new Date() });
    const p = await reload(payment.id);
    check("it is still treated as a late cancellation and charged", outcome === "late_charge" && p.status === "charged" && p.chargedCents === 1333, `${outcome} ${p.status}`);
  }

  console.log("\n18. Paying is started on a call that was just cancelled");
  {
    const { call, payment } = await newCall();
    await cancelCall({ call, payment, by: "host", now: new Date() });
    const [fresh] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    const refused = await startHold({ payment: fresh, call: await reloadCall(call.id), customer, now: new Date() }).catch((e) => e);
    check("refused", refused instanceof MoneyError);
    check("no hold is left behind", (await reload(payment.id)).status === "closed_uncharged" && (await reload(payment.id)).stripePaymentIntentId === null);
  }

  console.log("\n19. A declined card, then a second try with a good card");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_chargeDeclined");
    const first = (await reload(payment.id)).stripePaymentIntentId!;
    await stripe().paymentIntents.cancel(first);
    await syncHold(payment.id, new Date());
    const p = await hold(call, payment.id, "pm_card_visa");
    check("a fresh hold is made and placed", p.status === "held" && p.stripePaymentIntentId !== first, `${p.status}`);
    await cancelCall({ call, payment: p, by: "host", now: new Date() });
  }

  // ------------------------------------------------------------------------
  // Paying hosts. These need Stripe's marketplace feature (Connect) and a test
  // host whose payout account is ready. Run with --payouts once that is set up.
  if (process.argv.includes("--payouts")) {
    const { runPayday } = await import("../src/lib/payments/jobs");
    const { refreshPayoutsReady, getHostSettings } = await import("../src/lib/payments/hosts");
    const ready = await refreshPayoutsReady(host.id);
    const settings = await getHostSettings(host.id);
    check("the test host's payout account is ready", ready && Boolean(settings.stripeAccountId));
    if (!ready || !settings.stripeAccountId) {
      console.log("   Set up payouts for host@test.local on the Hosting settings page first.");
    } else {
      const account = settings.stripeAccountId;
      const transfersFor = async (callId: string) => (await stripe().transfers.list({ transfer_group: callId, limit: 10 })).data;
      /** A charged call for the test host: full 10 minutes, $13.33, host share $12.38. */
      const chargedCall = async () => {
        const made = await newCall();
        await hold(made.call, made.payment.id, "pm_card_visa");
        await attend(made.call, [["host", 0, 600], ["customer", 0, 600]]);
        await settleFinishedCalls(after(made.call, 5));
        return made;
      };
      const payday = (call: { endsAt: Date }) => new Date(call.endsAt.getTime() + 15 * 24 * 3_600_000);

      console.log("\n20. Payday: two calls for one host");
      {
        const a = await chargedCall();
        const b = await chargedCall();
        const before = await reload(a.payment.id);
        check("charged, with the host's share of $12.38 waiting", before.status === "charged" && before.originalHostShareCents === 1238 && before.transferStatus === "not_due", `${before.status} ${before.originalHostShareCents}`);

        await runPayday(new Date(a.call.endsAt.getTime() + 6 * 24 * 3_600_000));
        check("nothing is sent before 7 days have passed", (await reload(a.payment.id)).transferStatus === "not_due");

        await Promise.all([runPayday(payday(b.call)), runPayday(payday(b.call))]); // two helpers at once
        await reconcileOperations(soon());
        await runPayday(payday(b.call));
        const pa = await reload(a.payment.id);
        const pb = await reload(b.payment.id);
        check("both shares were sent", pa.transferStatus === "sent" && pb.transferStatus === "sent", `${pa.transferStatus} ${pb.transferStatus}`);
        const sent = (pa.transferCents ?? 0) + (pb.transferCents ?? 0);
        // Earlier journeys left other charged calls for this host on the same payday, so count the whole payday.
        const [{ fees, paid }] = await db
          .select({
            fees: sql<number>`coalesce(sum(${schema.payments.payoutFeeCents}), 0)::int`,
            paid: sql<number>`count(*)::int`,
          })
          .from(schema.payments)
          .where(sql`${schema.payments.transferStatus} = 'sent' and ${schema.payments.transferDueAt} = ${pa.transferDueAt!.toISOString()}::timestamptz`);
        check(`the 25-cent payout charge was taken once across the ${paid} calls paid that day`, fees === 25, String(fees));
        check("each share was sent in full, less any payout charge it carried", (pa.transferCents ?? 0) + (pa.payoutFeeCents ?? 0) === 1238 && (pb.transferCents ?? 0) + (pb.payoutFeeCents ?? 0) === 1238);
        const ta = await transfersFor(a.call.id);
        const tb = await transfersFor(b.call.id);
        check("Stripe made exactly one transfer per call", ta.length === 1 && tb.length === 1, `${ta.length} ${tb.length}`);
        check("Stripe sent them to the host's account", ta[0]?.destination === account && ta[0].amount + tb[0].amount === sent);
        check("the money record matches", (await ledgerSum(a.payment.id, "host_transfer")) + (await ledgerSum(b.payment.id, "host_transfer")) === -sent);

        await runPayday(payday(b.call));
        check("running payday again sends nothing more", (await transfersFor(a.call.id)).length === 1 && (await transfersFor(b.call.id)).length === 1);
        const refused = await refundPayment({ paymentId: a.payment.id, amountCents: 100, decidedBy: host.id, decidedAs: "host", reason: null }).catch((e) => e);
        check("no refund after the host has been paid", refused instanceof MoneyError);
      }

      console.log("\n21. Payday after a partial refund");
      {
        const c = await chargedCall();
        await refundPayment({ paymentId: c.payment.id, amountCents: 667, decidedBy: host.id, decidedAs: "host", reason: null });
        const share = currentSplit(await reload(c.payment.id)).hostShareCents;
        await runPayday(payday(c.call));
        const p = await reload(c.payment.id);
        check("only the share that is left is sent", p.transferStatus === "sent" && (p.transferCents ?? 0) + (p.payoutFeeCents ?? 0) === share, `${p.transferCents} + ${p.payoutFeeCents} vs ${share}`);
        const t = await transfersFor(c.call.id);
        check("Stripe sent exactly that", t.length === 1 && t[0].amount === p.transferCents);
      }

      console.log("\n22. Payday after a full refund, and while a bank dispute is open");
      {
        const d = await chargedCall();
        await refundPayment({ paymentId: d.payment.id, amountCents: 1333, decidedBy: host.id, decidedAs: "host", reason: null });
        const e = await chargedCall();
        await db.update(schema.payments).set({ disputeOpen: true }).where(eq(schema.payments.id, e.payment.id));
        await runPayday(payday(e.call));
        check("nothing is sent for a fully refunded call", (await reload(d.payment.id)).transferStatus === "not_owed" && (await transfersFor(d.call.id)).length === 0);
        check("nothing is sent while a dispute is open", (await reload(e.payment.id)).transferStatus === "not_due" && (await transfersFor(e.call.id)).length === 0);
        await db.update(schema.payments).set({ disputeOpen: false }).where(eq(schema.payments.id, e.payment.id));
        await runPayday(payday(e.call));
        check("it is sent once the dispute is closed", (await reload(e.payment.id)).transferStatus === "sent");
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
