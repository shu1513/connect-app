import { desc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { openReports, REPORT_REASONS } from "@/lib/safety/reports";
import { switches } from "@/lib/safety/switches";
import { RULES } from "@/lib/terms";
import { requireAdmin } from "@/lib/session";
import { decideProfileAction, closeAccountAction } from "../people/actions";
import { closeReportAction, liftPauseAction, pauseAction, switchesAction, warnAction } from "./actions";

const CONTEXT_LABEL: Record<string, string> = { call: "a call", booking: "a request", profile: "a host's page" };

export default async function AdminReportsPage(props: PageProps<"/admin/reports">) {
  await requireAdmin();
  const notice = readNotice("/admin/reports", await props.searchParams);
  const [reports, current, paused, recent] = await Promise.all([
    openReports(),
    switches(),
    db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, reason: schema.user.pausedReason, since: schema.user.pausedAt }).from(schema.user).where(isNotNull(schema.user.pausedAt)),
    db
      .select({ action: schema.adminActions, adminName: schema.user.name })
      .from(schema.adminActions)
      .innerJoin(schema.user, eq(schema.user.id, schema.adminActions.adminId))
      .orderBy(desc(schema.adminActions.createdAt))
      .limit(50),
  ]);
  const field = "mt-1 rounded border border-neutral-400 bg-transparent px-2 py-1";
  const button = "rounded border border-neutral-500 px-3 py-1.5";
  const ruleOptions = RULES.map((rule) => (
    <option key={rule.key} value={rule.key}>
      {rule.title}
    </option>
  ));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-2">
          ← Admin: payments
        </Link>
        <Link href="/admin/people" className="ml-4 underline underline-offset-2">
          Hosts and accounts
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Admin: reports and safety</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <h2 className="mt-8 text-lg font-semibold">Open reports ({reports.length})</h2>
      {reports.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Nothing is open.</p>
      ) : (
        <ul className="mt-3 space-y-6">
          {reports.map(({ report, reporterName, reported, profile, earlierReports, callsTogether, actions }) => {
            const snapshot = JSON.parse(report.snapshot) as { booking?: { note?: string }; call?: { safetyEndedAt?: string | null } };
            return (
              <li key={report.id} className={`rounded border p-4 text-sm ${report.urgent ? "border-red-600" : "border-neutral-400"}`}>
                <p className="font-medium">
                  {report.urgent && <span className="mr-2 rounded bg-red-600 px-2 py-0.5 text-xs text-white">URGENT</span>}
                  R-{report.reference}: {REPORT_REASONS.find((r) => r.key === report.reason)?.label ?? report.reason}, made from {CONTEXT_LABEL[report.context] ?? report.context},{" "}
                  <LocalTime iso={report.createdAt.toISOString()} />
                </p>
                <p className="mt-1">
                  <strong>About:</strong> {reported?.name ?? "unknown"} ({reported?.email}){profile ? `, host @${profile.handle} ("${profile.displayName}")` : ""}
                  {reported?.pausedAt ? " — paused" : ""}
                  {reported?.closedAt ? " — account closed" : ""}
                </p>
                <p className="mt-1">
                  <strong>From:</strong> {reporterName}. They have had {callsTogether} {callsTogether === 1 ? "call" : "calls"} together. {earlierReports} earlier{" "}
                  {earlierReports === 1 ? "report" : "reports"} about this person.
                </p>
                {report.text && <p className="mt-2 whitespace-pre-line rounded bg-neutral-800/40 p-2">&ldquo;{report.text}&rdquo;</p>}
                {snapshot.booking?.note && <p className="mt-1 opacity-70">The request&apos;s note said: &ldquo;{snapshot.booking.note}&rdquo;</p>}
                {snapshot.call?.safetyEndedAt && <p className="mt-1 opacity-70">The call was ended with &quot;End call and report&quot;; its charge is on your review list.</p>}
                {actions.length > 0 && (
                  <p className="mt-1 opacity-70">
                    Earlier actions on this person: {actions.map((a) => `${a.action} (${a.createdAt.toISOString().slice(0, 10)})`).join("; ")}
                  </p>
                )}

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <form action={warnAction} className="rounded border border-neutral-500 p-3">
                    <input type="hidden" name="userId" value={report.reportedId} />
                    <p className="font-medium">Send a warning</p>
                    <select name="rule" required className={`${field} block w-full`}>
                      {ruleOptions}
                    </select>
                    <input name="note" placeholder="A sentence for them (optional)" className={`${field} block w-full`} />
                    <button type="submit" className={`${button} mt-2`}>
                      Send warning
                    </button>
                  </form>
                  <form action={pauseAction} className="rounded border border-neutral-500 p-3">
                    <input type="hidden" name="userId" value={report.reportedId} />
                    <p className="font-medium">Pause the account</p>
                    <select name="rule" required className={`${field} block w-full`}>
                      {ruleOptions}
                    </select>
                    <input name="note" placeholder="A sentence for them (optional)" className={`${field} block w-full`} />
                    <button type="submit" className={`${button} mt-2`}>
                      Pause
                    </button>
                  </form>
                  {profile && profile.status === "approved" && (
                    <form action={decideProfileAction}>
                      <input type="hidden" name="userId" value={report.reportedId} />
                      <input type="hidden" name="decision" value="suspended" />
                      <button type="submit" className={button}>
                        Suspend their host profile
                      </button>
                    </form>
                  )}
                  {reported && !reported.closedAt && (
                    <form action={closeAccountAction}>
                      <input type="hidden" name="email" value={reported.email} />
                      <button type="submit" className={`${button} border-red-600 text-red-600`}>
                        Close their account
                      </button>
                    </form>
                  )}
                </div>
                <form action={closeReportAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="reportId" value={report.id} />
                  <label className="flex-1">
                    Your note (kept with the report)
                    <input name="note" required className={`${field} block w-full`} />
                  </label>
                  <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white">
                    Close this report
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mt-10 text-lg font-semibold">Paused accounts ({paused.length})</h2>
      {paused.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {paused.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3">
              <span>
                {p.name}, {p.email}: {p.reason} (since <LocalTime iso={p.since!.toISOString()} />)
              </span>
              <form action={liftPauseAction}>
                <input type="hidden" name="userId" value={p.id} />
                <button type="submit" className="underline underline-offset-2">
                  Lift the pause
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-lg font-semibold">Stop switches</h2>
      <form action={switchesAction} className="mt-2 space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="requestsOff" defaultChecked={current.requestsOff} /> No new requests for calls
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="joiningOff" defaultChecked={current.joiningOff} /> Nobody can join a call
        </label>
        <button type="submit" className={button}>
          Save switches
        </button>
      </form>

      <h2 className="mt-10 text-lg font-semibold">Recent admin actions</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {recent.map(({ action, adminName }) => (
          <li key={action.id}>
            <LocalTime iso={action.createdAt.toISOString()} />: {adminName}: {action.action}
            {action.detail ? ` (${action.detail})` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
