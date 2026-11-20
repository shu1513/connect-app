/**
 * The posts of a project's diary (plans/23, "The diary"; plans/24): writing, changing and removing
 * them, the lists a page shows, and the founder hiding one.
 *
 * Who sees a post:
 *   everyone   a post that is not removed and not hidden, on a host page that is open to everyone
 *   the host   also her hidden posts, marked "Hidden by Connect"
 *   nobody     a post she removed (its line stays, for a report made about it)
 */
import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Project, ProjectPost } from "@/db/schema";
import { publicProfile } from "@/lib/profiles/profiles";
import { recordAdminAction } from "@/lib/safety/audit";
import { projectsOnFor } from "@/lib/safety/switches";
import { hasLockedPicture, removeInStep } from "./picture-steps";
import { isId, NOT_RUNNING, PROJECTS_OFF } from "./projects";
import { linksToText, PROJECT, ProjectError, readPost } from "./rules";
import { followEmailsOn } from "@/lib/follows/rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const NOT_FOUND = "Post not found.";

/**
 * The post and its project, both locked, if the post is this host's and she has not removed it.
 * Someone else's post and one that does not exist look the same. Also the way in for her pictures
 * (pictures.ts), so that a post and its pictures are changed one after the other, never at once.
 */
export async function ownPost(tx: Tx, hostId: string, postId: string): Promise<{ post: ProjectPost; project: Project }> {
  if (!isId(postId)) throw new ProjectError(NOT_FOUND);
  const [found] = await tx
    .select({ projectId: schema.projects.id })
    .from(schema.projectPosts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .where(and(eq(schema.projectPosts.id, postId), eq(schema.projects.hostId, hostId)));
  if (!found) throw new ProjectError(NOT_FOUND);
  // The project before the post, as everywhere: ending a project and changing one of its posts wait for each other.
  const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, found.projectId)).for("update");
  const [post] = await tx.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, postId)).for("update");
  if (!project || !post || post.removedAt) throw new ProjectError(NOT_FOUND);
  return { post, project };
}

/** The host writes a post in the project the form was drawn for, which must be her running one. */
export async function writePost(input: { hostId: string; projectId: string; text: string; links: string[]; now: Date }): Promise<ProjectPost> {
  const { text, links } = readPost(input);
  if (!isId(input.projectId)) throw new ProjectError(NOT_RUNNING);
  return db.transaction(async (tx) => {
    if (!(await projectsOnFor(input.hostId, tx))) throw new ProjectError(PROJECTS_OFF);
    // Locked, so a project that is being ended at this moment gets no new post.
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.hostId, input.hostId), eq(schema.projects.status, "running")))
      .for("update");
    if (!project) throw new ProjectError(NOT_RUNNING);
    // While the emails to followers are switched off, a post is marked as dealt with as it is written: switching
    // them on later never announces anything from before (plans/31).
    const [post] = await tx
      .insert(schema.projectPosts)
      .values({ projectId: project.id, text, links: linksToText(links), createdAt: input.now, updatedAt: input.now, announcedAt: followEmailsOn() ? null : input.now })
      .returning();
    return post;
  });
}

/** The host changes a post. Only in her running project, not a post the founder has hidden, and not while the switch is off for her. */
export async function changePost(input: { hostId: string; postId: string; text: string; links: string[]; now: Date }): Promise<void> {
  const { text, links } = readPost(input);
  await db.transaction(async (tx) => {
    if (!(await projectsOnFor(input.hostId, tx))) throw new ProjectError(PROJECTS_OFF);
    const { post, project } = await ownPost(tx, input.hostId, input.postId);
    if (project.status !== "running") throw new ProjectError("This project has ended, so its posts can no longer be changed.");
    if (post.hiddenAt) throw new ProjectError("This post was hidden by Connect and cannot be changed. You can remove it.");
    await tx.update(schema.projectPosts).set({ text, links: linksToText(links), updatedAt: input.now }).where(eq(schema.projectPosts.id, post.id));
  });
}

/**
 * The host removes a post, and with it its pictures. Always allowed for a post of hers: also a
 * hidden one, in an ended project, and while the switch is off. The one exception is a post with
 * a picture Connect has removed and reported: that post is kept as it is (plans/24, "What locked protects").
 */
export async function removePost(input: { hostId: string; postId: string; now: Date }): Promise<void> {
  await db.transaction(async (tx) => {
    const { post } = await ownPost(tx, input.hostId, input.postId);
    if (await hasLockedPicture(tx, post.id)) throw new ProjectError("This post is kept by Connect and cannot be removed.");
    await tx.update(schema.projectPosts).set({ removedAt: input.now, updatedAt: input.now }).where(eq(schema.projectPosts.id, post.id));
    const mine = await tx.select({ id: schema.projectPictures.id }).from(schema.projectPictures).where(and(eq(schema.projectPictures.postId, post.id), inArray(schema.projectPictures.state, ["waiting", "shown", "refused"])));
    await removeInStep(tx, mine.map((picture) => picture.id), "host", input.now);
  });
}

/** One post for its own page on the host's side, with its project. Null for someone else's, a removed one and one that does not exist. */
export async function postForHost(hostId: string, postId: string): Promise<{ post: ProjectPost; project: Project } | null> {
  if (!isId(postId)) return null;
  const [row] = await db
    .select({ post: schema.projectPosts, project: schema.projects })
    .from(schema.projectPosts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .where(and(eq(schema.projectPosts.id, postId), eq(schema.projects.hostId, hostId), isNull(schema.projectPosts.removedAt)));
  return row ?? null;
}

/**
 * One page of a project's posts, the newest first, and whether there are older ones. `forHost`
 * includes the posts the founder has hidden; everyone else never gets them. Removed posts are in
 * neither. The caller has already decided that this viewer may see the project at all.
 */
export async function postsOf(projectId: string, options: { page?: number; forHost?: boolean } = {}): Promise<{ posts: ProjectPost[]; older: boolean }> {
  const page = Number.isInteger(options.page) && options.page! > 0 ? options.page! : 1;
  const seen = and(eq(schema.projectPosts.projectId, projectId), isNull(schema.projectPosts.removedAt), options.forHost ? undefined : isNull(schema.projectPosts.hiddenAt));
  const rows = await db
    .select()
    .from(schema.projectPosts)
    .where(seen)
    .orderBy(desc(schema.projectPosts.createdAt), desc(schema.projectPosts.id))
    .limit(PROJECT.postsPerPage + 1)
    .offset((page - 1) * PROJECT.postsPerPage);
  return { posts: rows.slice(0, PROJECT.postsPerPage), older: rows.length > PROJECT.postsPerPage };
}

/** How many posts of a project everyone can see. */
export async function publicPostCount(projectId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.projectPosts).where(and(eq(schema.projectPosts.projectId, projectId), isNull(schema.projectPosts.removedAt), isNull(schema.projectPosts.hiddenAt)));
  return row?.n ?? 0;
}

/**
 * A post as anyone may see it, with its project and host, or null: not removed, not hidden, and
 * on a host page that is open to everyone. Asked by the report form, so that only a post the
 * reporter can really see can be reported.
 */
export async function publicPost(postId: string): Promise<{ post: ProjectPost; project: Project; handle: string } | null> {
  if (!isId(postId)) return null;
  const [row] = await db
    .select({ post: schema.projectPosts, project: schema.projects, handle: schema.hostProfiles.handle })
    .from(schema.projectPosts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .innerJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.projects.hostId))
    .where(and(eq(schema.projectPosts.id, postId), isNull(schema.projectPosts.removedAt), isNull(schema.projectPosts.hiddenAt)));
  // Whether her page is open is asked of the one function that knows (approved, not hidden by her, account open).
  if (!row || !(await publicProfile(row.handle))) return null;
  return row;
}

// ---------------------------------------------------------------------------
// The founder
// ---------------------------------------------------------------------------

/** The founder hides a post, with a note. The host is shown "Hidden by Connect"; nobody else sees the post. */
export async function hidePost(input: { adminId: string; postId: string; note: string; now: Date }): Promise<void> {
  if (!isId(input.postId)) throw new ProjectError(NOT_FOUND);
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, 500);
  await db.transaction(async (tx) => {
    const [hidden] = await tx
      .update(schema.projectPosts)
      .set({ hiddenAt: input.now, hiddenBy: input.adminId, hiddenNote: note, updatedAt: input.now })
      .where(and(eq(schema.projectPosts.id, input.postId), isNull(schema.projectPosts.hiddenAt)))
      .returning({ projectId: schema.projectPosts.projectId });
    if (!hidden) throw new ProjectError("That post is already hidden, or does not exist.");
    const [project] = await tx.select({ hostId: schema.projects.hostId }).from(schema.projects).where(eq(schema.projects.id, hidden.projectId));
    await recordAdminAction({ adminId: input.adminId, action: "diary post hidden", targetUserId: project?.hostId, targetId: input.postId, detail: note }, tx);
  });
}

/** The founder shows a hidden post again. Never one with a picture that was removed and reported: that post stays hidden for good. */
export async function showPost(input: { adminId: string; postId: string; now: Date }): Promise<void> {
  if (!isId(input.postId)) throw new ProjectError(NOT_FOUND);
  await db.transaction(async (tx) => {
    // The post is locked first, so that showing it and locking one of its pictures wait for each other.
    const [post] = await tx.select().from(schema.projectPosts).where(eq(schema.projectPosts.id, input.postId)).for("update");
    if (!post || !post.hiddenAt) throw new ProjectError("That post is not hidden, or does not exist.");
    if (await hasLockedPicture(tx, post.id)) throw new ProjectError("A picture of this post was removed and reported, so the post stays hidden.");
    await tx.update(schema.projectPosts).set({ hiddenAt: null, hiddenBy: null, hiddenNote: null, updatedAt: input.now }).where(eq(schema.projectPosts.id, post.id));
    const [project] = await tx.select({ hostId: schema.projects.hostId }).from(schema.projects).where(eq(schema.projects.id, post.projectId));
    await recordAdminAction({ adminId: input.adminId, action: "diary post shown again", targetUserId: project?.hostId, targetId: input.postId }, tx);
  });
}

export type AdminPost = { post: ProjectPost; projectName: string; hostName: string; handle: string | null };

const adminPosts = () =>
  db
    .select({ post: schema.projectPosts, projectName: schema.projects.name, hostName: schema.user.name, handle: schema.hostProfiles.handle })
    .from(schema.projectPosts)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .innerJoin(schema.user, eq(schema.user.id, schema.projects.hostId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.projects.hostId));

/** For the founder: one post, whatever its state. */
export async function postForAdmin(postId: string): Promise<AdminPost | null> {
  if (!isId(postId)) return null;
  const [row] = await adminPosts().where(eq(schema.projectPosts.id, postId));
  return row ?? null;
}

/**
 * For the founder: one page of a project's posts, the newest first, hidden ones included, whether
 * or not the host's page is open. This is how every post can be reached and hidden. Posts the host
 * removed are not in it: nobody sees those, so there is nothing left to hide.
 */
export async function projectPostsForAdmin(projectId: string, page = 1): Promise<{ posts: AdminPost[]; older: boolean } | null> {
  if (!isId(projectId)) return null;
  const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) return null;
  const from = Number.isInteger(page) && page > 0 ? page : 1;
  const rows = await adminPosts()
    .where(and(eq(schema.projectPosts.projectId, projectId), isNull(schema.projectPosts.removedAt)))
    .orderBy(desc(schema.projectPosts.createdAt), desc(schema.projectPosts.id))
    .limit(PROJECT.postsPerPage + 1)
    .offset((from - 1) * PROJECT.postsPerPage);
  return { posts: rows.slice(0, PROJECT.postsPerPage), older: rows.length > PROJECT.postsPerPage };
}

/** For the founder: the posts that are hidden now, and the newest posts of all projects. */
export async function postsForAdmin(): Promise<{ hidden: AdminPost[]; latest: AdminPost[] }> {
  const hidden = await adminPosts().where(and(isNotNull(schema.projectPosts.hiddenAt), isNull(schema.projectPosts.removedAt))).orderBy(desc(schema.projectPosts.hiddenAt));
  const latest = await adminPosts().where(and(isNull(schema.projectPosts.removedAt), isNull(schema.projectPosts.hiddenAt))).orderBy(desc(schema.projectPosts.createdAt)).limit(30);
  return { hidden, latest };
}
