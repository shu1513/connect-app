/**
 * "Available now": a host says they can take a call right away, for a while,
 * and keeps their page open. Customers on their page see it and can ask for a
 * call that starts within minutes. Everything that creates or answers such a
 * request is in bookings.ts; this file is the switch, the sign of life, and
 * what the live pages read.
 */
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { BookingError, endInstantRequestsOfAbsentHosts, lockCalendars, offerOf } from "./bookings";
import { isAvailableNow, NOW } from "./now-rules";

export type AvailabilityState = { availableUntil: string | null; on: boolean };

function stateOf(calendar: { availableUntil: Date | null; availableSeenAt: Date | null } | undefined, now: Date): AvailabilityState {
  const on = Boolean(calendar && isAvailableNow(calendar, now));
  return { availableUntil: on ? calendar!.availableUntil!.toISOString() : null, on };
}

/**
 * Switches "available now" on for a while, or off. Only a host who can be booked at all can switch it on.
 * `onlyPeriodUntil` is for the page saying "gone" as it closes: that message may arrive late, after the
 * host has reloaded and switched on again, so it ends only the availability period it came from
 * (a period is known by the moment it runs until).
 */
export async function setAvailableNow(input: { hostId: string; minutes: number | null; now: Date; onlyPeriodUntil?: Date }): Promise<AvailabilityState> {
  const { hostId, now } = input;
  if (input.minutes !== null) {
    if (!(NOW.durations as readonly number[]).includes(input.minutes)) throw new BookingError("Choose one of the offered durations.");
    const offer = await offerOf(hostId);
    if (!offer) throw new BookingError("Your profile must be approved, with a calendar set up, before you can be available now.");
    if (!offer.canTakePaid) throw new BookingError("Finish your payout setup before you can be available now.");
  }
  const until = input.minutes === null ? null : new Date(now.getTime() + input.minutes * 60_000);
  // Every change to a host's availability is made under their calendar lock, one after the other,
  // so a late sign of life can never undo a switch-on, and the clean-up below sees a settled state.
  const calendar = await db.transaction(async (tx) => {
    await lockCalendars(tx, [hostId]);
    const [row] = await tx
      .update(schema.hostCalendars)
      .set({ availableUntil: until, availableSeenAt: until ? now : null, updatedAt: now })
      .where(and(eq(schema.hostCalendars.userId, hostId), !until && input.onlyPeriodUntil ? eq(schema.hostCalendars.availableUntil, input.onlyPeriodUntil) : undefined))
      .returning();
    return row;
  });
  if (!calendar) {
    // A late "gone" from a period that is already over: nothing to end. Say how things stand now.
    const [current] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hostId));
    return stateOf(current, now);
  }
  // Switched off (the button, or the page closing): anyone still waiting for an answer is told at once.
  if (!until) await endInstantRequestsOfAbsentHosts(now, hostId);
  return stateOf(calendar, now);
}

/**
 * The host's page saying "still here". Counts only while availability is on
 * and the last sign of life is recent: after a lapse (the tab slept, the
 * connection dropped) availability is over, and the host switches it on again.
 */
export async function stillHere(hostId: string, now: Date): Promise<AvailabilityState> {
  const recent = new Date(now.getTime() - NOW.presenceSeconds * 1000);
  // Renewing, or finding it lapsed and clearing it, is one step under the host's calendar lock:
  // a switch-on that lands in between is either seen (and renewed) or comes wholly after.
  const { calendar, lapsed } = await db.transaction(async (tx) => {
    await lockCalendars(tx, [hostId]);
    const [renewed] = await tx
      .update(schema.hostCalendars)
      // Never moved back: this sign of life may have waited for the lock behind a newer one (or a switch-on).
      .set({ availableSeenAt: sql`greatest(${schema.hostCalendars.availableSeenAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(eq(schema.hostCalendars.userId, hostId), gt(schema.hostCalendars.availableUntil, now), gt(schema.hostCalendars.availableSeenAt, recent)))
      .returning();
    if (renewed) return { calendar: renewed, lapsed: false };
    // Lapsed or over: make the switch-off explicit, so nothing later can revive it.
    const [cleared] = await tx.update(schema.hostCalendars).set({ availableUntil: null, availableSeenAt: null }).where(eq(schema.hostCalendars.userId, hostId)).returning();
    return { calendar: cleared, lapsed: true };
  });
  if (lapsed) await endInstantRequestsOfAbsentHosts(now, hostId);
  return stateOf(calendar, now);
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
