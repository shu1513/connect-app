"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Shows a stored UTC time in the viewer's own time zone.
 * The server cannot know the viewer's zone, so it sends the UTC time and the
 * local version appears once the page is running in the browser.
 */
export function LocalTime({ iso, seconds = false, year = false, dateOnly = false }: { iso: string; seconds?: boolean; year?: boolean; dateOnly?: boolean }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  // Only the day, with its year: for a day in the past that needs no time beside it ("the last on Nov 12, 2026").
  if (dateOnly) {
    return <time dateTime={iso}>{inBrowser ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : iso.slice(0, 10)}</time>;
  }

  const text = inBrowser
    ? new Date(iso).toLocaleString(undefined, {
        // Only where dates from other years stand side by side (past calls).
        year: year ? "numeric" : undefined,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: seconds ? "2-digit" : undefined,
        timeZoneName: seconds ? undefined : "short",
      })
    : iso.replace("T", " ").replace(/(\.\d+)?Z$/, " UTC");

  return <time dateTime={iso}>{text}</time>;
}
