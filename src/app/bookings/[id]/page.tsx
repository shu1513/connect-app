import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { bookingFor } from "@/lib/booking/bookings";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { stripe, stripePublishableKey } from "@/lib/payments/stripe";
import { requireUser } from "@/lib/session";
import { acceptAction, continueMemberAction, declineAction, takeBackAction } from "./actions";
import { CardStep } from "./card-step";
import { NowWaiting } from "./now-waiting";
import { BlockButton } from "@/components/block-button";
import { NoteForm } from "@/components/note-form";
import { Rating } from "@/components/rating";
import { hostNoteAbout, NOTE_MAX } from "@/lib/people/contacts";
import { averageFor } from "@/lib/ratings/ratings";
import { identityState } from "@/lib/safety/identity";
import { SitePage } from "@/components/site-page";
import { HostPhoto } from "@/components/host-photo";
import { photosOf } from "@/lib/profiles/photo";

export const metadata: Metadata = { title: "Request for a call" };

const STAGE_FOR_CUSTOMER: Record<string, string> = {
  card: "Almost there: enter your card to send the request.",
  waiting: "Sent. Waiting for the host's answer.",
  accepted: "Accepted. Your call is booked.",
  declined: "The host could not take this request.",
  passed_over: "The host accepted another request for that time.",
  ran_out: "This request ended without an answer.",
  taken_back: "You took this request back.",
  cancelled: "This call was cancelled.",
};
/** A booking a member made with their membership time: no request, no answer, no card step. */
const MEMBER_STAGE_FOR_CUSTOMER: Record<string, string> = {
  paying: "We are taking this month's payment. Your call is booked as soon as that is done.",
  accepted: "Booked with your membership.",
  ran_out: "This call was not booked.",
  cancelled: "This call was cancelled.",
};
const MEMBER_STAGE_FOR_HOST: Record<string, string> = {
  accepted: "Booked by a member of yours. There is nothing for you to accept.",
  cancelled: "This call was cancelled.",
};
const STAGE_FOR_HOST: Record<string, string> = {
  waiting: "Waiting for your answer.",
  accepted: "You accepted. The call is booked.",
  declined: "You declined this request.",
  passed_over: "You accepted another request for that time.",
  ran_out: "This request ended because it was not answered in time.",
  taken_back: "The customer took this request back.",
  cancelled: "This call was cancelled.",
};

/** One request, for the customer who sent it or the host it was sent to. */
export default async function BookingPage(props: PageProps<"/bookings/[id]">) {
  const { id } = await props.params;
  // Emails link here: someone who has to log in first comes back to this request.
  const user = await requireUser(`/bookings/${id}`);
  const found = await bookingFor(id, user.id);
  if (!found) notFound();
  const { booking, role } = found;
  // A host never sees a request that was not sent to them: one still at the card step, or given up there.
  const testCall = booking.source === "admin";
  if (role === "host" && (booking.stage === "card" || (!booking.requestedAt && !testCall))) notFound();
  // Nor a member's booking that was never made (it reserved nothing of hers).
  const byMember = booking.source === "member";
  if (role === "host" && byMember && !booking.callId) notFound();
  const notice = readNotice(`/bookings/${id}`, await props.searchParams);

  const [other] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, role === "host" ? booking.customerId : booking.hostId));
  const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, booking.hostId));
  const otherName = role === "host" ? other?.name : (profile?.displayName ?? other?.name);
  const paid = booking.totalCents > 0;
  // For the host deciding: how other hosts have rated this customer, and the host's own private note about them.
  const showRating = role === "host" && !testCall;
  const customerRating = showRating ? await averageFor(booking.customerId, "customer", new Date()) : null;
  const idConfirmed = showRating && (await identityState(booking.customerId)).passed;
  const note = role === "host" ? await hostNoteAbout(booking.hostId, booking.customerId) : null;
  // For the host: the customer's photo (plans/35). The id only; the photo's own address decides whether this host gets it.
  const customerPhotoId = role === "host" ? ((await photosOf([booking.customerId])).get(booking.customerId) ?? null) : null;

  // The card form, for a paid request that has not been sent yet.
  let clientSecret: string | null = null;
  if (role === "customer" && booking.stage === "card" && booking.stripeSetupIntentId) {
    clientSecret = await stripe()
      .setupIntents.retrieve(booking.stripeSetupIntentId)
      .then((setup) => setup.client_secret)
      .catch((error) => {
        console.error(`[bookings] could not load the card form for booking ${booking.id}`, error);
        return null;
      });
  }

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
          {byMember ? (role === "host" ? `Call with ${otherName}` : `Your call with ${otherName}`) : role === "host" ? `Request from ${otherName}` : `Your request to ${otherName}`}
        </h1>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <p className="mt-4 font-medium">
        {(byMember ? (role === "host" ? MEMBER_STAGE_FOR_HOST : MEMBER_STAGE_FOR_CUSTOMER) : role === "host" ? STAGE_FOR_HOST : STAGE_FOR_CUSTOMER)[booking.stage] ?? booking.stage}
      </p>
      {role === "customer" && booking.stage === "ran_out" && booking.endedReason && (
        <p className="mt-1 text-sm opacity-70">{byMember ? `${booking.endedReason} No membership time was used for it.` : `Reason: ${booking.endedReason.replace(/\.$/, "")}.`}</p>
      )}
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
          <dt className="opacity-70">{byMember ? "Paid from the membership" : "Price"}</dt>
          <dd className="font-medium">
            {byMember ? `${booking.lengthMinutes} minutes of membership time (${formatMoney(booking.totalCents)} at most)` : paid ? `${formatMoney(booking.totalCents)} at most` : "Free"}
          </dd>
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
            <dt className="opacity-70">{role === "host" ? "Answer by" : "You will hear by"}</dt>
            <dd className="font-medium">
              <LocalTime iso={booking.respondBy.toISOString()} />
            </dd>
          </div>
        )}
      </dl>

      {role === "customer" && booking.stage === "card" && clientSecret && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Your card</h2>
          <p className="mt-1 text-sm opacity-70">
            Nothing is held or charged now. Your card is kept by Stripe for this booking only. The request is sent as soon as the card is saved.
          </p>
          <CardStep bookingId={booking.id} clientSecret={clientSecret} publishableKey={stripePublishableKey()} />
        </section>
      )}

      {role === "customer" && booking.stage === "card" && !clientSecret && (
        <section className="mt-6 text-sm">
          <p role="alert">The card form could not be loaded just now. Nothing was sent and nothing is held.</p>
          <p className="mt-2">
            Reload this page in a moment, or{" "}
            <Link href={profile ? `/h/${profile.handle}` : "/"} className="underline underline-offset-2">
              choose the time again
            </Link>
            . An unfinished request disappears by itself.
          </p>
        </section>
      )}

      {role === "customer" && booking.stage === "waiting" && (
        <>
          {booking.source === "now" && booking.respondBy ? (
            <NowWaiting bookingId={booking.id} respondBy={booking.respondBy.toISOString()} hostName={otherName ?? "the host"} />
          ) : (
            <p className="mt-6 text-sm opacity-70">
              This is a request, not a reservation. Other people may ask for the same time, and the host chooses.
              {paid ? " Nothing is held on your card unless you are accepted." : ""}
            </p>
          )}
          <form action={takeBackAction} className="mt-4">
            <input type="hidden" name="id" value={booking.id} />
            <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 text-sm">
              Take this request back
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
            Open the call&apos;s page
          </Link>
          {role === "customer" && paid && !byMember && booking.stage === "accepted" && " (this is also where you can pay by hand if your card needs attention)"}
          {role === "customer" && byMember && booking.stage === "accepted" && " (this is also where you can cancel it)"}
        </p>
      )}
    </SitePage>
  );
}
