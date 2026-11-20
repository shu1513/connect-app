import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

/**
 * Whether a screen is still there and still the one in front, without a break, since something
 * was begun on it (plans/45-phone-apps/06-asking-for-a-call.md). A screen takes a watch as a step
 * begins, and asks it right before each thing the person will see or be led by after a wait:
 * opening the browser, showing Stripe's card sheet, moving on to another screen.
 *
 * The watch says no once the person has left the screen, even if they have come back to it since,
 * and once somebody else has signed in (every screen is then made anew). An answer that arrives
 * after that does none of those things. (What is in front is the screen of the app's own
 * navigation: a question box or Stripe's sheet over the screen does not count as leaving it.)
 */
export function useWatch(): () => () => boolean {
  const state = useRef({ there: false, inFront: false, period: 0 });
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
      flags.period++;
      return () => {
        flags.inFront = false;
        flags.period++;
      };
    }, []),
  );
  return useCallback(() => {
    const flags = state.current;
    const began = flags.period;
    return () => flags.there && flags.inFront && flags.period === began;
  }, []);
}
