"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/**
 * The customer saves a card for a paid request, in Stripe's own form.
 * Nothing is held or charged by this step.
 */
export function CardStep({ bookingId, clientSecret, publishableKey }: { bookingId: string; clientSecret: string; publishableKey: string }) {
  const stripe = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <div className="mt-4 rounded bg-white p-4">
      <Elements stripe={stripe} options={{ clientSecret }}>
        <CardForm bookingId={bookingId} clientSecret={clientSecret} />
      </Elements>
    </div>
  );
}

function CardForm({ bookingId, clientSecret }: { bookingId: string; clientSecret: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whatever the browser thinks happened, the server asks Stripe for the truth.
  async function tellServer() {
    const response = await fetch(`/api/bookings/${bookingId}/card-saved`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.stage !== "card") {
      router.refresh();
      return true;
    }
    return false;
  }

  // Coming back from the bank's own approval page: the card may already be saved.
  useEffect(() => {
    if (!stripe) return;
    let stop = false;
    stripe.retrieveSetupIntent(clientSecret).then(({ setupIntent }) => {
      if (!stop && setupIntent?.status === "succeeded") void tellServer();
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
    const result = await stripe.confirmSetup({ elements, confirmParams: { return_url: window.location.href }, redirect: "if_required" });
    if (result.error) {
      setError(result.error.message ?? "Your card could not be saved. Please try another card.");
      setBusy(false);
      return;
    }
    if (!(await tellServer())) {
      setError("Your card could not be confirmed yet. Please reload the page in a moment.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {/* Cards only. Stripe's "Link" extras cannot be held and charged later. */}
      <PaymentElement options={{ wallets: { link: "never" } }} />
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={!stripe || busy} className="mt-4 w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">
        {busy ? "Saving your card…" : "Save card and send request"}
      </button>
    </form>
  );
}
