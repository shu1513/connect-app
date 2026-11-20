"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** A piece of a sentence: plain words, or words to stress (src/lib/booking/book-words.ts; this panel's points name no moments). */
type Part = string | { bold: string } | { time: string };

/**
 * The words are handed in by the page: this file runs in the browser, and the sentences are kept in one place
 * for the website and the phone app (src/lib/call-page/words.ts).
 */
type Props = {
  callId: string;
  title: string;
  /** What it costs, that it is only held, what is paid for, and the cancelling rule. */
  points: Part[][];
  /** "Hold $13.33 and confirm the call" */
  button: string;
  busyWords: string;
  notHeld: string;
  notConfirmed: string;
  notStarted: string;
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
        if (!response.ok) return setError(body.error ?? props.notStarted);
        if (body.alreadyHeld) return router.refresh();
        setSetup({ stripe: loadStripe(body.publishableKey), clientSecret: body.clientSecret });
      } catch {
        if (!cancelled) setError("Could not reach the server. Check your internet connection and reload the page.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.callId, props.notStarted, router]);

  return (
    <section className="mt-6 max-w-xl rounded border border-neutral-400 p-4">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {props.points.map((point, index) => (
          <li key={index}>{point.map((part, at) => (typeof part === "string" ? part : "bold" in part ? <strong key={at}>{part.bold}</strong> : part.time))}</li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {setup ? (
        <div className="mt-4 rounded bg-white p-4">
          <Elements stripe={setup.stripe} options={{ clientSecret: setup.clientSecret }}>
            <PayForm callId={props.callId} button={props.button} busyWords={props.busyWords} notHeld={props.notHeld} notConfirmed={props.notConfirmed} />
          </Elements>
        </div>
      ) : (
        !error && <p className="mt-4 text-sm opacity-70">Loading the secure card form…</p>
      )}
    </section>
  );
}

function PayForm({ callId, button, busyWords, notHeld, notConfirmed }: { callId: string; button: string; busyWords: string; notHeld: string; notConfirmed: string }) {
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
      setError(result.error.message ?? notHeld);
      setBusy(false);
      return;
    }

    // Whatever the browser thinks happened, the server asks Stripe for the truth.
    const response = await fetch(`/api/calls/${callId}/payment/sync`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.status === "held") {
      router.refresh();
    } else {
      setError(notConfirmed);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {/* Cards only. Stripe's "Link" extras (pay by bank, Klarna) cannot be held and charged later. */}
      <PaymentElement options={{ wallets: { link: "never" } }} />
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
        {busy ? busyWords : button}
      </button>
    </form>
  );
}
