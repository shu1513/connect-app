"use server";

import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { withNotice } from "@/lib/notice";
import { hidePost, showPost } from "@/lib/projects/posts";
import { ProjectError } from "@/lib/projects/rules";
import { recordAdminAction } from "@/lib/safety/audit";
import { setSwitches } from "@/lib/safety/switches";
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
    await setSwitches({ projects: position });
    const plain = position === "off" ? "off" : "on for everyone";
    await recordAdminAction({ adminId: admin.id, action: "projects switch set", detail: plain });
    back(`Projects are ${plain}.`);
  }
  const handles = [...new Set(String(formData.get("hosts") ?? "").split(/[\s,]+/).map((handle) => handle.replace(/^@/, "").toLowerCase()).filter(Boolean))];
  const found = handles.length ? await db.select({ userId: schema.hostProfiles.userId, handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.handle, handles)) : [];
  const unknown = handles.filter((handle) => !found.some((host) => host.handle === handle));
  if (unknown.length > 0) back(`No host has the handle ${unknown.join(", ")}. Nothing was changed.`);
  await setSwitches({ projects: position, projectsHosts: found.map((host) => host.userId) });
  const words = `on for ${found.length === 0 ? "nobody yet" : found.map((host) => host.handle).join(", ")}`;
  await recordAdminAction({ adminId: admin.id, action: "projects switch set", detail: words });
  back(`Projects are ${words}.`);
}
