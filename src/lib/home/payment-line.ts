import type { Payment } from "@/db/schema";
import { formatMoney } from "@/lib/payments/access";

/**
 * What a list of calls says about a call's money. Whether the call is free or still unpaid is read
 * from its own payment; what is held and what was charged are added up over every payment of the
 * call, each on its own (the call's own payment can end uncharged while added time was charged).
 */
export function paymentLine(all: Payment[]): string {
  const own = all.find((p) => p.extensionId === null);
  if (!own) return "Free";
  if (own.status === "awaiting_payment") return `${formatMoney(own.bookedCents)}, not paid yet`;
  const charged = all.filter((p) => p.status === "charged");
  const held = all.filter((p) => p.status === "held");
  const parts: string[] = [];
  // A call booked with a membership is paid from the member's month: nothing is held or charged on a card for it.
  const fromMembership = own.kind === "member_call";
  // Each kind on its own: time added to a member's call can be paid by card, and that part is a card charge like any other.
  const paid = (some: Payment[]) => formatMoney(some.reduce((sum, p) => sum + (p.chargedCents ?? 0) - p.refundedCents, 0));
  const booked = (some: Payment[]) => formatMoney(some.reduce((sum, p) => sum + p.bookedCents, 0));
  const fromMonth = (p: Payment) => p.kind === "member_call";
  const byCard = (p: Payment) => p.kind !== "member_call";
  if (charged.some(fromMonth)) parts.push(`Paid from the membership: ${paid(charged.filter(fromMonth))}`);
  if (charged.some(byCard)) parts.push(`Charged ${paid(charged.filter(byCard))}${fromMembership ? " by card" : ""}`);
  if (held.some(fromMonth)) parts.push(`${booked(held.filter(fromMonth))} of membership time set aside`);
  if (held.some(byCard)) parts.push(`${booked(held.filter(byCard))} held${fromMembership ? " on the card" : ""}`);
  if (held.some((p) => p.needsReview)) parts.push("needs review");
  return parts.length > 0 ? parts.join(", ") : fromMembership ? "Nothing used from the membership" : "Not charged";
}

/** The call is waiting for its payment: its page asks for that before anyone can enter. */
export function notPaidYet(all: Payment[]): boolean {
  return all.find((p) => p.extensionId === null)?.status === "awaiting_payment";
}

/** Every payment of each of these calls: its own, and one for each time more time was added during it. */
export function paymentsByCall(payments: Payment[]): Map<string, Payment[]> {
  const byCall = new Map<string, Payment[]>();
  for (const payment of payments) {
    // Asked for by call, so each has one; a payment without a call (expired member time) is never listed.
    if (payment.callId) byCall.set(payment.callId, [...(byCall.get(payment.callId) ?? []), payment]);
  }
  return byCall;
}
