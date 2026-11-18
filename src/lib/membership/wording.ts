/**
 * The sentences a person agrees to when they join or resume, and their version. One place: the
 * page shows them from here and `join.ts` records the version, so the two can never differ.
 * Change a sentence, change the version.
 */
import { timeWords } from "./rules";

export const MEMBERSHIP_WORDING_VERSION = "2026-11-18";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** What the person agrees to, with this host's numbers in it. */
export function agreementSentences(input: { hostName: string; monthlyCents: number; includedMinutes: number }): string[] {
  const { hostName, monthlyCents, includedMinutes } = input;
  return [
    `You pay ${money(monthlyCents)} a month, starting today, until you cancel.`,
    `If ${hostName} lowers the member price, you pay less from your next month; your time stays the same.`,
    `Each month gives you ${timeWords(includedMinutes)} of calls with ${hostName}. Time you have not used when a month ends expires and is not paid back.`,
    `You can cancel at any time on "Your account"; your membership then runs to the end of the month you paid for.`,
    `At the start of each month the amount is first only held on your card. It is taken when you make your first booking of that month, or after 72 hours, whichever comes first (sooner if your card's hold ends sooner; "Your account" shows the exact time). If you cancel before it is taken, nothing is charged.`,
  ];
}

/** The box the person ticks. */
export function agreementBox(hostName: string): string {
  return `I agree to this, and to my card being kept for the monthly payment and for extra time during a call with ${hostName} that my membership time does not cover.`;
}
