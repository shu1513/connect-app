import { desc, sql } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { deliveryConfigured } from "@/lib/notifications/delivery";
import { requireAdmin } from "@/lib/session";
import { sendTestEmail } from "./actions";

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

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-2">
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
    </main>
  );
}
