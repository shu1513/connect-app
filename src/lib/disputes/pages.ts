/**
 * Where a person can read about the dispute over a piece of money (plans/47, part 1).
 */
import { desc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Dispute, Payment } from "@/db/schema";
import { disputePath } from "./record";

/**
 * A dispute, for someone who may open its page: the host whose money it is about, and the founder
 * (logged in as an admin). For anyone else, and for a dispute that does not exist, null: the page
 * then says "not found" for both, so it gives nothing away. The customer has no page here.
 */
export async function disputeForViewer(disputeId: string, viewer: { id: string }, founder: boolean): Promise<Dispute | null> {
  const [dispute] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId));
  if (!dispute) return null;
  return dispute.hostId === viewer.id || founder ? dispute : null;
}

/**
 * For each of these shares that has a recorded dispute: the page of that dispute. A share's money
 * can come from a call's own card payment, from a membership's month, or from a contribution's
 * payment; the dispute is over whichever was charged at Stripe. With several disputes on one
 * charge, the one that has not ended comes first, then the latest.
 */
export async function disputePagesOf(payments: Payment[]): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  if (payments.length === 0) return pages;
  const ids = (pick: (payment: Payment) => string | null) => [...new Set(payments.flatMap((payment) => pick(payment) ?? []))];
  const own = ids((p) => (p.monthId || p.contributionPaymentId ? null : p.id));
  const months = ids((p) => p.monthId);
  const contributed = ids((p) => p.contributionPaymentId);
  const rows = await db
    .select({ id: schema.disputes.id, paymentId: schema.disputes.paymentId, monthId: schema.disputes.monthId, contributionPaymentId: schema.disputes.contributionPaymentId, outcome: schema.disputes.outcome })
    .from(schema.disputes)
    .where(
      or(
        own.length > 0 ? inArray(schema.disputes.paymentId, own) : undefined,
        months.length > 0 ? inArray(schema.disputes.monthId, months) : undefined,
        contributed.length > 0 ? inArray(schema.disputes.contributionPaymentId, contributed) : undefined,
      ),
    )
    .orderBy(desc(schema.disputes.openedAt));
  // Open ones first; within each group the latest first (the order above).
  const inOrder = [...rows.filter((row) => !row.outcome), ...rows.filter((row) => row.outcome)];
  for (const payment of payments) {
    const found = inOrder.find((row) => (payment.monthId ? row.monthId === payment.monthId : payment.contributionPaymentId ? row.contributionPaymentId === payment.contributionPaymentId : row.paymentId === payment.id));
    if (found) pages.set(payment.id, disputePath(found.id));
  }
  return pages;
}
