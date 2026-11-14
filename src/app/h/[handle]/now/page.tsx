import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { instantOffer } from "@/lib/booking/bookings";
import { NOW } from "@/lib/booking/now-rules";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { bookedTotalCents } from "@/lib/payments/pricing";
import { publicProfile } from "@/lib/profiles/profiles";
import { identityState } from "@/lib/safety/identity";
import { getSignedIn } from "@/lib/session";
import { sendNowRequest } from "./actions";

export const dynamic = "force-dynamic";

/** The summary a customer sees before asking for a call right now. */
export default async function CallNowPage(props: PageProps<"/h/[handle]/now">) {
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
  const open = await instantOffer(profile.userId, new Date());

  if (!open || !open.lengths.includes(minutes)) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">{profile.displayName} is not available right now</h1>
        <p className="mt-4 text-sm">
          <Link href={`/h/${profile.handle}`} className="underline underline-offset-2">
            Back to their page
          </Link>{" "}
          — you can still ask for a call at a later time there.
        </p>
      </main>
    );
  }
  if (person.id === profile.userId) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">This is your own page</h1>
        <p className="mt-4 text-sm">You cannot book a call with yourself.</p>
      </main>
    );
  }
  const total = bookedTotalCents(open.offer.pricePer15Cents, minutes * 60);
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
        <Link href={`/h/${profile.handle}`} className="underline underline-offset-2">
          ← Back
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
          <dt className="opacity-70">Length</dt>
          <dd className="font-medium">{minutes} minutes</dd>
        </div>
        <div>
          <dt className="opacity-70">Price</dt>
          <dd className="font-medium">{paid ? `${formatMoney(total)} at most (${formatMoney(open.offer.pricePer15Cents)} per 15 minutes)` : "Free"}</dd>
        </div>
      </dl>

      <section className="mt-6 rounded border border-neutral-400 p-4 text-sm">
        <h2 className="font-semibold">How a call now works</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            {profile.displayName} has <strong>{NOW.answerMinutes} minutes</strong> to accept. If they do not, the request ends by itself and
            nothing is held or charged.
          </li>
          <li>
            When they accept, the call starts <strong>about a minute later</strong>. Keep this tab open: it takes you to the call.
          </li>
          <li>You can take the request back for free until it is accepted, and cancel for free until the call starts.</li>
          {paid && (
            <>
              <li>
                <strong>Nothing is held or charged now.</strong> When {profile.displayName} accepts, {formatMoney(total)} is held on your card
                right away. If your bank wants you to approve it, you do that on the call&apos;s page.
              </li>
              <li>
                After the call you are charged for the time <strong>you and {profile.displayName} were both in the call</strong>, never more than{" "}
                {formatMoney(total)}. Time only one of you was in is not charged.
              </li>
            </>
          )}
        </ul>
      </section>

      <form action={sendNowRequest} className="mt-6 space-y-4 text-sm">
        <input type="hidden" name="handle" value={profile.handle} />
        <input type="hidden" name="length" value={minutes} />
        <input type="hidden" name="requestKey" value={randomUUID()} />
        <input type="hidden" name="seenPrice" value={open.offer.pricePer15Cents} />
        {paid && (
          <label className="flex items-start gap-2">
            <input type="checkbox" name="cardTerms" required className="mt-1" />
            <span>
              I agree that Connect keeps my card for this call, holds up to {formatMoney(total)} on it when the host accepts, and charges it
              after the call for the time we were both in it. If I ask for more time during the call, the price of that extra time is held
              on the same card and charged in the same way. The card is removed once the call is over.
            </span>
          </label>
        )}
        <button type="submit" className="rounded bg-green-700 px-4 py-2 font-medium text-white">
          {paid ? "Save my card and ask now" : "Ask now"}
        </button>
      </form>
    </main>
  );
}
