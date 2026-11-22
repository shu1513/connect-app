/**
 * The founder's refund of a call's payment, also after the host has collected (plans/46-part-3-money-owed.md,
 * decisions 9 to 11): finding the payment, the grounds the founder can name, an estimate of what the host will
 * owe, and what really came of the refund at Stripe.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import { formatMoney } from "./access";
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

/**
 * What is left of a payment to refund, in cents, and what refunding `amountCents` of it (all that is left, when no
 * amount is given) would make the host owe at most: what her share loses, and never more than was really sent to her
 * for it (nothing, when the share was collected with nothing sent). An estimate: the real numbers are written when
 * Stripe confirms the refund, and what is still left on the transfer can make it less.
 */
export function refundEstimate(payment: Pick<Payment, "chargedCents" | "refundedCents" | "originalHostShareCents" | "transferStatus" | "transferCents">, amountCents?: number): { leftCents: number; hostOwesCents: number } {
  if (payment.chargedCents === null || payment.originalHostShareCents === null) return { leftCents: 0, hostOwesCents: 0 };
  const leftCents = Math.max(0, payment.chargedCents - payment.refundedCents);
  const amount = Math.max(0, Math.min(leftCents, amountCents ?? leftCents));
  const before = currentSplit(payment as Payment).hostShareCents;
  const after = splitAfterRefunds({ chargeCents: payment.chargedCents, refundedCents: payment.refundedCents + amount, originalHostShareCents: payment.originalHostShareCents }).hostShareCents;
  const sent = payment.transferStatus === "sent" ? (payment.transferCents ?? 0) : 0;
  return { leftCents, hostOwesCents: Math.min(Math.max(0, before - after), sent) };
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
export const REFUND_SEARCH_PAGE = 50;

export async function paymentsForRefund(search: RefundSearch, before?: Date): Promise<FoundPayment[]> {
  const host = schema.user;
  const byCall = "callId" in search;
  if (byCall && !UUID.test(search.callId)) return [];
  const customerId = byCall ? null : search.customerId;
  const rows = await db
    .select({ payment: schema.payments, callId: schema.calls.id, startsAt: schema.calls.startsAt, hostId: schema.calls.hostId, customerId: schema.calls.customerId })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(eq(schema.payments.kind, "card"), eq(schema.payments.status, "charged"), byCall ? eq(schema.calls.id, search.callId) : eq(schema.calls.customerId, customerId!), before ? lt(schema.calls.startsAt, before) : undefined))
    // A page at a time, newest call first; "older" asks for the calls that began before the last one shown.
    .orderBy(desc(schema.calls.startsAt), desc(schema.payments.id))
    .limit(REFUND_SEARCH_PAGE);
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

export type RefundOutcome = {
  paymentId: string;
  /** What the refund's line says was asked for: never the number a form sent. */
  amountCents: number;
  status: "done" | "in_progress" | "failed";
  /** Stripe's own number for the refund: set once Stripe has answered the request. */
  stripeRefundId: string | null;
  /** What Stripe said when it refused or failed it. */
  failure: string | null;
  afterCollection: boolean;
  hostOwesCents: number;
  /** For one after collection: what was really sent to the host for that share. */
  sentCents: number;
  /** What the helper has made of it so far: nothing yet, a take-back in some state, or "nothing can be taken back". */
  takeBack: "not_yet" | "nothing" | { status: string; amountCents: number };
};

/** What came of one refund request, read back from the record: paid back, on its way, or refused, and what the host then owes. Null when it was never written. */
export async function refundOutcome(refundId: string): Promise<RefundOutcome | null> {
  const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!refund) return null;
  const [payment] = await db.select({ transferStatus: schema.payments.transferStatus, transferCents: schema.payments.transferCents }).from(schema.payments).where(eq(schema.payments.id, refund.paymentId));
  const [debt] = await db.select({ status: schema.hostDebts.status, amountCents: schema.hostDebts.amountCents }).from(schema.hostDebts).where(eq(schema.hostDebts.refundId, refund.id));
  return {
    paymentId: refund.paymentId,
    amountCents: refund.amountCents,
    status: refund.status as RefundOutcome["status"],
    stripeRefundId: refund.stripeRefundId,
    failure: refund.failure,
    afterCollection: refund.afterCollection,
    hostOwesCents: refund.hostOwesCents,
    sentCents: payment?.transferStatus === "sent" ? (payment.transferCents ?? 0) : 0,
    takeBack: debt && debt.status !== "nothing" ? debt : refund.debtLookedAt ? "nothing" : "not_yet",
  };
}

/**
 * What the person who asked for a refund is told, from what was written down (never from what the form sent, and
 * never more than is known). `refused` is a refusal the request itself came back with, if any.
 */
export function refundAnswer(outcome: RefundOutcome | null, as: "founder" | "host", refused: string | null = null): string {
  // No line: nothing was begun and nothing was asked of Stripe.
  if (!outcome) return refused ?? "No refund was started: another money action on this payment is still being confirmed with Stripe, or something went wrong before anything was sent. Nothing was given back. Look at the payment again in a minute.";
  const amount = formatMoney(outcome.amountCents);
  if (outcome.status === "failed") {
    const why = outcome.failure ?? refused;
    return `Stripe refused the refund of ${amount}${why ? ` (${why})` : ""}. Nothing was given back. You can try again.`;
  }
  if (outcome.status === "in_progress") {
    // With Stripe's number: Stripe has the request and has not finished it. Without: the app asked and has no answer.
    return outcome.stripeRefundId
      ? `The refund of ${amount} is on its way: Stripe has accepted it and has not confirmed it yet. The app finishes it by itself.${outcome.afterCollection ? " What the host owes is worked out once it is confirmed." : ""}`
      : `The refund of ${amount} is being checked: the app asked Stripe and has no answer yet, so it is not known whether Stripe received the request. The app finds out by itself within a few minutes. Look at the payment again then, and do not refund it a second time meanwhile.`;
  }
  if (!outcome.afterCollection) return as === "founder" ? `${amount} was given back to the customer. The host had not collected this share, so nobody owes anything.` : `The refund of ${amount} was sent to the customer.`;
  const shrank = `${amount} was given back to the customer from Connect's money. The host's share shrank by ${formatMoney(outcome.hostOwesCents)}.`;
  if (outcome.takeBack === "nothing" || outcome.sentCents <= 0 || outcome.hostOwesCents <= 0) return `${shrank} Nothing can be taken back for it: nothing was sent to the host for this share, or nothing is left of what was sent.`;
  if (outcome.takeBack === "not_yet") return `${shrank} The app now works out what the host owes (never more than the ${formatMoney(outcome.sentCents)} that was sent to them) and tells them, usually within a minute. It is then listed under "Money hosts owe back".`;
  const owed = formatMoney(outcome.takeBack.amountCents);
  return outcome.takeBack.status === "waiting"
    ? `${shrank} The host owes ${owed}. The app does not take it by itself: it waits for you under "Money hosts owe back".`
    : `${shrank} The host owes ${owed} and has been told. It is listed under "Money hosts owe back".`;
}
