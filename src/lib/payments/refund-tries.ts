/**
 * Finding a refund on Stripe's own list of a charge's refunds, for money that is owed back as a
 * LINE and sent in TRIES: a tip's or a contribution's refund (src/lib/contributions/refund.ts) and
 * a membership's pay-back (src/lib/membership/payback.ts). Both tell Stripe the line and the try
 * with every request (`metadata.refundId`, `metadata.attempt`), so one search serves both and the
 * two cannot drift apart.
 */
import type Stripe from "stripe";
import { SEARCH_WITHIN_MS } from "./operations";
import { lookUp, stripe } from "./stripe";

/** One try of one line, and the payment at Stripe it is sent to. */
export type RefundTry = { intentId: string; refundId: string; attempt: number };

/**
 * The first refund on Stripe's complete list of a charge's refunds that is the wanted one, or undefined when the
 * list shows none. Every page: a payment can have several refunds on its one charge. A look, not the action: a "no"
 * to the look itself proves nothing and is thrown as "could not look" (`lookUp`). So is a search that took too
 * long, each page and the whole of it: a search that did not finish is never "not there".
 */
export async function refundOnStripesList(intentId: string, wanted: (refund: Stripe.Refund) => boolean): Promise<Stripe.Refund | undefined> {
  const until = Date.now() + SEARCH_WITHIN_MS;
  return lookUp(async () => {
    for await (const candidate of stripe().refunds.list({ payment_intent: intentId, limit: 100 }, { timeout: SEARCH_WITHIN_MS })) {
      if (wanted(candidate)) return candidate;
      if (Date.now() > until) throw new Error("the search through this charge's refunds took too long");
    }
    // (Also when the last page came late and held nothing: a search that ran past its time proves nothing.)
    if (Date.now() > until) throw new Error("the search through this charge's refunds took too long");
    return undefined;
  });
}

/** Whether a refund on Stripe's list is this line's and this try's. */
export const isTry = (params: Pick<RefundTry, "refundId" | "attempt">) => (refund: Stripe.Refund) => refund.metadata?.refundId === params.refundId && refund.metadata?.attempt === String(params.attempt);

/**
 * The last safeguard against paying one line twice, looked at before ANY try after the first is sent, by whoever
 * sends it: a refund that an EARLIER try of this line made at Stripe and that is not over there (failed or
 * cancelled). A new try only exists because the one before was recorded as "not made". Every way that record can
 * be wrong although each step judged rightly by what it saw (two helpers repeating at the same moment, one refused
 * and the other paid a moment later; the Stripe library sending a request a second time by itself after a closed
 * connection; a try written down before its sender had a last moment for sending it) leaves the earlier refund on
 * Stripe's list by the time the new try is due, an hour later. Then that refund is the line's refund: it is booked
 * as this try's outcome and nothing is sent.
 */
export async function earlierTryAtStripe(params: RefundTry): Promise<Stripe.Refund | undefined> {
  if (params.attempt <= 1) return undefined;
  return refundOnStripesList(params.intentId, (refund) => {
    const attempt = Number(refund.metadata?.attempt);
    return refund.metadata?.refundId === params.refundId && Number.isInteger(attempt) && attempt < params.attempt && refund.status !== "failed" && refund.status !== "canceled";
  });
}
