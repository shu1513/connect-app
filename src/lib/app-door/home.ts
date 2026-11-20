/**
 * The home page for the phone app (plans/45-phone-apps/04-the-home-page.md): what the website's
 * page shows, minus projects, from the very same gathering (src/lib/home/gather.ts).
 *
 * The answer is built field by field, never by handing over whole records. So nothing the app
 * must not have can travel inside something it may: not a customer's email, not the diary choice
 * that sits in a followed host's line, not a field added to a record later.
 */
import "server-only";
import type { ListedCall } from "@/components/call-row";
import { roomOpensAt } from "@/lib/calls";
import { FOLLOW } from "@/lib/follows/rules";
import { CALENDAR } from "@/lib/home/calendar";
import { gatherHome } from "@/lib/home/gather";
import { notPaidYet } from "@/lib/home/payment-line";
import { HOME } from "@/lib/home/rules";
import { noCallWords, requestWords } from "@/lib/home/words";
import { formatMoney } from "@/lib/payments/access";
import { languageNames } from "@/lib/profiles/languages";
import { SUGGEST, SUGGEST_WHY } from "@/lib/suggestions/rules";
import type { AppCall, AppHome, AppSwitches } from "./types";

/** One call, field by field. `about` is only ever there when the gathering attached it: for a call this person hosts that is not over. */
function callFor(call: ListedCall): AppCall {
  return {
    id: call.id,
    startsAt: call.startsAt,
    endsAt: call.endsAt,
    minutes: call.minutes,
    name: call.name,
    photoId: call.photoId,
    hosting: call.hosting,
    open: call.open,
    finished: call.finished,
    payment: call.payment,
    ...(call.earned ? { earned: { text: call.earned.text, cents: call.earned.cents, soFar: call.earned.soFar } } : {}),
    ...(call.moneyOpen ? { moneyOpen: true as const } : {}),
    ...(call.about
      ? { about: { words: call.about.words, idConfirmed: call.about.idConfirmed, member: call.about.member, callsBefore: call.about.callsBefore, lastCallAt: call.about.lastCallAt, note: call.about.note } }
      : {}),
  };
}

export async function homeFor(person: { id: string; name: string; paused: boolean }, dayAsked: unknown, switches: AppSwitches): Promise<AppHome> {
  // Never the diary: projects are not in the apps, and nothing of one is read for them.
  const home = await gatherHome(person, dayAsked, { diary: false });
  // The times asked for, soonest first, each with the people who asked for it; the first few times are listed.
  const starts = [...new Set(home.toAnswer.map(({ booking }) => booking.startsAt.toISOString()))];
  const listedStarts = new Set(starts.slice(0, HOME.requestTimesShown));
  return {
    serverNow: home.drawn.toISOString(),
    firstName: person.name.trim().split(/\s+/)[0] ?? "",
    hosting: home.hosts ? { page: home.ownProfile?.status === "approved" && !home.ownProfile.hidden ? home.ownProfile.handle : null } : null,
    calls: home.listed.map(callFor),
    next: home.next ? { id: home.next.id, opensAt: roomOpensAt(home.next).toISOString(), notPaid: notPaidYet(home.paymentsOf.get(home.next.id) ?? []) } : null,
    noCall: home.next ? null : noCallWords(home.followed.length === 0 && home.requests.length === 0),
    calendar: {
      shown: home.hasCalls || home.toAnswer.length > 0,
      day: home.day,
      asks: home.asks.map((ask) => ({ startsAt: ask.startsAt, endsAt: ask.endsAt, count: ask.count })),
      cut: home.cut,
      most: CALENDAR.most,
    },
    toAnswer: {
      count: home.toAnswer.length,
      times: starts.length,
      shown: home.toAnswer
        .filter(({ booking }) => listedStarts.has(booking.startsAt.toISOString()))
        .map(({ booking, customerName }) => ({
          id: booking.id,
          startsAt: booking.startsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
          minutes: booking.lengthMinutes,
          price: booking.totalCents > 0 ? formatMoney(booking.totalCents) : "free",
          name: customerName,
          respondBy: booking.respondBy ? booking.respondBy.toISOString() : null,
        })),
    },
    toRate: home.toRate.map((call) => ({ callId: call.callId, otherName: call.otherName, endsAt: call.endsAt.toISOString() })),
    requests: home.requests.map(({ booking, hostName }) => ({ id: booking.id, hostName, startsAt: booking.startsAt.toISOString(), words: requestWords(booking) })),
    followed: {
      total: home.followed.length,
      // Name, page, "available now" and photo, and nothing else of the line: the host's account id, the diary choice and the email hours stay on the server.
      hosts: home.shownHosts.map((host) => ({
        name: host.name,
        handle: host.handle,
        available: switches.availableNow && host.available && Boolean(host.handle),
        photoId: host.handle ? (home.photos.get(host.hostId) ?? null) : null,
      })),
    },
    suggested: home.suggested
      ? {
          day: home.suggested.day,
          made: home.suggested.made,
          shownFirst: SUGGEST.shown,
          why: SUGGEST_WHY,
          hosts: home.suggested.hosts.map((host) => ({
            place: host.place,
            handle: host.handle,
            name: host.displayName,
            price: host.pricePer15Cents === 0 ? "Free calls" : `${formatMoney(host.pricePer15Cents)} per 15 minutes`,
            languages: languageNames(host.languages),
            seen: host.seen,
            rating: host.rating ? { average: host.rating.average, count: host.rating.count } : null,
            photoId: host.photoId,
            availableNow: switches.availableNow && host.open.availableNow,
            nextOpen: host.open.nextOpen ? host.open.nextOpen.toISOString() : null,
          })),
        }
      : null,
    takeCalls: home.soonest.length === 0,
    refreshSeconds: FOLLOW.refreshSeconds,
  };
}
