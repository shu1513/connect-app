"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { withNotice } from "@/lib/notice";
import { errorSummary } from "@/lib/email";
import { recordAdminAction } from "@/lib/safety/audit";
import { keptMessagesFor } from "@/lib/safety/kept-messages";
import type { KeptState } from "./kept-state";
import { closeReport, liftPause, pauseAccount, ReportError, warn } from "@/lib/safety/reports";
import { stopSwitchesFrom } from "@/lib/safety/switch-form";
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
  let notice = "The account is paused and the person has been told. Their waiting requests have ended and their calls that had not started were cancelled at no charge.";
  try {
    const { callsNotEnded } = await pauseAccount({ adminId: admin.id, userId: String(formData.get("userId") ?? ""), ruleKey: String(formData.get("rule") ?? ""), note: String(formData.get("note") ?? "").trim(), requestId: requestIdOf(formData) });
    if (callsNotEnded !== 0) {
      notice = `The account is paused and the person has been told, but ${callsNotEnded > 0 ? `${callsNotEnded} of its calls` : "its requests and calls"} could not be ended automatically. Please check that person's requests and calls and end them by hand.`;
    }
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function liftPauseAction(formData: FormData) {
  const admin = await requireAdmin();
  // The pause the page showed, by its moment: a page left open cannot lift a later pause of the same account.
  const since = new Date(String(formData.get("since") ?? ""));
  const lifted = Number.isNaN(since.getTime()) ? false : await liftPause({ adminId: admin.id, userId: String(formData.get("userId") ?? ""), since });
  back(lifted ? "The pause is lifted." : "Nothing was lifted: that pause is no longer there. The list below shows how things stand now.");
}

export async function switchesAction(formData: FormData) {
  const admin = await requireAdmin();
  const { values, detail } = stopSwitchesFrom(formData);
  await setSwitches(values);
  await recordAdminAction({ adminId: admin.id, action: "stop switches set", detail });
  back("The switches were saved.");
}

/**
 * The founder reads the messages kept with a report (plans/49-messaging.md, decision 24). The
 * login is checked here; the look is written into the record of admin actions inside
 * `keptMessagesFor`, in the same database step, before anything is given back. If that fails,
 * nothing is given back. The words are never written to a log.
 */
export async function keptMessagesAction(_state: KeptState, formData: FormData): Promise<KeptState> {
  const admin = await requireAdmin();
  const reportId = String(formData.get("reportId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) return { error: "That report is not there.", kept: null };
  try {
    const kept = await keptMessagesFor({ adminId: admin.id, reportId });
    return kept ? { error: null, kept } : { error: "Nothing is kept with that report.", kept: null };
  } catch (error) {
    console.error(`[admin] reading the kept messages of a report failed (${errorSummary(error)})`);
    return { error: "Something went wrong. Nothing was shown. Please try again.", kept: null };
  }
}

/** The memberships switch: off, on for the hosts named by their handle, or on for everyone. */
/**
 * The switches for the phone apps (plans/45-phone-apps/01-the-door.md). The server reads them for
 * every request of an app, so a thing switched off here is refused to the apps, not only hidden.
 * (No app can pay for a membership yet. When one can, turning memberships to a stricter position
 * must first end the payments an app has begun: plans/45-phone-apps/13-memberships.md.)
 */
export async function appSwitchesAction(formData: FormData) {
  const admin = await requireAdmin();
  const chosen = String(formData.get("appMemberships") ?? "");
  const appMemberships = chosen === "on" || chosen === "use_only" ? chosen : "off";
  const appOldestVersion = String(formData.get("appOldestVersion") ?? "").trim();
  // A slip in this field could tell every phone to update, or nobody. So it is saved only when it is a version, or empty.
  if (appOldestVersion !== "" && !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(appOldestVersion)) {
    back("The oldest allowed version must look like 1.2.0, or be left empty. Nothing was changed.");
  }
  const values = { appMemberships, appTips: formData.get("appTips") === "on", appAvailableNow: formData.get("appAvailableNow") === "on", appOldestVersion } as const;
  await setSwitches(values);
  const membershipWords = { on: "on", use_only: "on, but nothing is bought in the app", off: "off" }[appMemberships];
  await recordAdminAction({
    adminId: admin.id,
    action: "phone app switches set",
    detail: `memberships ${membershipWords}; tips ${values.appTips ? "on" : "off"}; available now ${values.appAvailableNow ? "on" : "off"}; oldest version ${appOldestVersion || "none"}`,
  });
  back("The switches for the phone apps were saved.");
}

export async function membershipsSwitchAction(formData: FormData) {
  const admin = await requireAdmin();
  const chosen = String(formData.get("memberships") ?? "");
  const position = chosen === "named" || chosen === "everyone" ? chosen : "off";
  if (position !== "named") {
    // Off (and everyone) are saved at once, whatever is typed in the list: switching off must never wait for a handle to be put right. The list stays as it was.
    await setSwitches({ memberships: position });
    const plain = position === "off" ? "off" : "on for everyone";
    await recordAdminAction({ adminId: admin.id, action: "memberships switch set", detail: plain });
    back(`Memberships are ${plain}.`);
  }
  const handles = [...new Set(String(formData.get("hosts") ?? "").split(/[\s,]+/).map((handle) => handle.replace(/^@/, "").toLowerCase()).filter(Boolean))];
  const found = handles.length ? await db.select({ userId: schema.hostProfiles.userId, handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.handle, handles)) : [];
  const unknown = handles.filter((handle) => !found.some((host) => host.handle === handle));
  if (unknown.length > 0) back(`No host has the handle ${unknown.join(", ")}. Nothing was changed.`);
  await setSwitches({ memberships: position, membershipsHosts: found.map((host) => host.userId) });
  const words = `on for ${found.length === 0 ? "nobody yet" : found.map((host) => host.handle).join(", ")}`;
  await recordAdminAction({ adminId: admin.id, action: "memberships switch set", detail: words });
  back(`Memberships are ${words}.`);
}
