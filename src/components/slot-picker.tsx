"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * The open times, shown day by day in the visitor's own time zone. The server
 * cannot know that zone, so it sends exact moments and the browser writes
 * them out.
 */
export function SlotPicker({ starts, hrefBase }: { starts: string[]; hrefBase: string }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  // A host with long hours has a lot of open times. Show a few days, and more on request.
  const [daysShown, setDaysShown] = useState(4);
  if (!inBrowser) return <p className="mt-4 text-sm opacity-70">Loading the open times…</p>;

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = new Map<string, string[]>();
  for (const iso of starts) {
    const day = new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    days.set(day, [...(days.get(day) ?? []), iso]);
  }

  return (
    <div className="mt-4">
      <p className="text-sm opacity-70">Times are shown in your time zone ({zone.replace(/_/g, " ")}).</p>
      <ul className="mt-3 space-y-4">
        {[...days].slice(0, daysShown).map(([day, times]) => (
          <li key={day}>
            <p className="text-sm font-medium">{day}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {times.map((iso) => (
                <Link key={iso} href={`${hrefBase}&start=${encodeURIComponent(iso)}`} className="rounded border border-neutral-500 px-3 py-1.5 text-sm hover:bg-blue-600 hover:text-white">
                  {new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {days.size > daysShown && (
        <button type="button" onClick={() => setDaysShown(daysShown + 7)} className="mt-4 text-sm underline underline-offset-2">
          Show more days
        </button>
      )}
    </div>
  );
}
