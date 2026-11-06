"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { recordAdminAction } from "@/lib/safety/audit";
import { closeReport, liftPause, pauseAccount, ReportError, warn } from "@/lib/safety/reports";
import { setSwitches } from "@/lib/safety/switches";
import { requireAdmin } from "@/lib/session";

function back(text: string): never {
  redirect(withNotice("/admin/reports", text));
}
/** Made when the form was shown, so sending the same form twice does not warn or pause twice. */
function requestIdOf(formData: FormData): string {
  const id = String(formData.get("requestId") ?? "");
  return /^[0-9a-f-]{36}$/i.test(id) ? id : randomUUID();
}

function problem(error: unknown): string {
  if (error instanceof ReportError) return error.message;
  console.error("[admin] report action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

export async function closeReportAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The report is closed and the reporter has been told.";
  try {
    await closeReport({ reportId: String(formData.get("reportId") ?? ""), adminId: admin.id, note: String(formData.get("note") ?? "").trim() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function warnAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The warning was sent.";
  try {
    await warn({ adminId: admin.id, userId: String(formData.get("userId") ?? ""), ruleKey: String(formData.get("rule") ?? ""), note: String(formData.get("note") ?? "").trim(), requestId: requestIdOf(formData) });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function pauseAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The account is paused and the person has been told.";
  try {
    await pauseAccount({ adminId: admin.id, userId: String(formData.get("userId") ?? ""), ruleKey: String(formData.get("rule") ?? ""), note: String(formData.get("note") ?? "").trim(), requestId: requestIdOf(formData) });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function liftPauseAction(formData: FormData) {
  const admin = await requireAdmin();
  await liftPause({ adminId: admin.id, userId: String(formData.get("userId") ?? "") });
  back("The pause is lifted.");
}

export async function switchesAction(formData: FormData) {
  const admin = await requireAdmin();
  const values = { requestsOff: formData.get("requestsOff") === "on", joiningOff: formData.get("joiningOff") === "on" };
  await setSwitches(values);
  await recordAdminAction({ adminId: admin.id, action: "stop switches set", detail: `new requests ${values.requestsOff ? "off" : "on"}; joining calls ${values.joiningOff ? "off" : "on"}` });
  back("The switches were saved.");
}
