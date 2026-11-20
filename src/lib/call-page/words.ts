/**
 * The sentences of one call's page before the call (who and when, the customer's confirm-and-pay
 * step, cancelling), kept in one place so that the website's page and the phone app say the same
 * (plans/45-phone-apps/08-the-calls-page.md).
 *
 * A sentence that stresses some words, or names an exact moment, is given in parts: the website
 * writes a moment in the browser's time zone, the phone in its own.
 */
import type { Part } from "@/lib/booking/book-words";

/** The host's cancelling rule for this call, as the customer reads it before paying. */
export function cancelRuleSentence(freeCancelMinutes: number, bookedPrice: string): string {
  if (freeCancelMinutes === 0) return "You can cancel for free at any time before the call starts.";
  const hours = freeCancelMinutes / 60;
  const when = hours === 1 ? "1 hour" : `${hours} hours`;
  return `You can cancel for free until ${when} before the call starts. After that, cancelling costs the full ${bookedPrice}, unless the host chooses to refund you.`;
}

/** What follows the booked times in the line under the title: how the call is paid for. */
export function paidHowWords(input: { kind: string | null; role: "host" | "customer"; pricePer15: string | null; upTo: string | null }): string {
  if (input.kind === null) return "Free call";
  return input.kind === "member_call" ? `paid from ${input.role === "customer" ? "your" : "the customer's"} membership, up to ${input.upTo}` : `${input.pricePer15} per 15 minutes, up to ${input.upTo}`;
}

/** The points of the confirm-and-pay step: what it costs, that it is only held, what is paid for, and the cancelling rule. */
export function payPoints(input: { pricePer15: string; bookedPrice: string; billing: string; cancelRule: string }): Part[][] {
  const { bookedPrice } = input;
  return [
    [`This call costs ${input.pricePer15} per 15 minutes, up to `, { bold: bookedPrice }, " in total."],
    [`${bookedPrice} is held on your card now. Nothing is charged until after the call, and you are never charged more than that.`],
    ...(input.billing === "together"
      ? [["You pay for the time ", { bold: "you and the host are both in the call" }, " during the booked time. Time only one of you was in is not charged."] as Part[]]
      : [
          ["You pay for the time the host is in the call during the booked time. ", { bold: "That includes time the host spends waiting if you are late or do not join." }] as Part[],
          ["If the host is late, leaves early or does not show up, you do not pay for that time."] as Part[],
        ]),
    [input.cancelRule],
  ];
}

/** What cancelling right now would mean, said above the button. */
export function cancelWords(input: { member: boolean; outcome: "free" | "late_charge"; bookedPrice: string | null }): string {
  if (input.member) {
    return input.outcome === "free"
      ? "Cancelling now is free. The time booked for this call goes back to the membership."
      : `Cancelling now is past the free period: all the membership time booked for this call (${input.bookedPrice}) is used. The host may choose to give time back.`;
  }
  return input.outcome === "free" ? "Cancelling now is free. Nothing is charged." : `Cancelling now is past the free period: the full ${input.bookedPrice} is charged. The host may choose to refund you.`;
}

/** What is said after a call was cancelled. */
export function cancelledWords(input: { member: boolean; outcome: "free" | "late_charge" }): string {
  if (input.outcome === "late_charge") {
    // What became of the time is on the page this goes to (used; or kept as it is while the month's payment is disputed).
    return input.member ? "The call was cancelled after the free period. The payment below says what became of the membership time booked for it." : "The call was cancelled after the free period, so the booked price is charged.";
  }
  return input.member ? "The call was cancelled. The payment below says what became of the membership time booked for it." : "The call was cancelled. Nothing is charged.";
}

export const CALL_WORDS = {
  title: (otherName: string) => `Call with ${otherName}`,
  role: (role: "host" | "customer") => `(you are the ${role})`,
  cancelled: "This call was cancelled.",
  ended: "This call has ended.",
  details: "See the details",
  /** The customer, more than 2 days before the start. The moment stands between the two. */
  tooEarlyBefore: "You can confirm and pay for this call from ",
  tooEarlyAfter: ".",
  tooEarlySmall: "That is 2 days before it starts.",
  hostWaits: (customerName: string) => `Waiting for ${customerName} to confirm and pay.`,
  hostWaitsSmall: (bookedPrice: string) => `The call can only start once ${bookedPrice} is held on their card.`,
  updatesByItself: " This page updates by itself.",
  blocked: "This call cannot go ahead because its payment is no longer in place.",
  payTitle: "Confirm and pay",
  payButton: (bookedPrice: string) => `Hold ${bookedPrice} and confirm the call`,
  payBusy: "Placing the hold…",
  payNotHeld: "Your card could not be held. Please try another card.",
  payNotConfirmed: "The hold could not be confirmed yet.",
  /** For the phone app, whose card form is a sheet that can be closed. */
  payGivenUp: "You closed the card form before the hold was placed. Nothing is held.",
  payCheckAgain: "Check again",
  payNotStarted: "Payment could not be started. Please try again.",
  payNotChecked: "Could not check the payment. Please try again.",
  payOnlyCustomer: "Only the customer can pay for this call.",
  payFromMembership: "This call is paid from your membership. There is nothing to pay by card.",
  notFound: "Call not found.",
  cancelButton: "Cancel this call",
  /** The phone app asks once more before it cancels, with the outcome's own sentence. */
  cancelYes: "Cancel the call",
  cancelNo: "Keep it",
  /** The phone app's Calls place. */
  comingTitle: "Coming calls",
  noComing: "You have no call coming up.",
  pastTitle: "Past calls",
  noPast: "No past calls yet.",
  noMore: "No more calls.",
  statusCancelled: "Cancelled",
  statusEnded: "Ended",
  aboutTitle: (customerName: string) => `About ${customerName}`,
  /** What cancelling means changed between the page being shown and the button being pressed. */
  cancelChanged: "Cancelling this call is no longer free: its free period has just ended. Nothing was cancelled. Please read what cancelling means now.",
} as const;
