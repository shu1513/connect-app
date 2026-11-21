/**
 * The requests a host has to answer, for the phone app
 * (plans/45-phone-apps/07-a-hosts-requests.md): the website's own list, from the very same
 * gathering (src/lib/booking/waiting-list.ts) and with the very same sentences
 * (waiting-words.ts). The answer is built field by field: no account id travels, and nothing
 * about a customer whose account is closed or who is across a block.
 */
import "server-only";
import { waitingForHost } from "@/lib/booking/bookings";
import { aboutWaiting, byTime, type Waiting, type WaitingAbout } from "@/lib/booking/waiting-list";
import { WAITING_WORDS } from "@/lib/booking/waiting-words";
import { formatMoney } from "@/lib/payments/access";
import type { AppAnswer, AppRequests, AppWaitingOne } from "./types";

/** How often the app asks again while the list is in front: a request for a call right now needs its answer within minutes. */
const LIST_REFRESH_SECONDS = 15;

/** How a host answers a waiting request: the buttons, and the question the app asks before it accepts. */
export function answerFor(booking: { source: string; lengthMinutes: number; startsAt: Date; totalCents: number }): AppAnswer {
  const instant = booking.source === "now";
  const price = booking.totalCents > 0 ? formatMoney(booking.totalCents) : "free";
  return {
    kind: instant ? "now" : "booked",
    accept: WAITING_WORDS.accept,
    decline: WAITING_WORDS.decline,
    sure: [WAITING_WORDS.acceptSureBefore(booking.lengthMinutes), { time: booking.startsAt.toISOString() }, WAITING_WORDS.acceptSureAfter(price)],
    yes: WAITING_WORDS.acceptYes,
    no: WAITING_WORDS.acceptNo,
    elsewhere: instant ? WAITING_WORDS.nowElsewhere : null,
  };
}

/** One waiting request as the host's list shows it. */
export function waitingOne(row: Waiting[number], about: WaitingAbout): AppWaitingOne {
  const { booking } = row;
  return {
    id: booking.id,
    kind: booking.source === "now" ? "now" : "booked",
    name: row.customerName,
    minutes: booking.lengthMinutes,
    price: booking.totalCents > 0 ? formatMoney(booking.totalCents) : "free",
    respondBy: booking.respondBy ? booking.respondBy.toISOString() : null,
    known: about.known,
    rating: about.rating ? { average: about.rating.average, count: about.rating.count } : null,
    ratingWords: about.known && !about.rating ? WAITING_WORDS.newCustomer : null,
    idConfirmed: about.idConfirmed,
    words: about.words,
    note: about.note,
    photoId: about.photoId,
    answer: answerFor(booking),
  };
}

/** The list for this host. For someone nobody has asked, it is simply empty. */
export async function requestsFor(host: { id: string }, now: Date): Promise<AppRequests> {
  const waiting = await waitingForHost(host.id);
  const about = await aboutWaiting(host.id, waiting, now);
  return {
    title: WAITING_WORDS.title(waiting.length),
    intro: [WAITING_WORDS.intro, `${WAITING_WORDS.nowBefore}${WAITING_WORDS.nowPage}${WAITING_WORDS.nowAfter}`],
    empty: waiting.length === 0 ? WAITING_WORDS.empty : null,
    groups: byTime(waiting).map(([startsAt, rows]) => ({
      startsAt,
      many: rows.length > 1 ? WAITING_WORDS.many(rows.length) : null,
      requests: rows.map((row) => waitingOne(row, about.get(row.booking.id)!)),
    })),
    refreshSeconds: LIST_REFRESH_SECONDS,
  };
}
