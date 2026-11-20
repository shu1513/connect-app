"use server";

import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { withNotice } from "@/lib/notice";
import { momentIn } from "@/lib/booking/calendar";
import { lockAndReport, recordReportMade, removePictureAsFounder, setSuspected } from "@/lib/projects/moderation";
import { hidePost, showPost } from "@/lib/projects/posts";
import { ProjectError } from "@/lib/projects/rules";
import { saveProjectsSwitch, saveTipsSwitch } from "@/lib/contributions/switch";
import { requireAdmin } from "@/lib/session";

function back(text: string, postId?: string): never {
  // Back to the same post when one was being looked at. The id is only used in an address of our own.
  redirect(withNotice(postId && /^[0-9a-f-]{36}$/i.test(postId) ? `/admin/projects?post=${postId}` : "/admin/projects", text));
}

function problem(error: unknown): string {
  if (error instanceof ProjectError) return error.message;
  console.error("[admin] project action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** The founder hides a post of a diary. The host sees "Hidden by Connect"; nobody else sees the post. */
export async function hidePostAction(formData: FormData) {
  const admin = await requireAdmin();
  const postId = String(formData.get("postId") ?? "");
  let notice = "The post is hidden. Its host sees \"Hidden by Connect\".";
  try {
    await hidePost({ adminId: admin.id, postId, note: String(formData.get("note") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice, postId);
}

export async function showPostAction(formData: FormData) {
  const admin = await requireAdmin();
  const postId = String(formData.get("postId") ?? "");
  let notice = "The post is shown again.";
  try {
    await showPost({ adminId: admin.id, postId, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice, postId);
}

/** The projects switch: off, on for the hosts named by their handle, or on for everyone. The same form as the memberships switch. */
export async function projectsSwitchAction(formData: FormData) {
  const admin = await requireAdmin();
  const chosen = String(formData.get("projects") ?? "");
  const position = chosen === "named" || chosen === "everyone" ? chosen : "off";
  if (position !== "named") {
    // Off (and everyone) are saved at once, whatever is typed in the list: switching off must never wait for a handle to be put right. The list stays as it was.
    const plain = position === "off" ? "off" : "on for everyone";
    // The change, its line in the record of the founder's actions, and what it means for contributions are saved together, or none is.
    await saveProjectsSwitch({ adminId: admin.id, values: { projects: position }, detail: plain });
    back(`Projects are ${plain}.`);
  }
  const handles = [...new Set(String(formData.get("hosts") ?? "").split(/[\s,]+/).map((handle) => handle.replace(/^@/, "").toLowerCase()).filter(Boolean))];
  const found = handles.length ? await db.select({ userId: schema.hostProfiles.userId, handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.handle, handles)) : [];
  const unknown = handles.filter((handle) => !found.some((host) => host.handle === handle));
  if (unknown.length > 0) back(`No host has the handle ${unknown.join(", ")}. Nothing was changed.`);
  const words = `on for ${found.length === 0 ? "nobody yet" : found.map((host) => host.handle).join(", ")}`;
  await saveProjectsSwitch({ adminId: admin.id, values: { projects: position, projectsHosts: found.map((host) => host.userId) }, detail: words });
  back(`Projects are ${words}.`);
}

/** Where a picture's form was pressed: on one post's view (`postId`), or on the lists. The browser comes back to the same place. */
const placeOf = (formData: FormData): string | undefined => String(formData.get("postId") ?? "") || undefined;
const pictureOf = (formData: FormData): string => String(formData.get("pictureId") ?? "");

export async function removePictureAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The picture was removed. Nobody can see it any more.";
  try {
    await removePictureAsFounder({ adminId: admin.id, pictureId: pictureOf(formData), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice, placeOf(formData));
}

/** "Remove and report". Behind a tick box, because it cannot be undone. */
export async function lockPictureAction(formData: FormData) {
  const admin = await requireAdmin();
  if (formData.get("sure") !== "on") back("Tick the box to remove and report a picture. Nothing was changed.", placeOf(formData));
  let notice = "The picture is removed and kept for the report. Its post is hidden. Now make the report, then write down below when you made it.";
  try {
    await lockAndReport({ adminId: admin.id, pictureId: pictureOf(formData), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice, placeOf(formData));
}

export async function holdPictureAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The picture is held. Nobody but you can see it, and no checking service is sent it.";
  try {
    await setSuspected({ adminId: admin.id, pictureId: pictureOf(formData), on: true, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice, placeOf(formData));
}

export async function liftPictureAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The picture is no longer held.";
  try {
    await setSuspected({ adminId: admin.id, pictureId: pictureOf(formData), on: false, now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice, placeOf(formData));
}

/** "I have made the report", with the day and time it was really made, typed in the founder's own time zone. */
export async function reportMadeAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The time of the report is written down.";
  try {
    const madeAt = momentIn(admin.timeZone ?? "UTC", String(formData.get("madeAt") ?? ""));
    await recordReportMade({ adminId: admin.id, pictureId: pictureOf(formData), madeAt: madeAt ?? new Date(Number.NaN), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

/**
 * The tips switch (plans/44, decision 12): on or off, for every host. The change, its line in the
 * record of the founder's actions, and what it means for tips that are not taken (they are given
 * up, and their holds let go) are saved together, or none is.
 */
export async function tipsSwitchAction(formData: FormData) {
  const admin = await requireAdmin();
  // Read strictly: anything that is not "on" counts as off, the safe side, as for the other switches.
  const off = formData.get("tips") !== "on";
  await saveTipsSwitch({ adminId: admin.id, off });
  back(off ? "Tips are off. Tips that were only held are being let go." : "Tips are on.");
}
