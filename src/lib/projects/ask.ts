/**
 * The two places where a customer meets a host's project without looking for it (plans/23,
 * "After a call"; plans/26): the box on the results of a call, and the visitor's own line
 * beside the project. Reading only: nothing here writes anything, and nothing asks Stripe.
 */
import { and, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Project } from "@/db/schema";
import type { LoadedAttendance } from "@/lib/attendance/load";
import { whyNotContribute } from "@/lib/contributions/start";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { runningProjectOf } from "./projects";
import { mayAsk } from "./rules";

const pays = schema.contributionPayments;

/**
 * "Already contributes" (plans/23): a monthly contribution of theirs to this project that is
 * being set up or running, or a payment of theirs to it that was ever held or taken. So someone
 * who gave once, who stopped, or who was refunded is not asked again for the same project.
 */
async function alreadyContributes(contributorId: string, projectId: string): Promise<boolean> {
  const [found] = await db
    .select({ id: schema.contributions.id })
    .from(schema.contributions)
    .leftJoin(pays, eq(pays.contributionId, schema.contributions.id))
    .where(
      and(
        eq(schema.contributions.contributorId, contributorId),
        eq(schema.contributions.projectId, projectId),
        or(and(eq(schema.contributions.kind, "monthly"), ne(schema.contributions.status, "ended")), isNotNull(pays.authorisedAt), inArray(pays.status, ["held", "taken"])),
      ),
    )
    .limit(1);
  return Boolean(found);
}

/**
 * The box after a call: the host's project, or null when the box is not shown. The page hands
 * over what it has already loaded; the rest is read here, and `mayAsk` decides from all of it.
 */
export async function askAfterCall(input: {
  /** Who is looking at the call's results. */
  role: "host" | "customer" | "admin";
  call: Call;
  /** The call's record, as the page loaded it. */
  attendance: Pick<LoadedAttendance, "final" | "result">;
  /** The host's page as everyone may open it (`publicProfile`), or null when it cannot be opened like that. */
  hostPage: { handle: string; displayName: string } | null;
}): Promise<{ project: Project; hostName: string; href: string } | null> {
  const { call, attendance, hostPage } = input;
  // Only the customer of the call is ever asked: for the host and the founder nothing more is read.
  if (input.role !== "customer") return null;
  const project = hostPage ? await runningProjectOf(call.hostId) : null;
  const [report, blocked, refund, cannot, already] = await Promise.all([
    db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(
        or(
          and(eq(schema.reports.reporterId, call.customerId), eq(schema.reports.reportedId, call.hostId)),
          and(eq(schema.reports.reporterId, call.hostId), eq(schema.reports.reportedId, call.customerId)),
        ),
      )
      .limit(1),
    isBlockedEitherWay(call.customerId, call.hostId),
    db.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id)).limit(1),
    project ? whyNotContribute(db, { contributorId: call.customerId, project }) : null,
    project ? alreadyContributes(call.customerId, project.id) : false,
  ]);
  const shown = mayAsk({
    role: input.role,
    cancelled: Boolean(call.cancelledAt),
    safetyEnded: Boolean(call.safetyEndedAt),
    recordFinal: attendance.final && Boolean(call.closedAt) && attendance.result.status === "complete",
    togetherSeconds: attendance.result.totals?.togetherSeconds ?? null,
    reported: report.length > 0,
    blocked,
    refundAsked: refund.length > 0,
    projectShown: Boolean(project),
    mayContribute: Boolean(project) && cannot === null,
    alreadyContributes: already,
  });
  return shown && project && hostPage ? { project, hostName: hostPage.displayName, href: `/h/${hostPage.handle}/project` } : null;
}

/** A visitor's own contribution to a project, as far as it gets a line beside the project. */
export type OwnContribution = { is: "monthly"; contributionId: string; amountCents: number } | { is: "card_step"; contributionId: string };

/**
 * What a visitor is to a project: whether they could contribute to it right now (`can`, the
 * answer of `whyNotContribute`), and their own contribution if it gets a line (`own`): one that
 * runs every month, or one they began and left at the card step. The host's page and the diary
 * both ask this, so the two never disagree. Without a visitor (not signed in) there is no `own`.
 */
export async function contributionOf(viewerId: string | null, project: Project): Promise<{ can: boolean; own: OwnContribution | null }> {
  const can = (await whyNotContribute(db, { contributorId: viewerId, project })) === null;
  if (!viewerId) return { can, own: null };
  const open = await db
    .select()
    .from(schema.contributions)
    .where(and(eq(schema.contributions.contributorId, viewerId), eq(schema.contributions.projectId, project.id), ne(schema.contributions.status, "ended")))
    .orderBy(desc(schema.contributions.createdAt));
  const monthly = open.find((contribution) => contribution.kind === "monthly" && contribution.status === "running");
  if (monthly) return { can, own: { is: "monthly", contributionId: monthly.id, amountCents: monthly.amountCents } };
  // A card step is only worth going back to while a contribution could still be made.
  const unfinished = can ? open.find((contribution) => contribution.status === "card_step") : undefined;
  return { can, own: unfinished ? { is: "card_step", contributionId: unfinished.id } : null };
}
