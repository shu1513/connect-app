/**
 * The founder holds a contribution's share back, or releases it sooner (plans/23, choice D;
 * plans/25, "The $1,000 rule in the code"). Each with a reason that is kept, and each written to
 * the record of the founder's actions in the same step.
 *
 * A release shortens a wait or lifts the founder's own hold. It never lifts a bank dispute, an
 * action that is under way, or a refund that is owed: those are judged apart, every time a share
 * is looked at (payments/collect.ts). A released payment stays released: counting the $1,000 again
 * does not put its 30 days back.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordAdminAction } from "@/lib/safety/audit";
import { lockForPayment } from "./locks";
import { ContributionError } from "./rules";

const pays = schema.contributionPayments;

async function decide(input: { paymentId: string; adminId: string; note: string; now: Date }, to: "held" | "released"): Promise<void> {
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!note) throw new ContributionError("Please give a reason. It is kept.");
  await db.transaction(async (tx) => {
    const { contribution, payment } = await lockForPayment(tx, input.paymentId);
    if (payment.status === "given_up") throw new ContributionError("This payment was given up; there is nothing to hold back or release.");
    await tx.update(pays).set({ founderHold: to, founderBy: input.adminId, founderAt: input.now, founderNote: note, updatedAt: input.now }).where(eq(pays.id, payment.id));
    if (to === "released") {
      // Her share can be collected from now, if it is already hers and was waiting longer.
      await tx
        .update(schema.payments)
        .set({ transferDueAt: sql`least(${schema.payments.transferDueAt}, ${input.now.toISOString()}::timestamptz)`, updatedAt: input.now })
        .where(and(eq(schema.payments.contributionPaymentId, payment.id), inArray(schema.payments.transferStatus, ["not_due", "due"])));
    }
    await recordAdminAction({ adminId: input.adminId, action: to === "held" ? "contribution held back" : "contribution released", targetUserId: contribution.hostId, targetId: payment.id, detail: note }, tx);
  });
}

export const holdBack = (input: { paymentId: string; adminId: string; note: string; now: Date }) => decide(input, "held");
export const release = (input: { paymentId: string; adminId: string; note: string; now: Date }) => decide(input, "released");
