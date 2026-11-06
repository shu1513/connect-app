import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { requireUser } from "@/lib/session";

/** What a paused person sees when they try to book, host or join. */
export default async function PausedPage() {
  const user = await requireUser();
  if (!user.paused) redirect("/");
  const [row] = await db.select({ reason: schema.user.pausedReason }).from(schema.user).where(eq(schema.user.id, user.id));
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Your account is paused</h1>
      <p className="mt-4 text-sm">
        You can still log in and see your past calls and receipts, but you cannot book, host or join calls for now.
      </p>
      {row?.reason && <p className="mt-3 text-sm">Reason: {row.reason}</p>}
      <p className="mt-3 text-sm">
        If you think this is a mistake, write to <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">{SUPPORT_EMAIL}</a>.
      </p>
      <p className="mt-6 text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
    </main>
  );
}
