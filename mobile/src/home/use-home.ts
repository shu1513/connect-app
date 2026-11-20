import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AppHome } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE, type Answer } from "@/lib/api-rules";
import { isHome } from "@/lib/home-rules";
import { useOpening } from "@/lib/opening";

/**
 * The home page's data, and when it is asked for again
 * (plans/45-phone-apps/04-the-home-page.md, decisions 1, 2 and 5): when the page opens, when the
 * day in view changes, when the page is pulled down, when the app comes back to the front, and
 * every minute while the page is in front.
 *
 * When a newer answer does not come because Connect cannot be reached, what is on the screen
 * stays, with a line saying so. When the server refuses (the sign-in ran out, "18 and terms" is
 * to do again, this copy is too old), everything is taken off the screen at once: it was shown to
 * someone the server no longer takes for that person. The opening question then says where they
 * belong.
 *
 * Reading the home page never makes suggestions. When the answer says today's have not been made,
 * the app asks for that in a step of its own, and then reads again.
 */
export function useHome(day: string | null) {
  const { refresh: askOpening } = useOpening();
  const [home, setHome] = useState<AppHome | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  /** How many questions are under way. */
  const [asking, setAsking] = useState(0);
  /** Only the newest question counts. */
  const newest = useRef(0);

  /**
   * What a refusal does, whichever request of the page met it (reading the page, a step of the
   * suggestions): the page is emptied at once, any answer still on its way no longer counts, and
   * the opening question is asked. True when the answer was a refusal.
   */
  const refused = useCallback(
    (answer: Answer<unknown>): boolean => {
      if (answer.ok || answer.code === "unreachable") return false;
      newest.current++;
      setHome(null);
      setProblem(answer.message);
      void askOpening();
      return true;
    },
    [askOpening],
  );

  const load = useCallback(async () => {
    const mine = ++newest.current;
    const read = () => ask<AppHome>(`/api/app/home${day ? `?day=${day}` : ""}`);
    setAsking((count) => count + 1);
    try {
      let answer = await read();
      if (mine !== newest.current) return;
      if (refused(answer)) return;
      if (!(answer.ok && isHome(answer.data))) {
        setProblem(answer.ok ? UNREACHABLE : answer.message);
        return;
      }
      setHome(answer.data);
      setProblem(null);
      // Today's suggestions have not been made: asked for in a step of its own, then read again. (Once made, the
      // server says so from then on, so this happens once a day; if the step fails it is tried again with the next reading.)
      const suggested = answer.data.suggested;
      if (!suggested || suggested.made) return;
      const made = await ask("/api/app/suggestions/make", { body: {} });
      if (mine !== newest.current || refused(made) || !made.ok) return;
      answer = await read();
      if (mine !== newest.current || refused(answer)) return;
      if (answer.ok && isHome(answer.data)) setHome(answer.data);
    } finally {
      setAsking((count) => count - 1);
    }
  }, [day, refused]);

  // While the page is in front: now, on coming back to the app, and every so often.
  const every = home?.refreshSeconds ?? 60;
  useFocusEffect(
    useCallback(() => {
      void load();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") void load();
      });
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void load();
      }, Math.max(every, 15) * 1000);
      return () => {
        listener.remove();
        clearInterval(timer);
      };
    }, [load, every]),
  );

  // A new question is under way whenever the day changes; an older answer for another day no longer counts.
  useEffect(() => () => void newest.current++, [day]);

  const pull = useCallback(async () => {
    setPulling(true);
    await load();
    setPulling(false);
  }, [load]);

  return { home, problem, pulling, pull, reload: load, asking: asking > 0, refused };
}
