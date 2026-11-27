/**
 * The sentences of "End call now" (plans/51-end-call-now.md): the question before the press, the
 * screen after it with its three choices, what the call's page says about the money, and the two
 * messages of the guard. One set for the website and for the phone app, which is sent them.
 * Plain words, nothing of the server in them.
 *
 * Every sentence about money is true in every case it is shown in: where the amount still depends
 * on something that is not known yet (was the host in the call at that moment?), the sentence
 * says so instead of promising one outcome.
 */
import { cancellationOutcome } from "@/lib/payments/rules";
import { END_GUARD } from "@/lib/safety/end-guard";

type Role = "host" | "customer";

/** What a press costs the person who presses, for the question before it. */
export type EndCost = "free" | "together" | "host_minutes" | "whole_booking" | "before_start" | "customer_minutes";

/**
 * Which it is, from the call and the person's role. A customer is asked with "your whole booked
 * time is still charged" only when his booking was made under words that say so (`wholeBookingSaid`,
 * booking/rules.ts): the press is then written and charged that way, and otherwise by the host's
 * time. `beforeStart`: the booked start has not come yet; such a press is charged as a
 * cancellation at that moment would be.
 */
export function endCostFor(input: { role: Role; billing: string; pricePer15Cents: number; wholeBookingSaid: boolean; beforeStart?: boolean }): EndCost {
  if (input.pricePer15Cents <= 0) return "free";
  if (input.billing === "together") return "together";
  if (input.role === "host") return "host_minutes";
  if (!input.wholeBookingSaid) return "customer_minutes";
  return input.beforeStart ? "before_start" : "whole_booking";
}

/**
 * How a call ended with the button is charged, as far as the call's own row says it:
 *   together        an "available now" call: the time both were in the call
 *   minutes         the host pressed (or a customer who was never told the rule): the host's time up to the press
 *   whole           the customer pressed during the call: his whole booked time (if the host was in the call then)
 *   free_early      the customer pressed before the booked start while cancelling was still free: nothing
 *   whole_early     the customer pressed before the booked start, after that time: the whole booking
 *   lowered         the customer pressed and then reported the host: the time the call lasted
 *   not_lowered     the customer pressed and reported, and the guard did not lower it (`_early`: pressed before the
 *                   booked start, after the time in which cancelling was free)
 */
export type EndMoney = "free" | "together" | "minutes" | "whole" | "free_early" | "whole_early" | "lowered" | "not_lowered" | "not_lowered_early";

export function endMoneyFor(call: { billing: string; pricePer15Cents: number; endedNowBy: string | null; endReportEffect: string | null; startsAt: Date; safetyEndedAt: Date | null; freeCancelMinutes: number }): EndMoney {
  if (call.pricePer15Cents <= 0) return "free";
  if (call.billing === "together") return "together";
  const early = call.safetyEndedAt !== null && call.safetyEndedAt < call.startsAt;
  // A customer who pressed before the start while cancelling was free pays nothing, told or not.
  if (early && call.endedNowBy !== "host" && call.endedNowBy !== null && cancellationOutcome({ by: "customer", now: call.safetyEndedAt!, startsAt: call.startsAt, freeCancelMinutes: call.freeCancelMinutes, held: true }) !== "late_charge") return "free_early";
  if (call.endedNowBy !== "customer") return "minutes";
  if (call.endReportEffect === "minutes" || call.endReportEffect === "minutes_uncounted") return "lowered";
  if (call.endReportEffect === "whole") return early ? "not_lowered_early" : "not_lowered";
  return early ? "whole_early" : "whole";
}

/** What the button does. Said as what will happen: that both are out is only known once the video service has confirmed it. */
const SURE = "End this call for both of you? Nobody will be able to come back in.";
/** Why a report no longer lowers a charge: said as what happened, accusing nobody. True whatever each report saved in dollars. */
const SEVERAL = "reports made after ending a call have already changed your charge from the whole booking to the minutes several times lately";
const SEVERAL_SENTENCE = `R${SEVERAL.slice(1)}`;

export const END_WORDS = {
  button: "End call now",
  /** The question before the press: what it does, and what it costs the person who presses. */
  sure: (cost: EndCost): string =>
    cost === "whole_booking"
      ? `${SURE} Your whole booked time is still charged, except time the host was not in the call.`
      : cost === "before_start"
        ? `${SURE} The call has not started yet. Ended before its start, it is charged as cancelling it would be; once it has started, your whole booked time is charged.`
        : cost === "host_minutes"
          ? `${SURE} You are paid for your time up to now.`
          : cost === "together"
            ? `${SURE} The time you were both in the call is charged.`
            : cost === "customer_minutes"
              ? `${SURE} You pay for the time the host was in the call up to now.`
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
  /**
   * For a customer who pressed, when it is so: said openly, so that nobody who was treated badly believes they must
   * pay for the whole booking. `partly`: a part of the call's money is already taken (or on its way), and stays as it is.
   */
  reportLowers: (name: string, partly: boolean) =>
    partly ? `If you report ${name}, what has not been charged yet for this call is charged only for the time it lasted.` : `If you report ${name}, this call is charged only for the time it lasted.`,
  reportDoesNotLower: `A report does not change what this call is charged: ${SEVERAL}.`,
  blockWhat: (name: string) =>
    `${name} can no longer ask you for calls or write to you. Your other calls with ${name} that are still to come are cancelled at no charge, and any membership or monthly contribution between you ends. ${name} is told that those have ended, never that you blocked them.`,
  /** The block stands. Nothing more is claimed: whether every call still to come was cancelled is said when the block is made. */
  blocked: (name: string) => `You have blocked ${name}.`,
  blockAgain: (name: string) => `Block ${name} again`,
  /** Under that button: what blocking again does, with nothing claimed about what the first block managed. */
  blockAgainWhat: (name: string) => `Blocking again tries once more to cancel any calls with ${name} that are still to come. ${name} is not told.`,
  /** On the phone app's page of a call that is over: the way to the same choices later. */
  reportOrBlock: (name: string) => `Report or block ${name}`,
  neither: "Neither",
  neitherWhat: (name: string) => `Nothing else happens. You can still report or block ${name} later from this call's page.`,
  toResults: "See the call's page",

  /**
   * What the call's page says about the money. A host is never told that she was reported: for her a lowered charge
   * reads like any charge by the minutes, and a report that was not lowered like no report at all.
   */
  money: (viewer: Role | "admin", money: EndMoney, names: { host: string; customer: string }): string | null => {
    if (money === "free") return null;
    if (money === "together") return "Only the time both were in the call up to that moment is charged.";
    if (viewer === "customer") {
      if (money === "minutes") return `You pay only for the time ${names.host} was in the call up to that moment.`;
      if (money === "free_early") return "You ended it before its booked start, while cancelling was still free: nothing is charged.";
      if (money === "whole_early") return "You ended it before its booked start, after the time in which cancelling was free: the whole booking is charged, as for a late cancellation.";
      if (money === "lowered") return `You reported ${names.host} after ending it, so what had not been charged yet is charged only for the time the call lasted, not the whole booking.`;
      if (money === "not_lowered" || money === "not_lowered_early") return `Your report was saved. It does not change what this call is charged: ${SEVERAL}.`;
      return `Because you ended it, your whole booked time is charged: the time ${names.host} was in the call, and the rest of the booking. Time you waited for ${names.host} is not charged, and if ${names.host} was not in the call when you ended it, neither is the rest.`;
    }
    if (viewer === "host") {
      if (money === "free_early") return `${names.customer} ended it before its booked start, while cancelling was still free: nothing is charged.`;
      // (A report of his that was not lowered leaves her page exactly as it was.)
      if (money === "whole_early" || money === "not_lowered_early") return `${names.customer} ended it before its booked start, after the time in which cancelling was free: the whole booking is charged, as for a late cancellation.`;
      if (money === "whole" || money === "not_lowered") return `Because ${names.customer} ended it, the whole booked time is charged: your time in the call and, if you were in the call at that moment, the rest of the booking.`;
      // (Not "only": on a call with time added by card, a charge that was taken earlier stays as it is.)
      return money === "lowered" ? "It is charged for your time in the call up to that moment." : "Only your time in the call up to that moment is charged.";
    }
    if (money === "minutes") return "Only the host's time in the call up to that moment is charged.";
    if (money === "free_early") return "The customer ended it before its booked start, while cancelling was still free: nothing is charged.";
    if (money === "whole_early") return "The customer ended it before its booked start, after the time in which cancelling was free: the whole booking is charged.";
    if (money === "lowered") return "The customer reported the host afterwards, so what had not been charged yet is charged only for the host's time in the call up to that moment.";
    if (money === "not_lowered" || money === "not_lowered_early") return "The customer reported the host afterwards, and the guard did not lower the charge: it stays as for a call the customer ended.";
    return "Because the customer ended it, the whole booked time is charged: the host's time in the call and, if the host was in the call at that moment, the rest of the booking.";
  },
  /** Under the money line, while the money is still to be taken: nothing is taken yet, and where the amount will be. */
  moneyWhen: "The money is taken about a day after the call. The amount is on the call's page a few minutes after the call.",
  /** The same place, once the call's money is settled. (The phone app's page of a call has no receipt yet: it says where the receipt is.) */
  moneyDone: "What was charged is on the call's page.",
  moneyDoneApp: "The call's money is settled. The receipt is on the call's page on the website.",

  /** Added to the thank-you after a report that decided the charge. */
  thanksLowered: "This call is charged only for the time it lasted, not the whole booking.",
  /** A part of the call's money had been taken already, or was on its way, when the report came (time added by card on a member's call, say). */
  thanksLoweredPartly: "What had not been charged yet for this call is charged only for the time it lasted. A charge that was already taken, or was on its way, stays as it is; if you think it is wrong, write to us.",
  thanksNotLowered: `Your report does not change what this call is charged: ${SEVERAL}. If you think the charge is wrong, write to us.`,
  /** All of the call's money was taken before the report arrived (he may have opened the form while it was still waiting). */
  thanksTooLate: "The charge for this call had already been made or was on its way, so your report does not change it. If you think the charge is wrong, write to us.",

  /** To the customer whose report did not lower the charge: a message with its email, long before the money is taken. Nothing about the block, which follows the report and can fail by itself. */
  customerSubject: "Your report was saved. The call's charge stays as it is",
  customerText: (hostName: string) =>
    `Your report about ${hostName} was saved, and we will look at it.\n\nIt does not change what the call you ended is charged. ${SEVERAL_SENTENCE}, so this one does not.\n\nIf you think the charge is wrong, you can ask ${hostName} for a refund on the call's page while that is open, or write to us.`,

  /** To the founder, once, when a customer crosses the line. No detail of any report. */
  founderSubject: "A customer has ended calls and reported the host several times",
  founderText: (customer: { name: string; email: string }) =>
    `${customer.name} (${customer.email}) has ended a call and then reported the host ${END_GUARD.line} times among their last ${END_GUARD.calls} calls. Each time, the report meant that the call was charged by its minutes instead of the whole booking.\n\nA further report will not lower their charge while this stays so. Their reports and blocks still go through, and nothing else was changed.\n\nYou can look at the account and its reports, and pause it if you think that is right.`,

  /** Why a charge that includes the rest of the booking is what it is, on the receipt. */
  whyWhole: (viewer: Role | "admin") => (viewer === "customer" ? "You ended the call: the time the host was in the call, and the rest of the booked time" : "The customer ended the call: the time the host was in the call, and the rest of the booked time"),
} as const;
