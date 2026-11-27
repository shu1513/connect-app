/**
 * The sentences of the report form and of its thank-you: one set for the website's page
 * (src/app/report) and for the phone app's screen (plans/45-phone-apps/09-the-call.md).
 */
import { END_WORDS } from "@/lib/call-page/end-words";

export const REPORT_TEXT_MAX = 2000;

/**
 * What became of the block that follows a report about a person (reports.ts):
 *   none        a report about a post of a diary, which does not block
 *   done        the block stands (`callsNotCancelled`: future calls that could not be cancelled yet)
 *   done_unsure the block stands, but the step ran into an error after saving it: whether the
 *               future calls between the two were cancelled is not known
 *   not_done    the block is not there
 *   unknown     the block ran into an error, and looking whether it stands did too
 */
export type ReportBlock = "none" | "done" | "done_unsure" | "not_done" | "unknown";

/**
 * The sentence a reporter reads after a report was saved, and whether it goes on the receipt page
 * (which has a "Block" button) or, when all went as it should, on the home page as before. The
 * report's number is in every one of them. Each sentence stands by itself and names no button:
 * the phone app shows the same sentence, and has no such button on that screen.
 */
export function reportNotice(outcome: { reference: number; block: ReportBlock; callsNotCancelled: number; endEffect?: string | null; endPartly?: boolean }): { notice: string; needsReceipt: boolean } {
  const said = reportSaid(outcome);
  // A customer's report after his own "End call now" also says what it did to that call's charge (plans/50).
  const money = outcome.endEffect === "whole" ? END_WORDS.thanksNotLowered : outcome.endEffect === "minutes" || outcome.endEffect === "minutes_uncounted" ? (outcome.endPartly ? END_WORDS.thanksLoweredPartly : END_WORDS.thanksLowered) : null;
  return money ? { notice: `${said.notice} ${money}`, needsReceipt: said.needsReceipt } : said;
}

function reportSaid(outcome: { reference: number; block: ReportBlock; callsNotCancelled: number }): { notice: string; needsReceipt: boolean } {
  const { reference } = outcome;
  if (outcome.block === "none") return { notice: REPORT_WORDS.thanksPost(reference), needsReceipt: false };
  if (outcome.block === "done" && outcome.callsNotCancelled === 0) return { notice: REPORT_WORDS.thanksPerson(reference), needsReceipt: false };
  if (outcome.block === "done") return { notice: REPORT_WORDS.thanksNotCancelled(reference, outcome.callsNotCancelled), needsReceipt: true };
  if (outcome.block === "done_unsure") return { notice: REPORT_WORDS.thanksCallsUnsure(reference), needsReceipt: true };
  return { notice: outcome.block === "not_done" ? REPORT_WORDS.savedNotBlocked(reference) : REPORT_WORDS.savedBlockUnknown(reference), needsReceipt: true };
}

export const REPORT_WORDS = {
  title: "Report",
  /** The links that lead to the form: on a host's page, and on a request. */
  reportPage: "Report this page",
  reportPerson: (name: string) => `Report ${name}`,
  /** Said only when true: the call really was ended with the call's button ("End call now", or the earlier "End call and report"). */
  stopped: "The call has been ended for both of you. Nobody can rejoin.",
  /**
   * For the phone app, while the room's closing is not confirmed yet: nothing is promised that is not known. Not
   * "nobody can join it again": no new entry pass is handed out, but one handed out just before stays good until
   * the video service has confirmed that the room is closed.
   */
  stopping: "The call is being ended for both of you.",
  aboutPost: "Tell us what is wrong with this post. Only our team reads this.",
  aboutPerson: "Tell us what happened. Only our team reads this. Reporting someone also blocks them: they cannot contact you through Connect again.",
  readThe: "Read the",
  rules: "rules",
  what: "What happened?",
  choose: "Choose a reason",
  more: "Tell us more (optional)",
  send: "Send report",
  danger: "If someone is in danger right now, contact your local emergency services first.",
  /** Reporting a post does not block its host, so that is not promised for one. */
  thanksPost: (reference: number) => `Thank you. Your report is R-${reference}. We will look at it.`,
  thanksPerson: (reference: number) => `Thank you. Your report is R-${reference}. We will look at it, and you will not hear from this person through Connect again.`,
  /** The block went through, but a call still to come between the two could not be cancelled yet. */
  thanksNotCancelled: (reference: number, calls: number) =>
    `Thank you. Your report is R-${reference}. This person is blocked, but ${calls} future ${calls === 1 ? "call" : "calls"} between you could not be cancelled just now. Please cancel ${calls === 1 ? "it" : "them"} from your calls page, or block this person again in a minute.`,
  /** The block stands, but whether the calls still to come between the two were cancelled is not known. */
  thanksCallsUnsure: (reference: number) => `Thank you. Your report is R-${reference}. This person is blocked, but we could not confirm that the future calls between you were cancelled. Please look at your calls page, or block this person again.`,
  /** The report is saved and the block is not there. */
  savedNotBlocked: (reference: number) => `Your report was saved: R-${reference}. This person is not blocked yet. Please block them.`,
  /** The report is saved and nobody could find out whether the block stands. */
  savedBlockUnknown: (reference: number) => `Your report was saved: R-${reference}. We could not confirm the block. Please block this person to make sure.`,
  receiptTitle: "Your report",
  /** On the website's receipt, above its button. */
  receiptBlock: "The button below blocks the person this report is about, or tries again.",
  receiptBlockButton: "Block this person",
  reportMessage: "Report",
  wrong: "Something went wrong. Please try again.",
} as const;
