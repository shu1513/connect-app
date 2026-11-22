/**
 * The founder's refund of a call's payment, also after the host has collected (plans/46-part-3-money-owed.md,
 * decisions 9 to 11): finding the payment, the grounds the founder can name, an estimate of what the host will
 * owe, and what really came of the refund at Stripe.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import { currentSplit } from "./actions";
import { splitAfterRefunds } from "./pricing";

/**
 * The grounds on which Connect decides a refund in the host's place (Host Agreement, sections 8.3 and 8.4). The
 * founder names one and adds a sentence; the host is told both.
 */
export const REFUND_GROUNDS = {
  reported: 'The call was ended with "End call and report".',
  host_absent: "The host did not join the call.",
  required: "The law or the rules of the card companies require this refund.",
  mistake: "The charge was made by mistake, by fraud, or for a call that broke the Community Rules.",
  unreachable: "The host's account is paused or closed, or the host cannot be reached.",
  legal_right: "The customer, in the United Kingdom or Europe, used a legal right to cancel or to a remedy.",
} as const;
export type RefundGround = keyof typeof REFUND_GROUNDS;
export const isRefundGround = (value: string): value is RefundGround => Object.hasOwn(REFUND_GROUNDS, value);

/** The reason the host reads: the ground, and the founder's own sentence. */
export function refundReason(ground: RefundGround, sentence: string): string {
  return `${REFUND_GROUNDS[ground]} ${sentence.trim()}`.trim();
}

/** What is left of a payment to refund, in cents, and what refunding `amountCents` of it would take off the host's share. An estimate: the real numbers are written when Stripe confirms the refund. */
export function refundEstimate(payment: Pick<Payment, "chargedCents" | "refundedCents" | "originalHostShareCents">, amountCents?: number): { leftCents: number; hostOwesCents: number } {
  if (payment.chargedCents === null || payment.originalHostShareCents === null) return { leftCents: 0, hostOwesCents: 0 };
  const leftCents = Math.max(0, payment.chargedCents - payment.refundedCents);
  const amount = Math.max(0, Math.min(leftCents, amountCents ?? leftCents));
  const before = currentSplit(payment as Payment).hostShareCents;
  const after = splitAfterRefunds({ chargeCents: payment.chargedCents, refundedCents: payment.refundedCents + amount, originalHostShareCents: payment.originalHostShareCents }).hostShareCents;
  return { leftCents, hostOwesCents: Math.max(0, before - after) };
}

export type FoundPayment = { payment: Payment; callId: string; startsAt: Date; hostName: string; customerName: string; customerEmail: string; collected: boolean; refundUnderWay: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the founder typed to find a payment: a call's id, or a customer's email address. */
export type RefundSearch = { callId: string } | { customerId: string };

/**
 * Turns what the founder typed into a search: a call's id as it is, an email address into the account's own number.
 * So the address of the page that shows the result never holds a person's email address. Null when nothing fits.
 */
export async function refundSearchFor(typed: string): Promise<RefundSearch | null> {
  const asked = typed.trim();
  if (!asked) return null;
  if (UUID.test(asked)) return { callId: asked.toLowerCase() };
  const [customer] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, asked.toLowerCase()));
  return customer ? { customerId: customer.id } : null;
}

/**
 * The charged card payments of one call, or of one customer, newest call first. So a payment older than the ones
 * the admin page lists can be found too.
 */
export async function paymentsForRefund(search: RefundSearch): Promise<FoundPayment[]> {
  const host = schema.user;
  const byCall = "callId" in search;
  if (byCall && !UUID.test(search.callId)) return [];
  const customerId = byCall ? null : search.customerId;
  const rows = await db
    .select({ payment: schema.payments, callId: schema.calls.id, startsAt: schema.calls.startsAt, hostId: schema.calls.hostId, customerId: schema.calls.customerId })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(eq(schema.payments.kind, "card"), eq(schema.payments.status, "charged"), byCall ? eq(schema.calls.id, search.callId) : eq(schema.calls.customerId, customerId!)))
    .orderBy(desc(schema.calls.startsAt))
    .limit(50);
  if (rows.length === 0) return [];
  const people = await db
    .select({ id: host.id, name: host.name, email: host.email })
    .from(host)
    .where(inArray(host.id, [...new Set(rows.flatMap((row) => [row.hostId, row.customerId]))]));
  const moving = await db
    .select({ paymentId: schema.refunds.paymentId, n: sql<number>`count(*)::int` })
    .from(schema.refunds)
    .where(and(inArray(schema.refunds.paymentId, rows.map((row) => row.payment.id)), eq(schema.refunds.status, "in_progress")))
    .groupBy(schema.refunds.paymentId);
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? "someone";
  return rows.map((row) => ({
    payment: row.payment,
    callId: row.callId,
    startsAt: row.startsAt,
    hostName: nameOf(row.hostId),
    customerName: nameOf(row.customerId),
    customerEmail: people.find((person) => person.id === row.customerId)?.email ?? "",
    collected: row.payment.transferStatus === "sent",
    refundUnderWay: moving.some((one) => one.paymentId === row.payment.id),
  }));
}

/** What came of one refund request, read back from the record: paid back, on its way, or refused. Null when it was never written. */
export async function refundOutcome(refundId: string): Promise<{ status: "done" | "in_progress" | "failed"; hostOwesCents: number; afterCollection: boolean } | null> {
  const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!refund) return null;
  return { status: refund.status as "done" | "in_progress" | "failed", hostOwesCents: refund.hostOwesCents, afterCollection: refund.afterCollection };
}
