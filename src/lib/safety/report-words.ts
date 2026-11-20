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
  /** For the phone app, while the room's closing is not confirmed yet: nothing is promised that is not known. */
  stopping: "The call is being ended for both of you. Nobody can join it again, and the charge for it will be looked at by a person.",
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
  wrong: "Something went wrong. Please try again.",
} as const;
