"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Asks the server for the page again every so often while the tab is in front, and when the
 * person comes back to it. For the pages that show who is available right now (plans/30).
 * Nothing is asked while the tab is in the background.
 */
export function RefreshEvery({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(again, seconds * 1000);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, [router, seconds]);
  return null;
}
