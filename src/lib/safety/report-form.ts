/**
 * The two things the report form does besides showing itself, for the website's page and for the
 * phone app's screen alike (plans/45-phone-apps/09-the-call.md): saying whether a call was
 * really ended with "End call and report", and filing the report with its thank-you.
 */
import "server-only";
import { callForParticipant } from "@/lib/payments/access";
import { REPORT_WORDS } from "./report-words";
import { createReport } from "./reports";

/** Whether this call, one of this person's, was ended with "End call and report". False for anybody else's call. */
export async function callWasStopped(userId: string, callId: string): Promise<boolean> {
  const access = await callForParticipant(callId, userId);
  return access !== null && access.call.safetyEndedAt !== null;
}

/**
 * Files a report and gives back the thank-you with its number. The person reported is worked out
 * on the server from where the report was made. Throws `ReportError` with its own sentence when
 * the report is not taken.
 */
export async function sendReportFor(reporterId: string, input: { context: string; contextId: string; reason: string; text: string }, now: Date): Promise<{ notice: string }> {
  const { reference } = await createReport({ reporterId, context: input.context, contextId: input.contextId, reason: input.reason, text: input.text, now });
  return { notice: input.context === "post" ? REPORT_WORDS.thanksPost(reference) : REPORT_WORDS.thanksPerson(reference) };
}
