"use server";

import { redirect } from "next/navigation";
import { errorSummary } from "@/lib/email";
import { withNotice } from "@/lib/notice";
import { safeNext } from "@/lib/safe-next";
import { BLOCK_WORDS } from "@/lib/safety/block-words";
import { block, BlockError, unblock } from "@/lib/safety/blocks";
import { reportedOf, sendReportFor } from "@/lib/safety/report-form";
import { REPORT_WORDS } from "@/lib/safety/report-words";
import { ReportError } from "@/lib/safety/reports";
import { requireUser } from "@/lib/session";

/** Files a report. The person reported is worked out on the server from where the report was made. */
export async function sendReport(formData: FormData) {
  const user = await requireUser();
  const context = String(formData.get("context") ?? "");
  const contextId = String(formData.get("contextId") ?? "");
  let notice: string;
  let receipt: string | null;
  try {
    ({ notice, receipt } = await sendReportFor(user.id, { context, contextId, reason: String(formData.get("reason") ?? ""), text: String(formData.get("text") ?? "") }, new Date()));
  } catch (error) {
    if (!(error instanceof ReportError)) {
      // Never the error itself: a database error carries the statement's values, which here are what the reporter
      // wrote and, for a report made from a message, the messages kept with it.
      console.error(`[safety] report failed (${errorSummary(error)})`);
      redirect(withNotice(`/report?${context}=${encodeURIComponent(contextId)}`, REPORT_WORDS.wrong));
    }
    redirect(withNotice(`/report?${context}=${encodeURIComponent(contextId)}`, error.message));
  }
  // All as it should be: the thank-you on the home page. Otherwise the receipt, which has the "Block" button.
  redirect(withNotice(receipt ?? "/", notice));
}

export async function blockAction(formData: FormData) {
  const user = await requireUser();
  const blockedId = String(formData.get("userId") ?? "");
  const back = String(formData.get("back") ?? "/account");
  let notice: string = BLOCK_WORDS.done;
  try {
    const { callsNotCancelled } = await block({ blockerId: user.id, blockedId, now: new Date() });
    if (callsNotCancelled > 0) notice = BLOCK_WORDS.notCancelled(callsNotCancelled);
  } catch (error) {
    notice = error instanceof BlockError ? error.message : BLOCK_WORDS.wrong;
  }
  redirect(withNotice(back === "/" ? "/account" : safeNext(back), notice));
}

/**
 * The "Block" button of a report's receipt (plans/49-messaging.md, part 2). The form names only
 * the report. Who is blocked is looked up here, from that report, for the person who is logged
 * in: the button can block nobody but the person that report of theirs was about. Blocking again
 * is safe, and tries again to cancel the calls still to come.
 */
export async function blockReportedAction(formData: FormData) {
  const user = await requireUser();
  const given = String(formData.get("reference") ?? "");
  const reference = /^[0-9]{1,12}$/.test(given) ? Number(given) : 0;
  const reportedId = await reportedOf(user.id, reference);
  if (!reportedId) redirect("/");
  let notice: string = BLOCK_WORDS.done;
  try {
    const { callsNotCancelled } = await block({ blockerId: user.id, blockedId: reportedId, now: new Date() });
    if (callsNotCancelled > 0) notice = BLOCK_WORDS.notCancelled(callsNotCancelled);
  } catch (error) {
    notice = error instanceof BlockError ? error.message : BLOCK_WORDS.wrong;
  }
  redirect(withNotice(`/report/saved/${reference}`, notice));
}

export async function unblockAction(formData: FormData) {
  const user = await requireUser();
  await unblock(user.id, String(formData.get("userId") ?? ""));
  redirect(withNotice("/account", "Unblocked. They can ask you for calls again."));
}
