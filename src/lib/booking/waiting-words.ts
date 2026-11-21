/**
 * The sentences about the requests a host has to answer, kept in one place so that the website's
 * pages and the phone app say the same (plans/45-phone-apps/07-a-hosts-requests.md).
 */
import { NOW } from "./now-rules";

export const WAITING_WORDS = {
  title: (count: number) => `Requests for calls (${count})`,
  intro: "Several people may ask for the same time. Accepting one books the call and tells everyone else whose request it gets in the way of. A request you do not answer in time ends by itself.",
  /** About requests for a call right now. On the website the words "Available now" in the middle are a link to that page. */
  nowBefore: `A request for a call right now is listed here too, but it needs your answer within ${NOW.answerMinutes} minutes. Your `,
  nowPage: "Available now",
  nowAfter: " page shows those the moment they arrive.",
  empty: "Nothing is waiting for your answer.",
  many: (people: number) => `${people} people asked for this time. Choose one.`,
  newCustomer: "New: not enough ratings yet",
  idConfirmed: "ID confirmed",
  accept: "Accept",
  decline: "Decline",
  /** The phone app asks once more before it accepts: a touch by mistake would make a commitment. The moment stands between the two. */
  acceptSureBefore: (minutes: number) => `Accept a ${minutes}-minute call on `,
  acceptSureAfter: (price: string) => (price === "free" ? ", for free?" : ` for ${price}?`),
  acceptYes: "Accept",
  acceptNo: "Not now",
  /** A call asked for right away is answered where such calls arrive. */
  nowElsewhere: "A request for a call right now is answered on your Available now page.",
  theirNote: "Their note",
  /** The host's own notepad about a customer. */
  noteTitle: (name: string) => `About ${name}`,
  noteHint: "Your private notes. Only you can see them.",
  noteSave: "Save",
  noteSaved: "Saved.",
  noteNotSaved: "Nothing was saved. What you typed is still in the box.",
  accepted: "Accepted. The call is booked, and anyone else who asked for that time has been told.",
  declined: "Declined. The customer has been told.",
} as const;
