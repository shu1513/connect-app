/**
 * "Available now": a host says they can take a call right away, for a while,
 * and keeps their page open. Customers on their page see it and can ask for a
 * call that starts within minutes. Everything that creates or answers such a
 * request is in bookings.ts; this file is the switch, the sign of life, and
 * what the live pages read.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { BookingError, offerOf } from "./bookings";
import { isAvailableNow, NOW } from "./now-rules";

export type AvailabilityState = { availableUntil: string | null; on: boolean };

function stateOf(calendar: { availableUntil: Date | null; availableSeenAt: Date | null } | undefined, now: Date): AvailabilityState {
  const on = Boolean(calendar && isAvailableNow(calendar, now));
  return { availableUntil: on ? calendar!.availableUntil!.toISOString() : null, on };
}

/** Switches "available now" on for a while, or off. Only a host who can be booked at all can switch it on. */
export async function setAvailableNow(input: { hostId: string; minutes: number | null; now: Date }): Promise<AvailabilityState> {
  const { hostId, now } = input;
  if (input.minutes !== null) {
    if (!(NOW.durations as readonly number[]).includes(input.minutes)) throw new BookingError("Choose one of the offered durations.");
    const offer = await offerOf(hostId);
    if (!offer) throw new BookingError("Your profile must be approved, with a calendar set up, before you can be available now.");
    if (!offer.canTakePaid) throw new BookingError("Finish your payout setup before you can be available now.");
  }
  const until = input.minutes === null ? null : new Date(now.getTime() + input.minutes * 60_000);
  const [calendar] = await db
    .update(schema.hostCalendars)
    .set({ availableUntil: until, availableSeenAt: until ? now : null, updatedAt: now })
    .where(eq(schema.hostCalendars.userId, hostId))
    .returning();
  return stateOf(calendar, now);
}

/** The host's page saying "still here". Does nothing once the time has run out or availability was switched off. */
export async function stillHere(hostId: string, now: Date): Promise<AvailabilityState> {
  const [calendar] = await db
    .update(schema.hostCalendars)
    .set({ availableSeenAt: now })
    .where(and(eq(schema.hostCalendars.userId, hostId), gt(schema.hostCalendars.availableUntil, now)))
    .returning();
  if (calendar) return stateOf(calendar, now);
  const [current] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hostId));
  return stateOf(current, now);
}

/** What the host's live page shows: their availability and the instant requests waiting for them. */
export async function liveForHost(hostId: string, now: Date) {
  const [calendar] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hostId));
  const waiting = await db
    .select({ booking: schema.bookings, customerName: schema.user.name })
    .from(schema.bookings)
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.customerId))
    .where(and(eq(schema.bookings.hostId, hostId), eq(schema.bookings.source, "now"), eq(schema.bookings.stage, "waiting")))
    .orderBy(asc(schema.bookings.requestedAt));
  return {
    ...stateOf(calendar, now),
    requests: waiting.map(({ booking, customerName }) => ({
      id: booking.id,
      customerName,
      lengthMinutes: booking.lengthMinutes,
      totalCents: booking.totalCents,
      respondBy: booking.respondBy!.toISOString(),
    })),
  };
}

/** What the customer's waiting page shows: where their instant request stands. */
export async function liveForCustomer(bookingId: string, customerId: string) {
  const [booking] = await db
    .select({ stage: schema.bookings.stage, callId: schema.bookings.callId, respondBy: schema.bookings.respondBy, endedReason: schema.bookings.endedReason, source: schema.bookings.source })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.customerId, customerId), inArray(schema.bookings.source, ["now"])));
  if (!booking) return null;
  return { stage: booking.stage, callId: booking.callId, respondBy: booking.respondBy?.toISOString() ?? null, endedReason: booking.endedReason };
}
