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
import { BOOK_WORDS, bookPoints, cardTermsWords, CONFIRM_ID_FIRST } from "@/lib/booking/book-words";
import { gatherRequest } from "@/lib/booking/request-page";
import { endedWords, REQUEST_WORDS, requestPrice, requestTitle, stageWords } from "@/lib/booking/request-words";
import { LIMITS } from "@/lib/booking/rules";
import { callWords } from "@/lib/profiles/host-page-words";
import { publicProfile } from "@/lib/profiles/profiles";
import type { AppBooking, AppBookSummary } from "./types";

/** How often the app asks again about a request that waits for the host's answer, or for a month's payment. */
const WAITING_REFRESH_SECONDS = 20;

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
    what: callWords(offer.freeCancelMinutes),
    pointsTitle: BOOK_WORDS.pointsTitle(name),
    points: bookPoints({ hostName: name, totalCents: page.totalCents, freeCancelMinutes: offer.freeCancelMinutes, answerBy: page.answerBy, payBy: page.payBy, hostToo: page.hostToo }),
    note: { label: BOOK_WORDS.note(name), max: LIMITS.noteMax },
    cardTerms: page.paid ? cardTermsWords(page.totalCents) : null,
    idLine: page.idConfirmed ? BOOK_WORDS.idLine(name) : null,
    button: BOOK_WORDS.button(page.paid),
    // Made here, as the website's page makes it when it is shown: sent twice with it, a request counts once.
    requestKey: randomUUID(),
    seen: { price: offer.pricePer15Cents, freeCancel: offer.freeCancelMinutes },
  };
}

/**
 * One request, for the customer who made it; null for anyone else. (A host's side of a request
 * is not answered here yet: it comes with the screens on which she answers one.)
 */
export async function bookingPageFor(person: { id: string }, bookingId: string, now: Date, notice: string | null = null): Promise<AppBooking | null> {
  const found = await gatherRequest(person.id, bookingId, now);
  if (!found || found.role !== "customer") return null;
  const { booking, role, paid } = found;
  const waiting = booking.stage === "waiting";
  const atCard = booking.stage === "card";
  return {
    id: booking.id,
    title: requestTitle(booking, role, found.otherName),
    hostHandle: found.hostHandle,
    stage: booking.stage,
    stageWords: stageWords(booking, role),
    reason: endedWords(booking, role),
    startsAt: booking.startsAt.toISOString(),
    minutes: booking.lengthMinutes,
    price: requestPrice(booking),
    hearBy: waiting && booking.respondBy ? booking.respondBy.toISOString() : null,
    card: atCard ? { title: REQUEST_WORDS.cardTitle, words: REQUEST_WORDS.card, button: REQUEST_WORDS.cardButton, until: new Date(booking.createdAt.getTime() + LIMITS.cardStepMinutes * 60_000).toISOString() } : null,
    waitingWords: waiting ? REQUEST_WORDS.waiting(paid) : null,
    takeBack: waiting ? REQUEST_WORDS.takeBack : null,
    call: booking.callId ? { id: booking.callId, words: REQUEST_WORDS.callPageAlso(booking).trim() } : null,
    refreshSeconds: waiting || booking.stage === "paying" ? WAITING_REFRESH_SECONDS : null,
    notice,
  };
}
