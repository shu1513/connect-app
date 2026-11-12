import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { instantOfferOf } from "@/lib/booking/instant";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { bookedTotalCents } from "@/lib/payments/pricing";
import { publicProfile } from "@/lib/profiles/profiles";
import { identityState } from "@/lib/safety/identity";
import { getSignedIn } from "@/lib/session";
import { startNow } from "./actions";

export const dynamic = "force-dynamic";

/** The summary a customer sees before starting a call with a host who is available now. */
export default async function NowPage(props: PageProps<"/h/[handle]/now">) {
  const { handle } = await props.params;
  const query = await props.searchParams;
  const profile = await publicProfile(handle);
  if (!profile) notFound();
  const minutes = Number(query.length);
  const here = `/h/${profile.handle}/now?length=${minutes || ""}`;
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect(`/login?next=${encodeURIComponent(here)}`);
  if (!person.welcomed) redirect(`/welcome?next=${encodeURIComponent(here)}`);

  const problem = readNotice(`/h/${profile.handle}/now`, query);
  const back = `/h/${profile.handle}`;
  if (person.id === profile.userId) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">This is your own page</h1>
        <p className="mt-4 text-sm">You cannot call yourself.</p>
      </main>
    );
  }
  const offer = await instantOfferOf(profile.userId, new Date(), person.id);
  if (!offer || !offer.lengths.includes(minutes)) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">{profile.displayName} is not available for that right now</h1>
        <p className="mt-4 text-sm">
          <Link href={back} className="underline underline-offset-2">
            Back to {profile.displayName}&apos;s page
          </Link>
        </p>
      </main>
    );
  }
  const total = bookedTotalCents(offer.pricePer15Cents, minutes * 60);
  const paid = total > 0;
  if (!paid && !(await identityState(person.id)).passed) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">One thing first</h1>
        <p className="mt-4 text-sm">
          Before your first free call, please confirm who you are: a photo of your ID and a selfie on Stripe&apos;s own pages, which we never
          see. It takes a couple of minutes and is needed once.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/identity" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Confirm who I am
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={back} className="underline underline-offset-2">
          ← {profile.displayName}&apos;s page
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Call {profile.displayName} now</h1>

      {problem && (
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {problem}
        </p>
      )}

      <dl className="mt-6 space-y-2 text-sm">
        <div>
          <dt className="opacity-70">When</dt>
          <dd className="font-medium">In about 5 minutes, for {minutes} minutes. The exact start is set when you press the button.</dd>
        </div>
        <div>
          <dt className="opacity-70">Price</dt>
          <dd className="font-medium">{paid ? `${formatMoney(total)} at most (${formatMoney(offer.pricePer15Cents)} per 15 minutes)` : "Free"}</dd>
        </div>
      </dl>

      <section className="mt-6 rounded border border-neutral-400 p-4 text-sm">
        <h2 className="font-semibold">How a call that starts now works</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>The room is open as soon as you press the button. The call itself starts 5 minutes later; the minutes before the start are not counted.</li>
          <li>{profile.displayName} is told by email and on their calls page. They may take a few minutes to join.</li>
          {paid ? (
            <>
              <li>
                <strong>On the next page you confirm your card.</strong> {formatMoney(total)} is held on it; nothing is charged until after the call.
                The money must be held before the start, or the call is cancelled and nothing is charged.
              </li>
              <li>
                After the call you are charged for the time {profile.displayName} is in the call during the {minutes} booked minutes, never more
                than {formatMoney(total)}. <strong>That includes time they spend waiting if you are late or do not join.</strong> If they are late,
                leave early or do not show up, you do not pay for that time.
              </li>
            </>
          ) : (
            <li>This call is free.</li>
          )}
          <li>You can cancel for free at any time before the start.</li>
        </ul>
      </section>

      <form action={startNow} className="mt-6 text-sm">
        <input type="hidden" name="handle" value={profile.handle} />
        <input type="hidden" name="length" value={minutes} />
        <input type="hidden" name="requestKey" value={randomUUID()} />
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {paid ? "Start the call and continue to your card" : "Start the call"}
        </button>
      </form>
    </main>
  );
}
