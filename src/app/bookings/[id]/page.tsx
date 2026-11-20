import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { cardFormSecret, gatherRequest } from "@/lib/booking/request-page";
import { endedWords, REQUEST_WORDS, requestPrice, requestTitle, stageWords } from "@/lib/booking/request-words";
import { cardStepOpen } from "@/lib/booking/rules";
import { readNotice } from "@/lib/notice";
import { stripePublishableKey } from "@/lib/payments/stripe";
import { requireUser } from "@/lib/session";
import { acceptAction, continueMemberAction, declineAction, takeBackAction } from "./actions";
import { CardStep } from "./card-step";
import { NowWaiting } from "./now-waiting";
import { BlockButton } from "@/components/block-button";
import { NoteForm } from "@/components/note-form";
import { Rating } from "@/components/rating";
import { NOTE_MAX } from "@/lib/people/contacts";
import { SitePage } from "@/components/site-page";
import { HostPhoto } from "@/components/host-photo";

export const metadata: Metadata = { title: "Request for a call" };

/** One request, for the customer who sent it or the host it was sent to. */
export default async function BookingPage(props: PageProps<"/bookings/[id]">) {
  const { id } = await props.params;
  // Emails link here: someone who has to log in first comes back to this request.
  const user = await requireUser(`/bookings/${id}`);
  // What this page shows is gathered in one place, for this page and for the phone app (request-page.ts).
  const found = await gatherRequest(user.id, id, new Date());
  if (!found) notFound();
  const { booking, role, byMember, paid, otherName, hostHandle, showRating, customerRating, idConfirmed, note, customerPhotoId } = found;
  const notice = readNotice(`/bookings/${id}`, await props.searchParams);
  const price = requestPrice(booking);
  const ended = endedWords(booking, role);

  // The card form, for a paid request that has not been sent yet.
  // Past the card step's time the request is over, also in the moments before the helper has ended it: no card form then.
  const cardTooLate = role === "customer" && booking.stage === "card" && !cardStepOpen(booking.createdAt, new Date());
  const clientSecret = role === "customer" && booking.stage === "card" && !cardTooLate ? await cardFormSecret(booking, user, new Date()) : null;

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={role === "host" ? "/host/requests" : "/"} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {role === "host" ? "Requests for calls" : "Your calls"}
        </Link>
      </p>
      <div className="mt-4 flex items-center gap-3">
        {role === "host" && <HostPhoto photoId={customerPhotoId} name={otherName ?? ""} small />}
        <h1 className="text-2xl font-semibold">
          {requestTitle(booking, role, otherName)}
        </h1>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {/* Past the card step's time, in the moments before the helper ends the request: said in place of "enter your card". */}
      <p className="mt-4 font-medium" role={cardTooLate ? "alert" : undefined}>
        {cardTooLate ? REQUEST_WORDS.cardTooLate : stageWords(booking, role)}
      </p>
      {ended && <p className="mt-1 text-sm opacity-70">{ended}</p>}
      {role === "customer" && byMember && booking.stage === "paying" && (
        <form action={continueMemberAction} className="mt-4 text-sm">
          <input type="hidden" name="id" value={booking.id} />
          <p className="opacity-70">
            This is your first booking of the month, so the month&apos;s amount is taken from your card first. Nothing is kept for you until that is done. If
            this page still says so after a moment, press the button.
          </p>
          <button type="submit" className="mt-3 rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Finish booking
          </button>
        </form>
      )}

      <dl className="mt-6 space-y-2 text-sm">
        <div>
          <dt className="opacity-70">When</dt>
          <dd className="font-medium">
            <LocalTime iso={booking.startsAt.toISOString()} /> ({booking.lengthMinutes} minutes)
          </dd>
        </div>
        <div>
          <dt className="opacity-70">{price.label}</dt>
          <dd className="font-medium">{price.words}</dd>
        </div>
        {showRating && (
          <div>
            <dt className="opacity-70">Their rating as a customer</dt>
            <dd className="font-medium">
              <Rating shown={customerRating} newText="New: not enough ratings yet" />
            </dd>
          </div>
        )}
        {idConfirmed && (
          <div>
            <dt className="opacity-70">Their ID</dt>
            <dd className="font-medium text-green-700">Confirmed</dd>
          </div>
        )}
        {role === "host" && booking.note && (
          <div>
            <dt className="opacity-70">Their note</dt>
            <dd>{booking.note}</dd>
          </div>
        )}
        {booking.stage === "waiting" && booking.respondBy && (
          <div>
            <dt className="opacity-70">{REQUEST_WORDS.hearBy(role)}</dt>
            <dd className="font-medium">
              <LocalTime iso={booking.respondBy.toISOString()} />
            </dd>
          </div>
        )}
      </dl>

      {role === "customer" && booking.stage === "card" && clientSecret && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{REQUEST_WORDS.cardTitle}</h2>
          <p className="mt-1 text-sm opacity-70">{REQUEST_WORDS.card}</p>
          <CardStep bookingId={booking.id} clientSecret={clientSecret} publishableKey={stripePublishableKey()} />
        </section>
      )}

      {cardTooLate && (
        <section className="mt-6 text-sm">
          <p>
            <Link href={hostHandle ? `/h/${hostHandle}` : "/"} className="underline underline-offset-2">
              Choose the time again
            </Link>
          </p>
        </section>
      )}

      {role === "customer" && booking.stage === "card" && !cardTooLate && !clientSecret && (
        <section className="mt-6 text-sm">
          <p role="alert">{REQUEST_WORDS.cardNotLoaded}</p>
          <p className="mt-2">
            Reload this page in a moment, or{" "}
            <Link href={hostHandle ? `/h/${hostHandle}` : "/"} className="underline underline-offset-2">
              choose the time again
            </Link>
            . {REQUEST_WORDS.cardNotLoadedAfter}
          </p>
        </section>
      )}

      {role === "customer" && booking.stage === "waiting" && (
        <>
          {booking.source === "now" && booking.respondBy ? (
            <NowWaiting bookingId={booking.id} respondBy={booking.respondBy.toISOString()} hostName={otherName ?? "the host"} />
          ) : (
            <p className="mt-6 text-sm opacity-70">{REQUEST_WORDS.waiting(paid)}</p>
          )}
          <form action={takeBackAction} className="mt-4">
            <input type="hidden" name="id" value={booking.id} />
            <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 text-sm">
              {REQUEST_WORDS.takeBack}
            </button>
          </form>
        </>
      )}

      {role === "host" && booking.stage === "waiting" && (
        <div className="mt-6 flex gap-3 text-sm">
          <form action={acceptAction}>
            <input type="hidden" name="id" value={booking.id} />
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
              Accept
            </button>
          </form>
          <form action={declineAction}>
            <input type="hidden" name="id" value={booking.id} />
            <button type="submit" className="rounded border border-neutral-500 px-4 py-2">
              Decline
            </button>
          </form>
        </div>
      )}

      {note?.allowed && <NoteForm customerId={booking.customerId} name={otherName ?? "this customer"} text={note.text} max={NOTE_MAX} />}

      {booking.stage !== "card" && (
        <div className="mt-8 text-sm opacity-70">
          <Link href={`/report?booking=${booking.id}`} className="underline underline-offset-2">
            Report {otherName}
          </Link>
          <span className="mx-2">·</span>
          <BlockButton userId={role === "host" ? booking.customerId : booking.hostId} name={otherName ?? "this person"} back={`/bookings/${booking.id}`} />
        </div>
      )}

      {booking.callId && (
        <p className="mt-6 text-sm">
          <Link href={`/calls/${booking.callId}`} className="underline underline-offset-2">
            {REQUEST_WORDS.callPage}
          </Link>
          {role === "customer" && REQUEST_WORDS.callPageAlso(booking)}
        </p>
      )}
    </SitePage>
  );
}
