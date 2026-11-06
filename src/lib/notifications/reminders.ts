/**
 * Reminder emails: before a call (24 hours, 1 hour, and when the room opens)
 * to both people, and to a host whose request is about to run out. Each is
 * written once per call, person and moment, and only inside its window, so
 * a helper that was down does not send a pile of stale reminders later.
 */
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { whenFor } from "@/lib/booking/emails";
import { queueEmail } from "@/lib/email";
import { formatMoney } from "@/lib/payments/access";
import { dueReminders } from "./reminder-rules";
import { reminderFooter, unsubscribeHeaders, unsubscribeTokenFor } from "./unsubscribe";

const HOUR = 3_600_000;
const MINUTE = 60_000;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function writeCallReminders(now: Date): Promise<number> {
  const soon = await db
    .select({ call: schema.calls, payment: schema.payments })
    .from(schema.calls)
    .leftJoin(schema.payments, eq(schema.payments.callId, schema.calls.id))
    .where(and(gt(schema.calls.startsAt, now), lte(schema.calls.startsAt, new Date(now.getTime() + 24 * HOUR)), isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt)));
  let written = 0;
  for (const { call, payment } of soon) {
    const kinds = dueReminders(call.startsAt, now);
    if (kinds.length === 0) continue;
    const people = await db.select().from(schema.user).where(inArray(schema.user.id, [call.hostId, call.customerId]));
    const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId));
    for (const found of people) {
      if (!found.reminderEmails || found.closedAt) continue;
      const person = { ...found, unsubscribeToken: found.unsubscribeToken ?? (await unsubscribeTokenFor(found.id)) };
      const other = people.find((p) => p.id !== person.id);
      const otherName = person.id === call.customerId ? (profile?.displayName ?? other?.name ?? "your host") : (other?.name ?? "your customer");
      const minutes = Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / MINUTE);
      const link = `${appUrl()}/calls/${call.id}`;
      const paidNote =
        payment && person.id === call.customerId
          ? ` You pay for the time ${otherName} is in the call during the booked time (up to ${formatMoney(payment.bookedCents)}), including time they spend waiting for you inside it; the 5 minutes before the start are not counted.`
          : "";
      for (const kind of kinds) {
        const when = whenFor(person, call.startsAt);
        const subject =
          kind === "open" ? `Your room is open: call with ${otherName}` : kind === "hour" ? `In an hour: your call with ${otherName}` : `Tomorrow: your call with ${otherName}`;
        const lead =
          kind === "open"
            ? `The room for your ${minutes}-minute call with ${otherName} is open now. The call starts at ${when}.`
            : `A reminder: your ${minutes}-minute call with ${otherName} is at ${when}.`;
        await db.transaction((tx) =>
          queueEmail(tx, {
            to: person.email,
            subject,
            text: [`Hi ${person.name},`, "", lead + paidNote, "", `Join here: ${link}`, "", reminderFooter(person)].join("\n"),
            key: `reminder:${call.id}:${person.id}:${kind}`,
            expiresAt: call.endsAt,
            headers: unsubscribeHeaders(person),
          }),
        );
        written++;
      }
    }
  }
  return written;
}

/** A host whose waiting request runs out in about two hours gets one reminder. */
export async function writeRequestReminders(now: Date): Promise<number> {
  const soon = await db
    .select({ booking: schema.bookings, host: schema.user })
    .from(schema.bookings)
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.hostId))
    .where(and(eq(schema.bookings.stage, "waiting"), lte(schema.bookings.respondBy, new Date(now.getTime() + 2 * HOUR)), gt(schema.bookings.respondBy, new Date(now.getTime() + HOUR))));
  let written = 0;
  for (const { booking, host: found } of soon) {
    if (!found.reminderEmails || found.closedAt) continue;
    const host = { ...found, unsubscribeToken: found.unsubscribeToken ?? (await unsubscribeTokenFor(found.id)) };
    await db.transaction((tx) =>
      queueEmail(tx, {
        to: host.email,
        subject: "A request for a call runs out soon",
        text: [
          `Hi ${host.name},`,
          "",
          `A request for a ${booking.lengthMinutes}-minute call on ${whenFor(host, booking.startsAt)} needs your answer by ${whenFor(host, booking.respondBy!)}. If you do not answer by then, it ends by itself.`,
          "",
          `${appUrl()}/host/requests`,
          "",
          reminderFooter(host),
        ].join("\n"),
        key: `expiring:${booking.id}`,
        expiresAt: booking.respondBy!,
        headers: unsubscribeHeaders(host),
      }),
    );
    written++;
  }
  return written;
}
