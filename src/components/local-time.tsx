"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Shows a stored UTC time in the viewer's own time zone.
 * The server cannot know the viewer's zone, so it sends the UTC time and the
 * local version appears once the page is running in the browser.
 */
export function LocalTime({ iso, seconds = false }: { iso: string; seconds?: boolean }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const text = inBrowser
    ? new Date(iso).toLocaleString(undefined, {
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
