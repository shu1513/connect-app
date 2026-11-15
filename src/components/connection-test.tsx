"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WORDS, type Answer } from "@/lib/connection/answer";
import { runConnectionTest, type RunningTest } from "@/lib/connection/run-test";

/** No test starts by itself within this long of the last one finishing. */
const NOT_AGAIN_FOR_MS = 15 * 60_000;
/** Two small notes kept in this browser tab only, never on the server. The answer itself is not kept, even there. */
const LAST_FINISHED = "connect:connection-test:finished";
const joinedKey = (callId: string) => `connect:connection-test:joined:${callId}`;
/** The call screen says so the moment the person presses "Join" (see call-room.tsx). */
export const JOINING_EVENT = "connect:joining";

function note(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null; // a browser that will not keep notes: the test may simply run again
  }
}
function keep(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Joining and testing never depend on this.
  }
}

/**
 * "Test your connection": a short check of this device's connection to the
 * video service, with a plain answer and a tip. It only ever warns; it never
 * stops anyone from joining, and nobody else sees the answer.
 *
 * On a call's page it starts by itself, once, and pressing "Join" stops it at
 * once. It does not start by itself again within 15 minutes of the last test,
 * or on a call the person has already joined.
 */
export function ConnectionTest({ callId, auto }: { callId?: string; auto: boolean }) {
  const [state, setState] = useState<"idle" | "testing" | "joined" | Answer>("idle");
  const running = useRef<RunningTest | null>(null);

  const start = useCallback(() => {
    running.current?.stop();
    const test = runConnectionTest();
    running.current = test;
    setState("testing");
    void test.result.then((answer) => {
      if (running.current !== test) return; // stopped and replaced meanwhile
      running.current = null;
      if (answer === null) return;
      keep(LAST_FINISHED, String(Date.now()));
      setState(answer);
    });
  }, []);

  useEffect(() => {
    const last = Number(note(LAST_FINISHED));
    const recently = Number.isFinite(last) && last > 0 && Date.now() - last < NOT_AGAIN_FOR_MS;
    const alreadyJoined = callId ? note(joinedKey(callId)) === "1" : false;
    const first = auto && !recently && !alreadyJoined ? setTimeout(start, 0) : null;

    // Joining never waits for the test: the moment "Join" is pressed, the test is over.
    const onJoining = () => {
      running.current?.stop();
      running.current = null;
      if (callId) keep(joinedKey(callId), "1");
      setState("joined");
    };
    window.addEventListener(JOINING_EVENT, onJoining);
    return () => {
      if (first) clearTimeout(first);
      window.removeEventListener(JOINING_EVENT, onJoining);
      running.current?.stop();
      running.current = null;
    };
  }, [auto, callId, start]);

  // In the call, and after dropping out of it, nothing about the test is shown.
  if (state === "joined") return null;

  return (
    <section className="mt-4 rounded border border-neutral-400/60 p-3 text-sm" aria-live="polite" data-connection-test={state}>
      {state === "idle" && (
        <p>
          <button type="button" onClick={start} className="underline underline-offset-2">
            Test your connection
          </button>{" "}
          <span className="opacity-70">(about 12 seconds; it does not use your camera or microphone)</span>
        </p>
      )}
      {state === "testing" && <p className="opacity-80">Testing your connection… This takes about 12 seconds. You do not have to wait for it.</p>}
      {state !== "idle" && state !== "testing" && (
        <>
          <p className={state === "weak" || state === "no_connection" ? "font-medium text-amber-700" : "font-medium"}>{WORDS[state].title}</p>
          <p className="mt-1 opacity-80">{WORDS[state].tip}</p>
          <button type="button" onClick={start} className="mt-2 underline underline-offset-2">
            Test again
          </button>
        </>
      )}
    </section>
  );
}
