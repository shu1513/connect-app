/**
 * The two things the report form does besides showing itself, for the website's page and for the
 * phone app's screen alike (plans/45-phone-apps/09-the-call.md): saying whether a call was
 * really ended with "End call and report", and filing the report with its thank-you.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { callForParticipant } from "@/lib/payments/access";
import { REPORT_WORDS } from "./report-words";
import { createReport } from "./reports";

/** Whether this call, one of this person's, was ended with "End call and report". False for anybody else's call. */
export async function callWasStopped(userId: string, callId: string): Promise<boolean> {
  const access = await callForParticipant(callId, userId);
  return access !== null && access.call.safetyEndedAt !== null;
}

/**
 * The same question for the phone app, which does not say "ended for both" without proof: "stopped" only once
 * the room is written down as closed; "stopping" while the call is marked as stopped and the room's closing is
 * not confirmed yet; "no" for a call that was not stopped, or that is not this person's.
 */
export async function callStopState(userId: string, callId: string): Promise<"no" | "stopping" | "stopped"> {
  const access = await callForParticipant(callId, userId);
  if (!access || access.call.safetyEndedAt === null) return "no";
  return access.call.closedAt === null ? "stopping" : "stopped";
}

/**
 * Files a report and gives back the thank-you with its number. The person reported is worked out
 * on the server from where the report was made. Throws `ReportError` with its own sentence when
 * the report is not taken.
 *
 * The block that follows a report can fail by itself, after the report is saved. The sentence
 * then says what is true, always with the report's number (plans/49-messaging.md, part 2), and
 * `receipt` names the page that shows it with a "Block" button. `receipt` is null when all went
 * as it should; the website then shows the thank-you on the home page, as before. The phone app
 * shows the sentence it is given.
 */
export async function sendReportFor(reporterId: string, input: { context: string; contextId: string; reason: string; text: string }, now: Date): Promise<{ notice: string; receipt: string | null }> {
  const outcome = await createReport({ reporterId, context: input.context, contextId: input.contextId, reason: input.reason, text: input.text, now });
  const { reference } = outcome;
  if (outcome.block === "none") return { notice: REPORT_WORDS.thanksPost(reference), receipt: null };
  if (outcome.block === "done" && outcome.callsNotCancelled === 0) return { notice: REPORT_WORDS.thanksPerson(reference), receipt: null };
  const notice = outcome.block === "done" ? REPORT_WORDS.thanksNotCancelled(reference, outcome.callsNotCancelled) : outcome.block === "not_done" ? REPORT_WORDS.savedNotBlocked(reference) : REPORT_WORDS.savedBlockUnknown(reference);
  return { notice, receipt: `/report/saved?r=${reference}` };
}

/** For the receipt page: the person a report of this reporter's was about. Null for anyone else's report, or none. */
export async function reportedOf(reporterId: string, reference: number): Promise<string | null> {
  if (!Number.isInteger(reference) || reference < 1) return null;
  const [row] = await db.select({ reportedId: schema.reports.reportedId, context: schema.reports.context }).from(schema.reports).where(and(eq(schema.reports.reference, reference), eq(schema.reports.reporterId, reporterId)));
  // A report about a post blocks nobody, so it has no receipt with a "Block" button.
  return row && row.context !== "post" ? row.reportedId : null;
}
