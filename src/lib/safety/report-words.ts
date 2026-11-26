/**
 * The sentences of the report form and of its thank-you: one set for the website's page
 * (src/app/report) and for the phone app's screen (plans/45-phone-apps/09-the-call.md).
 */
export const REPORT_TEXT_MAX = 2000;

export const REPORT_WORDS = {
  title: "Report",
  /** The links that lead to the form: on a host's page, and on a request. */
  reportPage: "Report this page",
  reportPerson: (name: string) => `Report ${name}`,
  /** Said only when true: the call really was ended with "End call and report". */
  stopped: "The call has been ended for both of you. Nobody can rejoin, and the charge for it will be looked at by a person.",
  /**
   * For the phone app, while the room's closing is not confirmed yet: nothing is promised that is not known. Not
   * "nobody can join it again": no new entry pass is handed out, but one handed out just before stays good until
   * the video service has confirmed that the room is closed.
   */
  stopping: "The call is being ended for both of you. The charge for it will be looked at by a person.",
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
    `Thank you. Your report is R-${reference}. This person is blocked, but ${calls} future ${calls === 1 ? "call" : "calls"} between you could not be cancelled just now. Press "Block" below to try again, or cancel ${calls === 1 ? "it" : "them"} from your calls page.`,
  /** The report is saved and the block is not there. */
  savedNotBlocked: (reference: number) => `Your report was saved: R-${reference}. This person is not blocked yet. Press "Block" below.`,
  /** The report is saved and nobody could find out whether the block stands. */
  savedBlockUnknown: (reference: number) => `Your report was saved: R-${reference}. We could not confirm the block. Press "Block" below to make sure.`,
  receiptTitle: "Your report",
  reportMessage: "Report",
  wrong: "Something went wrong. Please try again.",
} as const;
