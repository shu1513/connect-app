"use client";

import { useEffect, useRef } from "react";

/** A list of time zones. When nothing is saved yet, it starts on the browser's own time zone. */
export function TimeZoneSelect({ zones, saved }: { zones: string[]; saved: string | null }) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (saved || !ref.current) return;
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zones.includes(guess)) ref.current.value = guess;
  }, [saved, zones]);

  return (
    <select
      ref={ref}
      name="timeZone"
      defaultValue={saved ?? "America/New_York"}
      required
      className="mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2"
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
