/**
 * What the sending service reports about one email after it accepted it: delivered, or bounced
 * (src/app/api/resend/webhook/route.ts calls this).
 *
 * The two marks are only ever set, never emptied. So whatever order the reports arrive in, an
 * email counts as having arrived exactly when it was reported delivered and never reported
 * bounced: a late "delivered" cannot hide a bounce, and a late bounce still counts.
 *
 * Some emails start a count of days when they arrive: the notice of a take-back, and the founder's
 * answer to an objection (plans/46-part-3-money-owed.md, decision 6). For such an email the report
 * is written with the take-back's share locked first: the same lock under which the taking reads
 * this email at the last moment. So a bounce is either seen by that reading, or it is written
 * after the taking has started; never in between.
 */
import { eq, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lockPayment } from "@/lib/payments/operations";

/**
 * Records one report. False when no email with this number of the sending service is known: the report can arrive a
 * moment before the app has saved that number, so the caller looks again a few times before letting the report go.
 */
export async function recordEmailEvent(providerId: string, kind: "delivered" | "bounced", note: string | null, now: Date = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [email] = await tx.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(eq(schema.emailOutbox.providerId, providerId));
    if (!email) return false;
    const [debt] = await tx
      .select({ paymentId: schema.hostDebts.paymentId })
      .from(schema.hostDebts)
      .where(or(eq(schema.hostDebts.noticeEmailId, email.id), eq(schema.hostDebts.answerEmailId, email.id)));
    if (debt) await lockPayment(tx, debt.paymentId);
    const at = now.toISOString();
    await tx
      .update(schema.emailOutbox)
      .set(
        kind === "bounced"
          ? { bouncedAt: sql`coalesce(${schema.emailOutbox.bouncedAt}, ${at}::timestamptz)`, lastError: note }
          : // A note of a bounce is kept: the bounce still counts.
            { deliveredAt: sql`coalesce(${schema.emailOutbox.deliveredAt}, ${at}::timestamptz)`, lastError: sql`case when ${schema.emailOutbox.bouncedAt} is null then null else ${schema.emailOutbox.lastError} end` },
      )
      .where(eq(schema.emailOutbox.id, email.id));
    return true;
  });
}
