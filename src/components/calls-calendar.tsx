"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { CallRow, type ListedCall } from "@/components/call-row";
import { type Ask, CALENDAR, daysInView, dayToMoveTo, dollars, hostedTotal, hoursToDraw, inLanes, minuteOfDay, segmentsOf, weekStartFrom } from "@/lib/home/calendar";
import { dayAfter, dayOf } from "@/lib/home/rules";

const never = () => () => {};
/** Wide enough for seven days side by side. Narrower, three. */
const WIDE = "(min-width: 720px)";
const watchWidth = (changed: () => void) => {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
};

/** The first day of the week in the browser's language (0 Sunday, 1 Monday, …); Sunday when the browser cannot say. */
function weekStart(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay?: number }; weekInfo?: { firstDay?: number } };
    return weekStartFrom(locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay);
  } catch {
    return 0;
  }
}

/** Noon of a calendar day, read as a plain date: its name never slips to a neighbour. */
const plain = (day: string) => new Date(`${day}T12:00:00Z`);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * "Your calendar" on the home page (plans/43-calendar-on-the-home-page.md): the days across, the
 * hours down, and a block for every call at its time. The calls this person hosts, the calls they
 * booked, and the calls that are over (with what a hosted one earned) each have their look, named
 * in words under the calendar. Tapping a call shows its row underneath. A time people have asked
 * her for and she has not answered is a dashed block that leads to the requests; a line says what
 * the calls she hosted in these days earned together; a red line marks "now" in today's column.
 *
 * Seven days in a wide window, three in a narrow one (the calendar's own width follows the window's). The arrows are links: the day is in the
 * page's address, so the back button works and the page's own refresh stays where it is.
 *
 * The server cannot know the viewer's time zone, the first day of their week or the width of
 * their screen, so it sends the calls of the days around the day asked for and everything is laid
 * out here, once the page runs in the browser. Until then the plain list of the calls that are
 * not over is shown, so a call is never put under a wrong day.
 *
 * It draws what it is given and decides nothing about who may see what: each call arrives with
 * exactly the words and numbers for the person looking. Which call is chosen is remembered by its
 * id only, so what is shown about it is always what the server sent last.
 */
export function CallsCalendar({ calls, asks, serverNow, day, nextId, cut }: { calls: ListedCall[]; asks: Ask[]; serverNow: string; day: string | null; nextId: string | null; cut: boolean }) {
  const zone = useSyncExternalStore(
    never,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
  const wide = useSyncExternalStore(
    watchWidth,
    () => window.matchMedia(WIDE).matches,
    () => null,
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");

  if (!zone || wide === null) {
    // The details of the next call are in the card above, once: its row here goes without them.
    const coming = calls.filter((call) => !call.finished).map((call) => (call.id === nextId ? { ...call, about: undefined } : call));
    return (
      <>
        <ul data-days="plain">
          {coming.map((call) => (
            <CallRow key={call.id} call={call} timeOnly={false} />
          ))}
        </ul>
        {/* This list is only the coming days: the page loads the calls around the day in view, not every call. It is said
            here, for the moment before the calendar is drawn, and for a browser in which it never is. */}
        <p className="mt-2 text-sm text-[#57534e]" data-days-note>
          {coming.length > 0 && "These are your calls of the coming days. "}The calendar, which shows every week, appears here once the page has finished loading.
        </p>
      </>
    );
  }

  const columns = wide ? 7 : 3;
  const today = dayOf(new Date(serverNow), zone);
  const shown = day ?? today;
  const days = daysInView(shown, columns, weekStart());
  const segments = segmentsOf(
    calls.map((call) => ({ call, startsAt: new Date(call.startsAt), endsAt: new Date(call.endsAt) })),
    days,
    zone,
  );
  // The times people have asked her for and she has not answered: a block each, with how many asked.
  const askSegments = segmentsOf(
    asks.map((ask) => ({ ask, startsAt: new Date(ask.startsAt), endsAt: new Date(ask.endsAt) })),
    days,
    zone,
  );
  // Calls and asked-for times together, so two that would cover each other stand side by side.
  const pieces: Array<{ day: string; from: number; to: number; call: ListedCall | null; ask: Ask | null }> = [
    ...segments.map((segment) => ({ day: segment.day, from: segment.from, to: segment.to, call: segment.call.call, ask: null })),
    ...askSegments.map((segment) => ({ day: segment.day, from: segment.from, to: segment.to, call: null, ask: segment.call.ask })),
  ];
  const hours = hoursToDraw(pieces);
  const height = (hours.to - hours.from) * CALENDAR.hourPixels;
  // Where "now" is in today's column, when today and this hour are in view.
  const nowMinute = minuteOfDay(new Date(serverNow), zone);
  const nowTop = days.includes(today) && nowMinute >= hours.from * 60 && nowMinute < hours.to * 60 ? ((nowMinute - hours.from * 60) / 60) * CALENDAR.hourPixels : null;
  // The first of the days in view that each call has a part in: where the list puts it.
  const firstDayOf = new Map<string, string>();
  for (const segment of [...segments].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) if (!firstDayOf.has(segment.call.call.id)) firstDayOf.set(segment.call.call.id, segment.day);
  const inView = calls.filter((call) => firstDayOf.has(call.id));
  const chosenCall = inView.find((call) => call.id === chosen) ?? null;
  // What the calls she hosted in these days earned together; nothing to say when she hosted none that is over.
  const total = hostedTotal(inView);
  const dayName = (one: string, long = false) => plain(one).toLocaleDateString(undefined, { weekday: long ? "long" : "short", day: "numeric", ...(long ? { month: "long" } : {}), timeZone: "UTC" });
  // Made once for all the blocks: a week can hold hundreds.
  const hourAndMinute = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone });
  const clock = (iso: string) =>
    hourAndMinute
      .formatToParts(new Date(iso))
      .filter((part) => part.type !== "dayPeriod")
      .map((part) => part.value)
      .join("")
      .trim();
  const months = [...new Set([days[0], days[days.length - 1]].map((one) => plain(one).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })))].join(" – ");
  const look = (call: ListedCall) => (call.finished ? "bg-[#e7e5e4] text-[#44403c]" : call.hosting ? "bg-[#fed7aa] text-[#7c2d12]" : "bg-[#99f6e4] text-[#134e4a]");
  const said = (call: ListedCall) =>
    [
      `${dayName(dayOf(new Date(call.startsAt), zone), true)}, ${new Date(call.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
      `${call.minutes} minutes`,
      call.name,
      call.hosting ? "you host" : "you booked",
      ...(call.finished ? ["finished"] : []),
      ...(call.earned ? [`earned ${call.earned.text}${call.earned.soFar ? " so far" : ""}`] : []),
    ].join(", ");
  const arrow = "inline-flex size-11 items-center justify-center rounded-full border border-[#d6d3d1] text-lg hover:bg-[#f5f5f4]";
  const tab = (on: boolean) => `inline-flex min-h-11 items-center rounded-full px-4 text-sm ${on ? "bg-[#1c1917] font-semibold text-white" : "border border-[#d6d3d1]"}`;

  return (
    <div data-calendar-days={days.join(",")} data-calendar-columns={columns}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold" aria-live="polite">
          {months}
        </p>
        <div className="flex items-center gap-2">
          <Link href={`/?day=${dayToMoveTo(shown, columns, -1)}`} scroll={false} className={arrow} aria-label={columns === 7 ? "The week before" : "The three days before"}>
            ‹
          </Link>
          <Link href="/" scroll={false} className="inline-flex min-h-11 items-center rounded-full border border-[#d6d3d1] px-4 text-sm hover:bg-[#f5f5f4]">
            Today
          </Link>
          <Link href={`/?day=${dayToMoveTo(shown, columns, 1)}`} scroll={false} className={arrow} aria-label={columns === 7 ? "The week after" : "The three days after"}>
            ›
          </Link>
        </div>
      </div>
      {total && (
        <p className="mt-1 text-sm text-[#57534e]" data-calendar-total={total.cents}>
          {total.calls} {total.calls === 1 ? "call" : "calls"} hosted in these days · earned <strong>{dollars(total.cents)}</strong>
          {total.soFar && " so far"}
          {/* When not every call around these days could be loaded, the sum is of the ones that were. */}
          {cut && " from the calls shown"}
        </p>
      )}
      <div className="mt-3 flex gap-2" role="group" aria-label="How to show your calls">
        <button type="button" className={tab(view === "calendar")} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>
          Calendar
        </button>
        <button type="button" className={tab(view === "list")} aria-pressed={view === "list"} onClick={() => setView("list")}>
          List
        </button>
      </div>
      {cut && <p className="mt-2 text-sm text-[#9a3412]">There are more calls around these days than can be shown at once. The {CALENDAR.most} nearest to them are here.</p>}

      {view === "calendar" ? (
        <>
          <div className="mt-3 grid text-xs" style={{ gridTemplateColumns: `2.75rem repeat(${columns}, minmax(0, 1fr))` }} data-calendar-grid>
            <div />
            {days.map((one) => (
              <div key={one} className={`border-b border-[#d6d3d1] px-0.5 pb-1 text-center ${one === today ? "font-bold text-[#9a3412]" : "text-[#57534e]"}`} data-calendar-day={one}>
                {dayName(one)}
              </div>
            ))}
            <div className="relative" style={{ height }} aria-hidden>
              {Array.from({ length: hours.to - hours.from }, (_, index) => (
                <span key={index} className="absolute right-1.5 -translate-y-1/2 text-[11px] text-[#78716c]" style={{ top: index * CALENDAR.hourPixels }}>
                  {index === 0 ? "" : new Date(Date.UTC(2020, 0, 1, hours.from + index)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" })}
                </span>
              ))}
            </div>
            {days.map((one) => (
              <div
                key={one}
                className="relative border-l border-[#e7e5e4]"
                style={{ height, ...hourLines }}
              >
                {/* Two pixels thick, and kept inside the grid in the last minute drawn. */}
                {one === today && nowTop !== null && <div aria-hidden data-calendar-now className="pointer-events-none absolute right-0 left-0 z-10 border-t-2 border-[#dc2626]" style={{ top: Math.min(nowTop, height - 2) }} />}
                {inLanes(pieces.filter((piece) => piece.day === one)).map((segment) => {
                  const top = ((segment.from - hours.from * 60) / 60) * CALENDAR.hourPixels;
                  const tall = (Math.max(segment.to - segment.from, CALENDAR.leastMinutes) / 60) * CALENDAR.hourPixels;
                  const place = { minHeight: 0, minWidth: 0, top, height: tall - 1, left: `calc(${(segment.lane / segment.lanes) * 100}% + 1px)`, width: `calc(${100 / segment.lanes}% - 2px)` };
                  if (segment.ask) {
                    const words = segment.ask.count === 1 ? "1 request" : `${segment.ask.count} requests`;
                    return (
                      // A time people asked for: a dashed block that leads to the requests, where she answers them.
                      <Link
                        key={`ask-${segment.ask.startsAt}-${one}`}
                        href="/host/requests"
                        // The day it starts on, also for the part of it that is drawn in the day after.
                        aria-label={`${dayName(dayOf(new Date(segment.ask.startsAt), zone), true)}, ${new Date(segment.ask.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, ${words} waiting for your answer`}
                        data-calendar-ask={segment.ask.count}
                        className="absolute overflow-hidden rounded-md border border-dashed border-[#57534e] bg-white px-1 text-left text-[11px] leading-[12px] whitespace-nowrap text-[#44403c] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1c1917]"
                        style={place}
                      >
                        <span className="block overflow-hidden text-ellipsis">{words}</span>
                      </Link>
                    );
                  }
                  const call = segment.call!;
                  return (
                    <button
                      key={`${call.id}-${one}`}
                      type="button"
                      aria-label={said(call)}
                      aria-pressed={chosen === call.id}
                      onClick={() => setChosen(chosen === call.id ? null : call.id)}
                      data-calendar-call={call.id}
                      data-calendar-look={call.finished ? "finished" : call.hosting ? "hosting" : "booked"}
                      className={`absolute overflow-hidden rounded-md px-1 text-left text-[11px] leading-[14px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1c1917] ${look(call)} ${chosen === call.id ? "ring-2 ring-[#1c1917]" : ""}`}
                      // A block is as tall as its call is long and as wide as its share of the day, so the site's least
                      // size for a button is set aside (in `place`): the list beside the calendar has the full-size rows.
                      style={place}
                    >
                      <span className="block overflow-hidden text-ellipsis">
                        {/* A finished call she hosted says what it earned, first, so it is what stays when the block is narrow. */}
                        {call.earned ? (
                          <>
                            <strong>{call.earned.text}</strong>
                            {call.earned.soFar && " so far"} {firstName(call.name)}
                          </>
                        ) : (
                          <>
                            {segment.from > 0 || dayOf(new Date(call.startsAt), zone) === one ? clock(call.startsAt) : "…"} {firstName(call.name)}
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#57534e]">
            <Key look="bg-[#fed7aa]" words="You host" />
            <Key look="bg-[#99f6e4]" words="You booked" />
            <Key look="bg-[#e7e5e4]" words="Finished" />
            {askSegments.length > 0 && <Key look="border border-dashed border-[#57534e] bg-white" words="Asked for, not answered" />}
          </p>
          <div className="mt-3 border-t border-[#e7e5e4]" data-calendar-chosen={chosenCall?.id ?? ""}>
            {chosenCall ? (
              <ul>
                <CallRow call={chosenCall} timeOnly={false} />
              </ul>
            ) : (
              <p className="pt-3 text-sm text-[#57534e]">{inView.length > 0 ? "Tap a call to see it." : "No calls in these days."}</p>
            )}
          </div>
        </>
      ) : (
        <div className="mt-3" data-calendar-list>
          {inView.length === 0 && <p className="text-sm text-[#57534e]">No calls in these days.</p>}
          {days.map((one) => {
            // A call that began the day before the first day in view is listed under that first day, with its own date.
            const starting = inView.filter((call) => firstDayOf.get(call.id) === one);
            if (starting.length === 0) return null;
            return (
              <section key={one} className="mt-4 first:mt-0">
                <h3 className="text-sm font-bold text-[#9a3412]">{one === today ? "Today" : one === dayAfter(today) ? "Tomorrow" : dayName(one, true)}</h3>
                <ul>
                  {starting.map((call) => (
                    <CallRow key={call.id} call={call} timeOnly={dayOf(new Date(call.startsAt), zone) === one} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A line across the day at every hour. */
const hourLines = { backgroundImage: "linear-gradient(to bottom, #e7e5e4 1px, transparent 1px)", backgroundSize: `100% ${CALENDAR.hourPixels}px` } as const;

function Key({ look, words }: { look: string; words: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`inline-block size-3 rounded-sm ${look}`} />
      {words}
    </span>
  );
}
