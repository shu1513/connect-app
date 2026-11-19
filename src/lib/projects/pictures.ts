/**
 * The pictures of a diary post, on the host's side and for everyone who looks (plans/23,
 * "Pictures"; plans/24): taking an upload in, handing a picture out, and removing one. The
 * checking is in checks/ and queue.ts; what the founder decides is in moderation.ts.
 *
 * `pictureFor` is the only function that hands out a picture's bytes. The steps several files
 * share (locking, removing, refusing) are in picture-steps.ts.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProjectPicture } from "@/db/schema";
import { publicProfile } from "@/lib/profiles/profiles";
import { projectsOnFor } from "@/lib/safety/switches";
import { childCheckOn, mayBeFetched, mayUpload, startingChildCheck } from "./child-safety";
import { makeCopy } from "./copy";
import { adminUrl, hasOpenUnder18Report, lockInStep, removeInStep, tellFounders } from "./picture-steps";
import { ownPost } from "./posts";
import { isId, PROJECTS_OFF } from "./projects";
import { PICTURE, ProjectError } from "./rules";

const NOT_FOUND = "Picture not found.";
const pictures = schema.projectPictures;
/** The states that count toward a post's four pictures. */
const COUNTED = ["waiting", "shown", "locked"];

// ---------------------------------------------------------------------------
// One picture is worked on at a time (plans/24, choice 9)
// ---------------------------------------------------------------------------

let busy = false;
/**
 * Takes the one place for working on an upload, or says it is taken. A large photo needs a lot of
 * memory while it is open, so uploads are read and turned into Connect's copy one after the other.
 * A second upload is told to try again; it is never kept waiting in memory. (This counts for each
 * running copy of the web server.)
 */
export function takePlace(): boolean {
  if (busy) return false;
  busy = true;
  return true;
}
export function givePlace(): void {
  busy = false;
}

// ---------------------------------------------------------------------------
// Taking an upload in
// ---------------------------------------------------------------------------

/**
 * Takes an uploaded file in as a picture of one of the host's posts. The caller holds the one
 * place for working on an upload (takePlace) and has already cut the upload off at its size limit.
 *
 * The heavy part, making Connect's copy, happens first and outside any database step. Then, in
 * one step: the host's uploads of the last 24 hours are counted under a lock for that host, and
 * the post's pictures under the post's own lock, so uploads sent at the same moment cannot slip
 * past either limit. Nothing of the original file is kept.
 */
export async function acceptUpload(input: { hostId: string; postId: string; original: Buffer; now: Date }): Promise<ProjectPicture> {
  if (!mayUpload()) throw new ProjectError("Pictures cannot be uploaded at the moment.");
  const copy = await makeCopy(input.original);
  const sha256 = createHash("sha256").update(copy.bytes).digest("hex");

  return db.transaction(async (tx) => {
    // One host at a time: the day's count and the insert that follows are one step.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pictures:${input.hostId}`}))`);
    if (!(await projectsOnFor(input.hostId, tx))) throw new ProjectError(PROJECTS_OFF);
    const { post, project } = await ownPost(tx, input.hostId, input.postId);
    if (project.status !== "running") throw new ProjectError("This project has ended, so no pictures can be added to its posts.");
    if (post.hiddenAt) throw new ProjectError("This post was hidden by Connect, so no pictures can be added to it.");

    const [{ today }] = await tx
      .select({ today: sql<number>`count(*)::int` })
      .from(pictures)
      .where(and(eq(pictures.hostId, input.hostId), gt(pictures.uploadedAt, new Date(input.now.getTime() - 24 * 3_600_000))));
    if (today >= PICTURE.perDay) throw new ProjectError(`You have uploaded ${PICTURE.perDay} pictures in the last 24 hours, which is the limit. Please try again tomorrow.`);
    const [{ inPost }] = await tx
      .select({ inPost: sql<number>`count(*)::int` })
      .from(pictures)
      .where(and(eq(pictures.postId, post.id), inArray(pictures.state, COUNTED)));
    if (inPost >= PICTURE.perPost) throw new ProjectError(`A post can have up to ${PICTURE.perPost} pictures. Remove one first.`);

    // The same bytes as one of her pictures that a checker refused (also one she has cleared away since), or that
    // is locked: an upload is not a second try at a clean answer.
    const same = await tx
      .select({ state: pictures.state, refusedByChecker: pictures.refusedByChecker, checkedBy: pictures.checkedBy, checkDetail: pictures.checkDetail })
      .from(pictures)
      .where(and(eq(pictures.hostId, input.hostId), eq(pictures.sha256, sha256), or(eq(pictures.state, "locked"), eq(pictures.refusedByChecker, true))));
    const wasLocked = same.some((earlier) => earlier.state === "locked");
    const wasRefused = wasLocked ? undefined : same.find((earlier) => earlier.refusedByChecker);

    const waitsForTool = await childCheckOn(tx);
    const [picture] = await tx
      .insert(pictures)
      .values({
        postId: post.id,
        hostId: input.hostId,
        width: copy.width,
        height: copy.height,
        byteLength: copy.bytes.length,
        sha256,
        uploadedAt: input.now,
        state: wasRefused ? "refused" : "waiting",
        refusedByChecker: Boolean(wasRefused),
        checkedBy: wasRefused ? wasRefused.checkedBy : null,
        checkedAt: wasRefused ? input.now : null,
        rulesVersion: wasRefused ? PICTURE.rulesVersion : null,
        checkDetail: wasRefused ? `The same picture as one that was refused before. ${wasRefused.checkDetail ?? ""}`.trim() : null,
        childCheck: startingChildCheck(waitsForTool),
        // A picture added while a report for "someone under 18" is open on its post is suspected like the ones that were there.
        suspectedByReport: await hasOpenUnder18Report(tx, post.id),
        nextTryAt: wasRefused || wasLocked ? null : input.now,
      })
      .returning();
    // A picture that is refused on the spot is not kept at all, unless the child-safety tool is switched on:
    // then it is kept until the tool has seen it, like every other upload (picture-steps.ts, deleteBytesIfFree).
    if (!wasRefused || waitsForTool) await tx.insert(schema.projectPictureFiles).values({ pictureId: picture.id, bytes: copy.bytes });
    if (wasLocked) {
      await lockInStep(tx, { pictureId: picture.id, postId: post.id, by: null, now: input.now });
      await tellFounders(tx, {
        subject: "A locked picture was uploaded again",
        text: `A host uploaded a picture that is the same, byte for byte, as one you removed and reported. It was locked at once and its post is hidden.\n\n${adminUrl()}`,
        key: `picture-locked-again:${picture.id}`,
      });
    }
    const [stored] = await tx.select().from(pictures).where(eq(pictures.id, picture.id));
    return stored;
  });
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

/** The host removes one of her pictures, or clears away one that was refused. Always allowed for a picture of hers, except a locked one. */
export async function removePicture(input: { hostId: string; pictureId: string; now: Date }): Promise<void> {
  if (!isId(input.pictureId)) throw new ProjectError(NOT_FOUND);
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ postId: pictures.postId, hostId: pictures.hostId }).from(pictures).where(eq(pictures.id, input.pictureId));
    if (!found || found.hostId !== input.hostId) throw new ProjectError(NOT_FOUND);
    // The post's lock first, as everywhere.
    await ownPost(tx, input.hostId, found.postId);
    const [picture] = await tx.select().from(pictures).where(eq(pictures.id, input.pictureId)).for("update");
    if (!picture || picture.state === "removed" || picture.state === "locked") throw new ProjectError(NOT_FOUND);
    await removeInStep(tx, [picture.id], "host", input.now);
  });
}

// ---------------------------------------------------------------------------
// Handing a picture out
// ---------------------------------------------------------------------------

export type Viewer = { id: string; admin: boolean } | null;

/**
 * A picture's bytes for this viewer, or null. The whole rule (plans/24, "Showing a picture"):
 *
 *   the picture                                        visitor   the host   the founder
 *   shown, its post up, her page open                  yes       yes        yes
 *   shown, post hidden by Connect or page not open     no        yes        yes
 *   held as suspected by the founder                   no        no         yes
 *   any picture of a post she has removed              no        no         yes, while kept
 *   waiting, its post not removed                      no        yes        yes
 *   refused, removed                                   no        no         no
 *   locked                                             no        no         no
 *
 * Before all of it: the rule of child-safety.ts. `open` says whether the answer went to someone
 * who could see the picture without being logged in; only such an answer may be kept by a browser.
 */
export async function pictureFor(viewer: Viewer, pictureId: string): Promise<{ bytes: Buffer; open: boolean } | null> {
  if (!isId(pictureId)) return null;
  const [row] = await db
    .select({ picture: pictures, postRemovedAt: schema.projectPosts.removedAt, postHiddenAt: schema.projectPosts.hiddenAt, hostId: schema.projects.hostId, handle: schema.hostProfiles.handle })
    .from(pictures)
    .innerJoin(schema.projectPosts, eq(schema.projectPosts.id, pictures.postId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.projects.hostId))
    .where(eq(pictures.id, pictureId));
  if (!row) return null;
  const { picture } = row;
  if (!mayBeFetched(picture)) return null;
  if (picture.state === "removed" || picture.state === "locked" || picture.state === "refused") return null;

  const isHost = viewer?.id === row.hostId;
  const isFounder = Boolean(viewer?.admin);
  let open = false;
  if (picture.suspectedByFounder || row.postRemovedAt) {
    if (!isFounder) return null;
  } else if (picture.state === "shown" && !row.postHiddenAt && row.handle && (await publicProfile(row.handle))) {
    open = true;
  } else if (!isHost && !isFounder) {
    return null;
  }
  const [file] = await db.select({ bytes: schema.projectPictureFiles.bytes }).from(schema.projectPictureFiles).where(eq(schema.projectPictureFiles.pictureId, picture.id));
  return file ? { bytes: file.bytes, open } : null;
}

/** `held`: taken out of sight by the founder for now, or not yet answered for by the child-safety tool. The host is told so instead of being shown it. */
export type ShownPicture = { id: string; postId: string; width: number; height: number; state: string; held: boolean; checkDetail: string | null };

/**
 * The pictures of these posts, in the order they were uploaded, for a page that has already
 * decided the viewer may see the posts. Everyone gets the shown ones; `forHost` adds the ones that
 * are waiting, and the ones that were refused (to tell her so). Removed and locked pictures are in
 * neither, and neither is a picture the child-safety rule or the founder holds back.
 */
export async function picturesOf(postIds: string[], options: { forHost?: boolean } = {}): Promise<Map<string, ShownPicture[]>> {
  const byPost = new Map<string, ShownPicture[]>();
  if (postIds.length === 0) return byPost;
  const rows = await db
    .select()
    .from(pictures)
    .where(and(inArray(pictures.postId, postIds), inArray(pictures.state, options.forHost ? ["waiting", "refused", "shown"] : ["shown"])))
    .orderBy(asc(pictures.uploadedAt), asc(pictures.id));
  for (const picture of rows) {
    if (!options.forHost && (!mayBeFetched(picture) || picture.suspectedByFounder)) continue;
    const list = byPost.get(picture.postId) ?? [];
    list.push({ id: picture.id, postId: picture.postId, width: picture.width, height: picture.height, state: picture.state, held: picture.suspectedByFounder || !mayBeFetched(picture), checkDetail: picture.checkDetail });
    byPost.set(picture.postId, list);
  }
  return byPost;
}

/** How many pictures a post has that count toward its four: the ones that are waiting, shown or locked. A refused or removed one does not. */
export async function pictureCount(postId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(pictures).where(and(eq(pictures.postId, postId), inArray(pictures.state, COUNTED)));
  return row?.n ?? 0;
}

