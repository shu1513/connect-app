/**
 * Reports, and what the founder does with them: close with a note, warn,
 * pause an account, lift a pause. (Suspending a host and closing an account
 * already exist and are used from the same page.)
 */
import { ACCOUNT_PAUSE, queueCanResumeEmail } from "@/lib/membership/emails";
import { cleanUpEndedMemberships, pauseMembershipsOf } from "@/lib/membership/state";
import { endContributionsOf, letGoAll } from "@/lib/contributions/ending";
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { errorSummary, queueEmail } from "@/lib/email";
import { RULES, SUPPORT_EMAIL } from "@/lib/terms";
import { endRequestsAndCallsOf } from "@/lib/profiles/closing";
import { photosOf } from "@/lib/profiles/photo";
import { publicProfile } from "@/lib/profiles/profiles";
import { liftSuspectedByReport, lockPost, markSuspectedByReport } from "@/lib/projects/picture-steps";
import { picturesOf } from "@/lib/projects/pictures";
import { publicPost } from "@/lib/projects/posts";
import { linksOf } from "@/lib/projects/rules";
import { hasBlocked } from "@/lib/follows/follows";
import { recordAdminAction } from "./audit";
import { block } from "./blocks";
import type { EndReportEffect } from "./end-guard";
import { decideEndReport, type EndReportDecision } from "./end-report";
import { keepMessages, type KeptSummary, keptSummaries, MessageGoneError, reportableMessage } from "./kept-messages";
import { type ReportBlock, type ReportedBack, REPORT_TEXT_MAX } from "./report-words";

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

const TEXT_MAX = REPORT_TEXT_MAX;
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
    const reportedId = call.hostId === reporterId ? call.customerId : call.hostId;
    return {
      reportedId,
      snapshot: {
        // `endedNowBy`: who ended it with "End call now" ("host" or "customer"). Null with `safetyEndedAt` set: the earlier button, whose money the founder decides.
        call: { id: call.id, startsAt: call.startsAt, endsAt: call.endsAt, safetyEndedAt: call.safetyEndedAt, safetyEndedBy: call.safetyEndedBy, endedNowBy: call.endedNowBy },
        booking: booking ? { id: booking.id, note: booking.note } : null,
        // The id of the photo the reported person had (plans/35). The photo itself is not copied: one they remove or replace afterwards is gone.
        photoId: (await photosOf([reportedId])).get(reportedId) ?? null,
      },
    };
  }
  if (context === "booking") {
    const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, contextId));
    if (!booking || (booking.hostId !== reporterId && booking.customerId !== reporterId)) throw new ReportError("Request not found.");
    const reportedId = booking.hostId === reporterId ? booking.customerId : booking.hostId;
    return {
      reportedId,
      snapshot: {
        booking: { id: booking.id, startsAt: booking.startsAt, lengthMinutes: booking.lengthMinutes, note: booking.note, stage: booking.stage },
        // As for a call: the id of the photo the reported person had.
        photoId: (await photosOf([reportedId])).get(reportedId) ?? null,
      },
    };
  }
  if (context === "profile") {
    // Only a page anyone can see can be reported from its address; a hidden or waiting profile gives nothing away.
    const profile = await publicProfile(contextId);
    if (!profile) throw new ReportError("Profile not found.");
    // With the id of the photo that was showing (plans/29). The photo itself is not copied: one the host removes or replaces afterwards is gone.
    return { reportedId: profile.userId, snapshot: { photoId: (await photosOf([profile.userId])).get(profile.userId) ?? null } };
  }
  if (context === "post") {
    // A post of a host's diary. Only one the reporter can really see: removed and hidden posts, and
    // posts on a page that is not open, give nothing away. What it said is kept, since she can change it.
    const found = await publicPost(contextId);
    if (!found) throw new ReportError("Post not found.");
    return {
      reportedId: found.project.hostId,
      // With the ids of the pictures that were showing. The pictures themselves are not copied: one the host removes afterwards is gone.
      snapshot: {
        post: { id: found.post.id, projectId: found.project.id, projectName: found.project.name, text: found.post.text, links: linksOf(found.post.links), writtenAt: found.post.createdAt, pictures: ((await picturesOf([found.post.id])).get(found.post.id) ?? []).map((picture) => picture.id) },
      },
    };
  }
  if (context === "message") {
    // A message of a conversation (plans/49-messaging.md, decision 22): only one of its two people, and only a
    // message of the other one that is still there. Here only who it is about is worked out; what is kept with
    // the report is read inside the report's own step, under the conversation's lock (`keepMessages`), and never
    // goes into this copy: the founder's list reads every open report whole.
    const found = await reportableMessage(db, reporterId, contextId);
    if (!found) throw new ReportError(new MessageGoneError().message);
    return { reportedId: found.writerId, snapshot: { message: { conversationId: found.conversationId, number: found.number } } };
  }
  throw new ReportError("Report not understood.");
}

export type ReportOutcome = {
  reference: number;
  reportedId: string;
  block: ReportBlock;
  callsNotCancelled: number;
  /** For a customer's report after his own "End call now": what it did to that call's charge (plans/51). Null for every other report. */
  endEffect: EndReportEffect | null;
  /** With `endEffect`: a part of that call's money was already taken when the report came, and stays as it is. */
  endPartly: boolean;
  /** It was such a report, but all of that call's money was already taken: nothing changed, and he is told so. */
  endTooLate: boolean;
};

/**
 * Files a report. Reporting a person (from a call, a request or their page) also blocks them for
 * the reporter. Reporting a post of a diary does not: it is about what was written, and a block
 * would end things between the two that the reporter did not ask to end (plans/23, choice G).
 * Urgent reports email every admin at once.
 *
 * A report made from a call by the customer who ended that call with "End call now" also decides,
 * in this same step, whether the call is charged by the minutes instead of the whole booking
 * (end-report.ts). No other report touches money.
 */
export async function createReport(input: { reporterId: string; context: string; contextId: string; reason: string; text: string; now: Date }): Promise<ReportOutcome> {
  const reason = REPORT_REASONS.find((r) => r.key === input.reason);
  if (!reason) throw new ReportError("Choose a reason.");
  const text = input.text.replace(/\s+/g, " ").trim();
  if (text.length > TEXT_MAX) throw new ReportError(`Please keep it under ${TEXT_MAX} characters.`);
  const { reportedId, snapshot } = await reportedPersonFor(input.reporterId, input.context, input.contextId);
  if (reportedId === input.reporterId) throw new ReportError("You cannot report yourself.");
  const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, reportedId));
  const full = { ...snapshot, profile: profile ? { displayName: profile.displayName, handle: profile.handle, about: profile.about } : null };

  let ended: EndReportDecision | "too_late" | null = null;
  const report = await db.transaction(async (tx) => {
    // One reporter at a time, so many reports sent at the same moment cannot slip past the daily limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`reports:${input.reporterId}`}))`);
    const [{ today }] = await tx
      .select({ today: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(and(eq(schema.reports.reporterId, input.reporterId), gt(schema.reports.createdAt, new Date(input.now.getTime() - 24 * 3_600_000))));
    if (today >= REPORTS_PER_DAY) throw new ReportError("You have sent a lot of reports today. If something urgent is happening, write to " + SUPPORT_EMAIL + ".");
    // Such a report and the post's pictures are changed under the post's lock, taken before the report is written (picture-steps.ts).
    const marksPictures = input.context === "post" && reason.key === "under18";
    if (marksPictures) await lockPost(tx, input.contextId);
    const [row] = await tx
      .insert(schema.reports)
      .values({ reporterId: input.reporterId, reportedId, context: input.context, contextId: input.contextId, reason: reason.key, text, urgent: reason.urgent, snapshot: JSON.stringify(full) })
      .returning();
    // "Someone under 18" about a post: its pictures are kept away from the everyday checkers while the report is open.
    if (marksPictures) await markSuspectedByReport(tx, input.contextId, input.now);
    // A report made from a message: the stretch of the conversation that is kept with it, in this same step. If
    // the message has gone in the meantime, the whole step is undone and no report is written.
    if (input.context === "message") {
      await keepMessages(tx, row.id, input.reporterId, input.contextId).catch((error) => {
        throw error instanceof MessageGoneError ? new ReportError(error.message) : error;
      });
    }
    // Last of what this step locks: the call's row, which the money step holds too (see end-report.ts).
    if (input.context === "call") ended = await decideEndReport(tx, { callId: input.contextId, reporterId: input.reporterId, now: input.now });
    if (reason.urgent) {
      for (const admin of await adminsIn(tx)) {
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
  const decided = ended as EndReportDecision | "too_late" | null;
  const money = decided === "too_late" || decided === null ? { endEffect: null, endPartly: false, endTooLate: decided === "too_late" } : { endEffect: decided.effect, endPartly: decided.partly, endTooLate: false };
  if (input.context === "post") return { reference: report.reference, reportedId, block: "none", callsNotCancelled: 0, ...money };
  // The report is saved. The block that follows can stumble by itself, and the reporter is then told what is
  // true, with the report's number, in place of "something went wrong" (which made people report twice).
  // Blocking saves the block first and cleans up afterwards, so after an error the block may well be there.
  try {
    const { callsNotCancelled } = await block({ blockerId: input.reporterId, blockedId: reportedId, now: input.now });
    return { reference: report.reference, reportedId, block: "done", callsNotCancelled, ...money };
  } catch (error) {
    console.error(`[safety] the block after report R-${report.reference} ran into an error (${errorSummary(error)})`);
    const stands = await hasBlocked(input.reporterId, reportedId).catch(() => null);
    // A block that stands after an error was saved before the step got to the calls still to come: whether those
    // were cancelled is not known, and is not called done.
    return { reference: report.reference, reportedId, block: stands === null ? "unknown" : stands ? "done_unsure" : "not_done", callsNotCancelled: 0, ...money };
  }
}

/** Everything the founder needs to judge a report. */
export async function openReports() {
  const rows = await db
    .select({ report: schema.reports, reporterName: schema.user.name })
    .from(schema.reports)
    .innerJoin(schema.user, eq(schema.user.id, schema.reports.reporterId))
    .where(eq(schema.reports.status, "open"))
    .orderBy(desc(schema.reports.urgent), desc(schema.reports.createdAt));
  // That messages are kept with a report, and how many: never their words (kept-messages.ts).
  const kept = await keptSummaries(rows.filter(({ report }) => report.context === "message").map(({ report }) => report.id));
  const out: Array<{ report: (typeof rows)[number]["report"]; reporterName: string; reported: { name: string; email: string; pausedAt: Date | null; closedAt: Date | null } | null; profile: typeof schema.hostProfiles.$inferSelect | null; earlierReports: number; callsTogether: number; reportedBack: ReportedBack; actions: (typeof schema.adminActions.$inferSelect)[]; kept: KeptSummary | null }> = [];
  for (const { report, reporterName } of rows) {
    const [reported] = await db.select({ name: schema.user.name, email: schema.user.email, pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, report.reportedId));
    const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, report.reportedId));
    const [{ earlier }] = await db.select({ earlier: sql<number>`count(*)::int` }).from(schema.reports).where(and(eq(schema.reports.reportedId, report.reportedId), sql`${schema.reports.id} <> ${report.id}`));
    const [{ together }] = await db
      .select({ together: sql<number>`count(*)::int` })
      .from(schema.calls)
      .where(or(and(eq(schema.calls.hostId, report.reporterId), eq(schema.calls.customerId, report.reportedId)), and(eq(schema.calls.hostId, report.reportedId), eq(schema.calls.customerId, report.reporterId))));
    // Reports the other way round, open or closed: the person this report is about has also reported its reporter
    // (plans/51, decision 26). Read for the founder only; nothing follows from it by itself.
    const back = await db
      .select({ context: schema.reports.context, contextId: schema.reports.contextId })
      .from(schema.reports)
      .where(and(eq(schema.reports.reporterId, report.reportedId), eq(schema.reports.reportedId, report.reporterId)));
    // "The same": made from the same call, or the same request. (An id is kept as it was sent, so its spelling is not compared.)
    const place = report.context === "call" ? "call" : report.context === "booking" ? "request" : null;
    const sameAsThis = place !== null && back.some((other) => other.context === report.context && other.contextId.toLowerCase() === report.contextId.toLowerCase());
    const reportedBack: ReportedBack = { count: back.length, same: sameAsThis ? place : null };
    const actions = await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetUserId, report.reportedId)).orderBy(desc(schema.adminActions.createdAt)).limit(10);
    out.push({ report, reporterName, reported: reported ?? null, profile: profile ?? null, earlierReports: earlier, callsTogether: together, reportedBack, actions, kept: kept.get(report.id) ?? null });
  }
  return out;
}

export async function closeReport(input: { reportId: string; adminId: string; note: string }): Promise<void> {
  await db.transaction(async (tx) => {
    // A report for "someone under 18" about a post: the post's lock first, so that two such reports closed at the
    // same moment, or one closed while another is made, cannot both go by what was true before.
    const [found] = await tx.select({ context: schema.reports.context, contextId: schema.reports.contextId, reason: schema.reports.reason }).from(schema.reports).where(eq(schema.reports.id, input.reportId));
    const marksPictures = found?.context === "post" && found.reason === "under18";
    if (found && marksPictures) await lockPost(tx, found.contextId);
    // The account the report is about is held while its report is closed, the way a pause by the app holds it
    // (plans/52, decision 8a): such a pause counts the open reports with that row held, so a report is closed
    // either before that count or after the pause, never in between.
    const [about] = await tx.select({ reportedId: schema.reports.reportedId }).from(schema.reports).where(eq(schema.reports.id, input.reportId));
    if (about) await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, about.reportedId)).for("no key update");
    const [report] = await tx
      .update(schema.reports)
      .set({ status: "closed", adminNote: input.note, closedBy: input.adminId, closedAt: new Date() })
      .where(and(eq(schema.reports.id, input.reportId), eq(schema.reports.status, "open")))
      .returning();
    if (!report) throw new ReportError("That report is already closed.");
    if (marksPictures) await liftSuspectedByReport(tx, report.contextId, new Date());
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
  const paused = await pause({ person, reason, because: `because of this rule:\n\n${reason}`, emailKey: `paused:${input.userId}:${input.requestId}`, adminId: input.adminId });
  if (typeof paused === "string") throw new ReportError("This account is already paused.");
  return paused;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The pause itself, the same whoever decides it: the founder (pauseAccount) or the app, when an identity check
 * gives an age under 18 (pauseUnderage). "already_paused" when the account was paused already: it is not paused
 * a second time. "not_first" when `first` said no: then nothing at all is done.
 */
async function pause(input: {
  /** Done first, in the same database step as the pause. If it answers false, nothing is paused or written. */
  first?: (tx: Tx) => Promise<boolean>;
  person: { id: string; name: string; email: string };
  /** What the paused page and the founder's list show. */
  reason: string;
  /** How the email goes on after "Your account has been paused". */
  because: string;
  emailKey: string;
  /** False when the person is not to be written to: a closed account, which was told when it was closed and cannot "still log in". */
  tellPerson?: boolean;
  /** The admin who decided it, for the admins' record. Null when the app paused the account by itself. */
  adminId: string | null;
  /** When the app paused the account by itself: what the founder is told, in the same step. `alreadyText` when the account was paused already. */
  tellFounder?: { subject: string; /** A function is asked only once the account is paused, in that same step (so it can say what `first` found). */ text: string | (() => string); alreadyText: string; key: string };
}): Promise<{ callsNotEnded: number } | "already_paused" | "not_first"> {
  const { person, reason } = input;
  let endedMemberships: string[] = [];
  let givenUpPayments: string[] = [];
  // The moment of this pause. What is ended after it is only what was there by this moment.
  const pausedAt = new Date();
  const done = await db.transaction(async (tx) => {
    if (input.first && !(await input.first(tx))) return "not_first" as const;
    const [row] = await tx
      .update(schema.user)
      .set({ pausedAt, pausedReason: reason, updatedAt: new Date() })
      .where(and(eq(schema.user.id, person.id), isNull(schema.user.pausedAt)))
      .returning({ id: schema.user.id });
    // Paused already: what `first` wrote stays written, the founder is told, and nothing else is done.
    if (!row) {
      if (input.tellFounder) {
        for (const admin of await adminsIn(tx)) await queueEmail(tx, { to: admin.email, subject: input.tellFounder.subject, text: input.tellFounder.alreadyText, key: `${input.tellFounder.key}:${admin.id}` });
      }
      return "already_paused" as const;
    }
    // Their memberships, as a host and as a member, are paused in this same step (plans/53): not ended, so that
    // lifting the pause lets each member resume. (An invitation nobody accepted yet ends, as it always did.)
    endedMemberships = await pauseMembershipsOf(tx, person.id, new Date());
    // So do their contributions, as a host and as a contributor; what was only held is let go below.
    givenUpPayments = await endContributionsOf(tx, person.id, "paused", new Date());
    if (input.tellPerson !== false) await queueEmail(tx, {
      to: person.email,
      subject: "Your Connect account is paused",
      text: `Hi ${person.name},\n\nYour account has been paused ${input.because}\n\nYou can still log in and see your past calls and receipts, but you cannot book, host or join calls until the pause is lifted. We are ending your requests that were waiting and cancelling your calls that have not started, at no charge to anyone. If you think this is a mistake, write to ${SUPPORT_EMAIL}.`,
      key: input.emailKey,
    });
    if (input.adminId) await recordAdminAction({ adminId: input.adminId, action: "account paused", targetUserId: person.id, detail: reason }, tx);
    if (input.tellFounder) {
      const text = typeof input.tellFounder.text === "function" ? input.tellFounder.text() : input.tellFounder.text;
      for (const admin of await adminsIn(tx)) await queueEmail(tx, { to: admin.email, subject: input.tellFounder.subject, text, key: `${input.tellFounder.key}:${admin.id}` });
    }
    return "paused" as const;
  });
  if (done !== "paused") return done;
  // The account is paused from here on, whatever happens next. First what keeps people safe (requests and
  // calls), then the money of the memberships that were paused with it. If the server stops before this is done,
  // the helper does it: the requests and calls with finishPausesAndClosures, the money with its usual rounds.
  //
  // Looked at once more first: if a person has lifted the pause in this very moment (and the account is not
  // closed), nothing of theirs is ended any more. What they ask for from then on is theirs to keep (plans/53,
  // decision 10). The memberships' month is settled all the same: they were paused, and stay so until resumed.
  const [still] = await db.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, person.id));
  // And only what was there when the account was paused is ended: a request or a call made after a lift is left
  // alone also if the lift falls between this look and the ending itself.
  const now = new Date();
  const callsNotEnded = still?.pausedAt || still?.closedAt ? await endRequestsAndCallsOf(person.id, now, now, pausedAt) : 0;
  await cleanUpEndedMemberships(endedMemberships, new Date());
  await letGoAll(givenUpPayments, new Date());
  return { callsNotEnded };
}

/** The admins and their addresses, read inside a database step. */
function adminsIn(reader: Pick<typeof db, "select">) {
  return reader.select({ email: schema.user.email, id: schema.user.id }).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
}

/**
 * An identity check came back "a real person, under 18" (the legal review of 20 November 2026). The app pauses
 * the account by itself, at once, exactly as the founder's pause does: the two ticked boxes at sign-up no longer
 * count against what an ID says. The person is told why and where to write; the founder is told by email, sees
 * the account under "Paused accounts" with this reason, and lifts the pause there if the check was wrong.
 *
 * It is not written in the admins' record, which needs an admin: no admin did this. The check's own line
 * (verified, not an adult, and when) is the record. An admin's own account is never paused, as with the
 * founder's pause. A closed account is paused too, so that opening it again does not give it back the use of
 * the app.
 *
 * The check's result is written by `save`, in the same database step as the pause: both are there, or neither.
 * `save` answers false when the result was written before, and then nothing is done: one check pauses at most
 * once, so a pause the founder lifted is never made again by the same check.
 */
export async function pauseUnderage(input: {
  userId: string;
  checkId: string;
  /** Writes the check's result. Called exactly once: in the pause's own database step, or alone when nobody is paused. False when the result was written already. */
  save: (writer: Pick<typeof db, "update">) => Promise<boolean>;
}): Promise<void> {
  const [person] = await db.select().from(schema.user).where(eq(schema.user.id, input.userId));
  const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, input.userId));
  if (!person || admin) {
    await input.save(db);
    if (admin) console.error(`[identity] the check of an admin account (${input.userId}) gave an age under 18. Admin accounts are not paused by the app; please look at it.`);
    return;
  }
  const rule = RULES.find((r) => r.key === "under18")!;
  const key = `paused:${input.userId}:underage:${input.checkId}`;
  const paused = await pause({
    first: input.save,
    person,
    reason: `${rule.title}. An identity check gave an age under 18.`,
    because: "because the identity check you took gave an age under 18, and Connect is for adults only.",
    emailKey: key,
    tellPerson: !person.closedAt,
    adminId: null,
    tellFounder: {
      subject: "An identity check gave an age under 18",
      text: `The identity check of ${person.name} (${person.email}) gave an age under 18. The app has paused the account by itself, and is now ending their waiting requests and cancelling their calls that have not started, at no charge. If a call could not be ended, a second email says so.\n\nPlease look at the account, and at any calls this person has already had. If the check was wrong, you can lift the pause on the same page:\n\n${appUrl()}/admin/reports`,
      alreadyText: `The identity check of ${person.name} (${person.email}) gave an age under 18. The account was paused already, for another reason, so nothing was changed. Please look at it before lifting that pause:\n\n${appUrl()}/admin/reports`,
      key: `${key}:founder`,
    },
  });
  // "not_first": another look at Stripe wrote this result, and did what follows from it. "already_paused": the
  // account was paused for another reason; that pause stays as it is, and the founder was told in the same step.
  if (typeof paused === "string") return;
  if (paused.callsNotEnded === 0) return;
  // The founder's own pause shows this number on the page. Here nobody is looking, so it is sent.
  console.error(`[identity] account ${input.userId} was paused for an age under 18, but ${paused.callsNotEnded === -1 ? "its requests and calls" : `${paused.callsNotEnded} of its calls`} could not be ended.`);
  for (const one of await adminsIn(db)) {
    await queueEmail(db, {
      to: one.email,
      subject: "A paused account still has calls",
      text: `The account of ${person.name} (${person.email}) was paused because an identity check gave an age under 18, but ${paused.callsNotEnded === -1 ? "its requests and calls" : `${paused.callsNotEnded} of its calls`} could not be ended. Please look at them now:\n\n${appUrl()}/admin`,
      key: `${key}:calls:${one.id}`,
    });
  }
}

/**
 * The app pauses an account by itself because its reports or its ratings reached a line (plans/52). Exactly the
 * founder's pause, made by nobody: the person is told why in general words and where to write, and the founder
 * is told that it happened. Whether a line is reached is worked out by the caller (auto-pause.ts); this only
 * pauses.
 *
 * Never an admin's account, and not a closed one (if it is opened again, the next round looks at it). "paused"
 * only when this call paused it: an account that is paused already is left exactly as it is.
 * `key` must be the same for the same cause within one fresh start, so that nothing is sent twice.
 *
 * `expectedFrom` is the fresh start (`auto_pause_from`) the caller counted with. It is read again in the pause's
 * own database step, with the account's row held: if a person lifted a pause in between, what was counted is
 * out of date and nothing is done (the next round counts afresh). Lifting a pause writes the same row, so the
 * two can only happen one after the other.
 */
export async function pauseByItself(input: {
  userId: string;
  expectedFrom: Date | null;
  /** What the caller counted, counted again inside the pause's own step (with that step as the reader). False: nothing is done. */
  stillTrue?: (tx: Tx) => Promise<boolean>;
  reason: string;
  because: string;
  founder: { subject: string; text: string | (() => string); alreadyText: string };
  key: string;
}): Promise<"paused" | "not_paused"> {
  const [person] = await db.select().from(schema.user).where(eq(schema.user.id, input.userId));
  const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, input.userId));
  if (!person || admin || person.closedAt || person.pausedAt) return "not_paused";
  const paused = await pause({
    first: async (tx) => {
      // Held as the pause's own change of this row holds it, and no harder: a call or a request that names this
      // person can still be written meanwhile (a member's booking holds the membership first and then writes a
      // call; holding the row harder here, with the membership taken after it, could leave the two waiting on each other).
      const [row] = await tx.select({ from: schema.user.autoPauseFrom, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, input.userId)).for("no key update");
      const [isAdmin] = await tx.select({ id: schema.admins.userId }).from(schema.admins).where(eq(schema.admins.userId, input.userId));
      if (!row || isAdmin || row.closedAt !== null || (row.from?.getTime() ?? null) !== (input.expectedFrom?.getTime() ?? null)) return false;
      return input.stillTrue ? input.stillTrue(tx) : true;
    },
    person,
    reason: input.reason,
    because: input.because,
    emailKey: input.key,
    adminId: null,
    tellFounder: { subject: input.founder.subject, text: input.founder.text, alreadyText: input.founder.alreadyText, key: `${input.key}:founder` },
  });
  if (typeof paused === "string") return "not_paused";
  if (paused.callsNotEnded !== 0) {
    // The founder's own pause shows this number on the page. Here nobody is looking, so it is sent.
    console.error(`[auto-pause] account ${input.userId} was paused automatically, but ${paused.callsNotEnded === -1 ? "its requests and calls" : `${paused.callsNotEnded} of its calls`} could not be ended.`);
    for (const one of await adminsIn(db)) {
      await queueEmail(db, {
        to: one.email,
        subject: "A paused account still has calls",
        text: `The account of ${person.name} (${person.email}) was paused automatically, but ${paused.callsNotEnded === -1 ? "its requests and calls" : `${paused.callsNotEnded} of its calls`} could not be ended. Please look at them now:\n\n${appUrl()}/admin`,
        key: `${input.key}:calls:${one.id}`,
      });
    }
  }
  return "paused";
}

/** Where the founder lifts a pause: said in the emails about a pause the app made by itself. */
export function pausedListUrl(): string {
  return `${appUrl()}/admin/reports`;
}

/**
 * Lifts a pause. `since`: the moment of the pause the admin was looking at; given, only that very pause is
 * lifted (a page left open cannot lift a later pause of the same account). False when nothing was lifted.
 */
export async function liftPause(input: { adminId: string; userId: string; since?: Date }): Promise<boolean> {
  return db.transaction(async (tx) => {
    // A person has looked at the account: what was reported and rated before this moment no longer counts toward
    // a pause the app makes by itself (plans/52, decision 8), and a new warning comes before a pause for ratings.
    // Without this, the next round would pause it again. Only an account that IS paused: a second press of the
    // button must not move the fresh start forward and so throw away what was reported since the real lift.
    const lifted = await tx
      .update(schema.user)
      .set({ pausedAt: null, pausedReason: null, autoPauseFrom: new Date(), ratingWarnedAt: null, customerRatingWarnedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.user.id, input.userId), isNotNull(schema.user.pausedAt), input.since ? eq(schema.user.pausedAt, input.since) : undefined))
      .returning({ id: schema.user.id });
    if (lifted.length === 0) return false;
    await recordAdminAction({ adminId: input.adminId, action: "pause lifted", targetUserId: input.userId }, tx);
    // Memberships that were paused with this account can be resumed again (plans/53): each member is told, where
    // the other of the two accounts is in use as well. Resuming stays the member's own step.
    const at = new Date();
    const waiting = await tx
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.status, "paused"), eq(schema.memberships.pausedReason, ACCOUNT_PAUSE), or(eq(schema.memberships.hostId, input.userId), eq(schema.memberships.customerId, input.userId))));
    for (const membership of waiting) {
      const otherId = membership.hostId === input.userId ? membership.customerId : membership.hostId;
      const [other] = await tx.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, otherId));
      if (other && !other.pausedAt && !other.closedAt) await queueCanResumeEmail(tx, membership, at);
    }
    return true;
  });
}
