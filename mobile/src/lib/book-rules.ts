/**
 * The plain logic of asking for a call in the app
 * (plans/45-phone-apps/06-asking-for-a-call.md): checking the server's answers before a screen
 * reads them, and deciding which addresses the app may open or hand to Stripe's kit. Plain logic
 * with no phone in it, so it can be tested on its own.
 */
import type { AppBooking, AppBookSummary, AppCardStep, AppIdentity, AppPart } from "../../../src/lib/app-door/types";
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

/** Whether an answer really is a request's page, with the parts the screen reads. */
export function isBooking(data: unknown): data is AppBooking {
  if (!isThing(data) || !isId(data.id) || !isText(data.title) || !isTextOrNull(data.hostHandle) || !isText(data.stage) || !isText(data.stageWords) || !isTextOrNull(data.reason)) return false;
  if (!isMoment(data.startsAt) || !isWhole(data.minutes) || !isThing(data.price) || !isText(data.price.label) || !isText(data.price.words)) return false;
  if (!(data.hearBy === null || isMoment(data.hearBy)) || !isTextOrNull(data.waitingWords) || !isTextOrNull(data.takeBack) || !isTextOrNull(data.notice)) return false;
  const sure = data.takeBackSure;
  if (sure !== null && !(isThing(sure) && isText(sure.words) && isText(sure.yes) && isText(sure.no))) return false;
  // A request that can be taken back always comes with the question to ask first.
  if (data.takeBack !== null && sure === null) return false;
  if (!(data.refreshSeconds === null || (typeof data.refreshSeconds === "number" && data.refreshSeconds > 0))) return false;
  if (data.call !== null && !(isThing(data.call) && isId(data.call.id))) return false;
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
