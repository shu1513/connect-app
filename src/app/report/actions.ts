"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { safeNext } from "@/lib/safe-next";
import { BLOCK_WORDS } from "@/lib/safety/block-words";
import { block, BlockError, unblock } from "@/lib/safety/blocks";
import { createReport, ReportError } from "@/lib/safety/reports";
import { requireUser } from "@/lib/session";

/** Files a report. The person reported is worked out on the server from where the report was made. */
export async function sendReport(formData: FormData) {
  const user = await requireUser();
  const context = String(formData.get("context") ?? "");
  const contextId = String(formData.get("contextId") ?? "");
  let notice: string;
  try {
    const { reference } = await createReport({
      reporterId: user.id,
      context,
      contextId,
      reason: String(formData.get("reason") ?? ""),
      text: String(formData.get("text") ?? ""),
      now: new Date(),
    });
    // Reporting a post does not block its host, so that is not promised for one.
    notice = context === "post" ? `Thank you. Your report is R-${reference}. We will look at it.` : `Thank you. Your report is R-${reference}. We will look at it, and you will not hear from this person through Connect again.`;
  } catch (error) {
    if (!(error instanceof ReportError)) {
      console.error("[safety] report failed", error);
      redirect(withNotice(`/report?${context}=${encodeURIComponent(contextId)}`, "Something went wrong. Please try again."));
    }
    redirect(withNotice(`/report?${context}=${encodeURIComponent(contextId)}`, error.message));
  }
  redirect(withNotice("/", notice));
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

export async function unblockAction(formData: FormData) {
  const user = await requireUser();
  await unblock(user.id, String(formData.get("userId") ?? ""));
  redirect(withNotice("/account", "Unblocked. They can ask you for calls again."));
}
