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
import { and, eq, sql } from "drizzle-orm";
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

  /** Creates a paid call starting in 10 minutes (so slow answers from Stripe cannot make it start mid-test), with its payment record. */
  async function newCall(hostId: string = host.id) {
    const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + MINUTES * 60_000);
    return db.transaction(async (tx) => {
      const [call] = await tx
        .insert(schema.calls)
        .values({ hostId, customerId: customer.id, startsAt, endsAt, roomName: `paycheck-${randomUUID()}`, pricePer15Cents: PRICE })
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
  /** The moment the money for a call is taken when nobody asked for a refund: 24 hours and 3 minutes after its start. */
  const taken = (call: { startsAt: Date }) => new Date(call.startsAt.getTime() + (24 * 60 + 3) * 60_000);
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
    const waiting = await reload(payment.id);
    check("minutes after the call nothing is taken yet: the money stays on hold", waiting.status === "held" && !waiting.needsReview && (await stripeIntent(payment.id)).status === "requires_capture", waiting.status);
    await settleFinishedCalls(new Date(taken(call).getTime() - 60_000));
    check("still on hold a minute before the planned moment", (await reload(payment.id)).status === "held");
    await settleFinishedCalls(taken(call));
    const p = await reload(payment.id);
    // 480 seconds at $20 per 15 minutes = $10.67
    check("24 hours and 3 minutes after the call's start: charged $10.67 for 8 minutes", p.status === "charged" && p.chargedCents === 1067, `${p.status} ${p.chargedCents}`);
    check("fee 82 cents, host $9.85", p.originalFeeCents === 82 && p.originalHostShareCents === 985, `${p.originalFeeCents} ${p.originalHostShareCents}`);
    check("time totals frozen", p.frozenHostSeconds === 480 && p.frozenTogetherSeconds === 480);
    check("nobody asked for a refund: the host's share is ready 24 hours after the call ends", p.transferStatus === "not_due" && p.transferDueAt?.getTime() === after(call, 24 * 60).getTime(), String(p.transferDueAt?.toISOString()));

    console.log("   …and with the real clock: a call that really ended more than a day ago");
    {
      const old = await newCall();
      await hold(old.call, old.payment.id, "pm_card_visa");
      // The call is moved into the past: it ended 25 hours ago. Its money is taken now, by the real clock.
      const endedAt = new Date(Math.floor((Date.now() - 25 * 3_600_000) / 1000) * 1000);
      const startedAt = new Date(endedAt.getTime() - MINUTES * 60_000);
      await db.update(schema.payments).set({ coversFrom: startedAt, coversUntil: endedAt }).where(eq(schema.payments.id, old.payment.id));
      const [moved] = await db.update(schema.calls).set({ startsAt: startedAt, endsAt: endedAt }).where(eq(schema.calls.id, old.call.id)).returning();
      await attend(moved, [["host", 0, 600], ["customer", 0, 600]]);
      await settleFinishedCalls(new Date());
      const q = await reload(old.payment.id);
      check("the money is taken, and the host's share is ready at that very moment", q.status === "charged" && q.chargedAt !== null && q.transferDueAt?.getTime() === q.chargedAt.getTime(), `${q.status} ${q.transferDueAt?.toISOString()} ${q.chargedAt?.toISOString()}`);
    }
    console.log("   …and the largest there can be: a 6-hour call at $1,000 per 15 minutes");
    {
      const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
      const big = await db.transaction(async (tx) => {
        const [made] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt: new Date(startsAt.getTime() + 360 * 60_000), roomName: `paycheck-${randomUUID()}`, pricePer15Cents: 100_000 }).returning();
        await createPaymentForCall(tx, made);
        const [made2] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, made.id));
        return { call: made, payment: made2 };
      });
      await hold(big.call, big.payment.id, "pm_card_visa");
      const held = await reload(big.payment.id);
      check("$24,000 is held on the card", held.status === "held" && held.bookedCents === 2_400_000 && (await stripeIntent(big.payment.id)).amount === 2_400_000 && (await stripeIntent(big.payment.id)).status === "requires_capture", `${held.status} ${held.bookedCents}`);
      await attend(big.call, [["host", 0, 21_600], ["customer", 0, 21_600]]);
      await db.update(schema.calls).set({ closedAt: new Date(big.call.endsAt.getTime() + 60_000) }).where(eq(schema.calls.id, big.call.id));
      await settleFinishedCalls(taken(big.call));
      const q = await reload(big.payment.id);
      check("and taken in full a day after the call's start, for the 6 hours both were there", q.status === "charged" && q.chargedCents === 2_400_000 && q.frozenTogetherSeconds === 21_600 && (await stripeIntent(big.payment.id)).amount_received === 2_400_000, `${q.status} ${q.chargedCents} ${q.frozenTogetherSeconds}`);
      check("the host's share is ready 24 hours after the 6-hour call ends", q.transferDueAt?.getTime() === after(big.call, 24 * 60).getTime(), String(q.transferDueAt?.toISOString()));
    }
    const intent = await stripeIntent(payment.id);
    check("Stripe received exactly $10.67", intent.status === "succeeded" && intent.amount_received === 1067, `${intent.status} ${intent.amount_received}`);

    await settleFinishedCalls(after(call, 24 * 60 + 20));
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
    await settleFinishedCalls(taken(call));
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
    check("the full booked price is charged at once (a late cancellation does not wait a day)", p.status === "charged" && p.chargedCents === 1333 && p.chargeReason === "late_cancel", `${p.status} ${p.chargedCents}`);
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
    await settleFinishedCalls(taken(call));
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
    const params = JSON.stringify({
      amountCents: 1333,
      reason: "attendance",
      frozen: { hostSeconds: 600, customerSeconds: 600, togetherSeconds: 600 },
      callEndsAt: call.endsAt.toISOString(),
      pricedThroughEventId: null,
    });
    await db.insert(schema.moneyOperations).values({ paymentId: payment.id, kind: "capture", label: `capture:${payment.id}:1`, params, status: "failed", finishedAt: new Date() });
    await stripe().paymentIntents.capture((await reload(payment.id)).stripePaymentIntentId!, { amount_to_capture: 1333 }, { idempotencyKey: `capture:${payment.id}:1` });
    await settleFinishedCalls(after(call, 5));
    const p = await reload(payment.id);
    check("the charge Stripe made is found and recorded, not lost", p.status === "charged" && p.chargedCents === 1333, `${p.status} ${p.chargedCents}`);
    check("with the times it was based on", p.frozenHostSeconds === 600 && p.chargeReason === "attendance" && !p.flaggedAfterCharge);
    check("charged exactly once", (await stripeIntent(payment.id)).amount_received === 1333 && (await ledgerSum(payment.id, "customer_charge")) === 1333);

    console.log("   …and the same when, by then, the call's record says nothing is owed");
    const other = await newCall();
    await hold(other.call, other.payment.id, "pm_card_visa");
    await attend(other.call, []); // nobody came
    await db.insert(schema.moneyOperations).values({ paymentId: other.payment.id, kind: "capture", label: `capture:${other.payment.id}:1`, params: "{}", status: "failed", finishedAt: new Date() });
    await stripe().paymentIntents.capture((await reload(other.payment.id)).stripePaymentIntentId!, { amount_to_capture: 1333 }, { idempotencyKey: `capture:${other.payment.id}:1` });
    await settleFinishedCalls(after(other.call, 5));
    await settleFinishedCalls(after(other.call, 6));
    const q = await reload(other.payment.id);
    check("the charge is still recorded, not left as a hold", q.status === "charged" && q.chargedCents === 1333 && (await ledgerSum(other.payment.id, "customer_charge")) === 1333, `${q.status} ${q.chargedCents}`);
    check("and it is flagged for the founder, because our record cannot explain it", q.flaggedAfterCharge === true);
  }

  console.log("\n16. The refund button is pressed twice");
  {
    const { call, payment } = await newCall();
    await hold(call, payment.id, "pm_card_visa");
    await attend(call, [["host", 0, 600], ["customer", 0, 600]]);
    await settleFinishedCalls(taken(call));
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

    console.log("   …and the same when the cancel request carries a copy of the payment from before paying began");
    const other = await newCall();
    await db.update(schema.calls).set({ freeCancelMinutes: 1440 }).where(eq(schema.calls.id, other.call.id));
    await startHold({ payment: other.payment, call: other.call, customer, now: new Date() });
    await stripe().paymentIntents.confirm((await reload(other.payment.id)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    const second = await cancelCall({ call: await reloadCall(other.call.id), payment: other.payment, by: "customer", now: new Date() });
    const q = await reload(other.payment.id);
    check("still a late cancellation, and charged", second === "late_charge" && q.status === "charged" && q.chargedCents === 1333, `${second} ${q.status}`);
  }

  console.log("\n18. Paying is started on a call that was just cancelled");
  {
    const { call, payment } = await newCall();
    await cancelCall({ call, payment, by: "host", now: new Date() });
    const [fresh] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
    const refused = await startHold({ payment: fresh, call: await reloadCall(call.id), customer, now: new Date() }).catch((e) => e);
    check("refused", refused instanceof MoneyError);
    check("no hold is left behind", (await reload(payment.id)).status === "closed_uncharged" && (await reload(payment.id)).stripePaymentIntentId === null);

    console.log("   …and a second, slow \"start paying\" request arrives after the customer has paid");
    const other = await newCall();
    await startHold({ payment: other.payment, call: other.call, customer, now: new Date() });
    await stripe().paymentIntents.confirm((await reload(other.payment.id)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    await syncHold(other.payment.id, new Date());
    // The slow request still has the copy of the payment from before anything happened.
    const slow = await startHold({ payment: other.payment, call: other.call, customer, now: new Date() }).catch((e) => e);
    const q = await reload(other.payment.id);
    check("it is told the call is already paid for", typeof slow === "object" && slow !== null && "alreadyHeld" in slow);
    check("the customer's hold is untouched", q.status === "held" && (await stripeIntent(other.payment.id)).status === "requires_capture", q.status);
    await cancelCall({ call: other.call, payment: q, by: "host", now: new Date() });
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
  // Hosts collecting their earnings. These need Stripe's marketplace feature
  // (Connect) and a test host whose payout account is ready. Run with --payouts
  // once that is set up.
  if (process.argv.includes("--payouts")) {
    const { acceptCollection, collectEarnings, collectForClosedHost, lastCollectionOf, sendCollection, unsentEarnings } = await import("../src/lib/payments/collect");
    const { transferAtStripe } = await import("../src/lib/payments/actions");
    const { runPaymentJobs } = await import("../src/lib/payments/jobs");
    const { refreshPayoutsReady, getHostSettings } = await import("../src/lib/payments/hosts");
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;
    const RUN = randomUUID().slice(0, 8);

    // If an earlier run stopped half way, one of its made-up hosts still has the test payout account. Give it back first.
    const mine = await getHostSettings(host.id);
    if (!mine.stripeAccountId) {
      const [left] = await db.select().from(schema.hostSettings).where(sql`${schema.hostSettings.userId} like 'cc-%' and ${schema.hostSettings.stripeAccountId} is not null`);
      if (left) {
        await db.transaction(async (tx) => {
          await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, left.userId));
          await tx.update(schema.hostSettings).set({ stripeAccountId: left.stripeAccountId }).where(eq(schema.hostSettings.userId, host.id));
        });
      }
    }
    const ready = await refreshPayoutsReady(host.id);
    const settings = await getHostSettings(host.id);
    check("the test host's payout account is ready", ready && Boolean(settings.stripeAccountId));
    if (!ready || !settings.stripeAccountId) {
      console.log("   Set up payouts for host@test.local on the Hosting page first.");
    } else {
      const account = settings.stripeAccountId;
      let holder = host.id;
      let made = 0;
      /**
       * A new host with nothing behind them, so that each journey below starts clean and its pretend
       * dates never touch host@test.local. A payout account cannot be made ready from a script, and
       * one account belongs to one host at a time, so the new host takes over the test account.
       */
      const freshHost = async (): Promise<string> => {
        const id = `cc-${RUN}-${++made}`;
        const stamp = new Date();
        await db.insert(schema.user).values({ id, name: `Collect check ${made}`, email: `collectcheck-${RUN}-${made}@example.test`, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
        await db.transaction(async (tx) => {
          await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, holder));
          await tx.insert(schema.hostSettings).values({ userId: id, stripeAccountId: account, payoutsReady: true });
        });
        holder = id;
        return id;
      };

      type Made = Awaited<ReturnType<typeof newCall>>;
      const FULL: Parameters<typeof attend>[1] = [["host", 0, 600], ["customer", 0, 600]];
      /** A charged call. By default the full 10 minutes: $13.33, host's share $12.38. */
      const chargedCall = async (hostId: string, visits = FULL, card = "pm_card_visa"): Promise<Made> => {
        const call = await newCall(hostId);
        await hold(call.call, call.payment.id, card);
        await attend(call.call, visits);
        await settleFinishedCalls(taken(call.call));
        return call;
      };
      const transfersFor = async (callId: string) => (await stripe().transfers.list({ transfer_group: callId, limit: 10 })).data;
      /** One press of "Collect earnings". Gives back the refusal, or null when the press was accepted. */
      const press = (hostId: string, now: Date, collectionId = randomUUID(), startedBy = hostId) =>
        collectEarnings({ collectionId, hostId, startedBy, now }).then(() => null, (e: unknown) => e as Error);
      /** The moment the last of these shares becomes ready. */
      const readyAt = async (...calls: Made[]) => {
        const dates = await Promise.all(calls.map(async (c) => (await reload(c.payment.id)).transferDueAt!.getTime()));
        return new Date(Math.max(...dates));
      };
      const collectionsOf = (hostId: string) => db.select().from(schema.collections).where(eq(schema.collections.hostId, hostId));
      const itemsOf = (collectionId: string) => db.select().from(schema.collectionItems).where(eq(schema.collectionItems.collectionId, collectionId));
      const share = async (c: Made) => currentSplit(await reload(c.payment.id)).hostShareCents;
      /** What the host got for this share, with the charge it carried, once sent. */
      const sent = async (c: Made) => {
        const p = await reload(c.payment.id);
        return { status: p.transferStatus, cents: p.transferCents ?? 0, fee: p.payoutFeeCents ?? 0, transfers: await transfersFor(c.call.id) };
      };
      const breakCharge = async (c: Made) => {
        const real = (await reload(c.payment.id)).stripeChargeId!;
        await db.update(schema.payments).set({ stripeChargeId: "ch_not_a_real_charge" }).where(eq(schema.payments.id, c.payment.id));
        return () => db.update(schema.payments).set({ stripeChargeId: real }).where(eq(schema.payments.id, c.payment.id));
      };

      try {
        console.log("\n20. Nothing is sent without a press; a press sends everything that is ready, and nothing else");
        {
          const h = await freshHost();
          const a = await chargedCall(h);
          const b = await chargedCall(h);
          const c = await chargedCall(h); // made last, so it ends, and becomes ready, a little later
          const other = await chargedCall(host.id); // another host's money
          const before = await reload(a.payment.id);
          check("charged, with the host's share of $12.38 waiting", before.status === "charged" && before.originalHostShareCents === 1238 && before.transferStatus === "not_due", `${before.status} ${before.originalHostShareCents}`);
          const T = await readyAt(a, b);
          check("the third share becomes ready later than the first two", (await readyAt(c)).getTime() > T.getTime());

          await runPaymentJobs(new Date(T.getTime() + DAY));
          check("the helper sends nothing by itself, however long it waits", (await sent(a)).status === "not_due" && (await sent(a)).transfers.length === 0 && (await collectionsOf(h)).length === 0);

          const early = await press(h, new Date((await readyAt(a)).getTime() - 1000));
          check("a second before the first share is ready, there is nothing to collect", early instanceof MoneyError && (await collectionsOf(h)).length === 0, early?.message);

          const first = randomUUID();
          const accepted = await press(h, T, first);
          const [pa, pb, pc] = [await sent(a), await sent(b), await sent(c)];
          check("exactly at that moment, the press is accepted (and the refused press used up nothing)", accepted === null, accepted?.message);
          check("both ready shares were sent", pa.status === "sent" && pb.status === "sent", `${pa.status} ${pb.status}`);
          check("the share that is not ready yet stays", pc.status === "not_due" && pc.transfers.length === 0);
          check("another host's money is not touched", (await sent(other)).status === "not_due" && (await sent(other)).transfers.length === 0);
          check("the 25-cent collection charge was taken once", pa.fee + pb.fee === 25 && pa.cents + pa.fee === 1238 && pb.cents + pb.fee === 1238, `${pa.fee} ${pb.fee}`);
          check("Stripe made exactly one transfer per call, to the host's account", pa.transfers.length === 1 && pb.transfers.length === 1 && pa.transfers[0].destination === account && pa.transfers[0].amount + pb.transfers[0].amount === pa.cents + pb.cents);
          check("the money record matches", (await ledgerSum(a.payment.id, "host_transfer")) + (await ledgerSum(b.payment.id, "host_transfer")) === -(pa.cents + pb.cents) && (await ledgerSum(a.payment.id, "payout_fee")) + (await ledgerSum(b.payment.id, "payout_fee")) === 25);
          const view = (await lastCollectionOf(h))!;
          check("the collection is a record of its own, showing what really happened", (await itemsOf(first)).length === 2 && view.last.id === first && view.last.sentCents === 2 * 1238 - 25 && view.last.feeCents === 25 && view.last.checkingCents === 0 && view.last.refusedCents === 0);
          check("and says when the host can collect again", view.againAt.getTime() === T.getTime() + DAY);
          const refused = await refundPayment({ paymentId: a.payment.id, amountCents: 100, decidedBy: h, decidedAs: "host", reason: null }).catch((e) => e);
          check("no refund after the share has been sent", refused instanceof MoneyError);

          const tooSoon = await press(h, new Date(T.getTime() + DAY - 1000));
          check("a second press inside the 24 hours is refused", tooSoon instanceof MoneyError && /24 hours/.test(tooSoon.message) && (await sent(c)).status === "not_due", tooSoon?.message);
          const later = await press(h, new Date(T.getTime() + DAY));
          const lc = await sent(c);
          check("exactly at 24 hours it is accepted, and takes the share that is ready by then", later === null && lc.status === "sent" && lc.transfers.length === 1, later?.message);
          check("that second collection carries its own 25-cent charge", lc.fee === 25 && lc.cents === 1238 - 25);

          const again = await press(h, new Date(T.getTime() + 5 * DAY), first);
          check("the first press arriving again, days later, changes nothing", again === null && (await collectionsOf(h)).length === 2 && (await sent(a)).transfers.length === 1);
        }

        console.log("\n21. Two presses at the same moment");
        {
          const h = await freshHost();
          const a = await chargedCall(h);
          const b = await chargedCall(h);
          const T = await readyAt(a, b);
          const results = await Promise.all([press(h, T), press(h, T)]); // two tabs
          check("two different presses at once make one collection", results.filter((r) => r === null).length === 1 && (await collectionsOf(h)).length === 1, results.map((r) => r?.message ?? "accepted").join(" | "));
          const [pa, pb] = [await sent(a), await sent(b)];
          check("each share was sent once, with one charge", pa.transfers.length === 1 && pb.transfers.length === 1 && pa.fee + pb.fee === 25);

          const h2 = await freshHost();
          const c = await chargedCall(h2);
          const same = randomUUID();
          const twice = await Promise.all([press(h2, await readyAt(c), same), press(h2, await readyAt(c), same)]); // a double click
          const pc = await sent(c);
          check("the same press sent twice at once is one collection", twice.every((r) => r === null) && (await collectionsOf(h2)).length === 1 && pc.transfers.length === 1 && pc.fee === 25, twice.map((r) => r?.message ?? "accepted").join(" | "));
        }

        console.log("\n22. What holds a share back: a bank dispute, a refund on its way, a Stripe message not handled yet");
        {
          const h = await freshHost();
          const disputed = await chargedCall(h);
          const refunding = await chargedCall(h);
          const partly = await chargedCall(h);
          const fully = await chargedCall(h);
          const plain = await chargedCall(h);
          await db.update(schema.payments).set({ disputeOpen: true }).where(eq(schema.payments.id, disputed.payment.id));
          const refundId = randomUUID(); // a refund asked for just before the press, not finished yet
          await db.insert(schema.refunds).values({ id: refundId, paymentId: refunding.payment.id, amountCents: 100, decidedBy: h, decidedAs: "host" });
          await refundPayment({ paymentId: partly.payment.id, amountCents: 667, decidedBy: h, decidedAs: "host", reason: null });
          await refundPayment({ paymentId: fully.payment.id, amountCents: 1333, decidedBy: h, decidedAs: "host", reason: null });
          const left = await share(partly);
          const T = await readyAt(disputed, refunding, partly, fully, plain);

          const messageId = `evt_check_${randomUUID()}`;
          await db.insert(schema.stripeEvents).values({ id: messageId, type: "charge.dispute.created", payload: "{}" });
          const waits = await press(h, T).finally(() => db.delete(schema.stripeEvents).where(eq(schema.stripeEvents.id, messageId)));
          check("while a message about a dispute is not handled, nothing is collected", waits instanceof MoneyError && (await collectionsOf(h)).length === 0 && (await sent(plain)).transfers.length === 0, waits?.message);

          const accepted = await press(h, T);
          check("once it is handled, the press is accepted (the refused one used up nothing)", accepted === null, accepted?.message);
          const pp = await sent(partly);
          check("the plain share is sent", (await sent(plain)).status === "sent");
          check("after a partial refund, only the share that is left is sent", pp.status === "sent" && pp.cents + pp.fee === left && pp.transfers.length === 1 && pp.transfers[0].amount === pp.cents, `${pp.cents}+${pp.fee} vs ${left}`);
          check("nothing is sent for a fully refunded call", (await sent(fully)).status === "not_owed" && (await sent(fully)).transfers.length === 0);
          check("nothing is sent while a dispute is open", (await sent(disputed)).status === "not_due" && (await sent(disputed)).transfers.length === 0);
          check("nothing is sent while a refund is on its way", (await sent(refunding)).status === "not_due" && (await sent(refunding)).transfers.length === 0);
          const shown = await unsentEarnings(T, h);
          check("the host is told why each one waits", shown.length === 2 && shown.find((e) => e.payment.id === disputed.payment.id)?.heldBack === "dispute" && shown.find((e) => e.payment.id === refunding.payment.id)?.heldBack === "refund");

          await db.update(schema.payments).set({ disputeOpen: false }).where(eq(schema.payments.id, disputed.payment.id));
          await db.update(schema.refunds).set({ status: "failed", finishedAt: new Date() }).where(eq(schema.refunds.id, refundId));
          await press(h, new Date(T.getTime() + DAY));
          check("both are sent by the next collection, once nothing holds them back", (await sent(disputed)).status === "sent" && (await sent(refunding)).status === "sent");
        }

        console.log("\n23. One collection: Stripe refuses one share, the answer for another is lost");
        {
          const h = await freshHost();
          const calls = [await chargedCall(h), await chargedCall(h), await chargedCall(h)];
          const T = await readyAt(...calls);
          const id = randomUUID();
          const accepted = await acceptCollection({ collectionId: id, hostId: h, startedBy: h, now: T });
          const startedOps = await Promise.all(calls.map((c) => opsFor(c.payment.id)));
          check("accepting writes every transfer down before Stripe is asked", accepted.started.length === 3 && startedOps.every((ops) => ops.filter((o) => o.kind === "transfer" && o.status === "started").length === 1) && (await transfersFor(calls[0].call.id)).length === 0);

          const blocked = await refundPayment({ paymentId: calls[0].payment.id, amountCents: 100, decidedBy: h, decidedAs: "host", reason: null }).catch((e) => e);
          check("a refund asked for while the share is being sent is refused", blocked instanceof Error && (await reload(calls[0].payment.id)).refundedCents === 0 && (await stripe().refunds.list({ payment_intent: (await reload(calls[0].payment.id)).stripePaymentIntentId!, limit: 5 })).data.length === 0, blocked?.message);

          // The share that carries the charge is the one Stripe refuses. One other goes through; the third's answer is lost.
          const carrier = accepted.started.find((s) => s.params.payoutFeeCents > 0)!;
          const [through, lost] = accepted.started.filter((s) => s !== carrier);
          const call = (paymentId: string) => calls.find((c) => c.payment.id === paymentId)!;
          const restore = await breakCharge(call(carrier.paymentId));
          await sendCollection([through, carrier]);
          await transferAtStripe(await reload(lost.paymentId), lost.params, lost.label); // Stripe did it; we "crashed" before hearing back
          const during = (await lastCollectionOf(h))!.last;
          check("the host is shown what really happened: one sent, one being checked, one could not be sent", during.sentCents === 1238 && during.checkingCents === 1238 && during.refusedCents === 1238, `${during.sentCents} ${during.checkingCents} ${during.refusedCents}`);
          check("the refused share stays ready for a later collection", (await sent(call(carrier.paymentId))).status === "not_due" && (await sent(call(carrier.paymentId))).transfers.length === 0);

          await reconcileOperations(soon());
          await reconcileOperations(soon());
          const pl = await sent(call(lost.paymentId));
          check("the helper finishes the lost one: recorded once, one transfer at Stripe", pl.status === "sent" && pl.cents === 1238 && pl.transfers.length === 1 && (await ledgerSum(lost.paymentId, "host_transfer")) === -1238, `${pl.status} ${pl.transfers.length}`);
          const after24 = (await lastCollectionOf(h))!.last;
          check("that was not another press, and the charge is waived because the share carrying it failed", (await collectionsOf(h)).length === 1 && after24.feeCents === 0 && after24.sentCents === 2 * 1238 && after24.checkingCents === 0);
          const stillBlocked = await press(h, new Date(T.getTime() + HOUR));
          check("the 24 hours stand, even though one share failed", stillBlocked instanceof MoneyError);

          await restore();
          await press(h, new Date(T.getTime() + DAY));
          const pr = await sent(call(carrier.paymentId));
          check("the refused share goes out with the next collection, which carries its own charge", pr.status === "sent" && pr.cents === 1238 - 25 && pr.fee === 25 && pr.transfers.length === 1, `${pr.status} ${pr.cents} ${pr.fee}`);
        }

        console.log("\n24. The app stops right after accepting; and a collection in which nothing goes through");
        {
          const h = await freshHost();
          const x = await chargedCall(h);
          await acceptCollection({ collectionId: randomUUID(), hostId: h, startedBy: h, now: await readyAt(x) });
          check("nothing has reached Stripe", (await sent(x)).status === "not_due" && (await sent(x)).transfers.length === 0);
          await reconcileOperations(soon());
          await reconcileOperations(soon());
          const px = await sent(x);
          check("the helper sends it, without the host pressing again", px.status === "sent" && px.transfers.length === 1 && px.cents === 1238 - 25 && px.fee === 25 && (await collectionsOf(h)).length === 1, `${px.status} ${px.transfers.length}`);

          const h2 = await freshHost();
          const y = await chargedCall(h2);
          const z = await chargedCall(h2);
          const T = await readyAt(y, z);
          const restoreY = await breakCharge(y);
          const restoreZ = await breakCharge(z);
          const pressed = await press(h2, T);
          const view = (await lastCollectionOf(h2))!.last;
          check("Stripe refuses everything: the press was accepted, nothing was sent and no charge was taken", pressed === null && view.sentCents === 0 && view.feeCents === 0 && view.refusedCents === 2 * 1238 && (await ledgerSum(y.payment.id, "payout_fee")) + (await ledgerSum(z.payment.id, "payout_fee")) === 0);
          await restoreY();
          await restoreZ();
          check("the 24 hours stand all the same", (await press(h2, new Date(T.getTime() + HOUR))) instanceof MoneyError);
          await press(h2, new Date(T.getTime() + DAY));
          check("both go out with the next collection, with one charge", (await sent(y)).status === "sent" && (await sent(z)).status === "sent" && (await sent(y)).fee + (await sent(z)).fee === 25);

          console.log("   …and when the helper only comes back more than 23 hours later, too late to repeat a request safely");
          const h3 = await freshHost();
          const m = await chargedCall(h3);
          const n = await chargedCall(h3);
          const T3 = await readyAt(m, n);
          const late = await acceptCollection({ collectionId: randomUUID(), hostId: h3, startedBy: h3, now: T3 });
          const [made, never] = late.started;
          const callOf = (paymentId: string) => (paymentId === m.payment.id ? m : n);
          await transferAtStripe(await reload(made.paymentId), made.params, made.label); // Stripe did this one; the other never left
          for (const op of late.started) await db.update(schema.moneyOperations).set({ createdAt: new Date(Date.now() - 25 * HOUR) }).where(eq(schema.moneyOperations.id, op.operationId));
          await reconcileOperations(soon());
          const pm = await sent(callOf(made.paymentId));
          const pn = await sent(callOf(never.paymentId));
          check("it asks Stripe instead: the transfer Stripe made is recorded, once", pm.status === "sent" && pm.transfers.length === 1 && pm.cents + pm.fee === 1238, `${pm.status} ${pm.transfers.length}`);
          check("the one Stripe never got is not sent late; it is simply ready again", pn.status === "not_due" && pn.transfers.length === 0 && (await unsentEarnings(new Date(T3.getTime() + DAY), h3)).some((e) => e.payment.id === never.paymentId && e.heldBack === null));
          await press(h3, new Date(T3.getTime() + DAY));
          check("and goes out with the host's next collection", (await sent(callOf(never.paymentId))).status === "sent" && (await sent(callOf(never.paymentId))).transfers.length === 1);
        }

        console.log("\n25. Two shares that are each smaller than the 25-cent charge");
        {
          const h = await freshHost();
          // The host was there for 23 seconds: 51 cents charged, and a share of 19 cents.
          const tiny: Parameters<typeof attend>[1] = [["host", 0, 23], ["customer", 0, 600]];
          const s1 = await chargedCall(h, tiny);
          check("a 51-cent charge leaves the host 19 cents", (await reload(s1.payment.id)).chargedCents === 51 && (await share(s1)) === 19, `${(await reload(s1.payment.id)).chargedCents} ${await share(s1)}`);
          const alone = await press(h, await readyAt(s1));
          check("19 cents alone is not collected: it would all go on the charge", alone instanceof MoneyError && (await collectionsOf(h)).length === 0, alone?.message);

          const s2 = await chargedCall(h, tiny);
          const T = await readyAt(s1, s2);
          const accepted = await acceptCollection({ collectionId: randomUUID(), hostId: h, startedBy: h, now: T });
          const carrier = accepted.started.find((s) => s.params.payoutFeeCents > 0)!;
          const receiver = accepted.started.find((s) => s !== carrier)!;
          const tinyCall = (paymentId: string) => (paymentId === s1.payment.id ? s1 : s2);
          check("the charge is 19 cents, taken from one share; the other is sent whole", carrier.params.payoutFeeCents === 19 && carrier.params.amountCents === 0 && receiver.params.amountCents === 19 && receiver.params.payoutFeeCents === 0);
          const restore = await breakCharge(tinyCall(receiver.paymentId));
          await sendCollection(accepted.started);
          const dropped = (await lastCollectionOf(h))!.last;
          check("when the other share fails, the charge is not taken: both stay ready", dropped.sentCents === 0 && dropped.feeCents === 0 && (await sent(s1)).status === "not_due" && (await sent(s2)).status === "not_due" && (await ledgerSum(carrier.paymentId, "payout_fee")) === 0, `${dropped.sentCents} ${dropped.feeCents}`);

          await restore();
          await press(h, new Date(T.getTime() + DAY));
          const [p1, p2] = [await sent(s1), await sent(s2)];
          const [gave, got] = p1.fee > 0 ? [p1, p2] : [p2, p1];
          check("next time one share pays the 19-cent charge and the host receives the other 19 cents", p1.status === "sent" && p2.status === "sent" && gave.fee === 19 && gave.cents === 0 && gave.transfers.length === 0 && got.fee === 0 && got.cents === 19 && got.transfers.length === 1 && got.transfers[0].amount === 19, `${p1.cents}+${p1.fee} ${p2.cents}+${p2.fee}`);
        }

        console.log("\n26. Charges from before this change, which were due on a weekly payday");
        {
          const h = await freshHost();
          const o1 = await chargedCall(h);
          const o2 = await chargedCall(h);
          const o3 = await chargedCall(h);
          const payday = new Date("2026-01-05T00:00:00Z"); // the same old Monday for all three
          for (const o of [o1, o2, o3]) await db.update(schema.payments).set({ transferDueAt: payday }).where(eq(schema.payments.id, o.payment.id));
          await db.update(schema.payments).set({ disputeOpen: true }).where(eq(schema.payments.id, o2.payment.id));
          // The third was already being sent by the old payday when the app was stopped.
          const oldParams = { amountCents: 1238, payoutFeeCents: 0, destination: account, callId: o3.call.id };
          await db.insert(schema.moneyOperations).values({ paymentId: o3.payment.id, kind: "transfer", label: `transfer:${o3.payment.id}:1`, params: JSON.stringify(oldParams), createdAt: new Date(Date.now() - 10 * 60_000) });

          const T = new Date();
          const id = randomUUID();
          const pressed = await press(h, T, id);
          const p1 = await sent(o1);
          check("an old charge keeps its date and is collected with the button", pressed === null && p1.status === "sent" && p1.fee === 25 && (await reload(o1.payment.id)).transferDueAt!.getTime() === payday.getTime(), pressed?.message);
          check("the one already being sent is left to finish; it is not part of the collection", (await itemsOf(id)).length === 1 && (await sent(o3)).status === "not_due");
          await reconcileOperations(soon());
          const p3 = await sent(o3);
          check("the helper finishes it as it was written down", p3.status === "sent" && p3.cents === 1238 && p3.fee === 0 && p3.transfers.length === 1, `${p3.status} ${p3.cents}`);

          await db.update(schema.payments).set({ disputeOpen: false }).where(eq(schema.payments.id, o2.payment.id));
          await press(h, new Date(T.getTime() + DAY));
          const p2 = await sent(o2);
          check("a second old charge with the same payday, collected a day later, carries its own charge", p2.status === "sent" && p2.fee === 25 && p2.cents === 1238 - 25, `${p2.status} ${p2.fee}`);
          const oldRecords = await db.select().from(schema.payoutFees).where(eq(schema.payoutFees.hostId, h));
          check("the old per-payday records are not written any more", oldRecords.length === 0);
        }

        console.log("\n27. A host whose account is closed: the founder's list, and a final collection");
        {
          const h = await freshHost();
          const k = await chargedCall(h);
          const [founder] = await db.select().from(schema.user).where(eq(schema.user.email, "admin@test.local"));
          const T = await readyAt(k);
          const final = (collectionId: string) => collectForClosedHost({ collectionId, hostId: h, adminId: founder.id, now: T }).then(() => null, (e: unknown) => e as Error);
          const whileOpen = await final(randomUUID());
          check("the founder cannot collect for a host whose account is open", whileOpen instanceof MoneyError && (await collectionsOf(h)).length === 0 && (await sent(k)).transfers.length === 0, whileOpen?.message);
          await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, h));
          const listed = (await unsentEarnings(T)).find((e) => e.payment.id === k.payment.id);
          check("the founder's list of uncollected money includes the closed host's share", listed?.hostId === h && listed.shareCents === 1238 && listed.heldBack === null);
          const id = randomUUID();
          const pressed = await final(id);
          const pk = await sent(k);
          const [record] = await db.select().from(schema.collections).where(eq(schema.collections.id, id));
          check("the founder's final collection sends it to that host's own account, under the same rules", pressed === null && pk.status === "sent" && pk.cents === 1238 - 25 && pk.transfers[0]?.destination === account, pressed?.message);
          check("and the record says who pressed", record?.hostId === h && record.startedBy === founder.id && record.startedAs === "founder");
          check("nothing is left on the founder's list for that host", !(await unsentEarnings(T)).some((e) => e.hostId === h));
        }

        console.log("\n28. A real bank dispute at Stripe, which we then lose");
        {
          const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
          const stranger = await handleStripeEvent({ type: "payment_intent.succeeded", data: { object: { metadata: { paymentId: randomUUID() } } } }).catch((e) => e);
          check("a Stripe message about a payment that is not ours is ignored, not an error", stranger === undefined);

          const h = await freshHost();
          const g = await chargedCall(h, FULL, "pm_card_createDispute"); // Stripe's test card that is always disputed
          const intentId = (await reload(g.payment.id)).stripePaymentIntentId!;
          const pause = () => new Promise((resolve) => setTimeout(resolve, 2000));
          let disputeId: string | undefined;
          for (let i = 0; i < 30 && !disputeId; i++) {
            disputeId = (await stripe().disputes.list({ payment_intent: intentId, limit: 1 })).data[0]?.id;
            if (!disputeId) await pause();
          }
          check("Stripe opened a dispute on the charge", Boolean(disputeId));
          if (disputeId) {
            const message = (type: string) => ({ type, data: { object: { id: disputeId } } });
            await handleStripeEvent(message("charge.dispute.created"));
            check("the dispute is recorded", (await reload(g.payment.id)).disputeOpen === true);

            await stripe().disputes.update(disputeId, { evidence: { uncategorized_text: "losing_evidence" } });
            let status = "";
            for (let i = 0; i < 30 && status !== "lost"; i++) {
              status = (await stripe().disputes.retrieve(disputeId)).status;
              if (status !== "lost") await pause();
            }
            check("Stripe says the dispute was lost", status === "lost", status);
            await handleStripeEvent(message("charge.dispute.closed"));
            const pressed = await press(h, await readyAt(g));
            const p = await reload(g.payment.id);
            check("the host cannot collect it", pressed instanceof MoneyError && p.disputeOpen === true && p.transferStatus === "not_due" && (await transfersFor(g.call.id)).length === 0, `${p.disputeOpen} ${p.transferStatus}`);
            const refused = await refundPayment({ paymentId: g.payment.id, amountCents: 100, decidedBy: h, decidedAs: "host", reason: null }).catch((e) => e);
            check("and it cannot be refunded on top", refused instanceof MoneyError);
          }
        }

        console.log("\n29. Earnings not collected for 12 months: the helper starts the collection (plans/46, part 3b)");
        {
          const { claimTry, collectUncollected, followUpUncollected, runTry } = await import("../src/lib/payments/uncollected");
          const MIN = 60_000;
          const triesOf = (hostId: string) => db.select().from(schema.uncollectedTries).where(eq(schema.uncollectedTries.hostId, hostId)).orderBy(schema.uncollectedTries.claimedAt);
          const toldOf = (hostId: string) => db.select().from(schema.messages).where(and(eq(schema.messages.userId, hostId), sql`${schema.messages.key} like 'uncollected:%'`));
          /** More than 12 months after this moment, whatever the year. */
          const yearAfter = (from: Date) => new Date(from.getTime() + 367 * DAY);
          const round = (now: Date, ...hostIds: string[]) => collectUncollected(now, { hostIds });
          const followUp = (now: Date, ...hostIds: string[]) => followUpUncollected(now, { hostIds });

          console.log("   …a host who never collected");
          const h1 = await freshHost();
          const k = await chargedCall(h1);
          const R = await readyAt(k);
          await round(new Date(R.getTime() + 330 * DAY), h1);
          check("at 11 months she is left alone: no try, no collection", (await triesOf(h1)).length === 0 && (await collectionsOf(h1)).length === 0 && (await sent(k)).transfers.length === 0);
          const N1 = yearAfter(R);
          await round(N1, h1);
          const [try1] = await triesOf(h1);
          const [made1] = await collectionsOf(h1);
          const pk = await sent(k);
          check("after 12 months, counted from her oldest ready share, everything ready is sent, with the charge", pk.status === "sent" && pk.cents === 1238 - 25 && pk.fee === 25 && pk.transfers.length === 1 && pk.transfers[0]?.destination === account, `${pk.status} ${pk.cents} ${pk.fee} ${pk.transfers.length}`);
          check("the collection is the try's own, and the record says the helper started it, with nobody who pressed", made1?.id === try1?.id && made1?.startedAs === "helper" && made1?.startedBy === null && try1?.outcome === "collected", `${made1?.startedAs} ${try1?.outcome}`);
          await followUp(N1, h1);
          const [told1] = await toldOf(h1);
          check("she is told what really went: the amount in US dollars, and the charge", (await toldOf(h1)).length === 1 && Boolean(told1?.body.includes("Sent to your Stripe payout account: $12.13, in US dollars.")) && Boolean(told1?.body.includes("The collection charge that was taken: $0.25.")) && told1?.path === "/host", told1?.body);
          check("and an email with the same words is written", (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, told1?.key ?? ""))).length === 1);
          await round(N1, h1);
          await followUp(new Date(N1.getTime() + 2 * DAY), h1);
          await round(new Date(N1.getTime() + 8 * DAY), h1);
          check("once: later rounds make no second try, collection or message", (await triesOf(h1)).length === 1 && (await collectionsOf(h1)).length === 1 && (await toldOf(h1)).length === 1);
          check("her Hosting page is told who started it", (await lastCollectionOf(h1))?.last.startedAs === "helper");
          check("her 24 hours count from it, as from her own", (await press(h1, new Date(N1.getTime() + HOUR))) instanceof MoneyError);

          console.log("   …a host whose last collection that went through is 12 months old; one that sent nothing in between does not count");
          const h2 = await freshHost();
          const a = await chargedCall(h2);
          const T0 = await readyAt(a);
          await press(h2, T0);
          const b = await chargedCall(h2);
          const T1 = new Date(Math.max(T0.getTime(), (await readyAt(b)).getTime()) + 60 * DAY);
          const restoreB = await breakCharge(b);
          const empty = await press(h2, T1);
          await restoreB();
          check("(her own collection two months later is accepted, and Stripe refuses all of it)", empty === null && (await collectionsOf(h2)).length === 2 && (await sent(b)).status === "not_due", empty?.message);
          await round(new Date(T0.getTime() + 330 * DAY), h2);
          check("at 11 months after the one that went through: left alone", (await triesOf(h2)).length === 0 && (await collectionsOf(h2)).length === 2);
          const N2 = yearAfter(T0);
          await round(N2, h2);
          const pb = await sent(b);
          check("12 months after the one that went through, not after the one that sent nothing: sent", pb.status === "sent" && pb.cents === 1238 - 25 && (await collectionsOf(h2)).length === 3 && (await collectionsOf(h2)).filter((c) => c.startedAs === "helper").length === 1 && (await collectionsOf(h2)).filter((c) => c.startedAs === "host").length === 2, `${pb.status} ${pb.cents}`);

          console.log("   …a try that sends nothing: written down, not a collection, tried again a week later and not before");
          const h3 = await freshHost();
          const c = await chargedCall(h3);
          const N3 = yearAfter(await readyAt(c));
          await db.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, h3));
          await round(N3, h3);
          const [refusedTry] = await triesOf(h3);
          check("a payout account that is not ready: the try is written down with the reason, and nothing is collected", (await triesOf(h3)).length === 1 && refusedTry?.outcome === "nothing" && /not ready/.test(refusedTry?.reason ?? "") && (await collectionsOf(h3)).length === 0 && (await sent(c)).transfers.length === 0, `${refusedTry?.outcome} ${refusedTry?.reason}`);
          await followUp(new Date(N3.getTime() + 2 * DAY), h3);
          check("she is not told of a try that sent nothing", (await toldOf(h3)).length === 0);
          await db.update(schema.hostSettings).set({ stripeAccountId: account, payoutsReady: true }).where(eq(schema.hostSettings.userId, h3));
          await round(new Date(N3.getTime() + 6 * DAY), h3);
          check("six days later: no new try", (await triesOf(h3)).length === 1 && (await collectionsOf(h3)).length === 0);
          await round(new Date(N3.getTime() + 7 * DAY + MIN), h3);
          const tries3 = await triesOf(h3);
          check("a week later: a second try, and now it is sent", tries3.length === 2 && tries3[1]?.outcome === "collected" && (await sent(c)).status === "sent" && (await collectionsOf(h3)).length === 1, `${tries3.length} ${tries3[1]?.outcome}`);

          console.log("   …two helpers at once; a try the helper stopped in the middle of; her own button in the same minute");
          const h4 = await freshHost();
          const d = await chargedCall(h4);
          const N4 = yearAfter(await readyAt(d));
          await Promise.all([round(N4, h4), round(N4, h4)]);
          await Promise.all([followUp(N4, h4), followUp(N4, h4)]);
          check("two helpers at once: one try, one collection, one transfer, one message", (await triesOf(h4)).length === 1 && (await collectionsOf(h4)).length === 1 && (await sent(d)).transfers.length === 1 && (await toldOf(h4)).length === 1, `${(await triesOf(h4)).length} ${(await collectionsOf(h4)).length} ${(await toldOf(h4)).length}`);

          const h5 = await freshHost();
          const e = await chargedCall(h5);
          const N5 = yearAfter(await readyAt(e));
          const stopped = await claimTry(h5, N5); // written down; the helper "stopped" before running it
          check("a try is written down before Stripe is asked anything", stopped !== null && stopped.outcome === null && (await collectionsOf(h5)).length === 0);
          check("while it has no outcome, no second try is written", (await claimTry(h5, N5)) === null && (await triesOf(h5)).length === 1);
          await followUp(new Date(N5.getTime() + MIN), h5);
          check("a minute later it is left: the helper that wrote it may still be at it", (await collectionsOf(h5)).length === 0);
          await followUp(new Date(N5.getTime() + 3 * MIN), h5);
          const [made5] = await collectionsOf(h5);
          check("then it is run again, under its own id", made5?.id === stopped?.id && (await sent(e)).status === "sent" && (await triesOf(h5))[0]?.outcome === "collected");
          await runTry(stopped!, new Date(N5.getTime() + 4 * MIN));
          check("run once more: the same collection, nothing sent twice", (await collectionsOf(h5)).length === 1 && (await sent(e)).transfers.length === 1);

          const h6 = await freshHost();
          const f = await chargedCall(h6);
          const N6 = yearAfter(await readyAt(f));
          const beaten = await claimTry(h6, N6);
          const own = await press(h6, N6); // her own button, between the helper's writing down and its collection
          await followUp(new Date(N6.getTime() + 3 * MIN), h6);
          const [try6] = await triesOf(h6);
          const made6 = await collectionsOf(h6);
          check("her own button in the same minute: one collection, hers; the helper's try sends nothing and tells her nothing", own === null && beaten !== null && made6.length === 1 && made6[0]?.startedAs === "host" && made6[0]?.startedBy === h6 && try6?.outcome === "nothing" && (await sent(f)).transfers.length === 1 && (await toldOf(h6)).length === 0, `${made6.length} ${try6?.outcome} ${try6?.reason}`);

          console.log("   …what is left alone: a closed account, and a share that is held back");
          const h7 = await freshHost();
          const g = await chargedCall(h7);
          const N7 = yearAfter(await readyAt(g));
          await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, h7));
          await round(N7, h7);
          check("a closed account is not touched: no try, no collection", (await triesOf(h7)).length === 0 && (await collectionsOf(h7)).length === 0 && (await sent(g)).transfers.length === 0);
          await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, h7));
          const closing = await claimTry(h7, N7);
          await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, h7));
          await runTry(closing!, N7);
          check("closed between the writing down and the collection: nothing is sent", (await triesOf(h7))[0]?.outcome === "nothing" && /closed/.test((await triesOf(h7))[0]?.reason ?? "") && (await collectionsOf(h7)).length === 0);

          const h8 = await freshHost();
          const held = await chargedCall(h8);
          const free = await chargedCall(h8);
          const N8 = yearAfter(await readyAt(held, free));
          await db.update(schema.payments).set({ disputeOpen: true }).where(eq(schema.payments.id, held.payment.id)); // stands in for a bank dispute
          await round(N8, h8);
          check("a share a bank dispute holds back stays; the other is sent", (await sent(held)).status === "not_due" && (await sent(held)).transfers.length === 0 && (await sent(free)).status === "sent" && (await itemsOf((await collectionsOf(h8))[0]!.id)).length === 1);
          await db.update(schema.payments).set({ disputeOpen: false }).where(eq(schema.payments.id, held.payment.id));

          console.log("   …the message when Stripe refuses one share and has no clear answer for another");
          const h9 = await freshHost();
          const three = [await chargedCall(h9), await chargedCall(h9), await chargedCall(h9)];
          const N9 = yearAfter(await readyAt(...three));
          const try9 = (await claimTry(h9, N9))!;
          const accepted = await acceptCollection({ collectionId: try9.id, hostId: h9, startedBy: null, now: N9 });
          const carrier = accepted.started.find((x) => x.params.payoutFeeCents > 0)!;
          const [through, lost] = accepted.started.filter((x) => x !== carrier);
          const restore9 = await breakCharge(three.find((x) => x.payment.id === carrier.paymentId)!);
          await sendCollection([through, carrier]);
          await transferAtStripe(await reload(lost.paymentId), lost.params, lost.label); // Stripe did it; we "stopped" before hearing back
          await restore9();
          await followUp(new Date(N9.getTime() + 3 * MIN), h9); // finds the try without an outcome, and the collection that is there
          check("the try is known as a collection", (await triesOf(h9))[0]?.outcome === "collected" && (await collectionsOf(h9)).length === 1);
          check("while one transfer has no clear answer, she is not told yet", (await toldOf(h9)).length === 0);
          await followUp(new Date(N9.getTime() + DAY + MIN), h9);
          const [told9] = await toldOf(h9);
          check("after a day she is told what is known: one sent, one refused as not sent, one still being checked", (await toldOf(h9)).length === 1 && Boolean(told9?.body.includes("Sent to your Stripe payout account: $12.38, in US dollars.")) && Boolean(told9?.body.includes("Could not be sent: $12.38. Stripe refused it.")) && Boolean(told9?.body.includes("Still being checked: $12.38.")) && !told9?.body.includes("The collection charge that was taken"), told9?.body);
          await reconcileOperations(soon());
          await reconcileOperations(soon());
          await followUp(new Date(N9.getTime() + 2 * DAY), h9);
          check("the money helper finishes the unanswered one, and she is not told twice", (await sent(three.find((x) => x.payment.id === lost.paymentId)!)).status === "sent" && (await toldOf(h9)).length === 1);
        }
      } finally {
        // Give the test payout account back to host@test.local, whatever happened above.
        await db.transaction(async (tx) => {
          await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, holder));
          await tx.update(schema.hostSettings).set({ stripeAccountId: account }).where(eq(schema.hostSettings.userId, host.id));
        });
        await refreshPayoutsReady(host.id).catch(() => undefined);
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
