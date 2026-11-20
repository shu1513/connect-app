/**
 * The words of the email a host gets when the founder decides about their profile. Kept apart
 * from the sending (see emails.ts) so they can be read and tested on their own.
 */
import { SUPPORT_EMAIL } from "@/lib/terms";

export function profileDecisionEmail(
  decision: "approved" | "declined" | "suspended",
  host: { name: string; handle: string; hidden?: boolean },
  url: string,
  /** Why the page was declined or suspended: the rule and the facts (plans/46, decision 11). The Host Agreement promises it (17.4). */
  reason: string | null = null,
): { subject: string; text: string } {
  const hosting = `${url}/host`;
  const why = reason ? ["", "The reason:", "", reason] : [];
  const said = {
    approved: {
      subject: "Your Connect page is approved",
      lines: [
        host.hidden
          ? "Your host profile is approved. Your page is hidden by you at the moment; you can show it again on your Hosting page."
          : `Your host page is approved and public: ${url}/h/${host.handle}`,
        "",
        "People can ask you for a call once your hours are set on your calendar and, if you charge for calls, once your payouts are set up. Your Hosting page shows what is left to do:",
        hosting,
      ],
    },
    declined: {
      subject: "Your Connect host profile was not approved",
      lines: [
        "We looked at your host profile and could not approve it as it is. Your page is not public.",
        ...why,
        "",
        "You can change your profile on your Hosting page, and we will look at it again:",
        hosting,
      ],
    },
    suspended: {
      subject: "Your Connect host page has been suspended",
      lines: [
        "Your host page has been suspended and is no longer public. Requests that are waiting for your answer are being ended, and your upcoming calls are being cancelled at no charge to your customers.",
        ...why,
        "",
        `If you think this is a mistake, write to ${SUPPORT_EMAIL} and say what you want looked at again. A person reads it.`,
      ],
    },
  }[decision];
  return { subject: said.subject, text: [`Hi ${host.name},`, "", ...said.lines, "", `—\nConnect · questions: ${SUPPORT_EMAIL}`].join("\n") };
}
