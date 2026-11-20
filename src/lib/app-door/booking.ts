/**
 * Asking a host for a call at a time, and the request's own page, for the phone app
 * (plans/45-phone-apps/06-asking-for-a-call.md): what the website's pages show, from the very
 * same gathering (src/lib/booking/book-page.ts, request-page.ts) and with the very same
 * sentences (book-words.ts, request-words.ts).
 *
 * The answers are built field by field. No account id travels, and no price is worked out in the
 * app: it shows the words it is given, and hands back the two numbers it was shown as they are.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { gatherBookPage } from "@/lib/booking/book-page";
import { BOOK_WORDS, bookPoints, cardTermsWords, CONFIRM_ID_FIRST, whatIsAskedFor } from "@/lib/booking/book-words";
import { gatherRequest } from "@/lib/booking/request-page";
import { cardDeadlineWords, endedWords, REQUEST_WORDS, requestPrice, requestTitle, stageWords } from "@/lib/booking/request-words";
import { CARD_CONSENT_VERSION, cardStepOpen, LIMITS } from "@/lib/booking/rules";
import { publicProfile } from "@/lib/profiles/profiles";
import type { AppBooking, AppBookSummary, AppSwitches } from "./types";

/** How often the app asks again about a request that waits for the host's answer, or for a month's payment. */
const WAITING_REFRESH_SECONDS = 20;
/** How often it asks again while a request stands at its card step: so that a page left open says so when the time is up. */
const CARD_REFRESH_SECONDS = 30;

/**
 * What a customer reads before asking this host for this time, or null when there is no such page
 * for anyone to open. The same four outcomes as the website's page, by the same function.
 */
export async function bookSummaryFor(person: { id: string }, handle: string, asked: { start: string | null; length: string | null }, now: Date): Promise<AppBookSummary | null> {
  const profile = await publicProfile(handle);
  if (!profile) return null;
  const page = await gatherBookPage(person, profile, asked, now);
  const name = profile.displayName;
  if (page.kind === "gone") return { kind: "gone", title: BOOK_WORDS.gone, button: BOOK_WORDS.chooseAnother };
  if (page.kind === "own") return { kind: "own", title: BOOK_WORDS.ownTitle, words: BOOK_WORDS.own };
  if (page.kind === "confirm_id") return { kind: "confirm_id", title: CONFIRM_ID_FIRST.title, words: CONFIRM_ID_FIRST.words(page.reason, name), small: CONFIRM_ID_FIRST.small(name), button: CONFIRM_ID_FIRST.button };
  const { offer } = page;
  return {
    kind: "ok",
    title: BOOK_WORDS.title(name),
    startsAt: page.startsAt.toISOString(),
    minutes: page.minutes,
    hostTime: BOOK_WORDS.hostTime(name, page.hostZoneTime),
    price: BOOK_WORDS.price(page.totalCents, offer.pricePer15Cents),
    what: whatIsAskedFor(page.paid, offer.freeCancelMinutes),
    pointsTitle: BOOK_WORDS.pointsTitle(name),
    points: bookPoints({ hostName: name, totalCents: page.totalCents, freeCancelMinutes: offer.freeCancelMinutes, answerBy: page.answerBy, payBy: page.payBy, hostToo: page.hostToo }),
    note: { label: BOOK_WORDS.note(name), max: LIMITS.noteMax },
    cardTerms: page.paid ? cardTermsWords(page.totalCents) : null,
    // Which wording the box stands beside. It goes back with the request: a tick for other words is not taken.
    cardTermsVersion: page.paid ? CARD_CONSENT_VERSION : null,
    idLine: page.idConfirmed ? BOOK_WORDS.idLine(name) : null,
    button: BOOK_WORDS.button(page.paid),
    // Made here, as the website's page makes it when it is shown: sent twice with it, a request counts once.
    requestKey: randomUUID(),
    seen: { price: offer.pricePer15Cents, freeCancel: offer.freeCancelMinutes },
  };
}

/** Whether the card of this request may be entered from the app, as the founder's switches stand. */
export function mayEnterCard(booking: { source: string }, switches: AppSwitches): boolean {
  return booking.source !== "now" || switches.availableNow;
}

/**
 * One request, for the customer who made it; null for anyone else. (A host's side of a request
 * is not answered here yet: it comes with the screens on which she answers one.)
 */
export async function bookingPageFor(person: { id: string }, bookingId: string, switches: AppSwitches, now: Date, notice: string | null = null): Promise<AppBooking | null> {
  const found = await gatherRequest(person.id, bookingId, now);
  if (!found || found.role !== "customer") return null;
  const { booking, role, paid } = found;
  const waiting = booking.stage === "waiting";
  // The card can be entered from the app while the card step is open, and, for a call asked for "now" (begun on the
  // website), only while "available now" is switched on for the apps. The request itself can always be read.
  // Past the card step's time the request is over, also in the moments before the helper has ended it.
  const tooLate = booking.stage === "card" && !cardStepOpen(booking.createdAt, now);
  const atCard = booking.stage === "card" && !tooLate && mayEnterCard(booking, switches);
  return {
    id: booking.id,
    title: requestTitle(booking, role, found.otherName),
    hostHandle: found.hostHandle,
    stage: booking.stage,
    // Past the card step's time: said as it is, in place of "enter your card".
    stageWords: tooLate ? REQUEST_WORDS.cardTooLate : stageWords(booking, role),
    reason: endedWords(booking, role),
    startsAt: booking.startsAt.toISOString(),
    minutes: booking.lengthMinutes,
    price: requestPrice(booking),
    hearBy: waiting && booking.respondBy ? booking.respondBy.toISOString() : null,
    card: atCard
      ? {
          title: REQUEST_WORDS.cardTitle,
          words: REQUEST_WORDS.card,
          button: REQUEST_WORDS.cardButton,
          deadline: cardDeadlineWords(new Date(booking.createdAt.getTime() + LIMITS.cardStepMinutes * 60_000)),
          givenUp: REQUEST_WORDS.cardGivenUp,
          notSaved: REQUEST_WORDS.cardNotSaved,
          notConfirmed: REQUEST_WORDS.cardNotConfirmed,
          checkAgain: REQUEST_WORDS.cardCheckAgain,
        }
      : null,
    waitingWords: waiting ? REQUEST_WORDS.waiting(paid) : null,
    takeBack: waiting ? REQUEST_WORDS.takeBack : null,
    takeBackSure: waiting ? { words: REQUEST_WORDS.takeBackSure, yes: REQUEST_WORDS.takeBackYes, no: REQUEST_WORDS.takeBackNo } : null,
    // What else the call's own page is for is said once the app has that page (part 08).
    call: booking.callId ? { id: booking.callId } : null,
    // (Past the card step's time the helper ends the request within moments: the page asks again until it has.)
    refreshSeconds: waiting || booking.stage === "paying" || tooLate ? WAITING_REFRESH_SECONDS : atCard ? CARD_REFRESH_SECONDS : null,
    notice,
  };
}
