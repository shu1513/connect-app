import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { offerOf, openTimes } from "@/lib/booking/bookings";
import { whenFor } from "@/lib/booking/emails";
import { answerDeadline, LIMITS, payCutoff } from "@/lib/booking/rules";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { bookedTotalCents } from "@/lib/payments/pricing";
import { publicProfile } from "@/lib/profiles/profiles";
import { identityState } from "@/lib/safety/identity";
import { getSignedIn } from "@/lib/session";
import { sendRequest } from "./actions";

export const dynamic = "force-dynamic";

const CANCEL_RULE: Record<number, string> = {
  0: "You can cancel for free any time before the call starts.",
  60: "You can cancel for free until 1 hour before the call starts. After that, cancelling costs the full booked price.",
  720: "You can cancel for free until 12 hours before the call starts. After that, cancelling costs the full booked price.",
  1440: "You can cancel for free until 24 hours before the call starts. After that, cancelling costs the full booked price.",
};

/** The summary a customer sees before sending a request. */
export default async function BookPage(props: PageProps<"/h/[handle]/book">) {
  const { handle } = await props.params;
  const query = await props.searchParams;
  const { start, length } = query;
  const profile = await publicProfile(handle);
  if (!profile) notFound();
  const here = `/h/${profile.handle}/book?length=${length}&start=${encodeURIComponent(String(start))}`;
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect(`/login?next=${encodeURIComponent(here)}`);
  if (!person.welcomed) redirect(`/welcome?next=${encodeURIComponent(here)}`);

  // Only a message this site made for this page is shown; words put in a link by someone else are not.
  const problem = readNotice(`/h/${profile.handle}/book`, query);
  const offer = await offerOf(profile.userId);
  const minutes = Number(length);
  const startsAt = new Date(String(start));
  const now = new Date();
  const open = offer && offer.lengths.includes(minutes) && !Number.isNaN(startsAt.getTime()) ? await openTimes(offer, minutes, now) : [];
  const stillOpen = open.some((o) => o.getTime() === startsAt.getTime());
  const back = `/h/${profile.handle}?length=${minutes || ""}`;

  if (!offer || !stillOpen) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">That time is no longer open</h1>
        <p className="mt-4 text-sm">
          <Link href={back} className="underline underline-offset-2">
            Choose another time
          </Link>
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
  const terms = { startsAt, paid, freeCancelMinutes: offer.freeCancelMinutes };
  const answerBy = answerDeadline({ ...terms, requestedAt: now });
  const hostZoneTime = whenFor({ timeZone: offer.timeZone }, startsAt);

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={back} className="underline underline-offset-2">
          ← Other times
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Ask {profile.displayName} for a call</h1>

      {problem && (
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {problem}
        </p>
      )}

      <dl className="mt-6 space-y-2 text-sm">
        <div>
          <dt className="opacity-70">When</dt>
          <dd className="font-medium">
            <LocalTime iso={startsAt.toISOString()} /> ({minutes} minutes)
          </dd>
          <dd className="opacity-70">For {profile.displayName}: {hostZoneTime}</dd>
        </div>
        <div>
          <dt className="opacity-70">Price</dt>
          <dd className="font-medium">{paid ? `${formatMoney(total)} at most (${formatMoney(offer.pricePer15Cents)} per 15 minutes)` : "Free"}</dd>
        </div>
      </dl>

      <section className="mt-6 rounded border border-neutral-400 p-4 text-sm">
        <h2 className="font-semibold">Request this time, subject to {profile.displayName}&apos;s approval</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>This is a request, not a reservation.</strong> Other people may ask for the same time, and {profile.displayName} chooses.
          </li>
          <li>
            You will have an answer by <LocalTime iso={answerBy.toISOString()} />. If there is none by then, the request ends by itself.
          </li>
          <li>While you wait, this time is kept for this request in your own Connect calendar: you cannot ask for another call that overlaps it.</li>
          <li>You can take the request back for free at any time before it is accepted.</li>
          {paid && (
            <>
              <li>
                <strong>Nothing is held or charged now.</strong> If your request is accepted, {formatMoney(total)} is held on your card 2 days
                before the call (or right away, if the call is sooner). You do not need to come back for that.
              </li>
              <li>
                After the call you are charged for the time {profile.displayName} was in the call during the booked time, never more than{" "}
                {formatMoney(total)}. <strong>That includes time they spend waiting if you are late or do not join.</strong> If they are late,
                leave early or do not show up, you do not pay for that time.
              </li>
              <li>{CANCEL_RULE[offer.freeCancelMinutes]}</li>
              <li>
                If your card cannot be held, we email you and you can fix it until <LocalTime iso={payCutoff(startsAt, offer.freeCancelMinutes).toISOString()} />.
                After that an unpaid booking is cancelled at no cost.
              </li>
            </>
          )}
          {!paid && <li>{CANCEL_RULE[0]}</li>}
        </ul>
      </section>

      <form action={sendRequest} className="mt-6 space-y-4 text-sm">
        <input type="hidden" name="handle" value={profile.handle} />
        <input type="hidden" name="start" value={startsAt.toISOString()} />
        <input type="hidden" name="length" value={minutes} />
        <input type="hidden" name="requestKey" value={randomUUID()} />
        {/* What this page showed. If the host has changed either since, the request is not sent. */}
        <input type="hidden" name="seenPrice" value={offer.pricePer15Cents} />
        <input type="hidden" name="seenFreeCancel" value={offer.freeCancelMinutes} />
        <label className="block">
          What would you like to talk about? (optional, up to {LIMITS.noteMax} characters; only {profile.displayName} sees it)
          <textarea name="note" rows={3} maxLength={LIMITS.noteMax} className="mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2" />
        </label>
        {paid && (
          <label className="flex items-start gap-2">
            <input type="checkbox" name="cardTerms" required className="mt-1" />
            <span>
              I allow Connect to save my card for this booking only and, if my request is accepted, to hold up to {formatMoney(total)} on it
              without my being present, and to charge it after the call as described above. The card is removed once this booking is over.
            </span>
          </label>
        )}
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {paid ? "Continue to card details" : "Send request"}
        </button>
      </form>
    </main>
  );
}
