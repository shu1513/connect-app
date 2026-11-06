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
import { acceptAction, declineAction, takeBackAction } from "./actions";
import { CardStep } from "./card-step";
import { NowWaiting } from "./now-waiting";
import { BlockButton } from "@/components/block-button";

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
  const user = await requireUser();
  const { id } = await props.params;
  const found = await bookingFor(id, user.id);
  // A host never sees a request that has not been sent to them yet.
  if (!found || (found.role === "host" && found.booking.stage === "card")) notFound();
  const { booking, role } = found;
  const notice = readNotice(`/bookings/${id}`, await props.searchParams);

  const [other] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, role === "host" ? booking.customerId : booking.hostId));
  const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, booking.hostId));
  const otherName = role === "host" ? other?.name : (profile?.displayName ?? other?.name);
  const paid = booking.totalCents > 0;

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
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-sm">
        <Link href={role === "host" ? "/host/requests" : "/"} className="underline underline-offset-2">
          ← {role === "host" ? "Your requests" : "Your calls"}
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">{role === "host" ? `Request from ${otherName}` : `Your request to ${otherName}`}</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <p className="mt-4 font-medium">{(role === "host" ? STAGE_FOR_HOST : STAGE_FOR_CUSTOMER)[booking.stage] ?? booking.stage}</p>
      {role === "customer" && booking.stage === "ran_out" && booking.endedReason && <p className="mt-1 text-sm opacity-70">Reason: {booking.endedReason}.</p>}

      <dl className="mt-6 space-y-2 text-sm">
        <div>
          <dt className="opacity-70">When</dt>
          <dd className="font-medium">
            <LocalTime iso={booking.startsAt.toISOString()} /> ({booking.lengthMinutes} minutes)
          </dd>
        </div>
        <div>
          <dt className="opacity-70">Price</dt>
          <dd className="font-medium">{paid ? `${formatMoney(booking.totalCents)} at most` : "Free"}</dd>
        </div>
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
          {role === "customer" && paid && booking.stage === "accepted" && " (this is also where you can pay by hand if your card needs attention)"}
        </p>
      )}
    </main>
  );
}
