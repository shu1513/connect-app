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
    const refused = await capturePayment({ paymentId: tooMuch.payment.id, amountCents: 1334, reason: "admin", frozen: null, callEndsAt: tooMuch.call.endsAt }).catch((e) => e);
    check("never more than the booked price", refused instanceof MoneyError);
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

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
