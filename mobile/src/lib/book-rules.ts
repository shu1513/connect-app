/**
 * The plain logic of asking for a call in the app
 * (plans/45-phone-apps/06-asking-for-a-call.md): checking the server's answers before a screen
 * reads them, and deciding which addresses the app may open or hand to Stripe's kit. Plain logic
 * with no phone in it, so it can be tested on its own.
 */
import type { AppBooking, AppBookSummary, AppCardStep, AppIdentity, AppNoteSaved, AppPart, AppRequests, AppWaitingOne } from "../../../src/lib/app-door/types";
import { isIdentityNotice } from "./legal-rules";

const isThing = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isMoment = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A piece of a sentence: plain words, words to stress, or an exact moment. */
function isPart(value: unknown): value is AppPart {
  if (isText(value)) return true;
  if (!isThing(value)) return false;
  return isText(value.bold) || isMoment(value.time);
}
const isSentence = (value: unknown): value is AppPart[] => Array.isArray(value) && value.every(isPart);

/** An id of the server's, as it may stand in an address: exactly the shape the server's database gives its ids, and nothing else. */
export function isId(value: unknown): value is string {
  return isText(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** An id as the server writes it (in small letters), or an empty text for anything that is no id. A link may carry it in capitals. */
export function sameId(value: unknown): string {
  return isId(value) ? value.toLowerCase() : "";
}

/**
 * What a tick of the box about the card was given for: the box's own words and their version, the
 * price and the cancelling rule shown, and the time and length. A tick counts only for exactly these. When any
 * of them changes on the screen (the host changed her price, say), the box is empty again.
 */
export function tickedFor(summary: AppBookSummary | null): string | null {
  if (!summary || summary.kind !== "ok" || summary.cardTerms === null) return null;
  return JSON.stringify([summary.cardTerms, summary.cardTermsVersion, summary.seen.price, summary.seen.freeCancel, summary.startsAt, summary.minutes, summary.price]);
}

/** Whether an answer really is what a customer reads before asking for a call, with the parts the screen reads. */
export function isBookSummary(data: unknown): data is AppBookSummary {
  if (!isThing(data) || !isText(data.title)) return false;
  if (data.kind === "gone") return isText(data.button);
  if (data.kind === "own") return isText(data.words);
  if (data.kind === "confirm_id") return isText(data.words) && isText(data.small) && isText(data.button);
  if (data.kind !== "ok") return false;
  if (!isMoment(data.startsAt) || !isWhole(data.minutes) || !isText(data.hostTime) || !isText(data.price) || !isText(data.what) || !isText(data.pointsTitle) || !isTextOrNull(data.seller)) return false;
  if (!Array.isArray(data.points) || !data.points.every(isSentence)) return false;
  if (!isThing(data.note) || !isText(data.note.label) || !isWhole(data.note.max)) return false;
  if (!isTextOrNull(data.cardTerms) || !isTextOrNull(data.cardTermsVersion) || !isTextOrNull(data.idLine) || !isText(data.button) || !isId(data.requestKey)) return false;
  // The words beside the box and the version of those words come together, or not at all.
  if ((data.cardTerms === null) !== (data.cardTermsVersion === null)) return false;
  return isThing(data.seen) && isWhole(data.seen.price) && isWhole(data.seen.freeCancel);
}

const isRating = (value: unknown): boolean => value === null || (isThing(value) && typeof value.average === "number" && typeof value.count === "number");

/** What a host may know about the person asking, her note, and how she answers: the host's part of a request's page. */
function isHostPart(value: unknown): boolean {
  if (!isThing(value) || !isText(value.customerName) || !isTextOrNull(value.photoId) || typeof value.known !== "boolean" || !isRating(value.rating) || !isTextOrNull(value.ratingWords) || typeof value.idConfirmed !== "boolean") return false;
  if (value.words !== null && !(isThing(value.words) && isText(value.words.label) && isText(value.words.text))) return false;
  const note = value.note;
  if (note !== null && !(isThing(note) && isText(note.title) && isText(note.hint) && isTextOrNull(note.text) && isWhole(note.max) && isText(note.save) && isText(note.notSaved))) return false;
  return value.answer === null || isAnswer(value.answer);
}

/** How a host answers a waiting request: the buttons, the question to ask before accepting, and where a call asked for "now" is answered. Without `accept`, only declining is offered. */
function isAnswer(answer: unknown): boolean {
  return isThing(answer) && (answer.kind === "booked" || answer.kind === "now") && isTextOrNull(answer.accept) && isText(answer.decline) && isSentence(answer.sure) && isText(answer.yes) && isText(answer.no) && isTextOrNull(answer.elsewhere);
}

/** One waiting request on a host's list. */
function isWaitingOne(value: unknown): value is AppWaitingOne {
  if (!isThing(value) || !isId(value.id) || !(value.kind === "booked" || value.kind === "now") || !isText(value.name) || !isWhole(value.minutes) || !isText(value.price)) return false;
  if (!(value.respondBy === null || isMoment(value.respondBy)) || typeof value.known !== "boolean" || !isRating(value.rating) || !isTextOrNull(value.ratingWords)) return false;
  return typeof value.idConfirmed === "boolean" && isText(value.words) && isTextOrNull(value.note) && isTextOrNull(value.photoId) && isAnswer(value.answer);
}

/** Whether an answer really is a host's list of waiting requests, with the parts the screen reads. */
export function isRequests(data: unknown): data is AppRequests {
  if (!isThing(data) || !isText(data.title) || !Array.isArray(data.intro) || !data.intro.every(isText) || !isTextOrNull(data.empty)) return false;
  if (typeof data.refreshSeconds !== "number" || !(data.refreshSeconds > 0) || !Array.isArray(data.groups)) return false;
  return data.groups.every((group) => isThing(group) && isMoment(group.startsAt) && isTextOrNull(group.many) && Array.isArray(group.requests) && group.requests.every(isWaitingOne));
}

/** Whether an answer really is "the note is saved": the note as it is now stored (or none), and the words to say. */
export function isNoteSaved(data: unknown): data is AppNoteSaved {
  return isThing(data) && isTextOrNull(data.text) && isText(data.words);
}

/** A sentence in parts, written out as plain words, with each moment written by `when` (the phone's own time zone). */
export function plainWords(parts: readonly AppPart[], when: (iso: string) => string): string {
  return parts.map((part) => (typeof part === "string" ? part : "bold" in part ? part.bold : when(part.time))).join("");
}

/** Whether an answer really is a request's page, with the parts the screen reads. */
export function isBooking(data: unknown): data is AppBooking {
  if (!isThing(data) || !isId(data.id) || !(data.role === "customer" || data.role === "host") || !isText(data.title) || !isTextOrNull(data.hostHandle) || !isText(data.stage) || !isText(data.stageWords) || !isTextOrNull(data.reason)) return false;
  if (!isMoment(data.startsAt) || !isWhole(data.minutes) || !isThing(data.price) || !isText(data.price.label) || !isText(data.price.words)) return false;
  if (!(data.hearBy === null || (isThing(data.hearBy) && isText(data.hearBy.label) && isMoment(data.hearBy.at))) || !isTextOrNull(data.waitingWords) || !isTextOrNull(data.takeBack) || !isTextOrNull(data.notice)) return false;
  const sure = data.takeBackSure;
  if (sure !== null && !(isThing(sure) && isText(sure.words) && isText(sure.yes) && isText(sure.no))) return false;
  // A request that can be taken back always comes with the question to ask first.
  if (data.takeBack !== null && sure === null) return false;
  if (!(data.refreshSeconds === null || (typeof data.refreshSeconds === "number" && data.refreshSeconds > 0))) return false;
  if (data.call !== null && !(isThing(data.call) && isId(data.call.id))) return false;
  // The host's part comes for the host, and only for her.
  if (data.role === "host" ? !isHostPart(data.host) : data.host !== null) return false;
  if (!(data.report === null || isText(data.report))) return false;
  const block = data.block;
  if (block !== null && !(isThing(block) && isText(block.label) && isText(block.sure) && isText(block.yes) && isText(block.no))) return false;
  const card = data.card;
  if (card === null) return true;
  return isThing(card) && isText(card.title) && isText(card.words) && isText(card.button) && isSentence(card.deadline) && isText(card.givenUp) && isText(card.notSaved) && isText(card.notConfirmed) && isText(card.checkAgain);
}

/**
 * Whether an answer really is what Stripe's card sheet needs: a secret for saving a card (never one
 * for a payment), and one of Stripe's keys that may be shown (never a secret key).
 */
export function isCardStep(data: unknown): data is AppCardStep {
  return isThing(data) && isText(data.clientSecret) && /^seti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(data.clientSecret) && isText(data.publishableKey) && /^pk_(test|live)_[A-Za-z0-9]+$/.test(data.publishableKey) && isText(data.merchant) && data.merchant.trim() !== "";
}

/** Whether an answer really is where an identity check stands, with the parts the screen reads. */
export function isIdentity(data: unknown): data is AppIdentity {
  if (!isThing(data) || typeof data.passed !== "boolean" || typeof data.pending !== "boolean" || !isText(data.title) || !isText(data.small)) return false;
  if (!Array.isArray(data.words) || !data.words.every(isText) || !isTextOrNull(data.button) || !isTextOrNull(data.tries)) return false;
  // The button that starts a check is the agreement to the notice: a button without its notice, whole, is no answer.
  if (data.button !== null) return isIdentityNotice(data.notice);
  return data.notice === null || isIdentityNotice(data.notice);
}

/**
 * Whether an address is Stripe's own page for an identity check: the only page the app opens in
 * the browser sheet for it, whatever the server's answer says. Locked (`https`), on Stripe's own
 * name for these pages, with no name and password in it.
 */
export function isStripeCheckPage(address: unknown): address is string {
  if (!isText(address)) return false;
  try {
    const url = new URL(address);
    return url.protocol === "https:" && url.hostname === "verify.stripe.com" && url.username === "" && url.password === "" && url.port === "";
  } catch {
    return false;
  }
}

/** The address of the app's own screen for a request: where the card sheet comes back to after a bank's approval. */
export function requestScreen(scheme: string, bookingId: string): string | null {
  return isId(bookingId) && /^[a-z][a-z0-9+.-]*$/.test(scheme) ? `${scheme}://bookings/${bookingId}` : null;
}

/** The time a customer chose on a host's page, as the summary's address carries it; null when it is not a time and a length. */
export function chosenTime(start: unknown, length: unknown): { start: string; length: number } | null {
  const minutes = Number(length);
  if (!isText(start) || !isMoment(start) || !isText(length) || !Number.isInteger(minutes) || minutes <= 0) return null;
  return { start: new Date(start).toISOString(), length: minutes };
}
