"use server";

import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { changePost, removePost, writePost } from "@/lib/projects/posts";
import { changeProject, endProject, startProject } from "@/lib/projects/projects";
import { ProjectError } from "@/lib/projects/rules";
import { requireActiveUser, requireUser } from "@/lib/session";
import type { PostFormState } from "./post-form-state";

const PAGE = "/host/project";

function back(path: string, text: string): never {
  redirect(withNotice(path, text));
}

function problem(error: unknown): string {
  if (error instanceof ProjectError) return error.message;
  console.error("[projects] action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** The three link boxes of a post's form. */
const linksOf = (formData: FormData): string[] => formData.getAll("link").map((value) => String(value));
/** The project a form was drawn for. The library checks that it is this host's running one. */
const projectOf = (formData: FormData): string => String(formData.get("projectId") ?? "");

/**
 * Every action here takes the host from the login, never from the form, and the library decides
 * again whether she may do it. Writing needs an account that is not paused; removing a post and
 * ending a project do not, and neither depends on the founder's switch.
 */
export async function startProjectAction(formData: FormData) {
  const user = await requireActiveUser(PAGE);
  let notice = "Your project has started. Write your first post below.";
  try {
    await startProject({ hostId: user.id, name: String(formData.get("name") ?? ""), description: String(formData.get("description") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(PAGE, notice);
}

export async function changeProjectAction(formData: FormData) {
  const user = await requireActiveUser(PAGE);
  let notice = "Your project was saved.";
  try {
    await changeProject({ hostId: user.id, projectId: projectOf(formData), name: String(formData.get("name") ?? ""), description: String(formData.get("description") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(PAGE, notice);
}

export async function endProjectAction(formData: FormData) {
  const user = await requireUser(PAGE);
  if (formData.get("sure") !== "on") back(PAGE, "Tick the box to end your project. Nothing was changed.");
  let notice = "Your project has ended. Its diary stays readable, marked as ended.";
  try {
    await endProject({ hostId: user.id, projectId: projectOf(formData), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(PAGE, notice);
}

/**
 * The two actions of the post form (post-form.tsx). Unlike the others they do not send the
 * browser on when the server refuses: they answer with the reason and with what was typed, so a
 * long post is never lost. A post that was saved sends the browser on, as everywhere.
 */
function refused(error: unknown, formData: FormData): PostFormState {
  return { error: problem(error), text: String(formData.get("text") ?? ""), links: linksOf(formData) };
}

/** Said in the form itself, so a host whose account was paused while she was typing keeps her draft. (Every other action sends a paused account to the page that explains the pause.) */
const PAUSED = new ProjectError("Your account is paused, so you cannot write or change posts at the moment.");

export async function writePostAction(_state: PostFormState, formData: FormData): Promise<PostFormState> {
  const user = await requireUser(PAGE);
  if (user.paused) return refused(PAUSED, formData);
  try {
    await writePost({ hostId: user.id, projectId: projectOf(formData), text: String(formData.get("text") ?? ""), links: linksOf(formData), now: new Date() });
  } catch (error) {
    return refused(error, formData);
  }
  back(PAGE, "Your post is in the diary.");
}

export async function changePostAction(_state: PostFormState, formData: FormData): Promise<PostFormState> {
  const postId = String(formData.get("postId") ?? "");
  // Someone who has to log in first comes back to the post's own page. The id is only used in an address of our own.
  const user = await requireUser(/^[0-9a-f-]{36}$/i.test(postId) ? `${PAGE}/posts/${postId}` : PAGE);
  if (user.paused) return refused(PAUSED, formData);
  try {
    await changePost({ hostId: user.id, postId, text: String(formData.get("text") ?? ""), links: linksOf(formData), now: new Date() });
  } catch (error) {
    return refused(error, formData);
  }
  back(PAGE, "Your post was saved.");
}

export async function removePostAction(formData: FormData) {
  const user = await requireUser(PAGE);
  // A post of an earlier project is removed from that project's list, and the host comes back to it. The id is only used in an address of our own.
  const earlier = String(formData.get("earlier") ?? "");
  let notice = "The post was removed from the diary.";
  try {
    await removePost({ hostId: user.id, postId: String(formData.get("postId") ?? ""), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(/^[0-9a-f-]{36}$/i.test(earlier) ? `${PAGE}?project=${earlier}` : PAGE, notice);
}
