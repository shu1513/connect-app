"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { HostPhoto } from "@/components/host-photo";
import { LocalTime } from "@/components/local-time";
import { byDay } from "@/lib/home/rules";

const subscribe = () => () => {};

export type ListedCall = {
  id: string;
  startsAt: string;
  minutes: number;
  /** The other person, as this person knows them: a host by the name on their page. */
  name: string;
  /** The other person's photo, when they are the host and have one. */
  photoId: string | null;
  /** This person hosts the call. */
  hosting: boolean;
  /** "Open now", or nothing while the room is not open yet. */
  open: boolean;
  /** What the list says about the call's money. */
  payment: string;
};

/**
 * "Your next calls" on the home page (plans/36): the calls that are not over, the soonest first,
 * grouped by the day they start on in the person's own time zone.
 *
 * The server cannot know that zone, so the days are worked out once the page runs in the browser,
 * as `LocalTime` does for a single time. Until then the plain list is shown with full dates, so a
 * call is never put under a wrong day.
 */
export function CallsByDay({ calls, serverNow }: { calls: ListedCall[]; serverNow: string }) {
  const zone = useSyncExternalStore(
    subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
  const line = (call: ListedCall, timeOnly: boolean) => (
    <li key={call.id} className="flex items-center gap-3 border-t border-[#e7e5e4] py-3 first:border-t-0" data-call={call.id}>
      <HostPhoto photoId={call.photoId} name={call.name} small />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-base font-bold">
          {timeOnly ? (
            <time dateTime={call.startsAt}>{new Date(call.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</time>
          ) : (
            <LocalTime iso={call.startsAt} />
          )}{" "}
          · {call.name}
        </p>
        <p className="text-[#57534e]">
          {call.minutes} minutes · {call.payment}
          {call.hosting && (
            <>
              {" "}
              · <span data-hosting>You host this call</span>
            </>
          )}
          {call.open && (
            <>
              {" "}
              · <strong>Open now</strong>
            </>
          )}
        </p>
      </div>
      <Link href={`/calls/${call.id}`} className="inline-flex min-h-11 shrink-0 items-center underline underline-offset-2">
        Open
      </Link>
    </li>
  );

  if (!zone) return <ul data-days="plain">{calls.map((call) => line(call, false))}</ul>;
  const groups = byDay(
    calls.map((call) => ({ ...call, startsAt: new Date(call.startsAt), call })),
    zone,
    new Date(serverNow),
  );
  return (
    <div data-days="grouped">
      {groups.map((group) => (
        <section key={group.day} className="mt-4 first:mt-0" data-day={group.is}>
          <h3 className="text-sm font-bold text-[#9a3412]">
            {group.is === "today"
              ? "Today"
              : group.is === "tomorrow"
                ? "Tomorrow"
                : // Noon of that calendar day, read as a plain date: the name of the day never slips to a neighbour.
                  new Date(`${group.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
          </h3>
          <ul>{group.calls.map(({ call }) => line(call, true))}</ul>
        </section>
      ))}
    </div>
  );
}
