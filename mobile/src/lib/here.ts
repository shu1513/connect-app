import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

/**
 * Whether a screen is still there and still the one in front
 * (plans/45-phone-apps/06-asking-for-a-call.md). A screen asks this right before it does something
 * the person will see or be led by after a wait: opening the browser, showing Stripe's card sheet,
 * moving on to another screen. An answer that arrives after the person has left the screen, or
 * after somebody else has signed in (every screen is then made anew), does none of those.
 */
export function useHere(): () => boolean {
  const state = useRef({ there: false, inFront: false });
  useEffect(() => {
    const flags = state.current;
    flags.there = true;
    return () => {
      flags.there = false;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      const flags = state.current;
      flags.inFront = true;
      return () => {
        flags.inFront = false;
      };
    }, []),
  );
  return useCallback(() => state.current.there && state.current.inFront, []);
}
