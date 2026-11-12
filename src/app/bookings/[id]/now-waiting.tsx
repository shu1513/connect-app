"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Live = { stage: string; callId: string | null; respondBy: string | null; endedReason: string | null };

const POLL_MS = 2_000;

/**
 * The customer's wait for an instant request. Asks every couple of seconds
 * where things stand; when the host accepts, goes to the call page (which
 * shows the hold being placed, then the Join button).
 */
export function NowWaiting(props: { bookingId: string; respondBy: string; hostName: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState<Live | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    let stopped = false;
    // Set when this page is left: an answer still on its way must not move the person anywhere.
    let left = false;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch(`/api/bookings/${props.bookingId}/live`, { cache: "no-store" });
        if (response.ok) {
          const next = (await response.json()) as Live;
          if (left) return;
          setLive(next);
          if (next.stage === "accepted" && next.callId) {
            stopped = true;
            router.push(`/calls/${next.callId}`);
            return;
          }
          if (next.stage !== "waiting") {
            stopped = true;
            router.refresh();
            return;
          }
        }
      } catch {
        // The next poll tries again.
      } finally {
        inFlight.current = false;
      }
    };
    const tick = async () => {
      await ask();
      if (!stopped) timer = setTimeout(tick, POLL_MS + Math.random() * 400);
    };
    timer = setTimeout(tick, POLL_MS);
    const onFocus = () => void ask();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      left = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [props.bookingId, router]);

  const seconds = Math.max(0, Math.round((new Date(live?.respondBy ?? props.respondBy).getTime() - now) / 1000));
  return (
    <section className="mt-6 rounded border-2 border-green-700 p-4" aria-live="polite">
      <p className="text-lg font-semibold">Asking {props.hostName}…</p>
      <p className="mt-1 text-sm">
        {seconds > 0 ? `They have ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} to answer.` : "Their time to answer is up; this request is ending."}{" "}
        Keep this page open: when they accept, it takes you to the call, which starts about a minute later.
      </p>
    </section>
  );
}
