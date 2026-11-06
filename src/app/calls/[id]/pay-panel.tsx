"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Props = {
  callId: string;
  /** "$13.33" */
  bookedPrice: string;
  /** "$20.00" */
  pricePer15: string;
  /** Plain sentence describing the host's cancelling rule for this call. */
  cancelRule: string;
};

/** The customer's confirm-and-pay step. The card is entered in Stripe's own form. */
export function PayPanel(props: Props) {
  const [setup, setSetup] = useState<{ stripe: Promise<Stripe | null>; clientSecret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/calls/${props.callId}/payment/start`, { method: "POST" });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) return setError(body.error ?? "Payment could not be started.");
        if (body.alreadyHeld) return router.refresh();
        setSetup({ stripe: loadStripe(body.publishableKey), clientSecret: body.clientSecret });
      } catch {
        if (!cancelled) setError("Could not reach the server. Check your internet connection and reload the page.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.callId, router]);

  return (
    <section className="mt-6 max-w-xl rounded border border-neutral-400 p-4">
      <h2 className="text-lg font-semibold">Confirm and pay</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>
          This call costs {props.pricePer15} per 15 minutes, up to <strong>{props.bookedPrice}</strong> in total.
        </li>
        <li>
          {props.bookedPrice} is held on your card now. Nothing is charged until after the call, and you are never charged
          more than that.
        </li>
        <li>
          You pay for the time the host is in the call during the booked time.{" "}
          <strong>That includes time the host spends waiting if you are late or do not join.</strong>
        </li>
        <li>If the host is late, leaves early or does not show up, you do not pay for that time.</li>
        <li>{props.cancelRule}</li>
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {setup ? (
        <div className="mt-4 rounded bg-white p-4">
          <Elements stripe={setup.stripe} options={{ clientSecret: setup.clientSecret }}>
            <PayForm callId={props.callId} bookedPrice={props.bookedPrice} />
          </Elements>
        </div>
      ) : (
        !error && <p className="mt-4 text-sm opacity-70">Loading the secure card form…</p>
      )}
    </section>
  );
}

function PayForm({ callId, bookedPrice }: { callId: string; bookedPrice: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "Your card could not be held. Please try another card.");
      setBusy(false);
      return;
    }

    // Whatever the browser thinks happened, the server asks Stripe for the truth.
    const response = await fetch(`/api/calls/${callId}/payment/sync`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.status === "held") {
      router.refresh();
    } else {
      setError("The hold could not be confirmed yet. Please reload the page in a moment.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="mt-4 w-full rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Placing the hold…" : `Hold ${bookedPrice} and confirm the call`}
      </button>
    </form>
  );
}
