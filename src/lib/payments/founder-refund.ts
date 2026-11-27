/**
 * The founder's refund of a call's payment, also after the host has collected (plans/46-part-3-money-owed.md,
 * decisions 9 to 11): finding the payment, the grounds the founder can name, an estimate of what the host will
 * owe, and what really came of the refund at Stripe.
 */
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import { formatMoney } from "./access";
import { currentSplit } from "./actions";
import { refundOwes } from "@/lib/disputes/takeback-rules";
import { splitAfterRefunds } from "./pricing";

/**
 * The grounds on which Connect decides a refund in the host's place (Host Agreement, sections 8.3 and 8.4). The
 * founder names one and adds a sentence; the host is told both.
 */
export const REFUND_GROUNDS = {
  // (The key is from the time of the earlier button, "End call and report". The host reads this sentence, so it says
  // only how the call ended, never that anybody reported anybody.)
  reported: 'The call was ended early with "End call now".',
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
export function refundEstimate(
  payment: Pick<Payment, "chargedCents" | "refundedCents" | "originalHostShareCents" | "transferStatus" | "transferCents">,
  amountCents?: number,
  /** What her share has already lost to earlier refunds given after the sending. */
  reductionsSoFarCents = 0,
): { leftCents: number; hostOwesCents: number; sentCents: number } {
  const sentCents = payment.transferStatus === "sent" ? (payment.transferCents ?? 0) : 0;
  if (payment.chargedCents === null || payment.originalHostShareCents === null) return { leftCents: 0, hostOwesCents: 0, sentCents };
  const leftCents = Math.max(0, payment.chargedCents - payment.refundedCents);
  const amount = Math.max(0, Math.min(leftCents, amountCents ?? leftCents));
  const before = currentSplit(payment as Payment).hostShareCents;
  const after = splitAfterRefunds({ chargeCents: payment.chargedCents, refundedCents: payment.refundedCents + amount, originalHostShareCents: payment.originalHostShareCents }).hostShareCents;
  // The same rule the real sum uses: once refunds have used up all that was sent, a further refund adds nothing.
  return { leftCents, sentCents, hostOwesCents: refundOwes({ sentCents, reductionsBeforeCents: reductionsSoFarCents, reductionCents: Math.max(0, before - after), roomCents: Number.MAX_SAFE_INTEGER }) };
}

export type FoundPayment = {
  payment: Payment;
  callId: string;
  startsAt: Date;
  hostName: string;
  customerName: string;
  customerEmail: string;
  collected: boolean;
  /** A refund of it that is not finished: "accepted" by Stripe and on its way, or "unanswered" (the app asked and does not know yet whether Stripe got the request). */
  refundUnderWay: "no" | "accepted" | "unanswered";
  /** What the host's share has already lost to refunds given after it was sent. */
  reductionsCents: number;
  /** A member's call, paid from a membership's month: what is given back is its time, and after collection its money goes to the member's card (plans/50-part-2-member-time-owed-back.md). */
  memberCall: boolean;
  /** A bank has a question or a dispute on the payment (for a member's call: on its month's charge), so nothing can be given back from it now. */
  frozen: boolean;
};

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

/** Where a page of the search ends: the next page holds what comes after it in the list's own order (the call's start, then the payment's number). */
export type RefundSearchCursor = { startsAt: Date; paymentId: string };

export async function paymentsForRefund(search: RefundSearch, before?: RefundSearchCursor): Promise<FoundPayment[]> {
  const host = schema.user;
  const byCall = "callId" in search;
  if (byCall && !UUID.test(search.callId)) return [];
  const customerId = byCall ? null : search.customerId;
  const rows = await db
    .select({ payment: schema.payments, callId: schema.calls.id, startsAt: schema.calls.startsAt, hostId: schema.calls.hostId, customerId: schema.calls.customerId })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(inArray(schema.payments.kind, ["card", "member_call"]), eq(schema.payments.status, "charged"), byCall ? eq(schema.calls.id, search.callId) : eq(schema.calls.customerId, customerId!), before ? or(lt(schema.calls.startsAt, before.startsAt), and(eq(schema.calls.startsAt, before.startsAt), lt(schema.payments.id, before.paymentId))) : undefined))
    // A page at a time, newest call first. "Older" asks for what comes after the last one shown, by both keys of the
    // order, so two payments of one call (its own and one for added time) are never split from each other and lost.
    .orderBy(desc(schema.calls.startsAt), desc(schema.payments.id))
    .limit(REFUND_SEARCH_PAGE);
  if (rows.length === 0) return [];
  const people = await db
    .select({ id: host.id, name: host.name, email: host.email })
    .from(host)
    .where(inArray(host.id, [...new Set(rows.flatMap((row) => [row.hostId, row.customerId]))]));
  const ids = rows.map((row) => row.payment.id);
  const moving = await db
    .select({ paymentId: schema.refunds.paymentId, unanswered: sql<number>`count(*) filter (where ${schema.refunds.stripeRefundId} is null)::int` })
    .from(schema.refunds)
    .where(and(inArray(schema.refunds.paymentId, ids), eq(schema.refunds.status, "in_progress")))
    .groupBy(schema.refunds.paymentId);
  const reduced = await db
    .select({ paymentId: schema.refunds.paymentId, cents: sql<number>`coalesce(sum(${schema.refunds.hostOwesCents}), 0)::int` })
    .from(schema.refunds)
    .where(and(inArray(schema.refunds.paymentId, ids), eq(schema.refunds.status, "done"), eq(schema.refunds.afterCollection, true)))
    .groupBy(schema.refunds.paymentId);
  // A member's call is frozen with its month: the bank's question is on the month's charge.
  const monthIds = [...new Set(rows.map((row) => row.payment.monthId).filter((id): id is string => id !== null))];
  const frozenMonths = monthIds.length > 0 ? (await db.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(and(inArray(schema.membershipMonths.id, monthIds), inArray(schema.membershipMonths.dispute, ["open", "lost"])))).map((month) => month.id) : [];
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? "someone";
  return rows.map((row) => ({
    memberCall: row.payment.kind === "member_call",
    frozen: row.payment.disputeOpen || (row.payment.monthId !== null && frozenMonths.includes(row.payment.monthId)),
    payment: row.payment,
    callId: row.callId,
    startsAt: row.startsAt,
    hostName: nameOf(row.hostId),
    customerName: nameOf(row.customerId),
    customerEmail: people.find((person) => person.id === row.customerId)?.email ?? "",
    collected: row.payment.transferStatus === "sent",
    refundUnderWay: ((one) => (!one ? "no" : one.unanswered > 0 ? "unanswered" : "accepted"))(moving.find((one) => one.paymentId === row.payment.id)),
    reductionsCents: reduced.find((one) => one.paymentId === row.payment.id)?.cents ?? 0,
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
  /** Stripe said that it failed after it had first gone through, and the app has not undone its record yet (money was moving on the payment). */
  failedAfterAll: boolean;
  afterCollection: boolean;
  hostOwesCents: number;
  /** For one after collection: what was really sent to the host for that share. */
  sentCents: number;
  /** What the helper has made of it so far: nothing yet, a take-back in some state, or "nothing can be taken back". */
  takeBack: "not_yet" | "nothing" | { status: string; amountCents: number };
  /** For a member's call: where its time went. Back into the membership ("free"), or its money to the member's card ("card"). Null for a call paid by card. */
  memberTime: "free" | "card" | null;
};

/** What came of one refund request, read back from the record: paid back, on its way, or refused, and what the host then owes. Null when it was never written. */
export async function refundOutcome(refundId: string): Promise<RefundOutcome | null> {
  const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.id, refundId));
  if (!refund) return null;
  const [payment] = await db.select({ kind: schema.payments.kind, transferStatus: schema.payments.transferStatus, transferCents: schema.payments.transferCents }).from(schema.payments).where(eq(schema.payments.id, refund.paymentId));
  // A member's time that went to the card has its own line of what the month owes back, under this give-back's name.
  const [toCard] = payment?.kind === "member_call" ? await db.select({ id: schema.membershipRefunds.id }).from(schema.membershipRefunds).where(eq(schema.membershipRefunds.sourceKey, `giveback:${refund.id}`)) : [];
  const [debt] = await db.select({ status: schema.hostDebts.status, amountCents: schema.hostDebts.amountCents }).from(schema.hostDebts).where(eq(schema.hostDebts.refundId, refund.id));
  return {
    paymentId: refund.paymentId,
    amountCents: refund.amountCents,
    status: refund.status as RefundOutcome["status"],
    stripeRefundId: refund.stripeRefundId,
    failure: refund.failure,
    failedAfterAll: refund.status === "done" && refund.undoPendingAt !== null,
    afterCollection: refund.afterCollection,
    hostOwesCents: refund.hostOwesCents,
    sentCents: payment?.transferStatus === "sent" ? (payment.transferCents ?? 0) : 0,
    takeBack: debt && debt.status !== "nothing" ? debt : refund.debtLookedAt ? "nothing" : "not_yet",
    memberTime: payment?.kind === "member_call" ? (toCard ? "card" : "free") : null,
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
      : `The refund of ${amount} was recorded, and what came of it at Stripe is not confirmed yet: it may have gone through, or it may not have reached Stripe. The app finds out by itself; mostly that takes a few minutes, at the longest a day. Wait until the payment's page shows what happened, and do not refund it a second time before that.`;
  }
  // Stripe has said that it failed after all; the app's record still says "given back" until it is undone.
  if (outcome.failedAfterAll) return `The refund of ${amount} failed at Stripe after it had first gone through${outcome.failure ? ` (${outcome.failure})` : ""}: the customer did not get the money. The app is undoing its record of it, which takes a few minutes; nobody owes anything for it.`;
  // A member's call: what was given back is its time. It is in the membership again, or its money is owed to the
  // member's card (the month's own pay-back sends that, and confirms it to the member).
  const timeWent = outcome.memberTime === "card" ? "its money is owed to the member's card, and is sent there by itself" : "it is in the member's membership again";
  if (!outcome.afterCollection) {
    if (outcome.memberTime) return `${amount} of the member's time was given back: ${timeWent}.${as === "founder" ? " The host had not collected this share, so nobody owes anything." : ""}`;
    return as === "founder" ? `${amount} was given back to the customer. The host had not collected this share, so nobody owes anything.` : `The refund of ${amount} was sent to the customer.`;
  }
  const shrank = outcome.memberTime
    ? `${amount} of the member's time was given back: ${timeWent}, from Connect's money. The host's share shrank by ${formatMoney(outcome.hostOwesCents)}.`
    : `${amount} was given back to the customer from Connect's money. The host's share shrank by ${formatMoney(outcome.hostOwesCents)}.`;
  if (outcome.takeBack === "nothing" || outcome.sentCents <= 0 || outcome.hostOwesCents <= 0) return `${shrank} Nothing can be taken back for it: nothing was sent to the host for this share, or nothing is left of what was sent.`;
  // Nothing is promised that is not known yet: earlier refunds may have used up everything that was sent.
  if (outcome.takeBack === "not_yet") return `${shrank} The app now works out whether the host owes anything for it (never more than is left of the ${formatMoney(outcome.sentCents)} that was sent to them), usually within a minute. If they do, they are told, and it is listed under "Money hosts owe back".`;
  const owed = formatMoney(outcome.takeBack.amountCents);
  const where = 'It is listed under "Money hosts owe back".';
  // Where the take-back stands now, whatever it is: this is also what a form sent a second time is answered with.
  switch (outcome.takeBack.status) {
    case "waiting":
      return `${shrank} The host owes ${owed}. The app does not take it by itself: it waits for you under "Money hosts owe back".`;
    case "told":
      return `${shrank} The host owes ${owed} and has been told. ${where}`;
    case "objected":
      return `${shrank} The host was told that they owe ${owed}, and has objected: nothing is taken until you have decided. ${where}`;
    case "answered":
      return `${shrank} The host owes ${owed}; their objection was answered, and it is taken after its day. ${where}`;
    case "taking":
      return `${shrank} Stripe is being asked right now to take what the host owes for it back. ${where}`;
    case "taken":
      return `${shrank} What the host owed for it has been taken back. ${where}`;
    case "settled":
      return `${shrank} What the host owed for it was settled outside the app. ${where}`;
    case "cancelled":
      return `${shrank} The take-back for it was called off: the host owes nothing for it. ${where}`;
    default:
      return `${shrank} ${where}`;
  }
}
