/**
 * The plain logic of a call's page and the lists of calls in the app
 * (plans/45-phone-apps/08-the-calls-page.md): checking the server's answers before a screen reads
 * them, and the address the card sheet comes back to. Plain logic with no phone in it, so it can
 * be tested on its own.
 */
import type { AppCallPage, AppCalls, AppPart, AppPayStep } from "../../../src/lib/app-door/types";
import { isId } from "./book-rules";

const isThing = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isMoment = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const isPart = (value: unknown): value is AppPart => isText(value) || (isThing(value) && (isText(value.bold) || isMoment(value.time)));
const isSentence = (value: unknown): value is AppPart[] => Array.isArray(value) && value.every(isPart);

const STATES = ["cancelled", "ended", "too_early", "pay", "host_waits", "blocked", "room"];

/** Whether an answer really is a call's page, with the parts the screen reads. */
export function isCallPage(data: unknown): data is AppCallPage {
  if (!isThing(data) || !isId(data.id) || !(data.role === "customer" || data.role === "host") || !isText(data.title) || !isText(data.roleWords)) return false;
  if (!isMoment(data.startsAt) || !isMoment(data.endsAt) || !isText(data.paidHow) || !isMoment(data.serverNow) || !isText(data.state) || !STATES.includes(data.state)) return false;
  if (!(data.words === null || isSentence(data.words)) || !isTextOrNull(data.small) || !isTextOrNull(data.notice)) return false;
  if (!(data.refreshSeconds === null || (typeof data.refreshSeconds === "number" && data.refreshSeconds > 0))) return false;
  const { pay, room, about, cancel, afterEnd } = data;
  // The way to "Report", "Block" and "Neither" comes with a call that is over, and with no other.
  if (afterEnd !== null && !(isThing(afterEnd) && isText(afterEnd.label) && afterEnd.label !== "")) return false;
  if (afterEnd !== null && data.state !== "ended") return false;
  if (pay !== null && !(isThing(pay) && isText(pay.title) && Array.isArray(pay.points) && pay.points.every(isSentence) && isText(pay.button) && isText(pay.givenUp) && isText(pay.notHeld) && isText(pay.notConfirmed) && isText(pay.checkAgain))) return false;
  // The confirm-and-pay step comes with the state "pay" and with no other; the room with "room" and with no other.
  if ((data.state === "pay") !== (pay !== null)) return false;
  if (room !== null && !(isThing(room) && isMoment(room.opensAt) && typeof room.open === "boolean" && isText(room.enter) && room.enter !== "")) return false;
  if ((data.state === "room") !== (room !== null)) return false;
  if (about !== null && !(isThing(about) && isText(about.title) && isText(about.text))) return false;
  return cancel === null || (isThing(cancel) && isText(cancel.words) && isText(cancel.button) && (cancel.shown === "free" || cancel.shown === "late_charge") && isText(cancel.yes) && isText(cancel.no));
}

/** Whether an answer really is a page of a person's calls, with the parts the screen reads. */
export function isCalls(data: unknown): data is AppCalls {
  if (!isThing(data) || !(data.kind === "coming" || data.kind === "past") || !isMoment(data.serverNow) || !isText(data.title) || !isTextOrNull(data.empty)) return false;
  if (typeof data.page !== "number" || !Number.isInteger(data.page) || data.page < 1 || typeof data.more !== "boolean" || !Array.isArray(data.calls)) return false;
  return data.calls.every(
    (call) =>
      isThing(call) && isId(call.id) && isMoment(call.startsAt) && isMoment(call.endsAt) && typeof call.minutes === "number" && isText(call.name) && isTextOrNull(call.photoId) && typeof call.hosting === "boolean" && typeof call.open === "boolean" && typeof call.finished === "boolean" && isText(call.payment) && isTextOrNull(call.status),
  );
}

/**
 * Whether an answer really is what Stripe's sheet needs to place a hold: a secret of a payment that
 * the server made (never one for saving a card, which is another step's), and one of Stripe's keys
 * that may be shown (never a secret key).
 */
export function isPayStep(data: unknown): data is AppPayStep {
  return isThing(data) && isText(data.clientSecret) && /^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(data.clientSecret) && isText(data.publishableKey) && /^pk_(test|live)_[A-Za-z0-9]+$/.test(data.publishableKey) && isText(data.merchant) && data.merchant.trim() !== "";
}

/** The address of the app's own screen for a call: where the card sheet comes back to after a bank's approval. */
export function callScreen(scheme: string, callId: string): string | null {
  return isId(callId) && /^[a-z][a-z0-9+.-]*$/.test(scheme) ? `${scheme}://calls/${callId}` : null;
}
