/**
 * The sentences of the page of one request for a call, kept in one place so that the website's
 * page and the phone app say the same (plans/45-phone-apps/06-asking-for-a-call.md).
 */
import { formatMoney } from "@/lib/payments/access";
import type { Part } from "./book-words";
import { PASSED_OVER } from "./rules";

const STAGE_FOR_CUSTOMER: Record<string, string> = {
  card: "Almost there: enter your card to send the request.",
  waiting: "Sent. Waiting for the host's answer.",
  accepted: "Accepted. Your call is booked.",
  declined: "The host could not take this request.",
  passed_over: "The host accepted another request for that time.",
  ran_out: "This request ended without an answer.",
  taken_back: "You took this request back.",
  cancelled: "This call was cancelled.",
};
/** A booking a member made with their membership time: no request, no answer, no card step. */
const MEMBER_STAGE_FOR_CUSTOMER: Record<string, string> = {
  paying: "We are taking this month's payment. Your call is booked as soon as that is done.",
  accepted: "Booked with your membership.",
  ran_out: "This call was not booked.",
  cancelled: "This call was cancelled.",
};
const MEMBER_STAGE_FOR_HOST: Record<string, string> = {
  accepted: "Booked by a member of yours. There is nothing for you to accept.",
  cancelled: "This call was cancelled.",
};
const STAGE_FOR_HOST: Record<string, string> = {
  waiting: "Waiting for your answer.",
  accepted: "You accepted. The call is booked.",
  declined: "You declined this request.",
  passed_over: "You accepted another request for that time.",
  ran_out: "This request ended because it was not answered in time.",
  taken_back: "The customer took this request back.",
  cancelled: "This call was cancelled.",
};

/** A request that ended because a call the host booked for herself took its time (plans/42). The customer is not told why she is not free. */
const OWN_CALL_FOR_CUSTOMER = "The host is no longer free at that time.";
const OWN_CALL_FOR_HOST = "A call you booked yourself took this time.";

type Told = { stage: string; source: string; endedReason: string | null; totalCents: number; lengthMinutes: number };

/** The heading of the page. */
export function requestTitle(booking: Told, role: "host" | "customer", otherName: string | undefined): string {
  if (booking.source === "member") return role === "host" ? `Call with ${otherName}` : `Your call with ${otherName}`;
  return role === "host" ? `Request from ${otherName}` : `Your request to ${otherName}`;
}

/** Where the request stands, in one sentence, for the one of its two people who is looking. */
export function stageWords(booking: Told, role: "host" | "customer"): string {
  if (booking.stage === "passed_over" && booking.endedReason === PASSED_OVER.ownCall) return role === "host" ? OWN_CALL_FOR_HOST : OWN_CALL_FOR_CUSTOMER;
  const byMember = booking.source === "member";
  return (byMember ? (role === "host" ? MEMBER_STAGE_FOR_HOST : MEMBER_STAGE_FOR_CUSTOMER) : role === "host" ? STAGE_FOR_HOST : STAGE_FOR_CUSTOMER)[booking.stage] ?? booking.stage;
}

/** Why a request that never reached an answer ended, for its customer; null when there is nothing to add. */
export function endedWords(booking: Told, role: "host" | "customer"): string | null {
  if (role !== "customer" || booking.stage !== "ran_out" || !booking.endedReason) return null;
  return booking.source === "member" ? `${booking.endedReason} No membership time was used for it.` : `Reason: ${booking.endedReason.replace(/\.$/, "")}.`;
}

/** The label and the words of the price line. */
export function requestPrice(booking: Told): { label: string; words: string } {
  const byMember = booking.source === "member";
  return {
    label: byMember ? "Paid from the membership" : "Price",
    words: byMember ? `${booking.lengthMinutes} minutes of membership time (${formatMoney(booking.totalCents)} at most)` : booking.totalCents > 0 ? `${formatMoney(booking.totalCents)} at most` : "Free",
  };
}

/** By when the card must be entered: an unfinished request is dropped after that. */
export function cardDeadlineWords(until: Date): Part[] {
  return ["Enter your card by ", { time: until.toISOString() }, ". After that this unsent request ends by itself."];
}

export const REQUEST_WORDS = {
  hearBy: (role: "host" | "customer") => (role === "host" ? "Answer by" : "You will hear by"),
  cardTitle: "Your card",
  card: "Nothing is held or charged now. Your card is kept by Stripe for this booking only. The request is sent as soon as the card is saved.",
  cardNotLoaded: "The card form could not be loaded just now. Nothing was sent and nothing is held.",
  cardNotLoadedAfter: "An unfinished request disappears by itself.",
  cardButton: "Save card and send request",
  /** For the phone app, whose card form is a sheet that can be closed: what it says after the sheet, when the request is still not sent. */
  cardGivenUp: "You closed the card form before a card was saved. Nothing was sent.",
  cardNotSaved: "Your card could not be saved. Nothing was sent. Please try again, or try another card.",
  cardNotConfirmed: "Your card could not be confirmed yet. Please try again in a moment.",
  /** The button that asks once more whether a card that was entered has been saved, without opening the card form again. */
  cardCheckAgain: "Check again",
  /** Under a request that waits for the host's answer. */
  waiting: (paid: boolean) => `This is a request, not a reservation. Other people may ask for the same time, and the host chooses.${paid ? " Nothing is held on your card unless you are accepted." : ""}`,
  takeBack: "Take this request back",
  /** The phone app asks once more before taking a request back. */
  takeBackSure: "The host will no longer be able to accept it. This cannot be undone.",
  takeBackYes: "Take it back",
  takeBackNo: "Keep it",
  cardTooLate: "The time to enter a card for this request has passed. Nothing was sent.",
  cardNotNeeded: "This request does not need a card any more.",
  takenBack: "Your request was taken back. Nothing was held or charged.",
  callPage: "Open the call's page",
  /** What else the call's page is for, said beside its link to the customer of an accepted call; an empty string when nothing is. */
  callPageAlso: (booking: Told) => (booking.stage !== "accepted" ? "" : booking.source === "member" ? " (this is also where you can cancel it)" : booking.totalCents > 0 ? " (this is also where you can pay by hand if your card needs attention)" : ""),
} as const;
