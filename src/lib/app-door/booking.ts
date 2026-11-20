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
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { gatherBookPage } from "@/lib/booking/book-page";
import { BOOK_WORDS, bookPoints, cardTermsWords, CONFIRM_ID_FIRST, whatIsAskedFor } from "@/lib/booking/book-words";
import { gatherRequest, type RequestPage } from "@/lib/booking/request-page";
import { cardDeadlineWords, endedWords, REQUEST_WORDS, requestPrice, requestTitle, stageWords } from "@/lib/booking/request-words";
import { CARD_CONSENT_VERSION, cardStepOpen, LIMITS, newRequestKey } from "@/lib/booking/rules";
import { WAITING_WORDS } from "@/lib/booking/waiting-words";
import { NOTE_MAX, openAndUnblocked } from "@/lib/people/contacts";
import { BLOCK_WORDS } from "@/lib/safety/block-words";
import { REPORT_WORDS } from "@/lib/safety/report-words";
import { publicProfile, sellerLine } from "@/lib/profiles/profiles";
import { answerFor } from "./requests";
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
    seller: await sellerLine(profile.userId, name),
    points: bookPoints({ hostName: name, totalCents: page.totalCents, freeCancelMinutes: offer.freeCancelMinutes, answerBy: page.answerBy, payBy: page.payBy, hostToo: page.hostToo }),
    note: { label: BOOK_WORDS.note(name), max: LIMITS.noteMax },
    cardTerms: page.paid ? cardTermsWords(page.totalCents) : null,
    // Which wording the box stands beside. It goes back with the request: a tick for other words is not taken.
    cardTermsVersion: page.paid ? CARD_CONSENT_VERSION : null,
    idLine: page.idConfirmed ? BOOK_WORDS.idLine(name) : null,
    button: BOOK_WORDS.button(page.paid),
    // Made here, as the website's page makes it when it is shown: sent twice with it, a request counts once.
    // (A key for the app carries the moment it was made, and makes a request for half a day and no longer.)
    requestKey: newRequestKey(now),
    seen: { price: offer.pricePer15Cents, freeCancel: offer.freeCancelMinutes },
  };
}

/**
 * Whether one of a request's two people may block the other through it: only once it was really sent
 * (or became a call). A request that stopped at its card step never reached the host, also after it has
 * ended: neither of the two has anything of the other's through it.
 */
export function mayBlockThrough(booking: { stage: string; source: string; requestedAt: Date | null; callId: string | null }): boolean {
  if (booking.stage === "card") return false;
  // A member's booking is not sent to anyone: it counts only once it has become a call (one whose month's payment
  // did not go through never reached the host either).
  if (booking.source === "member") return booking.callId !== null;
  return booking.requestedAt !== null || booking.callId !== null;
}

/** Whether the card of this request may be entered from the app, as the founder's switches stand. */
export function mayEnterCard(booking: { source: string }, switches: AppSwitches): boolean {
  return booking.source !== "now" || switches.availableNow;
}

/**
 * What the host of a request may know about the person asking, her own note, and how she answers
 * (plans/45-phone-apps/07-a-hosts-requests.md, decision 1). **The rule of the list of waiting
 * requests holds here at every stage:** about a customer whose account is closed, or across a
 * block in either direction, nothing but the name is said: no rating, no "ID confirmed", no
 * photo, and not what they wrote when asking. The same for a founder's test call.
 */
async function hostPart(found: RequestPage): Promise<NonNullable<AppBooking["host"]>> {
  const { booking } = found;
  const name = found.otherName ?? "";
  const known = !found.testCall && (await openAndUnblocked(booking.hostId, [booking.customerId])).has(booking.customerId);
  const rating = known && found.customerRating ? { average: found.customerRating.average, count: found.customerRating.count } : null;
  return {
    customerName: name,
    photoId: known ? found.customerPhotoId : null,
    known,
    rating,
    ratingWords: known && !rating ? WAITING_WORDS.newCustomer : null,
    idConfirmed: known && found.idConfirmed,
    words: known && booking.note ? { label: WAITING_WORDS.theirNote, text: booking.note } : null,
    // Whether she may keep a note about this person is decided where notes are kept; here it is only shown, and
    // never beside "nothing may be said about them" (the two are asked at slightly different moments).
    note: known && found.note?.allowed ? { title: WAITING_WORDS.noteTitle(name), hint: WAITING_WORDS.noteHint, text: found.note.text, max: NOTE_MAX, save: WAITING_WORDS.noteSave, notSaved: WAITING_WORDS.noteNotSaved } : null,
    answer: booking.stage === "waiting" ? answerFor(booking) : null,
  };
}

/**
 * One request, for the customer who made it or the host it was sent to; null for anyone else, and
 * for a host who was never sent it (one still at the card step, a member's booking that never
 * became a call). What only one of the two may see is filled only for that one.
 */
export async function bookingPageFor(person: { id: string }, bookingId: string, switches: AppSwitches, now: Date, notice: string | null = null, options: { blockAgain?: boolean } = {}): Promise<AppBooking | null> {
  const found = await gatherRequest(person.id, bookingId, now);
  if (!found) return null;
  const { booking, role, paid } = found;
  const mine = role === "customer";
  const waiting = booking.stage === "waiting";
  // The card can be entered from the app while the card step is open, and, for a call asked for "now" (begun on the
  // website), only while "available now" is switched on for the apps. The request itself can always be read.
  // Past the card step's time the request is over, also in the moments before the helper has ended it.
  const tooLate = mine && booking.stage === "card" && !cardStepOpen(booking.createdAt, now);
  const atCard = mine && booking.stage === "card" && !tooLate && mayEnterCard(booking, switches);
  const otherName = found.otherName ?? "";
  // The button to block the other person is not offered again to someone who has blocked them already.
  const otherId = mine ? booking.hostId : booking.customerId;
  const [blockedByMe] = await db.select({ blockerId: schema.blocks.blockerId }).from(schema.blocks).where(and(eq(schema.blocks.blockerId, person.id), eq(schema.blocks.blockedId, otherId)));
  // ...unless a call between the two is still standing: blocking could not cancel it at the time, and blocking again
  // tries once more. Asked on every reading, so the way to try again stays for as long as it is needed.
  const [stillBooked] = blockedByMe
    ? await db
        .select({ id: schema.calls.id })
        .from(schema.calls)
        .where(
          and(
            or(and(eq(schema.calls.hostId, person.id), eq(schema.calls.customerId, otherId)), and(eq(schema.calls.hostId, otherId), eq(schema.calls.customerId, person.id))),
            isNull(schema.calls.cancelledAt),
            isNull(schema.calls.safetyEndedAt),
            gt(schema.calls.startsAt, now),
          ),
        )
        .limit(1)
    : [];
  return {
    id: booking.id,
    role,
    title: requestTitle(booking, role, found.otherName),
    hostHandle: found.hostHandle,
    stage: booking.stage,
    // Past the card step's time: said as it is, in place of "enter your card".
    stageWords: tooLate ? REQUEST_WORDS.cardTooLate : stageWords(booking, role),
    reason: endedWords(booking, role),
    startsAt: booking.startsAt.toISOString(),
    minutes: booking.lengthMinutes,
    price: requestPrice(booking),
    hearBy: waiting && booking.respondBy ? { label: REQUEST_WORDS.hearBy(role), at: booking.respondBy.toISOString() } : null,
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
    waitingWords: mine && waiting ? REQUEST_WORDS.waiting(paid) : null,
    takeBack: mine && waiting ? REQUEST_WORDS.takeBack : null,
    takeBackSure: mine && waiting ? { words: REQUEST_WORDS.takeBackSure, yes: REQUEST_WORDS.takeBackYes, no: REQUEST_WORDS.takeBackNo } : null,
    host: mine ? null : await hostPart(found),
    // As on the website's page: either of the two can report the other once the request was sent.
    report: booking.stage !== "card" ? REPORT_WORDS.reportPerson(otherName || "this person") : null,
    // As on the website's page: either of the two can block the other once the request was sent.
    block: mayBlockThrough(booking) && otherName && (!blockedByMe || stillBooked || options.blockAgain) ? { label: BLOCK_WORDS.label(otherName), sure: BLOCK_WORDS.sure(otherName), yes: BLOCK_WORDS.yes, no: BLOCK_WORDS.no } : null,
    // What else the call's own page is for is said once the app has that page (part 08).
    call: booking.callId ? { id: booking.callId } : null,
    // (Past the card step's time the helper ends the request within moments: the page asks again until it has.)
    refreshSeconds: waiting || (mine && booking.stage === "paying") || tooLate ? WAITING_REFRESH_SECONDS : atCard ? CARD_REFRESH_SECONDS : null,
    notice,
  };
}
