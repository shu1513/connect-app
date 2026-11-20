"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { warm } from "@/components/warm-ui";
import { OPEN_EARLY_SECONDS } from "@/lib/calls";
import { formatDuration } from "@/lib/format";
import { agoWords, countdownWords } from "@/lib/home/rules";

/**
 * The countdown on the home page's "Your next call" (plans/36): how long until the room of this
 * call can be entered, and the way in once the server says it is open.
 *
 * It follows the server's clock. The server sends its own time with the page (`serverNow`); from
 * there this only counts the time that passes, with the browser's steady counter, which does not
 * jump when the device's clock is changed. Every time the page is asked for again, the server's
 * time comes fresh and the count starts from it again.
 *
 * It never decides by itself that a room is open. At zero it says "Checking…" and asks the server
 * for the page again; the button "Enter the room" is drawn only from the server's own answer
 * (`open`). And the button is only a link: the call's page decides who may enter.
 */
export function Countdown(props: {
  callId: string;
  /** The server's time when the page was drawn. */
  serverNow: string;
  opensAt: string;
  startsAt: string;
  endsAt: string;
  /** The server's answer, when the page was drawn: the room can be entered. */
  open: boolean;
  /** The call is waiting for its payment: its page asks for that first. */
  notPaid: boolean;
}) {
  const router = useRouter();
  const drawnAt = Date.parse(props.serverNow);
  // The server's time as far as this page knows it. Until the page runs in the browser, the time it was drawn.
  const [now, setNow] = useState(drawnAt);
  useEffect(() => {
    const startedAt = performance.now();
    const update = () => setNow(drawnAt + (performance.now() - startedAt));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [drawnAt]);

  const opensAt = Date.parse(props.opensAt);
  const startsAt = Date.parse(props.startsAt);
  const endsAt = Date.parse(props.endsAt);
  // The room should be open by now and the server has not said so yet, or the call's booked end has
  // passed: the server is asked once for each, for this call. (A new answer comes with a new `serverNow`.)
  const due = now >= endsAt ? "ended" : !props.open && now >= opensAt ? "opened" : null;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!due) return;
    const key = `${props.callId}:${due}:${props.serverNow}`;
    if (asked.current === key) return;
    asked.current = key;
    router.refresh();
  }, [due, props.callId, props.serverNow, router]);

  const href = `/calls/${props.callId}`;
  if (due === "ended") {
    return (
      <p className="mt-4 text-[#57534e]" data-countdown="checking" role="status">
        Checking…
      </p>
    );
  }
  if (props.open) {
    const untilStart = (startsAt - now) / 1000;
    return (
      <div className="mt-4" data-countdown="open">
        <p className="text-lg font-bold">The room is open</p>
        <p className="mt-1 text-sm text-[#57534e]">{untilStart > 0 ? `The call starts in ${formatDuration(untilStart)}.` : `The booked start was ${agoWords(-untilStart)}.`}</p>
        <p className="mt-4">
          <Link href={href} className={props.notPaid ? warm.secondary : warm.button} data-enter={props.notPaid ? "not-paid" : "open"}>
            {props.notPaid ? "Open the call" : "Enter the room"}
          </Link>
        </p>
      </div>
    );
  }
  const words = countdownWords((opensAt - now) / 1000);
  return (
    <div className="mt-4" data-countdown={words ? "waiting" : "checking"}>
      {words ? (
        <>
          <p className="text-sm text-[#57534e]">You can enter</p>
          <p className={`font-extrabold tabular-nums ${words.everySecond ? "text-[40px] leading-tight" : "text-2xl"}`} role="timer" aria-live="off">
            {words.everySecond ? `in ${words.text}` : words.text}
          </p>
        </>
      ) : (
        <p className="text-[#57534e]" role="status">
          Checking…
        </p>
      )}
      <p className="mt-1 text-sm text-[#78716c]">The room opens {OPEN_EARLY_SECONDS / 60} minutes before the start.</p>
      <p className="mt-4">
        <Link href={href} className={warm.secondary} data-enter="not-open">
          Open the call
        </Link>
      </p>
    </div>
  );
}
