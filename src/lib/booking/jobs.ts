/**
 * The work the always-on helper does for bookings, every few seconds:
 *   - drop paid requests whose card was never entered,
 *   - end requests the host did not answer in time,
 *   - tell hosts about new requests (at most one email an hour each),
 *   - place the hold on the saved card when its time comes (one try),
 *   - tell the customer when that try did not work,
 *   - cancel, for free, bookings whose money is not held by the cut-off,
 *   - remove saved cards from Stripe once they are no longer needed.
 *
 * Each job is safe to run again and again, and on two helpers at once.
 */
import { and, eq, gt, inArray, isNotNull, isNull, like, lte, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { queueEmail } from "@/lib/email";
import { cancelCall } from "@/lib/payments/cancel";
import { placeHoldWithSavedCard, syncHold } from "@/lib/payments/hold";
import { OutcomeUnknownError } from "@/lib/payments/operations";
import { payOpensAt } from "@/lib/payments/rules";
import { stripe, stripeConfigured } from "@/lib/payments/stripe";
import { endUnanswered, endUnfinishedCardSteps } from "./bookings";
import { queueBookingEmails, whenFor } from "./emails";

const HOUR = 3_600_000;

function log(message: string, error?: unknown) {
  if (error) console.error(`[bookings] ${message}`, error);
  else console.log(`[bookings] ${message}`);
}

/** One email per host, at most once an hour, covering every request they have not been told about. */
async function tellHostsAboutNewRequests(now: Date): Promise<void> {
  const hosts = await db
    .selectDistinct({ hostId: schema.bookings.hostId })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.stage, "waiting"), isNull(schema.bookings.hostNotifiedAt)));
  for (const { hostId } of hosts) {
    await db.transaction(async (tx) => {
      const [recent] = await tx
        .select({ id: schema.emailOutbox.id })
        .from(schema.emailOutbox)
        .where(and(like(schema.emailOutbox.dedupeKey, `requests:${hostId}:%`), gt(schema.emailOutbox.createdAt, new Date(now.getTime() - HOUR))))
        .limit(1);
      if (recent) return;
      const fresh = await tx
        .update(schema.bookings)
        .set({ hostNotifiedAt: now })
        .where(and(eq(schema.bookings.hostId, hostId), eq(schema.bookings.stage, "waiting"), isNull(schema.bookings.hostNotifiedAt)))
        .returning({ respondBy: schema.bookings.respondBy });
      if (fresh.length === 0) return;
      const [host] = await tx.select().from(schema.user).where(eq(schema.user.id, hostId));
      const soonest = fresh.map((b) => b.respondBy).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
      const base = (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
      await queueEmail(tx, {
        to: host.email,
        subject: fresh.length === 1 ? "You have a new call request" : `You have ${fresh.length} new call requests`,
        text: [
          `Hi ${host.name},`,
          "",
          fresh.length === 1 ? "Someone has asked you for a call." : `${fresh.length} people have asked you for a call.`,
          soonest ? `The first one needs your answer by ${whenFor(host, soonest)}. A request you do not answer in time ends by itself.` : "",
          "Several people may ask for the same time. You choose who you take.",
          "",
          `${base}/host/requests`,
        ].join("\n"),
        key: `requests:${hostId}:${now.getTime()}`,
      });
    });
  }
}

/** Accepted, paid bookings whose money is not held yet, joined with their call and payment. */
function unpaidBookings() {
  return db
    .select({ booking: schema.bookings, call: schema.calls, payment: schema.payments })
    .from(schema.bookings)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.bookings.callId))
    .innerJoin(schema.payments, eq(schema.payments.callId, schema.calls.id))
    .where(
      and(
        eq(schema.bookings.stage, "accepted"),
        eq(schema.bookings.source, "customer"),
        eq(schema.payments.status, "awaiting_payment"),
        isNull(schema.calls.cancelledAt),
      ),
    )
    .$dynamic();
}

async function actionInFlight(paymentId: string): Promise<boolean> {
  const [op] = await db
    .select({ id: schema.moneyOperations.id })
    .from(schema.moneyOperations)
    .where(and(eq(schema.moneyOperations.paymentId, paymentId), eq(schema.moneyOperations.status, "started")))
    .limit(1);
  return Boolean(op);
}

/** Records that the saved card did not work, and tells the customer how to fix it. Once per booking. */
async function noteHoldFailed(bookingId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [booking] = await tx
      .update(schema.bookings)
      .set({ holdFailedAt: now })
      .where(and(eq(schema.bookings.id, bookingId), isNull(schema.bookings.holdFailedAt)))
      .returning();
    if (booking) await queueBookingEmails(tx, booking, "card_problem");
  });
}

/** Two days before the call (or at once, if it is sooner), try the saved card. One try per booking, ever. */
async function placeHolds(now: Date): Promise<void> {
  const due = await unpaidBookings().where(
    and(
      eq(schema.bookings.stage, "accepted"),
      eq(schema.bookings.source, "customer"),
      eq(schema.payments.status, "awaiting_payment"),
      isNull(schema.calls.cancelledAt),
      isNull(schema.bookings.holdTriedAt),
      isNotNull(schema.bookings.stripePaymentMethodId),
      gt(schema.calls.startsAt, now),
      gt(schema.bookings.payBy, now),
    ),
  );
  for (const { booking, call, payment } of due) {
    if (payOpensAt(call.startsAt) > now) continue;
    // Claim the one try before making it, so two helpers cannot both make it.
    const claimed = await db
      .update(schema.bookings)
      .set({ holdTriedAt: now })
      .where(and(eq(schema.bookings.id, booking.id), isNull(schema.bookings.holdTriedAt)))
      .returning({ id: schema.bookings.id });
    if (claimed.length === 0) continue;
    try {
      const [customer] = await db.select().from(schema.user).where(eq(schema.user.id, booking.customerId));
      const result = await placeHoldWithSavedCard({ payment, call, customer, paymentMethodId: booking.stripePaymentMethodId!, now });
      if (result === "held") log(`hold placed for booking ${booking.id}`);
      else {
        await noteHoldFailed(booking.id, now);
        log(`the saved card did not work for booking ${booking.id}; the customer was told`);
      }
    } catch (error) {
      // Not known yet whether it worked. The payments helper finds out; noteUnsettledTries() follows up.
      if (error instanceof OutcomeUnknownError) log(`hold for booking ${booking.id} is being checked with Stripe`);
      else log(`could not try the saved card for booking ${booking.id}`, error);
    }
  }
}

/** A try whose outcome was unknown at first, and has since turned out not to have worked. */
async function noteUnsettledTries(now: Date): Promise<void> {
  const tried = await unpaidBookings().where(
    and(
      eq(schema.bookings.stage, "accepted"),
      eq(schema.bookings.source, "customer"),
      eq(schema.payments.status, "awaiting_payment"),
      isNull(schema.calls.cancelledAt),
      isNull(schema.bookings.holdFailedAt),
      lte(schema.bookings.holdTriedAt, new Date(now.getTime() - 2 * 60_000)),
    ),
  );
  for (const { booking, payment } of tried) {
    if (await actionInFlight(payment.id)) continue;
    const synced = await syncHold(payment.id, now).catch(() => null);
    if (synced && synced.status === "awaiting_payment") await noteHoldFailed(booking.id, now);
  }
}

/** Money not held by the cut-off: the booking is cancelled for free and both people are told. */
async function cancelUnpaidAtCutoff(now: Date): Promise<void> {
  const late = await unpaidBookings().where(
    and(
      eq(schema.bookings.stage, "accepted"),
      eq(schema.bookings.source, "customer"),
      eq(schema.payments.status, "awaiting_payment"),
      isNull(schema.calls.cancelledAt),
      lte(schema.bookings.payBy, now),
    ),
  );
  for (const { booking, call, payment } of late) {
    try {
      if (await actionInFlight(payment.id)) continue; // a try is still being checked: wait for the answer
      // Ask Stripe one last time, so a hold that did go through is never thrown away.
      const synced = payment.stripePaymentIntentId ? await syncHold(payment.id, now) : payment;
      if (synced.status !== "awaiting_payment") continue;
      await cancelCall({ call, payment: synced, by: "admin", now, reason: "unpaid" });
      log(`booking ${booking.id} was cancelled: the money was not held in time`);
    } catch (error) {
      log(`could not cancel unpaid booking ${booking.id}; will retry`, error);
    }
  }
}

/** A saved card is for one booking only. Once the booking no longer needs it, it is removed from Stripe. */
async function removeSavedCards(): Promise<void> {
  const done = await db
    .select({ booking: schema.bookings, paymentStatus: schema.payments.status })
    .from(schema.bookings)
    .leftJoin(schema.payments, eq(schema.payments.callId, schema.bookings.callId))
    .where(
      and(
        isNotNull(schema.bookings.stripeSetupIntentId),
        or(
          inArray(schema.bookings.stage, ["declined", "passed_over", "ran_out", "taken_back", "cancelled"]),
          and(eq(schema.bookings.stage, "accepted"), ne(schema.payments.status, "awaiting_payment")),
        ),
      ),
    )
    .limit(25);
  for (const { booking } of done) {
    try {
      const setup = await stripe().setupIntents.retrieve(booking.stripeSetupIntentId!);
      const saved = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method?.id;
      if (setup.status !== "succeeded" && setup.status !== "canceled") await stripe().setupIntents.cancel(setup.id);
      if (saved) {
        await stripe()
          .paymentMethods.detach(saved)
          .catch((error: { code?: string }) => {
            // Already removed is fine.
            if (error?.code !== "resource_missing" && error?.code !== "payment_method_unexpected_state") throw error;
          });
      }
      await db.update(schema.bookings).set({ stripeSetupIntentId: null, stripePaymentMethodId: null }).where(eq(schema.bookings.id, booking.id));
    } catch (error) {
      log(`could not remove the saved card of booking ${booking.id}; will retry`, error);
    }
  }
}

/** Everything the helper does for bookings in one pass. One job failing does not stop the others. */
export async function runBookingJobs(now: Date): Promise<void> {
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ["unfinished card steps", () => endUnfinishedCardSteps(now)],
    ["unanswered requests", () => endUnanswered(now)],
    ["telling hosts", () => tellHostsAboutNewRequests(now)],
  ];
  if (stripeConfigured()) {
    jobs.push(
      ["placing holds", () => placeHolds(now)],
      ["checking tries", () => noteUnsettledTries(now)],
      ["unpaid at the cut-off", () => cancelUnpaidAtCutoff(now)],
      ["removing saved cards", () => removeSavedCards()],
    );
  }
  for (const [name, job] of jobs) {
    try {
      await job();
    } catch (error) {
      log(`job "${name}" failed; will retry`, error);
    }
  }
}
