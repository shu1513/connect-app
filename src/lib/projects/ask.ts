/**
 * The two places where a customer meets a host's project without looking for it (plans/23,
 * "After a call"; plans/26): the box on the results of a call, and the visitor's own line
 * beside the project. Reading only: nothing here writes anything, and nothing asks Stripe.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Project } from "@/db/schema";
import type { LoadedAttendance } from "@/lib/attendance/load";
import { kindsOffered } from "@/lib/contributions/rules";
import { whyNotContribute } from "@/lib/contributions/start";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { runningProjectOf } from "./projects";
import { mayAsk } from "./rules";

const pays = schema.contributionPayments;
type Reader = Pick<typeof db, "select">;

/**
 * "Already contributes" (plans/23): a monthly contribution of theirs to this project that is
 * being set up or running, or a payment of theirs to it that was ever held or taken. So someone
 * who gave once, who stopped, or who was refunded is not asked again for the same project.
 */
async function alreadyContributes(contributorId: string, projectId: string, reader: Reader): Promise<boolean> {
  const [found] = await reader
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
 * Code inside a database step of its own passes that step as the reader (a tip's start asks
 * whether this box would be shown: plans/44, decision 3).
 */
export async function askAfterCall(input: {
  /** Who is looking at the call's results. */
  role: "host" | "customer" | "admin";
  call: Call;
  /** The call's record, as the page loaded it. */
  attendance: Pick<LoadedAttendance, "final" | "result">;
  /** The host's page as everyone may open it (`publicProfile`), or null when it cannot be opened like that. */
  hostPage: { handle: string; displayName: string } | null;
}, reader: Reader = db): Promise<{ project: Project; hostName: string; href: string } | null> {
  const { call, attendance, hostPage } = input;
  // Only the customer of the call is ever asked: for the host and the founder nothing more is read.
  if (input.role !== "customer") return null;
  const project = hostPage ? await runningProjectOf(call.hostId, reader) : null;
  const [report, blocked, refund, cannot, already] = await Promise.all([
    reader
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(
        or(
          and(eq(schema.reports.reporterId, call.customerId), eq(schema.reports.reportedId, call.hostId)),
          and(eq(schema.reports.reporterId, call.hostId), eq(schema.reports.reportedId, call.customerId)),
        ),
      )
      .limit(1),
    isBlockedEitherWay(call.customerId, call.hostId, reader),
    reader.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id)).limit(1),
    project ? whyNotContribute(reader, { contributorId: call.customerId, project }) : null,
    project ? alreadyContributes(call.customerId, project.id, reader) : false,
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
 * What a visitor is to a project. The host's page and the diary both ask this, so the two never
 * disagree: the "Contribute" line of the one always leads to a form on the other.
 *
 * `offered`: the kinds of contribution this visitor could start right now. Empty when they cannot
 * contribute at all (the answer of `whyNotContribute`). "Every month" is left out while a monthly
 * contribution of theirs to this project is being set up or running, whatever its card step's
 * clock says: a second one would be refused when it is started (start.ts).
 *
 * `own`: their own contribution if it gets a line: one that runs every month, or one they began
 * and left at a card step that can still be finished. Without a visitor (not signed in) there is
 * none.
 */
export async function contributionOf(viewerId: string | null, project: Project, now: Date = new Date()): Promise<{ offered: Array<"once" | "monthly">; own: OwnContribution | null }> {
  const can = (await whyNotContribute(db, { contributorId: viewerId, project })) === null;
  const kinds = can ? kindsOffered(project) : [];
  if (!viewerId) return { offered: kinds, own: null };
  const open = await db
    .select()
    .from(schema.contributions)
    .where(and(eq(schema.contributions.contributorId, viewerId), eq(schema.contributions.projectId, project.id), ne(schema.contributions.status, "ended")))
    .orderBy(desc(schema.contributions.createdAt));
  const monthly = open.find((contribution) => contribution.kind === "monthly" && contribution.status === "running");
  const offered = open.some((contribution) => contribution.kind === "monthly") ? kinds.filter((kind) => kind !== "monthly") : kinds;
  if (monthly) return { offered, own: { is: "monthly", contributionId: monthly.id, amountCents: monthly.amountCents } };
  // A card step is only worth going back to while a contribution could still be made, and while that very step
  // can still be finished: its payment waits for a card, and its 30 minutes are not over. (Only read here: what
  // became of a payment whose time ran out is asked on the contribution's own page.)
  const atCardStep = can ? open.filter((contribution) => contribution.status === "card_step").map((contribution) => contribution.id) : [];
  if (atCardStep.length === 0) return { offered, own: null };
  const payable = await db
    .select({ contributionId: pays.contributionId })
    .from(pays)
    .where(and(inArray(pays.contributionId, atCardStep), eq(pays.status, "to_pay"), isNull(pays.endedHow), isNull(pays.problem), gt(pays.cardStepExpiresAt, now)));
  const unfinished = atCardStep.find((id) => payable.some((payment) => payment.contributionId === id));
  return { offered, own: unfinished ? { is: "card_step", contributionId: unfinished } : null };
}
