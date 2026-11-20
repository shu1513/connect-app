/**
 * What a host is shown about the customers of the calls she hosts, on the home page
 * (plans/38-host-home-page.md).
 *
 * Who gets what is decided here, on the server, and nowhere else: the details are made for the
 * calls the database says this person hosts, and only those calls are in the answer. How a row
 * looks ("You host this call") never decides it.
 *
 * Nothing at all about a customer while either has blocked the other, or once the customer's
 * account is closed: such a call can still be on the list (a block cancels only calls that have
 * not started). Nothing for a call made by a check script either.
 *
 * Every field read about a customer is named. Never their email, the name from their ID check,
 * their card, or anything another host knows about them.
 *
 * A fixed number of questions to the database, however many calls; none for someone who hosts none.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { hostNotesAbout, openAndUnblocked, talkedBefore } from "@/lib/people/contacts";
import { photosForHost } from "@/lib/profiles/photo";
import { verifiedAmong } from "@/lib/safety/identity";
import type { CustomerDetails } from "./rules";

export type AboutCall = { details: CustomerDetails; /** The customer's photo, when this host is handed one. */ photoId: string | null };

export async function customerDetailsFor(hostId: string, calls: Array<{ id: string; hostId: string; customerId: string }>, now: Date): Promise<Map<string, AboutCall>> {
  const about = new Map<string, AboutCall>();
  const hosted = calls.filter((call) => call.hostId === hostId && call.customerId !== hostId);
  if (hosted.length === 0) return about;

  // The request each call came from: what the customer wrote, and whether the call is a real one.
  const bookings = await db
    .select({ callId: schema.bookings.callId, words: schema.bookings.note, source: schema.bookings.source })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostId, hostId),
        inArray(
          schema.bookings.callId,
          hosted.map((call) => call.id),
        ),
      ),
    );
  const bookingOf = new Map(bookings.map((booking) => [booking.callId, booking]));
  const real = hosted.filter((call) => {
    const booking = bookingOf.get(call.id);
    return booking && booking.source !== "admin";
  });
  // The whole of it hangs on this: an open account, and no block in either direction.
  const allowed = await openAndUnblocked(
    hostId,
    real.map((call) => call.customerId),
  );
  const shown = real.filter((call) => allowed.has(call.customerId));
  if (shown.length === 0) return about;
  const customers = [...new Set(shown.map((call) => call.customerId))];

  const [idConfirmed, members, before, notes, photos] = await Promise.all([
    verifiedAmong(customers),
    // "Your member": a month is held or running. Not an invitation, a pause or a failed payment.
    db
      .select({ customerId: schema.memberships.customerId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.memberships.customerId, customers), eq(schema.memberships.status, "active"))),
    talkedBefore(hostId, customers, now),
    // The note and the photo each go through their own shared rule as well, which asks more than this file does.
    hostNotesAbout(hostId, customers),
    photosForHost(hostId, customers),
  ]);
  const member = new Set(members.map((row) => row.customerId));

  for (const call of shown) {
    const talked = before.get(call.customerId);
    about.set(call.id, {
      details: {
        words: bookingOf.get(call.id)?.words.trim() ?? "",
        idConfirmed: idConfirmed.has(call.customerId),
        member: member.has(call.customerId),
        callsBefore: talked?.calls ?? 0,
        lastCallAt: talked?.lastCallAt.toISOString() ?? null,
        note: notes.get(call.customerId) ?? null,
      },
      photoId: photos.get(call.customerId) ?? null,
    });
  }
  return about;
}
