/**
 * The app's first question to the server, asked when it opens and whenever it comes back to the
 * front, and its answer for every screen to read (plans/45-phone-apps/02-the-frame.md).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { AppStart } from "../../../src/lib/app-door/types";
import { ask } from "./api";
import type { Answer } from "./api-rules";
import { RENEW_LOOK_MS, renewSignIn, signOut, startLeaving } from "./auth";
import { openingAfter, signedOut, type Opening } from "./opening-rules";

type Value = {
  opening: Opening;
  /** "Try again", pressed by the person. */
  askAgain: () => void;
  /** Asks again quietly, after something changed who is signed in or what stands in the way. Gives back the server's answer. */
  refresh: () => Promise<Answer<AppStart>>;
  /** Signs out. The app shows nobody signed in at once, whether or not the server can be reached. False, and nothing changed, in the rare case that this phone could not do its own part. */
  leave: () => Promise<boolean>;
};
const OpeningContext = createContext<Value>({ opening: { kind: "asking" }, askAgain: () => {}, refresh: async () => ({ ok: false, code: "unreachable", message: "" }), leave: async () => false });

export function OpeningProvider({ children }: { children: ReactNode }) {
  const [opening, setOpening] = useState<Opening>({ kind: "asking" });
  /** Only the newest question counts: a slow answer to an older one must not overwrite a newer answer. */
  const newest = useRef(0);

  /** Puts the question, quietly: what is on the screen stays until the answer is in. */
  const put = useCallback(async (renewNow = false) => {
    const mine = ++newest.current;
    // First the phone's own request that keeps the sign-in alive (part 01, decision 2), then the question.
    await renewSignIn(renewNow);
    const answer = await ask<AppStart>("/api/app/start");
    if (mine === newest.current) setOpening((now) => openingAfter(now, answer));
    return answer;
  }, []);

  useEffect(() => {
    // On opening, the app already shows "asking".
    void put(true);
    // Coming back to the front: ask again.
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void put();
    });
    // While the app stays open: keep the sign-in alive.
    const timer = setInterval(() => void renewSignIn(), RENEW_LOOK_MS);
    return () => {
      listener.remove();
      clearInterval(timer);
    };
  }, [put]);

  /** "Try again", pressed by the person: say that the app is asking, then ask. */
  const askAgain = useCallback(() => {
    setOpening({ kind: "asking" });
    void put();
  }, [put]);

  const refresh = useCallback(() => put(), [put]);

  const leave = useCallback(async () => {
    // An answer still on its way was asked as the person who is leaving: it no longer counts.
    newest.current++;
    // From here on the app asks as nobody, and the phone remembers that a sign-out is under way: first, before the screen changes.
    if (!(await startLeaving())) return false;
    setOpening(signedOut);
    await signOut();
    await put();
    return true;
  }, [put]);

  return <OpeningContext.Provider value={{ opening, askAgain, refresh, leave }}>{children}</OpeningContext.Provider>;
}

export function useOpening(): Value {
  return useContext(OpeningContext);
}

/** What the server said when the app opened. Only for screens shown once the app is ready. */
export function useStart(): AppStart | null {
  const { opening } = useOpening();
  return opening.kind === "ready" ? opening.start : null;
}
