/**
 * The plain rules of a tip after a call (plans/44). No database, no Stripe: every function here is
 * tested on its own.
 *
 * A tip is kept in the contribution's books (kind "tip"), so its money moves as a contribution
 * made once does. What is its own: who may be asked and when, the amounts, and the fee. The host
 * gets the whole tip; what the card payment costs is added on top for the customer (decision 6).
 */
import { splitCharge, type FeeTerms } from "@/lib/payments/pricing";
import type { RateState } from "@/lib/ratings/rules";
import { CONTRIBUTION, ContributionError, readSum } from "./rules";

export const TIP = {
  /** The smallest tip: $2.00. */
  minCents: 200,
  /** The three amounts the box offers, beside "another amount". */
  suggestedCents: [200, 500, 1000],
  /** After a rating of this many stars or fewer the customer is no longer asked (decision 2). */
  lowStars: 3,
} as const;

/**
 * The fee terms a tip's payment is written with: what the card payment costs (2.9% plus 30 cents),
 * and nothing of Connect's own. Nothing extra for a card from outside the United States: that is
 * only known once the card was typed, the host still gets the whole tip, and Connect carries it.
 */
export const TIP_FEE_TERMS: FeeTerms = { percentBps: 290, fixedCents: 30, foreignCardBps: 0 };

/** What reaches the host of a payment written with the tip's terms. */
const reaches = (chargeCents: number): number => splitCharge(chargeCents, TIP_FEE_TERMS, false).hostShareCents;

/**
 * What the customer pays for a tip: the smallest amount that leaves the whole tip once the payment
 * fee is taken off. One more cent paid raises the fee by nothing or by one cent, so what reaches
 * the host goes up by one cent or stays: no tip is skipped, and the first amount that reaches the
 * tip leaves exactly the tip. ($2 costs $2.37, $5 costs $5.46, $10 costs $10.61.)
 */
export function chargeFor(tipCents: number): number {
  if (!Number.isInteger(tipCents) || tipCents < 1) throw new Error("A tip is a whole number of cents, one or more.");
  // Started a little below where it must lie, then walked up: at most a few steps.
  let charge = Math.max(tipCents + TIP_FEE_TERMS.fixedCents, Math.floor(((tipCents + TIP_FEE_TERMS.fixedCents) * 10_000) / (10_000 - TIP_FEE_TERMS.percentBps)) - 2);
  while (reaches(charge) < tipCents) charge++;
  return charge;
}

/** The payment fee that is added to a tip. */
export const feeFor = (tipCents: number): number => chargeFor(tipCents) - tipCents;

/** The largest tip: the one whose payment is still within the ceiling of every card payment on Connect ($100,000). */
export const MAX_TIP_CENTS = ((): number => {
  let tip = reaches(CONTRIBUTION.maxCents);
  while (chargeFor(tip) > CONTRIBUTION.maxCents) tip--;
  return tip;
})();

/**
 * Reads a tip typed in dollars and cents ("5", "7.50") and gives it back in cents, or refuses it in
 * words for the person. Its own reader: the smallest contribution stays $5, the smallest tip is $2.
 */
export function readTip(typed: string): number {
  const tooLarge = `The largest tip is $${(MAX_TIP_CENTS / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`;
  const tip = readSum(typed, tooLarge);
  if (tip < TIP.minCents) throw new ContributionError("The smallest tip is $2.");
  if (tip > MAX_TIP_CENTS) throw new ContributionError(tooLarge);
  return tip;
}

/** Everything that decides whether the customer of a call may give a tip for it right now (decision 1). */
export type TipFacts = {
  /** Who is asking, as the call sees them. */
  role: "host" | "customer" | "admin" | null;
  /** Where the call stands for rating: a call that can be rated ("open") is a call that can be tipped. */
  rating: RateState;
  /** Either has reported the other, whatever about and whatever became of the report. */
  reported: boolean;
  /** Either has blocked the other. */
  blocked: boolean;
  /** The customer has asked for a refund of this call, whatever the answer was. */
  refundAsked: boolean;
  /** The stars the customer gave for this call, or null. */
  stars: number | null;
  /** A tip for this call that is not certainly gone: being paid, held, taken, or still being cancelled. */
  tipThere: boolean;
  /** The host's account is open and not paused, and her host page is approved. */
  hostCanReceive: boolean;
  /** The customer's own account is open and not paused. */
  customerActive: boolean;
  /** The founder's switch. */
  tipsOn: boolean;
  /** Connect's own Stripe key is set. */
  stripeReady: boolean;
  /** The box about the host's project is shown on this page: then the tip box is not (decision 3). */
  projectBoxShown: boolean;
};

/** Why no tip can be given, in one word, or null when it can. The first reason that applies. */
export function whyNoTip(facts: TipFacts): "not_the_customer" | "call" | "trouble" | "stars" | "tip_there" | "host" | "paused" | "off" | "project" | null {
  if (facts.role !== "customer") return "not_the_customer";
  // The call took place, its record is final, and its 7 days are not over: the rating's own conditions.
  if (facts.rating !== "open") return "call";
  if (facts.reported || facts.blocked || facts.refundAsked) return "trouble";
  if (facts.stars !== null && facts.stars <= TIP.lowStars) return "stars";
  if (facts.tipThere) return "tip_there";
  if (!facts.tipsOn || !facts.stripeReady) return "off";
  if (!facts.hostCanReceive) return "host";
  if (!facts.customerActive) return "paused";
  if (facts.projectBoxShown) return "project";
  return null;
}

export const mayTip = (facts: TipFacts): boolean => whyNoTip(facts) === null;

/** Said for everything about the call and the two people that stands in the way: from here they all look the same. */
export const NO_TIP = "A tip cannot be given for this call at the moment.";
export const TIPS_OFF = "Tips are not open at the moment.";
export const TIP_THERE = 'There is already a tip for this call. You find it on "Your account", under "Tips you gave".';

/** Why a tip is refused, in words for the customer. The page before paying and the start of a tip say the same. */
export function refusal(why: NonNullable<ReturnType<typeof whyNoTip>>): string {
  if (why === "tip_there") return TIP_THERE;
  if (why === "off") return TIPS_OFF;
  if (why === "paused") return "Your account is paused, so you cannot give a tip at the moment.";
  return NO_TIP;
}

/** The day of a call, in words, in the reader's own time zone: "November 18". */
export function callDay(person: { timeZone: string | null }, startsAt: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: person.timeZone ?? "America/New_York", month: "long", day: "numeric" }).format(startsAt);
}

/**
 * The sentences a person sees before they pay a tip, and their version (decision 8). One place:
 * the page shows them from here and the start records the version, so the two can never differ.
 * Change a sentence, change the version.
 */
export const TIP_WORDING_VERSION = "2026-11-20";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const cents = (amount: number) => (amount < 100 ? `${amount} cents` : money(amount));

export function tipSentences(input: { tipCents: number; hostName: string; callOn: string }): string[] {
  const { tipCents, hostName, callOn } = input;
  return [
    `You pay ${money(chargeFor(tipCents))}, once: a tip of ${money(tipCents)} for your call with ${hostName} on ${callOn}, and a payment fee of ${cents(feeFor(tipCents))}.`,
    `${hostName} receives the whole ${money(tipCents)}. Connect keeps nothing of it; the payment fee covers what the payment itself costs.`,
    `The amount is first only held on your card, normally for three days, and taken after that. Until it is taken you can cancel and pay nothing.`,
    `A bank can make that time shorter for a card. You are always shown, and sent by email, the real moment your money is taken.`,
    `A tip is a thank-you for a call that has taken place. It does not buy another call or any promised reward, and it is not a donation to a charity.`,
    `Once money has been taken, giving it back is ${hostName}'s decision.`,
  ];
}
