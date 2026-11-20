import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { isHostToo } from "@/lib/booking/bookings";
import { gatherBookPage } from "@/lib/booking/book-page";
import { BOOK_WORDS, bookPoints, cardTermsWords, type Part } from "@/lib/booking/book-words";
import { whenFor } from "@/lib/booking/emails";
import { CARD_CONSENT_VERSION, LIMITS } from "@/lib/booking/rules";
import { readNotice } from "@/lib/notice";
import { hostForMemberByHandle } from "@/lib/membership/access";
import { memberBookingView, memberCallCents, memberOpenTimes } from "@/lib/membership/book";
import { formatMoney } from "@/lib/payments/access";
import { publicProfile } from "@/lib/profiles/profiles";
import { SellerLine } from "@/components/seller-line";
import { ConfirmIdFirst } from "@/components/confirm-id-first";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";
import { getSignedIn } from "@/lib/session";
import { bookMember, sendRequest } from "./actions";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Ask for a call" };

export const dynamic = "force-dynamic";

/** A sentence given in parts (book-words.ts): stressed words in bold, a moment in the browser's own time zone. */
function Sentence({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? part : "bold" in part ? <strong key={index}>{part.bold}</strong> : <LocalTime key={index} iso={part.time} />,
      )}
    </>
  );
}

/** The summary a customer sees before sending a request. */
export default async function BookPage(props: PageProps<"/h/[handle]/book">) {
  const { handle } = await props.params;
  const query = await props.searchParams;
  const { start, length } = query;
  const person = await getSignedIn();
  // A page hidden from the public still opens for a member of this host (asked of the membership's own access rules).
  const profile = (await publicProfile(handle)) ?? (person && !person.closed ? await hostForMemberByHandle(person.id, handle) : null);
  if (!profile) notFound();
  const asMember = query.as === "member";
  // This page's own address, to come back to after logging in or signing up. Opened without a time, that is the host's page.
  const here = typeof start === "string" && typeof length === "string" ? `/h/${profile.handle}/book?${asMember ? "as=member&" : ""}length=${encodeURIComponent(length)}&start=${encodeURIComponent(start)}` : `/h/${profile.handle}`;
  if (!person || person.closed || !person.emailVerified) redirect(`/login?next=${encodeURIComponent(here)}`);
  if (!person.welcomed) redirect(`/welcome?next=${encodeURIComponent(here)}`);

  // Only a message this site made for this page is shown; words put in a link by someone else are not.
  const problem = readNotice(`/h/${profile.handle}/book`, query);
  const now = new Date();
  if (asMember) return <MemberBook profile={profile} person={person} minutes={Number(length)} startsAt={new Date(String(start))} now={now} problem={problem} here={here} />;
  // What this page shows is gathered in one place, for this page and for the phone app (book-page.ts).
  const page = await gatherBookPage(person, profile, { start, length }, now);

  if (page.kind === "gone") {
    return (
      <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">{BOOK_WORDS.gone}</h1>
        <p className="mt-4 text-sm">
          <Link href={`/h/${profile.handle}?length=${page.minutes || ""}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
            {BOOK_WORDS.chooseAnother}
          </Link>
        </p>
      </SitePage>
    );
  }
  if (page.kind === "own") {
    return (
      <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">{BOOK_WORDS.ownTitle}</h1>
        <p className="mt-4 text-sm">{BOOK_WORDS.own}</p>
      </SitePage>
    );
  }
  if (page.kind === "confirm_id") return <ConfirmIdFirst reason={page.reason} hostName={profile.displayName} next={here} />;
  const { offer, startsAt, minutes, totalCents: total, paid } = page;
  const points = bookPoints({ hostName: profile.displayName, totalCents: total, freeCancelMinutes: offer.freeCancelMinutes, answerBy: page.answerBy, payBy: page.payBy, hostToo: page.hostToo });

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={`/h/${profile.handle}?length=${minutes || ""}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Other times
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">{BOOK_WORDS.title(profile.displayName)}</h1>

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
          <dd className="opacity-70">{BOOK_WORDS.hostTime(profile.displayName, page.hostZoneTime)}</dd>
        </div>
        <div>
          <dt className="opacity-70">Price</dt>
          <dd className="font-medium">{BOOK_WORDS.price(total, offer.pricePer15Cents)}</dd>
        </div>
      </dl>

      <section className="mt-6 rounded border border-neutral-400 p-4 text-sm">
        <h2 className="font-semibold">{BOOK_WORDS.pointsTitle(profile.displayName)}</h2>
        <SellerLine hostId={profile.userId} name={profile.displayName} />
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {points.map((point, index) => (
            <li key={index}>
              <Sentence parts={point} />
            </li>
          ))}
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
          {BOOK_WORDS.note(profile.displayName)}
          <textarea name="note" rows={3} maxLength={LIMITS.noteMax} className="mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2" />
        </label>
        {paid && (
          <label className="flex items-start gap-2">
            <input type="checkbox" name="cardTerms" required className="mt-1" />
            {/* Which wording this box stands beside. If it has been changed by the time the form arrives, nothing is sent. */}
            <input type="hidden" name="cardTermsVersion" value={CARD_CONSENT_VERSION} />
            <span>{cardTermsWords(total)}</span>
          </label>
        )}
        {page.idConfirmed && <p className="opacity-70">{BOOK_WORDS.idLine(profile.displayName)}</p>}
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {BOOK_WORDS.button(paid)}
        </button>
      </form>
    </SitePage>
  );
}

const MEMBER_CANCEL_RULE: Record<number, string> = {
  0: "You can cancel for free any time before the call starts. The time then goes back to your membership.",
  60: "You can cancel for free until 1 hour before the call starts, and the time goes back to your membership. After that, cancelling uses all the time you booked.",
  720: "You can cancel for free until 12 hours before the call starts, and the time goes back to your membership. After that, cancelling uses all the time you booked.",
  1440: "You can cancel for free until 24 hours before the call starts, and the time goes back to your membership. After that, cancelling uses all the time you booked.",
};

/** The summary a member sees before booking with their membership time. The call is booked at once. */
async function MemberBook(props: { profile: { userId: string; handle: string; displayName: string }; person: { id: string }; minutes: number; startsAt: Date; now: Date; problem: string | null; here: string }) {
  const { profile, person, minutes, startsAt, now, problem } = props;
  const back = `/h/${profile.handle}?mlength=${minutes || ""}#member`;
  // A block either way, a membership that cannot be booked from, and a time that is gone all look the same from here.
  const view = person.id !== profile.userId && !(await isBlockedEitherWay(person.id, profile.userId)) ? await memberBookingView(person.id, profile.userId, now) : null;
  const open = view && !Number.isNaN(startsAt.getTime()) ? await memberOpenTimes(view, minutes, now) : [];
  const time = open.find((o) => o.startsAt.getTime() === startsAt.getTime());
  if (!view || !time) {
    return (
      <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-2xl font-semibold">That time is no longer open</h1>
        {problem && (
          <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
            {problem}
          </p>
        )}
        <p className="mt-4 text-sm">
          <Link href={`/h/${profile.handle}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
            Choose another time
          </Link>
        </p>
      </SitePage>
    );
  }
  if (view.offer.verifiedOnly && !(await identityState(person.id)).passed) return <ConfirmIdFirst reason="host" hostName={profile.displayName} next={props.here} />;
  const { month, offer } = view;
  const cents = memberCallCents(month.pricePer15Cents, minutes);
  const hostToo = await isHostToo(person.id);

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={back} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Other times
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Book a call with {profile.displayName}</h1>

      {problem && (
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {problem}
        </p>
      )}

      <dl className="mt-6 space-y-2 text-sm">
        <div>
          <dt className="opacity-70">When</dt>
          <dd className="font-medium">
            <LocalTime iso={startsAt.toISOString()} /> ({minutes} minutes){time.membersOnly ? " · a time for members only" : ""}
          </dd>
          <dd className="opacity-70">For {profile.displayName}: {whenFor({ timeZone: offer.timeZone }, startsAt)}</dd>
        </div>
        <div>
          <dt className="opacity-70">Paid from your membership</dt>
          <dd className="font-medium">
            Uses {minutes} minutes of your membership ({formatMoney(cents)} of the {formatMoney(view.freeCents)} you have left)
          </dd>
        </div>
      </dl>

      <section className="mt-6 rounded border border-neutral-400 p-4 text-sm">
        <h2 className="font-semibold">What happens when you press &quot;Book&quot;</h2>
        <SellerLine hostId={profile.userId} name={profile.displayName} />
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>The call is booked at once.</strong> {profile.displayName} does not need to accept it.
          </li>
          {month.status === "held" && (
            <li>
              This is your first booking of this month, so the {formatMoney(month.totalCents)} that is held on your card is <strong>taken now</strong>,
              before the call is booked. After that, &quot;Cancel now&quot; is no longer possible for this month.
            </li>
          )}
          <li>
            After the call, your membership time is used for the time {profile.displayName} was in the call during the booked time, never more than these{" "}
            {minutes} minutes. <strong>That includes time they spend waiting if you are late or do not join.</strong> If they are late, leave early or
            do not show up, that time comes back to you.
          </li>
          <li>{MEMBER_CANCEL_RULE[offer.freeCancelMinutes]}</li>
          <li>The call must end before your month ends, on <LocalTime iso={view.monthEndsAt.toISOString()} />.</li>
          {hostToo && (
            <li>
              <strong>You are a host too:</strong> nobody can book you during this call, and requests to you for that time end.
            </li>
          )}
        </ul>
      </section>

      <form action={bookMember} className="mt-6 space-y-4 text-sm">
        <input type="hidden" name="handle" value={profile.handle} />
        <input type="hidden" name="start" value={startsAt.toISOString()} />
        <input type="hidden" name="length" value={minutes} />
        <input type="hidden" name="requestKey" value={randomUUID()} />
        {/* What this page showed. If either has changed since, nothing is booked. */}
        <input type="hidden" name="seenPrice" value={month.pricePer15Cents} />
        <input type="hidden" name="seenFreeCancel" value={offer.freeCancelMinutes} />
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          Book
        </button>
      </form>
    </SitePage>
  );
}
