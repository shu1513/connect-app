/**
 * The sentences of "End call now" (plans/50-end-call-now.md): the question before the press, the
 * screen after it with its three choices, what the call's page says about the money, and the two
 * messages of the guard. One set for the website and for the phone app, which is sent them.
 * Plain words, nothing of the server in them.
 */
import { END_GUARD } from "@/lib/safety/end-guard";

type Role = "host" | "customer";

/** What a press costs the person who presses, for the question before it. */
export type EndCost = "free" | "together" | "host_minutes" | "whole_booking";

/** Which of the four it is, from the call and the person's role. */
export function endCostFor(input: { role: Role; billing: string; pricePer15Cents: number }): EndCost {
  if (input.pricePer15Cents <= 0) return "free";
  if (input.billing === "together") return "together";
  return input.role === "host" ? "host_minutes" : "whole_booking";
}

/**
 * How a call ended with the button is charged, as far as the call's own facts say it:
 *   together      an "available now" call: the time both were in the call
 *   minutes       the host pressed: her time up to the press
 *   whole         the customer pressed: his whole booked time
 *   lowered       the customer pressed and then reported the host: the time the call lasted
 *   not_lowered   the customer pressed and reported, and the guard did not lower it
 */
export type EndMoney = "free" | "together" | "minutes" | "whole" | "lowered" | "not_lowered";

export function endMoneyFor(call: { billing: string; pricePer15Cents: number; endedNowBy: string | null; endReportEffect: string | null }): EndMoney {
  if (call.pricePer15Cents <= 0) return "free";
  if (call.billing === "together") return "together";
  if (call.endedNowBy !== "customer") return "minutes";
  if (call.endReportEffect === "minutes" || call.endReportEffect === "minutes_uncounted") return "lowered";
  return call.endReportEffect === "whole" ? "not_lowered" : "whole";
}

const SURE = "End this call for both of you? Nobody can come back in.";

export const END_WORDS = {
  button: "End call now",
  /** The question before the press: what it does, and what it costs the person who presses. */
  sure: (cost: EndCost): string =>
    cost === "whole_booking"
      ? `${SURE} Your whole booked time is still charged.`
      : cost === "host_minutes"
        ? `${SURE} You are paid for your time up to now.`
        : cost === "together"
          ? `${SURE} The time you were both in the call is charged.`
          : SURE,
  yes: "Yes, end the call",
  no: "No",

  /** The screen after the press. */
  title: "The call has ended",
  /**
   * Who ended it. "Nobody can come back in" is said only once the room is written down as closed: an entry pass handed
   * out just before the press stays good until the video service has confirmed the closing.
   */
  byYou: (closed: boolean) => (closed ? "You ended this call for both of you. Nobody can come back in." : "You ended this call. It is being closed for both of you."),
  byOther: (name: string, closed: boolean) => (closed ? `${name} ended this call for both of you. Nobody can come back in.` : `${name} ended this call. It is being closed for both of you.`),
  /** The room had closed already when the button was pressed: nothing was ended, the call was simply over. */
  alreadyOver: "This call was already over.",
  what: "Is there anything else you want to do?",
  reportWhat: (name: string) => `Tell us what happened. Only our team reads it. Reporting also blocks ${name}.`,
  /** For a customer who pressed, when it is so: said openly, so that nobody who was treated badly believes they must pay for the whole booking. */
  reportLowers: (name: string) => `If you report ${name}, this call is charged only for the time it lasted.`,
  reportDoesNotLower: "A report does not change what this call is charged: reports made after ending a call have lowered your charge several times lately.",
  blockWhat: (name: string) =>
    `${name} can no longer ask you for calls or write to you. Your other calls with ${name} that are still to come are cancelled at no charge, and any membership or monthly contribution between you ends. ${name} is not told.`,
  neither: "Neither",
  neitherWhat: (name: string) => `Nothing else happens. You can still report or block ${name} later from this call's page.`,
  toResults: "See the call's page",

  /**
   * What the call's page says about the money. `other` is the other person as this viewer knows them.
   * A host is never told that she was reported: for her a lowered charge reads like any charge by the minutes.
   */
  money: (viewer: Role | "admin", money: EndMoney, names: { host: string; customer: string }): string | null => {
    if (money === "free") return null;
    if (money === "together") return "Only the time both were in the call up to that moment is charged.";
    if (viewer === "customer") {
      if (money === "minutes") return `You pay only for the time ${names.host} was in the call up to that moment.`;
      if (money === "lowered") return `You reported ${names.host} after ending it, so it is charged only for the time it lasted, not the whole booking.`;
      if (money === "not_lowered") return "Your report was saved. The call is still charged for your whole booked time: reports made after ending a call have lowered your charge several times lately.";
      return `Because you ended it, your whole booked time is charged: the time ${names.host} was in the call, and the rest of the booking. Time you waited for ${names.host} is not charged.`;
    }
    if (viewer === "host") {
      if (money === "whole" || money === "not_lowered") return `Because ${names.customer} ended it, the whole booked time is charged: your time in the call, and the rest of the booking.`;
      return "Only your time in the call up to that moment is charged.";
    }
    if (money === "minutes") return "Only the host's time in the call up to that moment is charged.";
    if (money === "lowered") return "The customer reported the host afterwards, so only the host's time in the call up to that moment is charged.";
    if (money === "not_lowered") return "The customer reported the host afterwards, and the guard did not lower the charge: the whole booked time is charged.";
    return "Because the customer ended it, the whole booked time is charged: the host's time in the call, and the rest of the booking.";
  },
  /** Under the money line: nothing is taken yet, and where the amount will be. */
  moneyWhen: "The money is taken about a day after the call. The amount is on the call's page a few minutes after the call.",

  /** Added to the thank-you after a report that decided the charge. */
  thanksLowered: "This call is charged only for the time it lasted, not the whole booking.",
  thanksNotLowered:
    "This call is still charged for the whole booked time: reports made after ending a call have lowered your charge several times lately, so this one does not. If you think the charge is wrong, ask for a refund on the call's page or write to us.",

  /** To the customer whose report did not lower the charge: a message with its email, long before the money is taken. */
  customerSubject: "Your report was saved. The call's charge stays as it is",
  customerText: (hostName: string) =>
    `Your report about ${hostName} was saved, and ${hostName} is blocked.\n\nThe call you ended is still charged for the whole booked time. Reports made after ending a call have lowered your charge several times lately, so this one does not.\n\nIf you think the charge is wrong, you can ask for a refund on the call's page, or write to us.`,

  /** To the founder, once, when a customer crosses the line. No detail of any report. */
  founderSubject: "A customer has ended calls and reported the host several times",
  founderText: (customer: { name: string; email: string }) =>
    `${customer.name} (${customer.email}) has ended a call and then reported the host ${END_GUARD.line} times among their last ${END_GUARD.calls} calls. Each time, the report lowered what they paid.\n\nA further report will not lower their charge while this stays so. Their reports and blocks still go through, and nothing else was changed.\n\nYou can look at the account and its reports, and pause it if you think that is right.`,

  /** Why a charge that includes the rest of the booking is what it is, on the receipt. */
  whyWhole: (viewer: Role | "admin") => (viewer === "customer" ? "You ended the call: the time the host was in the call, and the rest of the booked time" : "The customer ended the call: the time the host was in the call, and the rest of the booked time"),
} as const;
