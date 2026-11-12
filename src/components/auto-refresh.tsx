"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the page's data every so often, for pages where something is expected to change without the person doing anything. */
export function AutoRefresh({ everySeconds }: { everySeconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everySeconds * 1000);
    return () => clearInterval(timer);
  }, [router, everySeconds]);
  return null;
}
