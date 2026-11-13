import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { ChangePasswordForm } from "@/components/auth-forms";
import { SignOutButton } from "@/components/sign-out-button";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { Rating } from "@/components/rating";
import { averageFor } from "@/lib/ratings/ratings";
import { blockedBy } from "@/lib/safety/blocks";
import { requireUser } from "@/lib/session";
import { unblockAction } from "../report/actions";
import { timeZones } from "@/lib/time-zones";
import { saveAccount, saveReminders } from "./actions";

const NOTICES: Record<string, string> = {
  saved: "Your details were saved.",
  reminders: "Your notification choice was saved.",
  name: "Your name must be 2 to 50 characters long.",
  zone: "Please choose your time zone from the list.",
};

export default async function AccountPage(props: PageProps<"/account">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const { notice } = query;
  const signed = readNotice("/account", query);
  const [password] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")));
  const blocked = await blockedBy(user.id);
  const [{ reminders }] = await db.select({ reminders: schema.user.reminderEmails }).from(schema.user).where(eq(schema.user.id, user.id));
  const [asHost, asCustomer] = await Promise.all([averageFor(user.id, "host", new Date()), averageFor(user.id, "customer", new Date())]);
  const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Your account</h1>

      {((typeof notice === "string" && NOTICES[notice]) || signed) && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {signed ?? NOTICES[String(notice)]}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Your details</h2>
        <p className="mt-1 text-sm opacity-70">Email: {user.email}. To change your email address, contact support.</p>
        <form action={saveAccount} className="mt-3 max-w-sm space-y-3">
          <label className="block text-sm">
            Your name
            <input name="name" type="text" defaultValue={user.name} required minLength={2} maxLength={50} className={field} />
          </label>
          <label className="block text-sm">
            Your time zone
            <TimeZoneSelect zones={timeZones()} saved={user.timeZone} />
          </label>
          <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 text-sm">
            Save
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your ratings</h2>
        <p className="mt-1 text-sm opacity-70">
          After a call, each person rates the other. You never see what one particular person gave you, only your averages. A rating starts
          to count a week after the call. Each person counts once, with their first rating of you. An average appears once three
          people&apos;s ratings count, and then moves three people at a time.
        </p>
        <p className="mt-2 text-sm">
          As a host: <Rating shown={asHost} newText="not enough ratings yet" />
        </p>
        <p className="mt-1 text-sm">
          As a customer: <Rating shown={asCustomer} newText="not enough ratings yet" />
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Password</h2>
        {password ? (
          <ChangePasswordForm />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            You log in with Google, so there is no password here. To add one, log out and use &quot;Forgot password&quot;
            on the login page.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Hosting</h2>
        <p className="mt-2 text-sm">
          <Link href="/host" className="underline underline-offset-2">
            Your host profile and payout settings
          </Link>
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm opacity-70">
          Emails about things that happen (an answer to a request, a cancellation, money, a report) are always sent. Reminders are up to you.
        </p>
        <form action={saveReminders} className="mt-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="reminders" defaultChecked={reminders} /> Email me reminders before my calls and about requests
          </label>
          <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5">
            Save
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">People you have blocked</h2>
        {blocked.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">Nobody. You can block someone from a request or a call&apos;s page.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {blocked.map((person) => (
              <li key={person.id} className="flex items-center gap-3">
                <span>{person.name}</span>
                <form action={unblockAction}>
                  <input type="hidden" name="userId" value={person.id} />
                  <button type="submit" className="underline underline-offset-2">
                    Unblock
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 text-sm">
        <SignOutButton />
        <p className="mt-4 opacity-70">To close your account, contact support.</p>
      </section>
    </main>
  );
}
