/**
 * The sentences of the page on which a customer asks a host for a call at a time, kept in one
 * place so that the website's page and the phone app say the same
 * (plans/45-phone-apps/06-asking-for-a-call.md).
 *
 * A sentence that stresses some words, or names an exact moment, is given in parts: the website
 * writes a moment in the browser's time zone, the phone in its own.
 */
import { formatMoney } from "@/lib/payments/access";
import { AFTER_CALL_MINUTES, LIMITS } from "./rules";

/** A piece of a sentence: plain words, words to stress, or an exact moment (as an ISO time). */
export type Part = string | { bold: string } | { time: string };

const CANCEL_RULE: Record<number, string> = {
  0: "You can cancel for free any time before the call starts.",
  60: "You can cancel for free until 1 hour before the call starts. After that, cancelling costs the full booked price.",
  720: "You can cancel for free until 12 hours before the call starts. After that, cancelling costs the full booked price.",
  1440: "You can cancel for free until 24 hours before the call starts. After that, cancelling costs the full booked price.",
};

/**
 * What is being asked for, said on the phone app's summary in the words the app stores' rules
 * turn on (plans/45-phone-apps/06-asking-for-a-call.md, "Keeping the 4.9%"): a live call between
 * two people that nobody records (the terms forbid recording, and Connect records none). The
 * cancelling rule beside it is the one that holds for this call: a free call can always be
 * cancelled for free, whatever rule the host has set for her paid ones.
 */
export function whatIsAskedFor(paid: boolean, freeCancelMinutes: number): string {
  return `A live, private one-to-one video call. It is not recorded. ${CANCEL_RULE[paid ? freeCancelMinutes : 0] ?? ""}`.trim();
}

export const BOOK_WORDS = {
  gone: "That time is no longer open",
  chooseAnother: "Choose another time",
  ownTitle: "This is your own page",
  own: "You cannot book a call with yourself.",
  title: (hostName: string) => `Ask ${hostName} for a call`,
  hostTime: (hostName: string, when: string) => `For ${hostName}: ${when}`,
  price: (totalCents: number, pricePer15Cents: number) => (totalCents > 0 ? `${formatMoney(totalCents)} at most (${formatMoney(pricePer15Cents)} per 15 minutes)` : "Free"),
  pointsTitle: (hostName: string) => `Request this time, subject to ${hostName}'s approval`,
  note: (hostName: string) => `What would you like to talk about? (optional, up to ${LIMITS.noteMax} characters; ${hostName} sees it, and Connect only if one of you reports the other)`,
  idLine: (hostName: string) => `${hostName} can see that your ID is confirmed, never your ID or the name on it.`,
  button: (paid: boolean) => (paid ? "Continue to card details" : "Send request"),
} as const;

/**
 * The points a customer reads before sending the request: that it is a request, by when the
 * answer comes, what it keeps free, and, for a paid call, everything about the money.
 */
export function bookPoints(input: { hostName: string; totalCents: number; freeCancelMinutes: number; answerBy: Date; payBy: Date; hostToo: boolean }): Part[][] {
  const { hostName } = input;
  const total = formatMoney(input.totalCents);
  const points: Part[][] = [
    [{ bold: "This is a request, not a reservation." }, ` Other people may ask for the same time, and ${hostName} chooses.`],
    ["You will have an answer by ", { time: input.answerBy.toISOString() }, ". If there is none by then, the request ends by itself."],
    [`While you wait, this time is kept for this request in your own Connect calendar: you cannot ask for another call that overlaps it or starts in the ${AFTER_CALL_MINUTES} minutes after it.`],
  ];
  if (input.hostToo) points.push([{ bold: "You are a host too:" }, " while this request waits, and during the call, nobody can book you at this time."]);
  points.push(["You can take the request back for free at any time before it is accepted."]);
  if (input.totalCents > 0) {
    points.push(
      [{ bold: "Nothing is held or charged now." }, ` If your request is accepted, ${total} is held on your card 2 days before the call (or right away, if the call is sooner). You do not need to come back for that.`],
      [
        `After the call you are charged for the time ${hostName} was in the call during the booked time, never more than ${total}. `,
        { bold: "That includes time they spend waiting if you are late or do not join." },
        " If they are late, leave early or do not show up, you do not pay for that time.",
      ],
      [CANCEL_RULE[input.freeCancelMinutes]],
      ["If your card cannot be held, we email you and you can fix it until ", { time: input.payBy.toISOString() }, ". After that an unpaid call is cancelled at no cost."],
    );
  } else points.push([CANCEL_RULE[0]]);
  return points;
}

/**
 * The words beside the box a customer must tick before a paid request is sent. **This is the
 * wording CARD_CONSENT_VERSION (rules.ts) names:** change the version whenever this changes.
 */
export function cardTermsWords(totalCents: number): string {
  return `I allow Connect to save my card for this booking only and, if my request is accepted, to hold up to ${formatMoney(totalCents)} on it without my being present, and to charge it after the call as described above. If I ask for more time during the call, the price of that extra time is held on the same card and charged in the same way. The card is removed once the call is over. Where a 14-day right to cancel applies to me (in the United Kingdom and Europe): I ask for this call to take place as booked, also within those 14 days, and I understand that the right ends once the call has taken place.`;
}

/** Shown in place of the summary when the customer must pass the identity check first. */
export const CONFIRM_ID_FIRST = {
  title: "One thing first",
  words: (reason: "free" | "host", hostName: string) =>
    `${reason === "free" ? "Before your first free call, please confirm who you are" : `${hostName} only takes calls from people who have confirmed their ID. Please confirm who you are`}: a photo of your ID and a selfie on Stripe's own pages, which we never see. It takes a couple of minutes and is needed once.`,
  small: (hostName: string) => `${hostName} will see only that your ID is confirmed, never your ID or the name on it.`,
  button: "Confirm who I am",
} as const;
