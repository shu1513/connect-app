"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Props = { contributionId: string; paymentId: string; clientSecret: string; publishableKey: string; button: string };

/**
 * Whatever the browser thinks happened, the server asks Stripe for the truth and the page is drawn
 * again from what the server then knows. Returns the payment's state as the server recorded it.
 */
async function askServer(contributionId: string, paymentId: string): Promise<{ status?: string; ended?: boolean; needsAction?: boolean } | null> {
  try {
    const response = await fetch(`/api/contributions/${contributionId}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payment: paymentId }) });
    return response.ok ? await response.json().catch(() => null) : null;
  } catch {
    // The connection dropped. Nothing is known, and nothing is claimed: the callers say so and stay usable.
    return null;
  }
}

/**
 * The card form for a contribution's payment: at the card step, and for "Pay now" after a monthly
 * payment that did not go through. Stripe's own form, as memberships use it, on the payment's one
 * PaymentIntent. That the amount is only held, and whether the card is kept, was set on the server
 * when the payment was made; nothing here sets it.
 */
export function ContributionCardForm(props: Props) {
  const stripe = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  return (
    <div className="mt-4 rounded bg-white p-4">
      <Elements stripe={stripe} options={{ clientSecret: props.clientSecret }}>
        <CardForm {...props} />
      </Elements>
    </div>
  );
}

function CardForm({ contributionId, paymentId, clientSecret, button }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bankStep, setBankStep] = useState(false);

  /** Asks the server, then shows the page as the server now knows it. True when the payment is no longer waiting for a card. */
  async function tellServer(): Promise<boolean> {
    const after = await askServer(contributionId, paymentId);
    router.refresh();
    return Boolean(after && (after.status !== "to_pay" || after.ended));
  }

  // Coming back from the bank's own approval page, or a reload: the payment may already have moved on.
  useEffect(() => {
    if (!stripe) return;
    let stop = false;
    stripe.retrievePaymentIntent(clientSecret).then(({ paymentIntent }) => {
      if (stop || !paymentIntent) return;
      if (paymentIntent.status === "requires_action") setBankStep(true);
      else if (paymentIntent.status !== "requires_payment_method" && paymentIntent.status !== "requires_confirmation") void tellServer();
      else if (new URLSearchParams(window.location.search).get("redirect_status") === "failed") setError("Your bank did not approve the payment. Please try again, or use another card.");
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripe, clientSecret]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href.split("?")[0] }, redirect: "if_required" });
    if (result.error) {
      setError(result.error.message ?? "Your card could not be used. Please try another card.");
      setBusy(false);
      return;
    }
    if (!(await tellServer())) {
      setError("The payment could not be confirmed yet. Please reload the page in a moment.");
      setBusy(false);
    }
  }

  /** The bank wants the contributor's approval: finished on the same payment, never a new one. */
  async function finishBankStep() {
    if (!stripe) return;
    setBusy(true);
    setError(null);
    const result = await stripe.handleNextAction({ clientSecret });
    if (result.error) setError(result.error.message ?? "Your bank did not approve the payment. Please try again, or use another card.");
    setBankStep(false);
    await tellServer();
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit}>
      {bankStep ? (
        <>
          <p className="text-sm">Your bank wants you to approve this payment.</p>
          <button type="button" onClick={finishBankStep} disabled={!stripe || busy} className="mt-4 w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">
            {busy ? "One moment…" : "Continue to your bank"}
          </button>
        </>
      ) : (
        <>
          {/* Cards only. Stripe's "Link" extras cannot be held and charged later. */}
          <PaymentElement options={{ wallets: { link: "never" } }} />
          <button type="submit" disabled={!stripe || busy} className="mt-4 w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">
            {busy ? "One moment…" : button}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * For a page that has no card form to show (the payment is not waiting for a card): asks the
 * server once what became of the payment, and offers to ask again. A hold the app has not heard
 * of yet, and a cancellation that is not confirmed yet, are found this way.
 */
export function PaymentCheck({ contributionId, paymentId }: { contributionId: string; paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    await askServer(contributionId, paymentId);
    router.refresh();
    setBusy(false);
  }
  useEffect(() => {
    // Once, when the page is opened: asked quietly, and the page is drawn again from what the server then knows.
    void askServer(contributionId, paymentId).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contributionId, paymentId]);
  return (
    <button type="button" onClick={check} disabled={busy} className="mt-3 rounded border border-neutral-500 px-3 py-1.5 text-sm disabled:opacity-50">
      {busy ? "Checking…" : "Check again"}
    </button>
  );
}
