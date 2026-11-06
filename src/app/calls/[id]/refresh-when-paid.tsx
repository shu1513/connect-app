"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 2_000;
const GIVE_UP_MS = 5 * 60_000;

/**
 * While a call's money is being held (an instant call right after acceptance,
 * or a booked call about to start), asks every couple of seconds whether the
 * payment has moved on, and reloads the page when it has: the customer sees
 * the Join button instead of a card form that is no longer needed, and the
 * host stops seeing "waiting for the customer to pay".
 */
export function RefreshWhenPaid(props: { callId: string; paymentStatus: string }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/calls/${props.callId}/live`, { cache: "no-store" });
        if (response.ok) {
          const live = (await response.json()) as { paymentStatus: string | null; cancelled: boolean; safetyEnded: boolean };
          if (live.cancelled || live.safetyEnded || (live.paymentStatus && live.paymentStatus !== props.paymentStatus)) {
            stopped = true;
            router.refresh();
            return;
          }
        }
      } catch {
        // The next ask tries again.
      } finally {
        inFlight = false;
      }
    };
    const tick = async () => {
      await ask();
      if (!stopped && Date.now() - started < GIVE_UP_MS) timer = setTimeout(tick, POLL_MS + Math.random() * 400);
    };
    timer = setTimeout(tick, POLL_MS);
    const onFocus = () => void ask();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [props.callId, props.paymentStatus, router]);
  return null;
}
