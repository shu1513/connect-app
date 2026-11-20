import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { deliveryConfigured } from "@/lib/notifications/delivery";
import { requireAdmin } from "@/lib/session";
import { dayInWords, noticeProblems, noticeReport } from "@/legal/notices";
import { sendRefusedAgain, sendTestEmail } from "./actions";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Emails" };

export const dynamic = "force-dynamic";

/**
 * The outbox: every email the app has written, with whether it was sent.
 * While nothing is really sent, the full text is shown here. As soon as
 * sending is set up, or in the live app, only the status is shown, never the
 * text, and a test email can be sent to the admin's own address.
 */
export default async function OutboxPage(props: PageProps<"/admin/outbox">) {
  const admin = await requireAdmin();
  const live = process.env.NODE_ENV === "production" || deliveryConfigured();
  const notice = readNotice("/admin/outbox", await props.searchParams);
  const emails = await db.select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.createdAt)).limit(50);
  const [counts] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${schema.emailOutbox.status} = 'queued')::int`,
      failed: sql<number>`count(*) filter (where ${schema.emailOutbox.status} = 'failed' and ${schema.emailOutbox.createdAt} > now() - interval '7 days')::int`,
    })
    .from(schema.emailOutbox);
  // Every version of a legal document people were written to about, and whether the 30 days were kept (plans/46, part 2).
  const notices = await noticeReport(new Date());
  const noticeLines = notices.some((one) => one.coming) ? await noticeProblems(new Date()) : [];

  return (
    <SitePage className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Emails</h1>
      <p className="mt-2 text-sm opacity-70">
        {deliveryConfigured()
          ? `Sending is on. Waiting to be sent: ${counts.queued}. Failed in the last 7 days: ${counts.failed}.`
          : "No sending service is set up (both RESEND_API_KEY and EMAIL_FROM are needed), so nothing is really sent. The latest 50 messages are shown here instead."}
      </p>
      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}
      <form action={sendTestEmail} className="mt-3">
        <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 text-sm">
          Send a test email to {admin.email}
        </button>
      </form>
      {notices.length > 0 && (
        <section className="mt-6 rounded border border-neutral-400 p-4 text-sm" data-notice-report>
          <h2 className="font-semibold">Notices of new terms</h2>
          <p className="mt-1 opacity-70">Every new version people were written to about. The Terms and the Host Agreement promise 30 days&apos; notice.</p>
          {noticeLines.map((problem) => (
            <p key={`${problem.kind}:${problem.coming.name}:${problem.coming.version.version}`} role="alert" className="mt-2 font-medium">
              {problem.line}
            </p>
          ))}
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {notices.map((one) => (
              <li key={`${one.name}:${one.version}:${one.effectiveFrom}`} data-notice={`${one.name}@${one.version}`}>
                {one.title}, version {one.version}, {one.coming ? "takes effect on" : "in effect since"} {dayInWords(one.effectiveFrom)}: {one.written} written; {one.sentInTime} sent with 30 days or more to go;{" "}
                {one.sentLate} sent later; {one.waiting} waiting; {one.failedOurs} not sent, for us to look at; {one.notOurs} not sent because the address does not work, the account was closed or the day was
                moved.{one.coming && !one.owed ? " No 30 days are owed for this one (it follows a draft, or it is marked urgent)." : ""}
              </li>
            ))}
          </ul>
          {notices.some((one) => one.coming && one.failedOurs > 0) && (
            <form action={sendRefusedAgain} className="mt-3">
              <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5">
                Send the refused ones again
              </button>
            </form>
          )}
        </section>
      )}
      {emails.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No emails yet.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {emails.map((email) => (
            <li key={email.id} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="font-medium">{email.subject}</p>
              <p className="opacity-70">
                To {email.to}, <LocalTime iso={email.createdAt.toISOString()} /> · {email.status}
                {email.attempts > 0 ? ` after ${email.attempts} ${email.attempts === 1 ? "try" : "tries"}` : ""}
                {email.lastError ? ` · ${email.lastError}` : ""}
              </p>
              {!live && <pre className="mt-2 whitespace-pre-wrap break-all font-sans">{email.body}</pre>}
            </li>
          ))}
        </ul>
      )}
    </SitePage>
  );
}
