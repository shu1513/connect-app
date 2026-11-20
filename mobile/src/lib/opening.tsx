/**
 * The app's first question to the server, asked when it opens and whenever it comes back to the
 * front, and its answer for every screen to read (plans/45-phone-apps/02-the-frame.md).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { AppStart } from "../../../src/lib/app-door/types";
import { ask } from "./api";
import { openingAfter, type Opening } from "./opening-rules";

type Value = { opening: Opening; askAgain: () => void };
const OpeningContext = createContext<Value>({ opening: { kind: "asking" }, askAgain: () => {} });

export function OpeningProvider({ children }: { children: ReactNode }) {
  const [opening, setOpening] = useState<Opening>({ kind: "asking" });
  /** Only the newest question counts: a slow answer to an older one must not overwrite a newer answer. */
  const newest = useRef(0);

  /** Puts the question, quietly: what is on the screen stays until the answer is in. */
  const put = useCallback(() => {
    const mine = ++newest.current;
    void ask<AppStart>("/api/app/start").then((answer) => {
      if (mine === newest.current) setOpening((now) => openingAfter(now, answer));
    });
  }, []);

  useEffect(() => {
    // On opening, the app already shows "asking".
    put();
    // Coming back to the front: ask again.
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") put();
    });
    return () => listener.remove();
  }, [put]);

  /** "Try again", pressed by the person: say that the app is asking, then ask. */
  const askAgain = useCallback(() => {
    setOpening({ kind: "asking" });
    put();
  }, [put]);

  return <OpeningContext.Provider value={{ opening, askAgain }}>{children}</OpeningContext.Provider>;
}

export function useOpening(): Value {
  return useContext(OpeningContext);
}

/** What the server said when the app opened. Only for screens shown once the app is ready. */
export function useStart(): AppStart | null {
  const { opening } = useOpening();
  return opening.kind === "ready" ? opening.start : null;
}
