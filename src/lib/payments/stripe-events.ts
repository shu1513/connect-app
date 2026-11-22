/**
 * What we do with a message from Stripe.
 *
 * A message never moves money and is never trusted for its content. It is a
 * nudge: we ask Stripe for the current state and record that. So a repeated,
 * late or out-of-order message can do no harm.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { syncPayment } from "@/lib/contributions/charge";
import { refreshDispute } from "@/lib/contributions/dispute";
import { noteDispute, type Owner } from "@/lib/disputes/record";
import { errorSummary } from "@/lib/email";
import { syncMonth } from "@/lib/membership/charge";
import { refreshMonthDispute } from "@/lib/membership/ending";
import { refreshPaymentDispute } from "./disputes";
import { syncHold } from "./hold";
import { stripe } from "./stripe";

/** An id as our database makes them. Anything else in a message's notes is not ours and is never looked up. */
const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StripeMessage = { type: string; data: { object: Record<string, unknown> } };

export async function handleStripeEvent(event: StripeMessage): Promise<void> {
  const object = event.data.object;

  if (event.type.startsWith("payment_intent.")) {
    // The hold was placed, or ended. Ask Stripe for the real state and record it.
    // A membership month's payment: the same nudge, to the month's own code.
    const monthId = (object.metadata as Record<string, string> | undefined)?.monthId;
    if (monthId && IS_ID.test(monthId)) {
      const [month] = await db.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(eq(schema.membershipMonths.id, monthId));
      if (month) await syncMonth(monthId, new Date());
      return;
    }
    // A contribution's payment: the same nudge, to its own code. It carries its id under a name of its own.
    const contributionPaymentId = (object.metadata as Record<string, string> | undefined)?.contributionPaymentId;
    if (contributionPaymentId && IS_ID.test(contributionPaymentId)) {
      const [ours] = await db.select({ id: schema.contributionPayments.id }).from(schema.contributionPayments).where(eq(schema.contributionPayments.id, contributionPaymentId));
      if (ours) await syncPayment(contributionPaymentId, new Date());
      return;
    }
    const paymentId = (object.metadata as Record<string, string> | undefined)?.paymentId;
    // Not one of ours (for example made by another copy of the app in the same Stripe test area): nothing to do.
    if (!paymentId || !IS_ID.test(paymentId)) return;
    const [known] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.id, paymentId));
    if (known) await syncHold(paymentId, new Date());
    return;
  }

  if (event.type === "refund.failed" || event.type === "refund.updated" || event.type === "charge.refund.updated") {
    // A refund changed at Stripe. What matters: one that Stripe had confirmed can fail afterwards (the customer's bank
    // sends it back). Then the app's record of it is undone, and a host who was to pay for it owes nothing
    // (plans/46-part-3-money-owed.md). What Stripe says now is read from Stripe there, not from this message.
    const refundId = String(object.id ?? "");
    if (!refundId.startsWith("re_")) return;
    // The app's own number for the refund, which it carries at Stripe: so it is found even before the app has
    // recorded Stripe's number for it.
    const ours = (object.metadata as Record<string, string> | undefined)?.refundId;
    const { refundChangedAtStripe } = await import("@/lib/disputes/takeback");
    await refundChangedAtStripe(refundId, ours && IS_ID.test(ours) ? ours : null);
    return;
  }

  if (event.type === "transfer.reversed") {
    // A host's transfer was reversed. The app knows its own reversals; one that somebody made by hand at Stripe
    // may have paid a take-back, or paid one twice: the founder is told, and nothing more is taken meanwhile.
    const transferId = String(object.id ?? "");
    if (!transferId.startsWith("tr_")) return;
    const { reversalSeenOnTransfer } = await import("@/lib/disputes/takeback");
    await reversalSeenOnTransfer(transferId);
    return;
  }

  if (event.type.startsWith("charge.dispute.")) {
    const dispute = await stripe()
      .disputes.retrieve(String(object.id))
      .catch((error: { code?: string }) => {
        if (error?.code === "resource_missing") return null; // Stripe does not know it: not ours
        throw error;
      });
    const intentId = typeof dispute?.payment_intent === "string" ? dispute.payment_intent : dispute?.payment_intent?.id;
    if (!intentId) return;
    const now = new Date();
    // First, and on its own: what keeps the money where it is. Each kind of money looks at ALL disputes on its
    // charge together (a bank can dispute one charge more than once), asks Stripe, records, and asks once more,
    // so that messages out of order, or two at the same moment, never leave a stale answer as the last word.
    const owners: Array<{ owner: Owner; money: () => Promise<void> }> = [];
    // A dispute over a call's card payment: recorded on the payment, where collecting and refunding look. The dispute
    // this message is about is counted also if Stripe's list does not show it yet.
    const [payment] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.stripePaymentIntentId, intentId));
    if (payment) owners.push({ owner: { kind: "payment", id: payment.id }, money: () => refreshPaymentDispute(payment.id, now, { id: dispute!.id, status: dispute!.status }) });
    // A dispute over a membership month's charge: recorded on the month, where booking, paying back and collecting look.
    const [month] = await db.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(eq(schema.membershipMonths.stripePaymentIntentId, intentId));
    if (month) owners.push({ owner: { kind: "month", id: month.id }, money: () => refreshMonthDispute(month.id, now) });
    // A dispute over a contribution's charge: recorded on its payment, where collecting and refunding look.
    const [contributed] = await db.select({ id: schema.contributionPayments.id }).from(schema.contributionPayments).where(eq(schema.contributionPayments.stripePaymentIntentId, intentId));
    if (contributed) owners.push({ owner: { kind: "contribution", id: contributed.id }, money: () => refreshDispute(contributed.id, now) });
    for (const { owner, money } of owners) {
      await money();
      // Only then, in a step of its own: the app's record of the dispute, and telling people (plans/47). The money is
      // protected by now. This step asks Stripe nothing more: a first sight is written from the dispute read above,
      // and a dispute the app knows is marked for the helper, which reads Stripe again within the minute (looking
      // at the money once more as it does). A fault here must not leave this message "not handled", because an
      // unhandled dispute message keeps every host from collecting (collect.ts, disputeMessageWaiting); the helper's
      // hourly look and its catch-up from Stripe's list write whatever is missing.
      await noteDispute(owner, dispute!, now).catch((error) => console.error(`[disputes] could not note dispute ${String(object.id)} (${errorSummary(error)}); the helper's look will`));
    }
  }
}
