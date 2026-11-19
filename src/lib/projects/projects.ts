/**
 * A host's project (plans/23, "How it works for a host"; plans/24): starting it, changing its name
 * and description, ending it, and finding it.
 *
 * Every function that writes is given the host's id by the caller, who takes it from the login and
 * never from a form. Each one decides again for itself whether the host may do this.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Project } from "@/db/schema";
import { ContributionError, readSuggested } from "@/lib/contributions/rules";
import { publicProfile, type PublicProfile } from "@/lib/profiles/profiles";
import { projectsOnFor } from "@/lib/safety/switches";
import { ProjectError, projectProblem, tidyName, tidyText } from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Whether a text is an id as our database makes them. Anything else is never looked up. */
export const isId = (text: string): boolean => ID.test(text);

export const PROJECTS_OFF = "Projects are not open at the moment.";
/**
 * Said when a form names a project that is not this host's running one: someone else's, one that
 * has ended since the page was drawn (an old tab), or no project at all. Every form that changes
 * a project names the project it was drawn for, so an old form can never act on a newer project.
 */
export const NOT_RUNNING = "That project is not running any more. Open the page again to see how things stand. Nothing was changed.";

function alreadyExists(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** The host's running project, or null. The one way to find it. */
export async function runningProjectOf(hostId: string, reader: Reader = db): Promise<Project | null> {
  const [project] = await reader.select().from(schema.projects).where(and(eq(schema.projects.hostId, hostId), eq(schema.projects.status, "running")));
  return project ?? null;
}

/** Every project of a host, the newest first. */
export async function projectsOf(hostId: string): Promise<Project[]> {
  return db.select().from(schema.projects).where(eq(schema.projects.hostId, hostId)).orderBy(desc(schema.projects.startedAt));
}

/**
 * Why this host cannot start a project right now, or null when she can. The rulebook's gate: her
 * page is approved and her payout account is ready. Beside it: her account is not paused, and the
 * founder's switch covers her.
 */
export async function startProblem(hostId: string, reader: Reader = db): Promise<string | null> {
  const [row] = await reader
    .select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt, status: schema.hostProfiles.status, payoutsReady: schema.hostSettings.payoutsReady })
    .from(schema.user)
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
    .leftJoin(schema.hostSettings, eq(schema.hostSettings.userId, schema.user.id))
    .where(eq(schema.user.id, hostId));
  if (!row || row.closedAt) return "Account not found.";
  if (row.pausedAt) return "Your account is paused, so you cannot start a project at the moment.";
  if (row.status !== "approved") return "Your host page must be approved before you can start a project.";
  if (!row.payoutsReady) return "Your payout account must be ready before you can start a project.";
  if (!(await projectsOnFor(hostId, reader))) return PROJECTS_OFF;
  return null;
}

/** The host starts a project. She can have one running at a time; the database itself refuses a second. */
export async function startProject(input: { hostId: string; name: string; description: string; now: Date }): Promise<Project> {
  const name = tidyName(input.name);
  const description = tidyText(input.description);
  const problem = projectProblem({ name, description });
  if (problem) throw new ProjectError(problem);
  try {
    return await db.transaction(async (tx) => {
      const cannot = await startProblem(input.hostId, tx);
      if (cannot) throw new ProjectError(cannot);
      const [project] = await tx.insert(schema.projects).values({ hostId: input.hostId, name, description, startedAt: input.now }).returning();
      return project;
    });
  } catch (error) {
    if (alreadyExists(error)) throw new ProjectError("You already have a project. End it before you start another.");
    throw error;
  }
}

/** The host changes the name and description of the project the form was drawn for, which must be her running one. Not while the founder's switch is off for her. */
export async function changeProject(input: { hostId: string; projectId: string; name: string; description: string; now: Date }): Promise<void> {
  const name = tidyName(input.name);
  const description = tidyText(input.description);
  const problem = projectProblem({ name, description });
  if (problem) throw new ProjectError(problem);
  if (!isId(input.projectId)) throw new ProjectError(NOT_RUNNING);
  await db.transaction(async (tx) => {
    if (!(await projectsOnFor(input.hostId, tx))) throw new ProjectError(PROJECTS_OFF);
    const changed = await tx
      .update(schema.projects)
      .set({ name, description, updatedAt: input.now })
      .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.hostId, input.hostId), eq(schema.projects.status, "running")))
      .returning({ id: schema.projects.id });
    if (changed.length === 0) throw new ProjectError(NOT_RUNNING);
  });
}

/**
 * The host sets the amounts she suggests, for each kind of contribution, as she typed them into
 * their boxes (plans/23, choice B). A kind she leaves empty is not offered. For the project the
 * form was drawn for, which must be her running one; not while the founder's switch is off for her.
 */
export async function changeSuggested(input: { hostId: string; projectId: string; once: string[]; monthly: string[]; now: Date }): Promise<void> {
  if (!isId(input.projectId)) throw new ProjectError(NOT_RUNNING);
  let once: number[];
  let monthly: number[];
  try {
    once = readSuggested(input.once);
    monthly = readSuggested(input.monthly);
  } catch (error) {
    if (error instanceof ContributionError) throw new ProjectError(error.message);
    throw error;
  }
  await db.transaction(async (tx) => {
    if (!(await projectsOnFor(input.hostId, tx))) throw new ProjectError(PROJECTS_OFF);
    const changed = await tx
      .update(schema.projects)
      .set({ suggestedOnce: once.join(","), suggestedMonthly: monthly.join(","), updatedAt: input.now })
      .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.hostId, input.hostId), eq(schema.projects.status, "running")))
      .returning({ id: schema.projects.id });
    if (changed.length === 0) throw new ProjectError(NOT_RUNNING);
  });
}

/**
 * Ends one running project of a host, inside the caller's database step. The one way a project
 * ends: what ending does to contributions (part two) is added here, in this same step. Returns
 * the project as it is afterwards, or null when that project was not her running one.
 */
export async function endProjectInStep(tx: Tx, input: { hostId: string; projectId: string; by: "host" | "connect"; now: Date }): Promise<{ project: Project; givenUpPayments: string[] } | null> {
  const [ended] = await tx
    .update(schema.projects)
    .set({ status: "ended", endedAt: input.now, endedBy: input.by, updatedAt: input.now })
    .where(and(eq(schema.projects.id, input.projectId), eq(schema.projects.hostId, input.hostId), eq(schema.projects.status, "running")))
    .returning();
  if (!ended) return null;
  // Every contribution to it ends in this same step: no monthly one is charged again, and payments that are only
  // held, monthly ones and ones made once, are given up. The caller lets their holds go once its step is saved.
  // (Loaded here, not at the top: that code talks to Stripe, and this file stays free of that.)
  const { endContributionsOfProject } = await import("@/lib/contributions/ending");
  const givenUpPayments = await endContributionsOfProject(tx, ended.id, "project_ended", input.now);
  return { project: ended, givenUpPayments };
}

/**
 * The host ends the project the form was drawn for, which must be her running one. Allowed also
 * while the founder's switch is off for her, and when her account is paused.
 */
export async function endProject(input: { hostId: string; projectId: string; now: Date }): Promise<Project> {
  if (!isId(input.projectId)) throw new ProjectError(NOT_RUNNING);
  const ended = await db.transaction((tx) => endProjectInStep(tx, { hostId: input.hostId, projectId: input.projectId, by: "host", now: input.now }));
  if (!ended) throw new ProjectError(NOT_RUNNING);
  // The project has ended from here on, whatever happens next. What was only held is let go (the helper repeats that until it is done).
  if (ended.givenUpPayments.length > 0) await (await import("@/lib/contributions/ending")).letGoAll(ended.givenUpPayments, input.now);
  return ended.project;
}

/**
 * The diary anyone may read, or null. Asked with the host's handle, and optionally one project's
 * id. Null whenever the host's page is not open to everyone (the same rule as her page: see
 * publicProfile), for an id that is not a project of that host, and for a host without a project.
 * Without an id: her running project, or the one that ended last when none is running.
 */
export async function diaryFor(handle: string, projectId?: string): Promise<{ profile: PublicProfile; project: Project } | null> {
  const profile = await publicProfile(handle);
  if (!profile) return null;
  if (projectId !== undefined) {
    if (!isId(projectId)) return null;
    // The project must be this host's: an id alone opens nothing under someone else's address.
    const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.hostId, profile.userId)));
    return project ? { profile, project } : null;
  }
  const running = await runningProjectOf(profile.userId);
  if (running) return { profile, project: running };
  const [last] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.hostId, profile.userId), eq(schema.projects.status, "ended")))
    .orderBy(desc(schema.projects.endedAt))
    .limit(1);
  return last ? { profile, project: last } : null;
}

/** For the founder: every project with its host, the newest first. */
export async function allProjects(): Promise<Array<{ project: Project; hostName: string; handle: string | null }>> {
  return db
    .select({ project: schema.projects, hostName: schema.user.name, handle: schema.hostProfiles.handle })
    .from(schema.projects)
    .innerJoin(schema.user, eq(schema.user.id, schema.projects.hostId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.projects.hostId))
    .orderBy(desc(schema.projects.startedAt));
}
