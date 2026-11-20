/**
 * What the page of one request for a call shows, gathered once for the website's page and for the
 * phone app (plans/45-phone-apps/06-asking-for-a-call.md): the request, which of its two people
 * is looking, and what that person may know about the other.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hostNoteAbout } from "@/lib/people/contacts";
import { stripe } from "@/lib/payments/stripe";
import { photosForHost } from "@/lib/profiles/photo";
import { averageFor } from "@/lib/ratings/ratings";
import { identityState } from "@/lib/safety/identity";
import { bookingFor, cardStepOf } from "./bookings";

type Found = NonNullable<Awaited<ReturnType<typeof bookingFor>>>;

export type RequestPage = Found & {
  /** A booking a member made with their membership time. */
  byMember: boolean;
  /** A founder's test call. */
  testCall: boolean;
  paid: boolean;
  /** The other person, as the one looking knows them: a host by the name on their page. */
  otherName: string | undefined;
  /** The host's page, if they have one. */
  hostHandle: string | null;
  /** For the host deciding: how other hosts have rated this customer; null for the customer, and for a test call. */
  customerRating: Awaited<ReturnType<typeof averageFor>> | null;
  showRating: boolean;
  /** For the host: the customer has passed the identity check. Only a yes or no. */
  idConfirmed: boolean;
  /** For the host: their own private note about this customer. */
  note: Awaited<ReturnType<typeof hostNoteAbout>> | null;
  /** For the host: the customer's photo, only if this host is handed it. */
  customerPhotoId: string | null;
};

/** The request, for one of its two people; null for anyone else, and for a host who was never sent it. */
export async function gatherRequest(userId: string, bookingId: string, now: Date): Promise<RequestPage | null> {
  const found = await bookingFor(bookingId, userId);
  if (!found) return null;
  const { booking, role } = found;
  // A host never sees a request that was not sent to them: one still at the card step, or given up there.
  const testCall = booking.source === "admin";
  if (role === "host" && (booking.stage === "card" || (!booking.requestedAt && !testCall))) return null;
  // Nor a member's booking that was never made (it reserved nothing of hers).
  const byMember = booking.source === "member";
  if (role === "host" && byMember && !booking.callId) return null;

  const [other] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, role === "host" ? booking.customerId : booking.hostId));
  const [profile] = await db.select({ handle: schema.hostProfiles.handle, displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, booking.hostId));
  // For the host deciding: how other hosts have rated this customer, and the host's own private note about them.
  const showRating = role === "host" && !testCall;
  return {
    booking,
    role,
    byMember,
    testCall,
    paid: booking.totalCents > 0,
    otherName: role === "host" ? other?.name : (profile?.displayName ?? other?.name),
    hostHandle: profile?.handle ?? null,
    showRating,
    customerRating: showRating ? await averageFor(booking.customerId, "customer", now) : null,
    idConfirmed: showRating && (await identityState(booking.customerId)).passed,
    note: role === "host" ? await hostNoteAbout(booking.hostId, booking.customerId) : null,
    // The id only, and only if this host is handed that photo: a host who was blocked, or a founder's test call,
    // learns nothing about it here.
    customerPhotoId: role === "host" ? ((await photosForHost(booking.hostId, [booking.customerId])).get(booking.customerId) ?? null) : null,
  };
}

/**
 * What Stripe's card form needs for a paid request that is still at its card step; null when it
 * could not be read just now (nothing was sent, and nothing is held).
 */
export async function cardFormSecret(booking: { id: string; stripeSetupIntentId: string | null }, customer: { id: string; name: string; email: string }, now: Date): Promise<string | null> {
  if (!booking.stripeSetupIntentId) {
    // The request was written down, but its card step could not be made at Stripe then. It is made now (once: the
    // same step however often the page is opened), so the page is not stuck saying "reload".
    return cardStepOf({ bookingId: booking.id, customer, now })
      .then((step) => step?.clientSecret ?? null)
      .catch((error) => {
        console.error(`[bookings] could not make the card step for booking ${booking.id}`, error);
        return null;
      });
  }
  return stripe()
    .setupIntents.retrieve(booking.stripeSetupIntentId)
    .then((setup) => setup.client_secret)
    .catch((error) => {
      console.error(`[bookings] could not load the card form for booking ${booking.id}`, error);
      return null;
    });
}
