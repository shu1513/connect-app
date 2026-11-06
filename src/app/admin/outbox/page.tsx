import { desc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Testing only: the emails the app would have sent. They contain login links,
 * so this page does not exist in the live app and only admins can open it.
 */
export default async function OutboxPage() {
  if (process.env.NODE_ENV === "production") notFound();
  await requireAdmin();

  const emails = await db.select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.createdAt)).limit(50);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-2">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Sent emails (testing)</h1>
      <p className="mt-2 text-sm opacity-70">
        While developing, no real email is sent. The latest 50 messages are shown here instead.
      </p>
      {emails.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No emails yet.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {emails.map((email) => (
            <li key={email.id} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="font-medium">{email.subject}</p>
              <p className="opacity-70">
                To {email.to}, <LocalTime iso={email.createdAt.toISOString()} />
              </p>
              <pre className="mt-2 whitespace-pre-wrap break-all font-sans">{email.body}</pre>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
