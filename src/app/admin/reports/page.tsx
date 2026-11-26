import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { photoStates } from "@/lib/profiles/photo";
import { unansweredRequests } from "@/lib/refunds/requests";
import { openReports, REPORT_REASONS } from "@/lib/safety/reports";
import { switches } from "@/lib/safety/switches";
import { RULES } from "@/lib/terms";
import { requireAdmin } from "@/lib/session";
import { decideProfileAction, closeAccountAction } from "../people/actions";
import { appSwitchesAction, closeReportAction, liftPauseAction, membershipsSwitchAction, pauseAction, switchesAction, warnAction } from "./actions";
import { SitePage } from "@/components/site-page";
import { KeptMessages } from "./kept-messages";

export const metadata: Metadata = { title: "Reports and safety" };

const CONTEXT_LABEL: Record<string, string> = { call: "a call", booking: "a request", profile: "a host's page", post: "a post of a host's diary", message: "a message" };

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
  // The hosts the founder has named for memberships, shown by their handle.
  const namedHosts = current.membershipsHosts.length
    ? await db.select({ handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, current.membershipsHosts))
    : [];
  // Read on its own, oldest first: a request whose host has gone silent must not sink out of sight.
  // What has become of the photos that were showing when a page was reported (plans/29).
  const photosNow = await photoStates(
    reports.flatMap(({ report }) => {
      try {
        const id = (JSON.parse(report.snapshot) as { photoId?: unknown }).photoId;
        return typeof id === "string" ? [id] : [];
      } catch {
        return [];
      }
    }),
  );
  const requests = await unansweredRequests();
  const people = requests.length > 0 ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user) : [];
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const field = "mt-1 rounded border border-neutral-400 bg-transparent px-2 py-1";
  const button = "rounded border border-neutral-500 px-3 py-1.5";
  const ruleOptions = RULES.map((rule) => (
    <option key={rule.key} value={rule.key}>
      {rule.title}
    </option>
  ));

  return (
    <SitePage className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-2">
          ← Admin
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

      <h2 className="mt-8 text-lg font-semibold">Refund requests waiting for an answer ({requests.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        The host decides. A host cannot collect the money for a call until they have answered its request. Open a call to see the connection
        record, to answer in the host&apos;s place before the money is taken, to refund, or to close the request.
      </p>
      {requests.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">No request is waiting.</p>
      ) : (
        <ul className="mt-3 space-y-3" data-refund-requests>
          {requests.map(({ request, call, view }) => (
            <li key={request.id} className="rounded border border-neutral-400 p-3 text-sm">
              <p className="font-medium">
                {nameOf.get(call.customerId)} asked {nameOf.get(call.hostId)} (host), <LocalTime iso={request.askedAt.toISOString()} />
              </p>
              <p className="mt-1">
                Reason: {request.reason === "connection" ? "the connection was bad" : "something else"}
                {request.note ? `. "${request.note}"` : "."}
              </p>
              <p className="mt-1">
                {view.answerBy ? (
                  <>
                    The money is still on hold. The host&apos;s answer costs nothing until <LocalTime iso={view.answerBy.toISOString()} />.
                  </>
                ) : view.beingDecided ? (
                  // On hold, but not for the host to answer: under your review (see Admin), or just being taken.
                  "The money is still on hold and its charge is being decided: the call's record is under review, or the money is just being taken. Nothing can be answered until that is done."
                ) : (
                  "The money has been taken. The answer is now a refund or a no."
                )}
              </p>
              <p className="mt-1 opacity-70">Room name, for the video service&apos;s dashboard: {call.roomName}</p>
              <p className="mt-1">
                <Link href={`/calls/${call.id}/results#refund`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                  Open the call
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-lg font-semibold">Open reports ({reports.length})</h2>
      {reports.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Nothing is open.</p>
      ) : (
        <ul className="mt-3 space-y-6">
          {reports.map(({ report, reporterName, reported, profile, earlierReports, callsTogether, actions, kept }) => {
            const snapshot = JSON.parse(report.snapshot) as {
              booking?: { id?: string; note?: string } | null;
              call?: { id?: string; safetyEndedAt?: string | null; endedNowBy?: string | null } | null;
              profile?: { displayName: string; handle: string; about: string } | null;
              post?: { id: string; projectName: string; text: string; links: string[]; pictures?: string[] } | null;
              /** The photo the reported person had: on their page when the page was reported (plans/29), or theirs when they were reported from a call or a request (plans/35). */
              photoId?: string | null;
            };
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
                {/* Only THAT messages are kept, and how many. Their words come through the button, whose press is written down first. */}
                {kept && <KeptMessages reportId={report.id} keptCount={kept.keptCount} olderLeftOut={kept.olderLeftOut} reporterName={reporterName} reportedName={reported?.name ?? "the person reported"} />}
                {snapshot.booking?.note && <p className="mt-1 opacity-70">The request&apos;s note said: &ldquo;{snapshot.booking.note}&rdquo;</p>}
                {snapshot.profile && (
                  <p className="mt-1 opacity-70">
                    Their page at the time: &ldquo;{snapshot.profile.displayName}&rdquo; (@{snapshot.profile.handle}){snapshot.profile.about ? `: "${snapshot.profile.about}"` : ""}
                  </p>
                )}
                {snapshot.photoId && (
                  <p className="mt-1 opacity-70" data-reported-photo>
                    {report.context === "profile" ? "Their page showed a photo when it was reported." : "They had a photo when they were reported."}{" "}
                    {photosNow.get(snapshot.photoId) === "current" ? (
                      <>
                        It is still their photo. It is listed, with &quot;Remove&quot; and &quot;Remove and report&quot;, on{" "}
                        <Link href="/admin/people#photos" className="underline underline-offset-2">
                          the page for hosts and accounts
                        </Link>
                        .
                      </>
                    ) : photosNow.get(snapshot.photoId) === "locked" ? (
                      <>
                        That photo was removed and reported, and is kept. It is listed on{" "}
                        <Link href="/admin/people#photos" className="underline underline-offset-2">
                          the page for hosts and accounts
                        </Link>
                        .
                      </>
                    ) : (
                      "That photo has been removed or replaced since, and is gone. A photo they have now is a different one."
                    )}
                  </p>
                )}
                {snapshot.post && (
                  <div className="mt-2 rounded border border-neutral-400 p-2" data-reported-post>
                    <p className="opacity-70">The post as it was when it was reported, in &ldquo;{snapshot.post.projectName}&rdquo;. Reporting a post does not block its host.</p>
                    <p className="mt-1 whitespace-pre-line">{snapshot.post.text}</p>
                    {snapshot.post.links.length > 0 && <p className="mt-1 break-all opacity-70">Links: {snapshot.post.links.join(", ")}</p>}
                    <p className="mt-1">
                      <Link href={`/admin/projects?post=${snapshot.post.id}`} className="underline underline-offset-2">
                        See the post as it is now, with its pictures, and decide
                      </Link>
                      {snapshot.post.pictures && snapshot.post.pictures.length > 0 && (
                        <span className="opacity-70">
                          {" "}
                          It showed {snapshot.post.pictures.length} {snapshot.post.pictures.length === 1 ? "picture" : "pictures"} when it was reported. A picture its host removes afterwards is not
                          kept.
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {snapshot.call?.id && (
                  <p className="mt-1">
                    <Link href={`/calls/${snapshot.call.id}/results`} className="underline underline-offset-2">
                      See the call&apos;s record (who joined, when, for how long)
                    </Link>
                    {!snapshot.call.safetyEndedAt
                      ? ""
                      : snapshot.call.endedNowBy
                        ? `. The ${snapshot.call.endedNowBy} ended it with "End call now"; its money settles by itself.`
                        : ". It was ended with \"End call and report\"; its charge is on your review list."}
                  </p>
                )}
                {snapshot.booking?.id && !snapshot.call?.id && (
                  <p className="mt-1">
                    <Link href={`/bookings/${snapshot.booking.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                      See the request
                    </Link>
                  </p>
                )}
                {actions.length > 0 && (
                  <p className="mt-1 opacity-70">
                    Earlier actions on this person: {actions.map((a) => `${a.action} (${a.createdAt.toISOString().slice(0, 10)})`).join("; ")}
                  </p>
                )}

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <form action={warnAction} className="rounded border border-neutral-500 p-3">
                    <input type="hidden" name="userId" value={report.reportedId} />
                    <input type="hidden" name="requestId" value={randomUUID()} />
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
                    <input type="hidden" name="requestId" value={randomUUID()} />
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
                    <form action={decideProfileAction} className="space-y-1">
                      <input type="hidden" name="userId" value={report.reportedId} />
                      <input type="hidden" name="decision" value="suspended" />
                <label className="block text-sm">
                  To suspend: the rule
                  <select name="ruleKey" defaultValue="" className="mt-1 block rounded border border-neutral-400 bg-transparent px-2 py-1">
                    <option value="">Choose a rule</option>
                    {ruleOptions}
                  </select>
                </label>
                <label className="block text-sm">
                  What happened, in a sentence (the person is told this)
                  <input name="reasonNote" maxLength={500} className="mt-1 block w-72 rounded border border-neutral-400 bg-transparent px-2 py-1" />
                </label>
                      <button type="submit" className={button}>
                        Suspend their host profile
                      </button>
                    </form>
                  )}
                  {reported && !reported.closedAt && (
                    <form action={closeAccountAction} className="space-y-1">
                      {/* The same reminder as beside the People page's button (the Host Agreement, 17.5). */}
                      <p className="text-sm opacity-70">
                        The person is emailed the reason. A host in the United Kingdom or Europe is owed 30 days&apos; written notice before a page is closed for good,
                        unless the law requires it sooner, the host broke the agreement repeatedly, or the reason is illegal or harmful content, fraud or a risk to
                        someone&apos;s safety. Suspend first when none of those applies.
                      </p>
                      <input type="hidden" name="email" value={reported.email} />
                <label className="block text-sm">
                  To close: the rule
                  <select name="ruleKey" defaultValue="" className="mt-1 block rounded border border-neutral-400 bg-transparent px-2 py-1">
                    <option value="">Choose a rule</option>
                    <option value="own_request">At the person&apos;s own request (no rule)</option>
                    {ruleOptions}
                  </select>
                </label>
                <label className="block text-sm">
                  What happened, in a sentence (the person is told this)
                  <input name="reasonNote" maxLength={500} className="mt-1 block w-72 rounded border border-neutral-400 bg-transparent px-2 py-1" />
                </label>
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
        {/* Says that this form has the box below: a form from before it existed leaves the switch for messages alone. */}
        <input type="hidden" name="hasConversationsOff" value="1" />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="conversationsOff" defaultChecked={current.conversationsOff} /> No messages between hosts and customers (they can still read
          their conversations, and report from them)
        </label>
        <button type="submit" className={button}>
          Save switches
        </button>
      </form>

      <h2 className="mt-10 text-lg font-semibold">Memberships</h2>
      <p className="mt-1 text-sm opacity-70">
        Off: nobody can invite, join, resume or get a new month. Months that have already started go on, and money that is
        owed is still paid back. A host who is not named is treated as if this were off.
      </p>
      <form action={membershipsSwitchAction} className="mt-2 space-y-2 text-sm">
        <label className="block">
          Memberships are
          <select name="memberships" defaultValue={current.memberships} className={`${field} ml-2`}>
            <option value="off">off</option>
            <option value="named">on for the hosts named below</option>
            <option value="everyone">on for everyone</option>
          </select>
        </label>
        <label className="block">
          Named hosts, by their handle, with commas between
          <input name="hosts" defaultValue={namedHosts.map((host) => host.handle).join(", ")} className={`${field} block w-full max-w-md`} />
        </label>
        <button type="submit" className={button}>
          Save memberships switch
        </button>
      </form>

      <h2 className="mt-10 text-lg font-semibold">The phone apps</h2>
      <p className="mt-1 text-sm opacity-70">
        These are for the iPhone and Android apps only; the website does not read them. A thing switched off here is also
        refused by the server, so an old copy of the app cannot reach it. The switches above still rule first: memberships
        that are off for everyone are off in the apps too.
      </p>
      <form action={appSwitchesAction} className="mt-2 space-y-2 text-sm">
        <label className="block">
          Memberships in the apps are
          <select name="appMemberships" defaultValue={current.appMemberships} className={`${field} ml-2`}>
            <option value="on">on</option>
            <option value="use_only">on, but nothing is bought in the app</option>
            <option value="off">off</option>
          </select>
        </label>
        <p className="opacity-70">
          In the middle position members can spend time they have already paid for, and nothing in the app can take a
          monthly payment. A member can always see and cancel their own membership, in every position.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="appTips" defaultChecked={current.appTips} /> Tips in the apps (they also need tips to
          be on for the website; keep this off until Apple&apos;s rule about a tip after a call is clear)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="appAvailableNow" defaultChecked={current.appAvailableNow} /> &quot;Available now&quot; in the
          apps
        </label>
        <label className="block">
          The oldest version of the app still allowed, such as 1.2.0 (empty: every version)
          <input name="appOldestVersion" defaultValue={current.appOldestVersion} className={`${field} block w-40`} />
        </label>
        <button type="submit" className={button}>
          Save the phone apps&apos; switches
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
    </SitePage>
  );
}
