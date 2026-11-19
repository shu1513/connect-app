/**
 * What the founder does with a picture (plans/23, "Pictures"; plans/24, "The founder's page").
 * A picture a checker flags is refused by itself, so the founder has no pictures to decide. What
 * is left: remove one, remove and report one, and take one out of sight while looking into it.
 * Every decision is written to the record of the founder's actions, in the same step.
 */
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Project, ProjectPicture, ProjectPost } from "@/db/schema";
import { recordAdminAction } from "@/lib/safety/audit";
import { azureChecker } from "./checks/azure";
import { openAiChecker } from "./checks/openai";
import { sightengineChecker } from "./checks/sightengine";
import { childCheckOn, childTool } from "./child-safety";
import { lockInStep, lockPost, removeInStep, type Tx } from "./picture-steps";
import { isId } from "./projects";
import { ProjectError } from "./rules";

const pictures = schema.projectPictures;
const NOT_FOUND = "Picture not found.";

/** The picture with its post and project, all locked in the app's order, for one decision. */
async function decide(pictureId: string, work: (tx: Tx, found: { picture: ProjectPicture; post: ProjectPost; project: Project }) => Promise<void>): Promise<void> {
  if (!isId(pictureId)) throw new ProjectError(NOT_FOUND);
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ postId: pictures.postId }).from(pictures).where(eq(pictures.id, pictureId));
    const locked = found ? await lockPost(tx, found.postId) : null;
    const [picture] = await tx.select().from(pictures).where(eq(pictures.id, pictureId)).for("update");
    if (!locked || !picture) throw new ProjectError(NOT_FOUND);
    await work(tx, { picture, ...locked });
  });
}

/** The founder removes a picture. Not a locked one, and not one that is already gone. */
export async function removePictureAsFounder(input: { adminId: string; pictureId: string; now: Date }): Promise<void> {
  await decide(input.pictureId, async (tx, { picture, project }) => {
    if (picture.state !== "waiting" && picture.state !== "shown") throw new ProjectError("That picture is no longer there to remove.");
    await removeInStep(tx, [picture.id], "founder", input.now);
    await recordAdminAction({ adminId: input.adminId, action: "diary picture removed", targetUserId: project.hostId, targetId: picture.id }, tx);
  });
}

/**
 * "Remove and report": the picture is locked. Nobody sees it again, its post is hidden and kept
 * as it was, and nothing deletes it afterwards. Only a picture whose bytes Connect still has.
 */
export async function lockAndReport(input: { adminId: string; pictureId: string; now: Date }): Promise<void> {
  await decide(input.pictureId, async (tx, { picture, post, project }) => {
    if (picture.state === "locked") throw new ProjectError("That picture is already removed and reported.");
    const [file] = await tx.select({ id: schema.projectPictureFiles.pictureId }).from(schema.projectPictureFiles).where(eq(schema.projectPictureFiles.pictureId, picture.id));
    if (!file) throw new ProjectError("That picture's file is no longer kept, so it cannot be locked.");
    await lockInStep(tx, { pictureId: picture.id, postId: post.id, by: input.adminId, now: input.now });
    await recordAdminAction({ adminId: input.adminId, action: "diary picture removed and reported", targetUserId: project.hostId, targetId: picture.id }, tx);
  });
}

/**
 * The founder's own "suspected" mark, on or off. While it is on, nobody but the founder sees the
 * picture and no everyday checker is sent it. Only the founder lifts it; closing a report never does.
 */
export async function setSuspected(input: { adminId: string; pictureId: string; on: boolean; now: Date }): Promise<void> {
  await decide(input.pictureId, async (tx, { picture, project }) => {
    if (picture.state !== "waiting" && picture.state !== "shown") throw new ProjectError("That picture is no longer there.");
    if (picture.suspectedByFounder === input.on) throw new ProjectError(input.on ? "That picture is already held." : "That picture is not held.");
    // The counter moves, so an answer a checker was already working on no longer counts.
    await tx.update(pictures).set({ suspectedByFounder: input.on, version: picture.version + 1, updatedAt: input.now }).where(eq(pictures.id, picture.id));
    await recordAdminAction({ adminId: input.adminId, action: input.on ? "diary picture held as suspected" : "diary picture no longer held", targetUserId: project.hostId, targetId: picture.id }, tx);
  });
}

/** "I have made the report": the day and time the founder says the report to the authorities was really made. */
export async function recordReportMade(input: { adminId: string; pictureId: string; madeAt: Date; now: Date }): Promise<void> {
  if (Number.isNaN(input.madeAt.getTime())) throw new ProjectError("Please give the day and time the report was made.");
  if (input.madeAt > input.now) throw new ProjectError("That time has not come yet. Please give the time the report was really made.");
  await decide(input.pictureId, async (tx, { picture, project }) => {
    if (picture.state !== "locked") throw new ProjectError("Only a picture that was removed and reported has a report.");
    await tx.update(pictures).set({ reportMadeAt: input.madeAt, updatedAt: input.now }).where(eq(pictures.id, picture.id));
    await recordAdminAction({ adminId: input.adminId, action: "report of a diary picture recorded", targetUserId: project.hostId, targetId: picture.id, detail: `made ${input.madeAt.toISOString()}` }, tx);
  });
}

// ---------------------------------------------------------------------------
// What the founder's page shows
// ---------------------------------------------------------------------------

export type AdminPicture = { picture: ProjectPicture; projectName: string; hostName: string; handle: string | null };

const adminPictures = () =>
  db
    .select({ picture: pictures, projectName: schema.projects.name, hostName: schema.user.name, handle: schema.hostProfiles.handle })
    .from(pictures)
    .innerJoin(schema.projectPosts, eq(schema.projectPosts.id, pictures.postId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectPosts.projectId))
    .innerJoin(schema.user, eq(schema.user.id, schema.projects.hostId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.projects.hostId));

/** The lists of the founder's page: pictures shown after a check for nudity only, pictures still waiting, the ones the founder holds, and the locked ones. */
export async function picturesForAdmin(): Promise<{ nudityOnly: AdminPicture[]; waiting: AdminPicture[]; held: AdminPicture[]; locked: AdminPicture[] }> {
  const nudityOnly = await adminPictures().where(and(eq(pictures.state, "shown"), eq(pictures.level, "nudity_only"), eq(pictures.suspectedByFounder, false))).orderBy(asc(pictures.checkedAt)).limit(100);
  const waiting = await adminPictures().where(and(eq(pictures.state, "waiting"), eq(pictures.suspectedByFounder, false))).orderBy(asc(pictures.uploadedAt)).limit(100);
  const held = await adminPictures().where(and(inArray(pictures.state, ["waiting", "shown"]), eq(pictures.suspectedByFounder, true))).orderBy(asc(pictures.uploadedAt));
  const locked = await adminPictures().where(eq(pictures.state, "locked")).orderBy(desc(pictures.lockedAt));
  return { nudityOnly, waiting, held, locked };
}

/** Every picture of one post that is still there, for the founder looking at that post. */
export async function picturesOfPostForAdmin(postId: string): Promise<ProjectPicture[]> {
  if (!isId(postId)) return [];
  return db.select().from(pictures).where(and(eq(pictures.postId, postId), inArray(pictures.state, ["waiting", "shown", "locked"]))).orderBy(asc(pictures.uploadedAt), asc(pictures.id));
}

export type CheckerState = { name: string; label: string; hasKey: boolean; lastGoodAt: Date | null; worksWithThisKey: boolean; outUntil: Date | null; faultSince: Date | null; faultDetail: string | null };

/** How each outside checking service stands, and the child-safety tool. Only whether a key is there is read, never the key. */
export async function checkerStates(now: Date): Promise<{ services: CheckerState[]; childToolThere: boolean; childCheckOn: boolean }> {
  const rows = await db.select().from(schema.pictureCheckers).where(or(isNotNull(schema.pictureCheckers.lastGoodAt), isNotNull(schema.pictureCheckers.outUntil), isNotNull(schema.pictureCheckers.faultSince)));
  const labels: Record<string, string> = { openai: "OpenAI", azure: "Microsoft", sightengine: "Sightengine" };
  const services = [openAiChecker(), azureChecker(), sightengineChecker()].map((service) => {
    const row = rows.find((line) => line.service === service.name);
    return {
      name: service.name,
      label: labels[service.name],
      hasKey: Boolean(service.keyMark),
      lastGoodAt: row?.lastGoodAt ?? null,
      worksWithThisKey: Boolean(service.keyMark) && row?.lastGoodKey === service.keyMark,
      outUntil: row?.outUntil && row.outUntil > now ? row.outUntil : null,
      faultSince: row?.faultSince ?? null,
      faultDetail: row?.faultDetail ?? null,
    };
  });
  return { services, childToolThere: childTool() !== null, childCheckOn: await childCheckOn() };
}
