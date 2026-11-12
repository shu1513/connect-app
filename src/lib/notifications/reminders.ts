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

/** Which of these reminder keys are already in the outbox (in any state). The unique key still guards two helpers writing at once. */
async function existingKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.select({ key: schema.emailOutbox.dedupeKey }).from(schema.emailOutbox).where(inArray(schema.emailOutbox.dedupeKey, keys));
  return new Set(rows.map((row) => row.key ?? ""));
}

export async function writeCallReminders(now: Date): Promise<number> {
  const soon = await db
    .select({ call: schema.calls, payment: schema.payments, source: schema.bookings.source })
    .from(schema.calls)
    .leftJoin(schema.payments, eq(schema.payments.callId, schema.calls.id))
    .leftJoin(schema.bookings, eq(schema.bookings.callId, schema.calls.id))
    .where(and(gt(schema.calls.startsAt, now), lte(schema.calls.startsAt, new Date(now.getTime() + 24 * HOUR)), isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt)));
  // Test calls made by an admin are not real appointments; calls started just now, and more time agreed
  // during a call, need no reminding: both people are already there.
  const due = soon
    .filter(({ source }) => source !== "admin" && source !== "instant" && source !== "extension")
    .map((row) => ({ ...row, kinds: dueReminders(row.call.startsAt, now) }))
    .filter(({ kinds }) => kinds.length > 0);
  const keyFor = (callId: string, userId: string, kind: string) => `reminder:${callId}:${userId}:${kind}`;
  // Most passes find every due reminder already written. One read says which, instead of a
  // conflicting insert (and the reads before it) for each one, on every pass of the helper.
  const alreadyWritten = await existingKeys(due.flatMap(({ call, kinds }) => [call.hostId, call.customerId].flatMap((userId) => kinds.map((kind) => keyFor(call.id, userId, kind)))));
  let written = 0;
  for (const { call, payment, kinds } of due) {
    const missing = (userId: string) => kinds.filter((kind) => !alreadyWritten.has(keyFor(call.id, userId, kind)));
    if (missing(call.hostId).length === 0 && missing(call.customerId).length === 0) continue;
    const people = await db.select().from(schema.user).where(inArray(schema.user.id, [call.hostId, call.customerId]));
    const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId));
    for (const found of people) {
      if (!found.reminderEmails || found.closedAt || found.pausedAt || missing(found.id).length === 0) continue;
      const person = { ...found, unsubscribeToken: found.unsubscribeToken ?? (await unsubscribeTokenFor(found.id)) };
      const other = people.find((p) => p.id !== person.id);
      const otherName = person.id === call.customerId ? (profile?.displayName ?? other?.name ?? "your host") : (other?.name ?? "your customer");
      const minutes = Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / MINUTE);
      const link = `${appUrl()}/calls/${call.id}`;
      const paidNote =
        payment && person.id === call.customerId
          ? ` You pay for the time ${otherName} is in the call during the booked time (up to ${formatMoney(payment.bookedCents)}), including time they spend waiting for you inside it; the 5 minutes before the start are not counted.`
          : "";
      for (const kind of missing(person.id)) {
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
            key: keyFor(call.id, person.id, kind),
            // A late "Tomorrow" or "In an hour" email would be wrong: each is dropped once its moment has passed.
            expiresAt: kind === "day" ? new Date(call.startsAt.getTime() - 12 * HOUR) : kind === "hour" ? new Date(call.startsAt.getTime() - 5 * MINUTE) : call.endsAt,
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
  const alreadyWritten = await existingKeys(soon.map(({ booking }) => `expiring:${booking.id}`));
  let written = 0;
  for (const { booking, host: found } of soon) {
    if (alreadyWritten.has(`expiring:${booking.id}`)) continue;
    if (!found.reminderEmails || found.closedAt || found.pausedAt) continue;
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
