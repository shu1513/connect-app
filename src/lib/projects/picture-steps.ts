/**
 * The steps on a picture that several files share (plans/24): locking, removing, refusing, and
 * the "suspected" mark of a report. Each runs inside the caller's own database step. This file
 * imports neither posts.ts nor pictures.ts, so both can use it.
 *
 * The order of locks, everywhere: the project, then the post, then the picture.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Project, ProjectPost } from "@/db/schema";
import { queueEmail } from "@/lib/email";
import { childCheckOn } from "./child-safety";
import { linksOf, PICTURE } from "./rules";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const pictures = schema.projectPictures;

/** Everyone who is an admin is told, once for each key. Written in the caller's own database step. */
export async function tellFounders(tx: Tx, message: { subject: string; text: string; key: string }): Promise<void> {
  const admins = await tx.select({ id: schema.user.id, email: schema.user.email }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
  for (const admin of admins) await queueEmail(tx, { to: admin.email, subject: message.subject, text: message.text, key: `${message.key}:${admin.id}` });
}

export function adminUrl(): string {
  return `${(process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "")}/admin/projects`;
}

/**
 * Locks a picture: "Remove and report", or a picture that is byte for byte one that is already
 * locked. In the caller's database step, with the picture's post locked. The picture is taken out
 * of sight for everyone, its post is hidden and kept as it was at this moment, and nothing can
 * delete or show it afterwards (plans/24, "What locked protects").
 */
export async function lockInStep(tx: Tx, input: { pictureId: string; postId: string; by: string | null; now: Date }): Promise<void> {
  const [post] = await tx.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, input.postId));
  const kept = post ? JSON.stringify({ id: post.id, projectId: post.projectId, text: post.text, links: linksOf(post.links), writtenAt: post.createdAt, removedAt: post.removedAt }) : "{}";
  await tx
    .update(pictures)
    .set({ state: "locked", level: null, lockedAt: input.now, lockedBy: input.by, lockedPost: kept, version: sql`${pictures.version} + 1`, claimId: null, claimedUntil: null, nextTryAt: null, updatedAt: input.now })
    .where(eq(pictures.id, input.pictureId));
  // The post is hidden, if it is not already. (Its "hidden by" stays empty when nobody pressed anything: this was the app's own step.)
  await tx
    .update(schema.projectPosts)
    .set({ hiddenAt: input.now, hiddenBy: input.by, hiddenNote: "A picture of this post was removed by Connect.", updatedAt: input.now })
    .where(and(eq(schema.projectPosts.id, input.postId), sql`${schema.projectPosts.hiddenAt} is null`));
}

/** Whether a post has a locked picture. Such a post can no longer be changed, removed or shown. */
export async function hasLockedPicture(reader: Pick<Tx, "select">, postId: string): Promise<boolean> {
  const [row] = await reader.select({ id: pictures.id }).from(pictures).where(and(eq(pictures.postId, postId), eq(pictures.state, "locked"))).limit(1);
  return Boolean(row);
}

/** A post and its project, both locked, whoever asks and whatever state the post is in. Null if there is no such post. */
export async function lockPost(tx: Tx, postId: string): Promise<{ post: ProjectPost; project: Project } | null> {
  const [found] = await tx.select({ projectId: schema.projectPosts.projectId }).from(schema.projectPosts).where(eq(schema.projectPosts.id, postId));
  if (!found) return null;
  const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, found.projectId)).for("update");
  const [post] = await tx.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, postId)).for("update");
  return project && post ? { post, project } : null;
}

/**
 * Deletes a removed picture's bytes, if nothing still needs them: no check of it is under way,
 * and the child-safety tool, once it is switched on, has answered for it. Otherwise they stay for
 * now, and the queue deletes them when that has settled (queue.ts). A locked picture's bytes are never
 * deleted: this only ever touches a picture whose state is "removed".
 */
export async function deleteBytesIfFree(tx: Tx, pictureId: string, now: Date): Promise<boolean> {
  const [picture] = await tx.select().from(pictures).where(eq(pictures.id, pictureId)).for("update");
  if (!picture || picture.state !== "removed") return false;
  if (picture.claimedUntil && picture.claimedUntil > now) return false;
  if (picture.childCheck === "waiting") return false;
  // Once the tool is switched on, also a picture from before that day is kept until the tool has answered for it.
  if (picture.childCheck === "not_set_up" && (await childCheckOn(tx))) return false;
  await tx.delete(schema.projectPictureFiles).where(eq(schema.projectPictureFiles.pictureId, pictureId));
  return true;
}

/**
 * Marks pictures as removed, in the caller's step. Never a locked one. The picture is gone for
 * everyone from this moment; its line stays, with what the checkers said.
 */
export async function removeInStep(tx: Tx, pictureIds: string[], by: "host" | "founder", now: Date): Promise<void> {
  if (pictureIds.length === 0) return;
  const removed = await tx
    .update(pictures)
    .set({ state: "removed", level: null, removedAt: now, removedBy: by, version: sql`${pictures.version} + 1`, nextTryAt: null, updatedAt: now })
    .where(and(inArray(pictures.id, pictureIds), inArray(pictures.state, ["waiting", "shown", "refused"])))
    .returning({ id: pictures.id });
  for (const { id } of removed) await deleteBytesIfFree(tx, id, now);
}

/**
 * A checker's flag refuses a picture (the founder's decision, 18 November 2026): in the caller's
 * step, with the picture locked. Nobody sees it; its bytes are deleted here and now; its line
 * stays, marked, so the same bytes are refused again. Nothing goes to the founder.
 */
export async function refuseInStep(tx: Tx, input: { pictureId: string; by: string; detail: string; now: Date }): Promise<void> {
  await tx
    .update(pictures)
    .set({ state: "refused", level: null, refusedByChecker: true, checkedBy: input.by, checkedAt: input.now, rulesVersion: PICTURE.rulesVersion, checkDetail: input.detail, version: sql`${pictures.version} + 1`, claimId: null, claimedUntil: null, nextTryAt: null, updatedAt: input.now })
    .where(eq(pictures.id, input.pictureId));
  await tx.delete(schema.projectPictureFiles).where(eq(schema.projectPictureFiles.pictureId, input.pictureId));
}

/**
 * A report for "someone under 18" was made about a post: while it is open, the post's pictures
 * carry the report's "suspected" mark, and no everyday checker is sent them. The mark hides
 * nothing by itself (plans/23). Each change moves the picture's counter, so an answer that was
 * already on its way no longer counts.
 */
export async function markSuspectedByReport(tx: Tx, postId: string, now: Date): Promise<void> {
  await tx
    .update(pictures)
    .set({ suspectedByReport: true, version: sql`${pictures.version} + 1`, updatedAt: now })
    .where(and(eq(pictures.postId, postId), inArray(pictures.state, ["waiting", "shown"]), eq(pictures.suspectedByReport, false)));
}

/** That report was closed. The mark comes off unless another such report on the same post is still open. The founder's own mark is never touched here. */
export async function liftSuspectedByReport(tx: Tx, postId: string, now: Date): Promise<void> {
  const [open] = await tx
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(and(eq(schema.reports.context, "post"), eq(schema.reports.contextId, postId), eq(schema.reports.reason, "under18"), eq(schema.reports.status, "open")))
    .limit(1);
  if (open) return;
  await tx.update(pictures).set({ suspectedByReport: false, version: sql`${pictures.version} + 1`, updatedAt: now }).where(and(eq(pictures.postId, postId), eq(pictures.suspectedByReport, true)));
}

/** Removed pictures whose bytes are still there. For the queue's tidying. */
export async function removedWithBytes(limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: pictures.id })
    .from(pictures)
    .innerJoin(schema.projectPictureFiles, eq(schema.projectPictureFiles.pictureId, pictures.id))
    .where(and(eq(pictures.state, "removed"), isNotNull(pictures.removedAt)))
    .limit(limit);
  return rows.map((row) => row.id);
}
