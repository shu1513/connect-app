/**
 * What one call's page shows before the call, gathered once for the website's page and for the
 * phone app (plans/45-phone-apps/08-the-calls-page.md): the call, which of its two people is
 * looking, where its payment stands, and what cancelling right now would mean.
 */
import "server-only";
import { monthIsFrozen } from "@/lib/membership/calls";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { wholeBookingSaid } from "@/lib/booking/rules";
import type { Call, Payment } from "@/db/schema";
import { hostNoteAbout } from "@/lib/people/contacts";
import { callForParticipant, formatMoney } from "@/lib/payments/access";
import { cancelOutcomeFor } from "@/lib/payments/cancel";
import { mayActWith } from "@/lib/safety/may-act";
import { syncHold } from "@/lib/payments/hold";
import { paymentBlocksJoin, payWindow, type CancellationOutcome } from "@/lib/payments/rules";

/** The hold may land any second when the call is this close: the page then follows it by itself. */
const FOLLOW_WITHIN_MS = 10 * 60_000;

export type CallPageState =
  /** Cancelled, or ended with a report: nothing more happens here. */
  | "cancelled"
  | "ended"
  /** The customer, with the money not yet held: more than 2 days ahead, or able to confirm and pay now. */
  | "too_early"
  | "pay"
  /** The host, while the customer has not paid. */
  | "host_waits"
  /** The payment is no longer in place (the hold ran out, or the call is over unpaid). */
  | "blocked"
  /** Nothing stands in the way: the countdown, and then the room. */
  | "room";

export type CallPage = {
  call: Call;
  role: "host" | "customer";
  /** The call's own payment; null for a free call. */
  payment: Payment | null;
  /** The other person, as the one looking knows them: a host by the name on their page. */
  otherName: string | null;
  /** For the host: her own note about this customer, to read while waiting (plans/32). Null for the customer. */
  about: Awaited<ReturnType<typeof hostNoteAbout>> | null;
  /** "$40.00": what the call's own payment is for; null for a free call. */
  bookedPrice: string | null;
  pricePer15: string | null;
  /** The most the whole call can cost: grows when time is added during the call. */
  upTo: string | null;
  /** What cancelling right now would mean for the person looking. */
  cancel: CancellationOutcome;
  /** A member's call whose month is frozen (its payment disputed at the bank): cancelling moves none of its time. */
  memberFrozen: boolean;
  state: CallPageState;
  /**
   * This call's booking was made under words that say what "End call now" costs a customer: his whole booked
   * time (plans/51-end-call-now.md). Only then is it charged that way, and only then does the button's question say so.
   */
  wholeBookingSaid: boolean;
  /** The hold may land any second (an instant call's saved card, a booked call about to start). */
  follows: boolean;
};

/**
 * The page of one call, for one of its two people; null for anyone else, whether or not the call
 * exists. With `sync`, a hold that is waiting is first asked about at Stripe (coming back from a
 * bank's approval, or reloading): the website's page does that as it loads, the phone app asks
 * for it as a step of its own, so that reading its page only ever reads.
 */
export async function gatherCallPage(userId: string, callId: string, now: Date, options: { sync: boolean }): Promise<CallPage | null> {
  const access = await callForParticipant(callId, userId);
  if (!access) return null;
  const { call, role } = access;
  let { payment } = access;
  if (options.sync && payment?.status === "awaiting_payment" && payment.stripePaymentIntentId) {
    payment = await syncHold(payment.id, now).catch(() => payment);
  }

  const otherId = role === "host" ? call.customerId : call.hostId;
  const [person] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, otherId));
  // A customer knows their host by the display name on the host's page, never by the host's account name.
  const [hostProfile] = role === "customer" ? await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId)) : [];
  // The host's own note about this customer. Fetched only for the host, with the person looking as the host:
  // nothing of it is in what the customer gets.
  // Withheld while the customer's details are (src/lib/home/customer-details.ts): his account paused or closed, or a
  // block between the two, with the host's own pause set aside. So the call's page and the room hand out nothing
  // that her lists hold back.
  const about = role === "host" && (await mayActWith(userId, [call.customerId], db, { ownPauseAside: true })).has(call.customerId) ? await hostNoteAbout(userId, call.customerId) : null;
  const bookedPrice = payment ? formatMoney(payment.bookedCents) : null;
  // The booking's total grows when time is added during the call; the call's own payment (the figure above, used
  // for paying and cancelling before the call) does not.
  const [booking] = payment ? await db.select({ totalCents: schema.bookings.totalCents, cardConsentVersion: schema.bookings.cardConsentVersion }).from(schema.bookings).where(eq(schema.bookings.callId, call.id)) : [];

  // The very question the step that cancels asks, so the page never says one thing and the cancelling does another:
  // free also past the free period when the call's two people may no longer act.
  const cancel = await cancelOutcomeFor(db, { call, by: role, now, held: payment?.status === "held" });
  // The call's own hold against its own stretch (see the join check): the call's end moves when time is added.
  const blocked = paymentBlocksJoin({ payment, callEndsAt: payment?.coversUntil ?? call.endsAt, now });
  const unpaid = Boolean(payment) && blocked === "not_paid" && payment?.status === "awaiting_payment";
  const state: CallPageState = call.cancelledAt
    ? "cancelled"
    : call.safetyEndedAt
      ? "ended"
      : unpaid
        ? role === "host"
          ? "host_waits"
          : payWindow({ now, startsAt: call.startsAt, endsAt: call.endsAt }) === "too_early"
            ? "too_early"
            : "pay"
        : blocked
          ? "blocked"
          : "room";
  return {
    call,
    role,
    payment,
    // A customer knows the host by the name on her page, and by nothing else: never by her account name.
    otherName: role === "customer" ? (hostProfile?.displayName ?? null) : (person?.name ?? null),
    about,
    bookedPrice,
    pricePer15: payment ? formatMoney(payment.pricePer15Cents) : null,
    upTo: payment ? formatMoney(booking?.totalCents ?? payment.bookedCents) : null,
    cancel,
    wholeBookingSaid: wholeBookingSaid(booking?.cardConsentVersion),
    memberFrozen: payment?.kind === "member_call" && payment.monthId !== null && (await monthIsFrozen(payment.monthId)),
    state,
    follows: unpaid && (call.billing === "together" || call.startsAt.getTime() - now.getTime() < FOLLOW_WITHIN_MS),
  };
}
