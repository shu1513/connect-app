/**
 * The sentences a person agrees to when they join or resume, and their version. One place: the
 * page shows them from here and `join.ts` records the version, so the two can never differ.
 * Change a sentence, change the version.
 */
import { timeWords } from "./rules";

export const MEMBERSHIP_WORDING_VERSION = "2026-11-20";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** What the person agrees to, with this host's numbers in it. */
export function agreementSentences(input: { hostName: string; monthlyCents: number; includedMinutes: number }): string[] {
  const { hostName, monthlyCents, includedMinutes } = input;
  return [
    `You pay ${money(monthlyCents)} a month, starting today. It renews by itself every month until you cancel.`,
    `If ${hostName} lowers the member price, you pay less from your next month; your time stays the same.`,
    `Each month gives you ${timeWords(includedMinutes)} of calls with ${hostName}. Time you have not used when a month ends expires and is not paid back.`,
    `You can cancel at any time on "Your account"; your membership then runs to the end of the month you paid for.`,
    `At the start of each month the amount is first only held on your card. It is taken when you make your first booking of that month, or after 72 hours, whichever comes first (sooner if your card's hold ends sooner; "Your account" shows the exact time). Until it is taken you can choose "Cancel now": then nothing is charged for that month and your membership is paused that day. (Cancelling the normal way does not let the hold go: the month is yours, and its amount is taken.)`,
    // The legal agreements (docs/legal/payment-terms.md, section 12.3), said to everyone so that nobody is asked where they live.
    `Where a 14-day right to cancel applies to you (in the United Kingdom and Europe): you can cancel a new membership within 14 days of joining by writing to us. Time you booked or used in those days is paid for at the member price, because by booking a call you ask for it to take place as booked.`,
  ];
}

/** The box the person ticks. */
export function agreementBox(hostName: string): string {
  return `I agree to this, and to my card being kept for the monthly payment and for extra time during a call with ${hostName} that my membership time does not cover. It renews every month until I cancel.`;
}
