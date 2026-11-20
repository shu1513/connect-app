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
import { isStart, openingAfter, signedOut, type Opening } from "./opening-rules";
import { forgetPhotos } from "./photos";

type Value = {
  opening: Opening;
  /** "Try again", pressed by the person. */
  askAgain: () => void;
  /** Asks again quietly, after something changed who is signed in or what stands in the way. Gives back the server's answer. */
  refresh: () => Promise<Answer<AppStart>>;
  /** Called when someone starts to sign in: an answer still on its way, asked for whoever was there before, no longer counts. */
  forgetQuestions: () => void;
  /** Signs out. The app shows nobody signed in at once, whether or not the server can be reached. False, and nothing changed, in the rare case that this phone could not do its own part. */
  leave: () => Promise<boolean>;
};
const OpeningContext = createContext<Value>({ opening: { kind: "asking" }, askAgain: () => {}, refresh: async () => ({ ok: false, code: "unreachable", message: "" }), forgetQuestions: () => {}, leave: async () => false });

export function OpeningProvider({ children }: { children: ReactNode }) {
  const [opening, setOpening] = useState<Opening>({ kind: "asking" });
  /** Only the newest question counts: a slow answer to an older one must not overwrite a newer answer. */
  const newest = useRef(0);
  /** Who the server last said is signed in (null: nobody; undefined: not known yet). */
  const who = useRef<string | null | undefined>(undefined);

  /** Puts the question, quietly: what is on the screen stays until the answer is in. */
  const put = useCallback(async (renewNow = false) => {
    const mine = ++newest.current;
    // First the phone's own request that keeps the sign-in alive (part 01, decision 2), then the question.
    await renewSignIn(renewNow);
    const answer = await ask<AppStart>("/api/app/start");
    if (mine === newest.current) {
      // A whole answer says who is signed in. When that is someone else than before, what the app kept for the
      // person before (photos) is dropped here, before any screen for the new person is drawn.
      if (answer.ok && isStart(answer.data)) {
        const now = answer.data.me?.id ?? null;
        if (who.current !== undefined && who.current !== now) forgetPhotos();
        who.current = now;
      }
      setOpening((now) => openingAfter(now, answer));
    }
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
  const forgetQuestions = useCallback(() => {
    newest.current++;
  }, []);

  const leave = useCallback(async () => {
    // An answer still on its way was asked as the person who is leaving: it no longer counts.
    newest.current++;
    // From here on the app asks as nobody, and the phone remembers that a sign-out is under way: first, before the screen changes.
    const begun = await startLeaving();
    if (!begun) return false;
    forgetPhotos();
    who.current = null;
    setOpening(signedOut);
    // "finished": the phone could not note the sign-out, so all of it was done before the screen changed.
    if (begun === "noted") await signOut();
    await put();
    return true;
  }, [put]);

  return <OpeningContext.Provider value={{ opening, askAgain, refresh, forgetQuestions, leave }}>{children}</OpeningContext.Provider>;
}

export function useOpening(): Value {
  return useContext(OpeningContext);
}

/** What the server said when the app opened. Only for screens shown once the app is ready. */
export function useStart(): AppStart | null {
  const { opening } = useOpening();
  return opening.kind === "ready" ? opening.start : null;
}
