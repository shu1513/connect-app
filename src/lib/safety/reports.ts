/**
 * Reports, and what the founder does with them: close with a note, warn,
 * pause an account, lift a pause. (Suspending a host and closing an account
 * already exist and are used from the same page.)
 */
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { RULES, SUPPORT_EMAIL } from "@/lib/terms";
import { endRequestsAndCallsOf } from "@/lib/profiles/closing";
import { publicProfile } from "@/lib/profiles/profiles";
import { recordAdminAction } from "./audit";
import { block } from "./blocks";

export class ReportError extends Error {}

export const REPORT_REASONS = [
  { key: "impersonation", label: "Pretending to be someone else", urgent: false },
  { key: "sexual", label: "Nudity or sexual content", urgent: false },
  { key: "under18", label: "Someone under 18", urgent: true },
  { key: "threats", label: "Harassment or threats", urgent: true },
  { key: "offsite", label: "Asked to pay outside Connect", urgent: false },
  { key: "other", label: "Something else", urgent: false },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["key"];

const TEXT_MAX = 2000;
const REPORTS_PER_DAY = 10;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Who a report from this place is about, checked on the server. The browser only says where the report was made. */
async function reportedPersonFor(reporterId: string, context: string, contextId: string): Promise<{ reportedId: string; snapshot: Record<string, unknown> }> {
  if (context === "call") {
    const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, contextId));
    if (!call || (call.hostId !== reporterId && call.customerId !== reporterId)) throw new ReportError("Call not found.");
    const [booking] = await db.select({ note: schema.bookings.note, id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.callId, call.id));
    return {
      reportedId: call.hostId === reporterId ? call.customerId : call.hostId,
      snapshot: {
        call: { id: call.id, startsAt: call.startsAt, endsAt: call.endsAt, safetyEndedAt: call.safetyEndedAt, safetyEndedBy: call.safetyEndedBy },
        booking: booking ? { id: booking.id, note: booking.note } : null,
      },
    };
  }
  if (context === "booking") {
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, contextId));
    if (!booking || (booking.hostId !== reporterId && booking.customerId !== reporterId)) throw new ReportError("Request not found.");
    return {
      reportedId: booking.hostId === reporterId ? booking.customerId : booking.hostId,
      snapshot: { booking: { id: booking.id, startsAt: booking.startsAt, lengthMinutes: booking.lengthMinutes, note: booking.note, stage: booking.stage } },
    };
  }
  if (context === "profile") {
    // Only a page anyone can see can be reported from its address; a hidden or waiting profile gives nothing away.
    const profile = await publicProfile(contextId);
    if (!profile) throw new ReportError("Profile not found.");
    return { reportedId: profile.userId, snapshot: {} };
  }
  throw new ReportError("Report not understood.");
}

/** Files a report. Reporting someone also blocks them for the reporter. Urgent reports email every admin at once. */
export async function createReport(input: { reporterId: string; context: string; contextId: string; reason: string; text: string; now: Date }): Promise<{ reference: number }> {
  const reason = REPORT_REASONS.find((r) => r.key === input.reason);
  if (!reason) throw new ReportError("Choose a reason.");
  const text = input.text.replace(/\s+/g, " ").trim();
  if (text.length > TEXT_MAX) throw new ReportError(`Please keep it under ${TEXT_MAX} characters.`);
  const { reportedId, snapshot } = await reportedPersonFor(input.reporterId, input.context, input.contextId);
  if (reportedId === input.reporterId) throw new ReportError("You cannot report yourself.");
  const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, reportedId));
  const full = { ...snapshot, profile: profile ? { displayName: profile.displayName, handle: profile.handle, about: profile.about } : null };

  const report = await db.transaction(async (tx) => {
    // One reporter at a time, so many reports sent at the same moment cannot slip past the daily limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`reports:${input.reporterId}`}))`);
    const [{ today }] = await tx
      .select({ today: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(and(eq(schema.reports.reporterId, input.reporterId), gt(schema.reports.createdAt, new Date(input.now.getTime() - 24 * 3_600_000))));
    if (today >= REPORTS_PER_DAY) throw new ReportError("You have sent a lot of reports today. If something urgent is happening, write to " + SUPPORT_EMAIL + ".");
    const [row] = await tx
      .insert(schema.reports)
      .values({ reporterId: input.reporterId, reportedId, context: input.context, contextId: input.contextId, reason: reason.key, text, urgent: reason.urgent, snapshot: JSON.stringify(full) })
      .returning();
    if (reason.urgent) {
      const admins = await tx.select({ email: schema.user.email, id: schema.user.id }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
      for (const admin of admins) {
        await queueEmail(tx, {
          to: admin.email,
          subject: `Urgent report R-${row.reference}`,
          text: `An urgent report (${reason.label.toLowerCase()}) was just made. Please look at it now:\n\n${appUrl()}/admin/reports`,
          key: `report:${row.id}:${admin.id}`,
        });
      }
    }
    return row;
  });
  await block({ blockerId: input.reporterId, blockedId: reportedId, now: input.now });
  return { reference: report.reference };
}

/** Everything the founder needs to judge a report. */
export async function openReports() {
  const rows = await db
    .select({ report: schema.reports, reporterName: schema.user.name })
    .from(schema.reports)
    .innerJoin(schema.user, eq(schema.user.id, schema.reports.reporterId))
    .where(eq(schema.reports.status, "open"))
    .orderBy(desc(schema.reports.urgent), desc(schema.reports.createdAt));
  const out = [];
  for (const { report, reporterName } of rows) {
    const [reported] = await db.select({ name: schema.user.name, email: schema.user.email, pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, report.reportedId));
    const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, report.reportedId));
    const [{ earlier }] = await db.select({ earlier: sql<number>`count(*)::int` }).from(schema.reports).where(and(eq(schema.reports.reportedId, report.reportedId), sql`${schema.reports.id} <> ${report.id}`));
    const [{ together }] = await db
      .select({ together: sql<number>`count(*)::int` })
      .from(schema.calls)
      .where(or(and(eq(schema.calls.hostId, report.reporterId), eq(schema.calls.customerId, report.reportedId)), and(eq(schema.calls.hostId, report.reportedId), eq(schema.calls.customerId, report.reporterId))));
    const actions = await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetUserId, report.reportedId)).orderBy(desc(schema.adminActions.createdAt)).limit(10);
    out.push({ report, reporterName, reported: reported ?? null, profile: profile ?? null, earlierReports: earlier, callsTogether: together, actions });
  }
  return out;
}

export async function closeReport(input: { reportId: string; adminId: string; note: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [report] = await tx
      .update(schema.reports)
      .set({ status: "closed", adminNote: input.note, closedBy: input.adminId, closedAt: new Date() })
      .where(and(eq(schema.reports.id, input.reportId), eq(schema.reports.status, "open")))
      .returning();
    if (!report) throw new ReportError("That report is already closed.");
    const [reporter] = await tx.select().from(schema.user).where(eq(schema.user.id, report.reporterId));
    if (reporter) {
      await queueEmail(tx, {
        to: reporter.email,
        subject: `Your report R-${report.reference} has been looked at`,
        text: `Hi ${reporter.name},\n\nThank you for your report R-${report.reference}. We have looked at it and taken the action we thought right. For privacy we cannot say what that was.\n\nIf anything else happens, please report it again.`,
        key: `report-closed:${report.id}`,
      });
    }
    await recordAdminAction({ adminId: input.adminId, action: "report closed", targetUserId: report.reportedId, targetId: report.id, detail: input.note }, tx);
  });
}

/** A reminder of the rules, by email. */
export async function warn(input: { adminId: string; userId: string; ruleKey: string; note: string; requestId: string }): Promise<void> {
  const rule = RULES.find((r) => r.key === input.ruleKey);
  if (!rule) throw new ReportError("Choose a rule.");
  const [person] = await db.select().from(schema.user).where(eq(schema.user.id, input.userId));
  if (!person) throw new ReportError("Person not found.");
  await db.transaction(async (tx) => {
    await queueEmail(tx, {
      to: person.email,
      subject: "A reminder of the Connect rules",
      text: `Hi ${person.name},\n\nThis is a reminder of one of the rules of Connect:\n\n${rule.title}. ${rule.text}\n\n${input.note ? `${input.note}\n\n` : ""}Please keep to the rules. Breaking them again can mean a paused or closed account. The full rules are at ${appUrl()}/rules. If you think this is a mistake, write to ${SUPPORT_EMAIL}.`,
      key: `warning:${input.userId}:${input.requestId}`,
    });
    await recordAdminAction({ adminId: input.adminId, action: "warning sent", targetUserId: input.userId, targetId: input.requestId, detail: `${rule.title}. ${input.note}` }, tx);
  });
}

/**
 * Pauses an account: it may log in and look, but not book, host or join calls. The person is told which rule and where to appeal.
 * Like closing an account, it ends the person's waiting requests, cancels their calls that have not started at no charge
 * (so nobody waits for, or pays for, a call the paused person may not join), and puts them out of a call in progress.
 *
 * Returns how many of their calls could not be ended (-1 when their requests or calls could not be dealt with at all),
 * so the founder can be told to check them.
 */
export async function pauseAccount(input: { adminId: string; userId: string; ruleKey: string; note: string; requestId: string }): Promise<{ callsNotEnded: number }> {
  const rule = RULES.find((r) => r.key === input.ruleKey);
  if (!rule) throw new ReportError("Choose a rule.");
  const [person] = await db.select().from(schema.user).where(eq(schema.user.id, input.userId));
  if (!person) throw new ReportError("Person not found.");
  const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, input.userId));
  if (admin) throw new ReportError("An admin account cannot be paused here.");
  const reason = `${rule.title}.${input.note ? ` ${input.note}` : ""}`;
  if (person.pausedAt) throw new ReportError("This account is already paused.");
  await db.transaction(async (tx) => {
    await tx.update(schema.user).set({ pausedAt: new Date(), pausedReason: reason, updatedAt: new Date() }).where(and(eq(schema.user.id, input.userId), isNull(schema.user.pausedAt)));
    await queueEmail(tx, {
      to: person.email,
      subject: "Your Connect account is paused",
      text: `Hi ${person.name},\n\nYour account has been paused because of this rule:\n\n${reason}\n\nYou can still log in and see your past calls and receipts, but you cannot book, host or join calls until the pause is lifted. We are ending your requests that were waiting and cancelling your calls that have not started, at no charge to anyone. If you think this is a mistake, write to ${SUPPORT_EMAIL}.`,
      key: `paused:${input.userId}:${input.requestId}`,
    });
    await recordAdminAction({ adminId: input.adminId, action: "account paused", targetUserId: input.userId, detail: reason }, tx);
  });
  // The account is paused from here on, whatever happens next.
  return { callsNotEnded: await endRequestsAndCallsOf(input.userId, new Date()) };
}

export async function liftPause(input: { adminId: string; userId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(schema.user).set({ pausedAt: null, pausedReason: null, updatedAt: new Date() }).where(eq(schema.user.id, input.userId));
    await recordAdminAction({ adminId: input.adminId, action: "pause lifted", targetUserId: input.userId }, tx);
  });
}
