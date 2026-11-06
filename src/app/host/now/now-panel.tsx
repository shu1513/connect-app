"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Request = { id: string; customerName: string; lengthMinutes: number; totalCents: number; respondBy: string };
type Live = { on: boolean; availableUntil: string | null; requests: Request[] };

const POLL_MS = 3_000;
const HEARTBEAT_MS = 15_000;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function secondsLeft(iso: string, now: number): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

/**
 * The host's live "Available now" panel. While it is open and availability is
 * on, it tells the server every 15 seconds that the host is still here, and
 * asks every 3 seconds whether anyone is waiting. Closing the tab ends
 * availability by itself (the sign of life stops).
 */
export function NowPanel(props: { initial: Live; durations: readonly number[] }) {
  const router = useRouter();
  const [live, setLive] = useState<Live>(props.initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/host/now", { cache: "no-store" });
      if (response.ok) setLive((await response.json()) as Live);
    } catch {
      // The next poll tries again.
    } finally {
      inFlight.current = false;
    }
  }, []);

  // The clock for the countdowns.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Polling, with a little jitter so many hosts do not all ask at once, and a refresh when the tab comes back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, POLL_MS + Math.random() * 500);
    };
    timer = setTimeout(tick, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  // The sign of life, only while on.
  useEffect(() => {
    if (!live.on) return;
    const beat = () => void fetch("/api/host/now", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ heartbeat: true }) }).catch(() => undefined);
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [live.on]);

  async function setAvailability(minutes: number | null) {
    setBusy("availability");
    setProblem(null);
    try {
      const response = await fetch("/api/host/now", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ minutes }) });
      const body = (await response.json()) as Partial<Live> & { error?: string };
      if (!response.ok) setProblem(body.error ?? "Something went wrong.");
      else setLive((current) => ({ ...current, on: Boolean(body.on), availableUntil: body.availableUntil ?? null }));
    } catch {
      setProblem("Could not reach Connect. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function answer(id: string, what: "accept" | "decline") {
    setBusy(id);
    setProblem(null);
    try {
      const response = await fetch(`/api/bookings/${id}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: what }) });
      const body = (await response.json()) as { callId?: string; error?: string };
      if (!response.ok) {
        setProblem(body.error ?? "Something went wrong.");
        await refresh();
      } else if (what === "accept" && body.callId) {
        router.push(`/calls/${body.callId}`);
        return;
      } else {
        await refresh();
      }
    } catch {
      setProblem("Could not reach Connect. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const left = live.availableUntil ? secondsLeft(live.availableUntil, now) : 0;

  return (
    <div>
      {problem && (
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {problem}
        </p>
      )}

      <section className="mt-6 rounded border border-neutral-400 p-4">
        {live.on ? (
          <>
            <p className="text-lg font-semibold">
              <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600" />
              You are available now
            </p>
            <p className="mt-1 text-sm opacity-80">
              For another {Math.floor(left / 60)} min {left % 60} s. Keep this page open: closing it switches this off.
            </p>
            <button type="button" onClick={() => setAvailability(null)} disabled={busy === "availability"} className="mt-3 rounded border border-neutral-500 px-3 py-1.5 text-sm">
              I am no longer available
            </button>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">You are not available right now</p>
            <p className="mt-1 text-sm opacity-80">Say for how long. Your page then shows &quot;Available now&quot; and people can ask for a call right away.</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {props.durations.map((minutes) => (
                <button key={minutes} type="button" onClick={() => setAvailability(minutes)} disabled={busy === "availability"} className="rounded bg-green-700 px-3 py-1.5 font-medium text-white">
                  Available for {minutes >= 60 ? `${minutes / 60} hour${minutes > 60 ? "s" : ""}` : `${minutes} minutes`}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-6" aria-live="polite">
        <h2 className="text-lg font-semibold">Asking for a call now ({live.requests.length})</h2>
        {live.requests.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">{live.on ? "Nobody yet. This page updates by itself." : "Switch on availability to receive requests."}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {live.requests.map((request) => {
              const seconds = secondsLeft(request.respondBy, now);
              return (
                <li key={request.id} className="rounded border-2 border-green-700 p-4">
                  <p className="text-lg font-semibold">
                    {request.customerName} — {request.lengthMinutes} minutes{request.totalCents > 0 ? `, ${money(request.totalCents)}` : ", free"}
                  </p>
                  <p className="mt-1 text-sm opacity-80">
                    {seconds > 0 ? `Answer within ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}. ` : "Time is up; this request is ending. "}
                    Accepting starts the call in about a minute and takes you to it.
                  </p>
                  <div className="mt-3 flex gap-3 text-sm">
                    <button type="button" onClick={() => answer(request.id, "accept")} disabled={busy !== null} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                      Accept and start
                    </button>
                    <button type="button" onClick={() => answer(request.id, "decline")} disabled={busy !== null} className="rounded border border-neutral-500 px-4 py-2">
                      Decline
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
