/**
 * A host's page's own sentences that both the website's page and the phone app show
 * (plans/45-phone-apps/05-search-and-a-hosts-page.md), kept in one place so the two say the same.
 */
import { lengthWords } from "@/lib/booking/rules";
import { formatMoney } from "@/lib/payments/access";
import { bookedTotalCents } from "@/lib/payments/pricing";

const CANCEL_RULE: Record<number, string> = {
  0: "Free to cancel any time before the call starts.",
  60: "Free to cancel until 1 hour before the call starts.",
  720: "Free to cancel until 12 hours before the call starts.",
  1440: "Free to cancel until 24 hours before the call starts.",
};

/** "$20.00 per 15 minutes", or that the call is free. */
export function priceWords(pricePer15Cents: number): string {
  return pricePer15Cents === 0 ? "Free private video call" : `${formatMoney(pricePer15Cents)} per 15 minutes`;
}

/** What the call is, and until when it can be cancelled for free. */
export function callWords(freeCancelMinutes: number): string {
  return `A private one-to-one video call. ${CANCEL_RULE[freeCancelMinutes] ?? ""}`.trim();
}

/** One length in a list to choose from: "30 minutes, $40.00", or only the length when the call is free. */
export function lengthChoice(minutes: number, pricePer15Cents: number): string {
  return `${lengthWords(minutes)}${pricePer15Cents > 0 ? `, ${formatMoney(bookedTotalCents(pricePer15Cents, minutes * 60))}` : ""}`;
}

/** The heading over the ordinary way of asking for a call. */
export function askTitle(member: boolean, availableNow: boolean): string {
  return member ? "Or ask the ordinary way, at the regular price" : availableNow ? "Or ask for a call later" : "Ask for a call";
}

/** Why nothing can be asked for, when nothing can: the host takes no calls now, or cannot be paid yet. Null when she can be asked. */
export function notTakingWords(displayName: string, offer: { canTakePaid: boolean } | null, chosen: number | null): string | null {
  if (!offer || !chosen) return `${displayName} is not taking calls at the moment.`;
  return offer.canTakePaid ? null : `${displayName} is not taking calls yet.`;
}

export const ASK_WORDS = {
  /** Under the heading, when she can be asked. The host's name follows "and". */
  notReserved: (displayName: string) => `This sends a request. It does not reserve the time: others may ask for it too, and ${displayName} chooses.`,
  noTimes: "There are no open times for this length right now. Please look again later.",
} as const;

/** The lines about a membership that is not (or not yet) running. */
export function membershipStateWords(status: "joining" | "unpaid" | "paused"): string {
  return status === "joining"
    ? "You are at the card step: you are a member once your card is entered."
    : status === "unpaid"
      ? "Your monthly payment did not go through. Until it does you have no member time."
      : "Your membership is paused. It costs nothing and gives no member time.";
}
