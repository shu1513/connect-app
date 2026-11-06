/**
 * The emails a booking cannot work without. Each is written in the same
 * database step as the event it is about (see queueEmail).
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking } from "@/db/schema";
import { queueEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/terms";

type Writer = Pick<typeof db, "insert" | "select">;
type Person = { id: string; name: string; email: string; timeZone: string | null };

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** A moment written out for one person, in their own time zone. */
export function whenFor(person: { timeZone: string | null }, moment: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: person.timeZone ?? "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(moment);
}

async function people(tx: Writer, ids: string[]): Promise<Map<string, Person>> {
  const rows = await tx
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, timeZone: schema.user.timeZone })
    .from(schema.user)
    .where(inArray(schema.user.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

async function hostName(tx: Writer, hostId: string, fallback: string): Promise<string> {
  const [profile] = await tx.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
  return profile?.displayName ?? fallback;
}

export type BookingEvent =
  | "sent"
  | "accepted"
  | "declined"
  | "passed_over"
  | "ran_out"
  | "card_problem"
  | "cancelled_unpaid"
  | "cancelled_by_host"
  | "cancelled_by_customer"
  | "cancelled_by_connect";

/** Writes the emails for one thing that happened to a booking. */
export async function queueBookingEmails(tx: Writer, booking: Booking, event: BookingEvent): Promise<void> {
  const found = await people(tx, [booking.hostId, booking.customerId]);
  const host = found.get(booking.hostId);
  const customer = found.get(booking.customerId);
  if (!host || !customer) return;
  const hostShown = await hostName(tx, host.id, host.name);
  const length = `${booking.lengthMinutes}-minute`;
  const page = `${appUrl()}/bookings/${booking.id}`;
  const footer = `—\nConnect · questions: ${SUPPORT_EMAIL}`;
  const toCustomer = (subject: string, lines: string[]) =>
    queueEmail(tx, { to: customer.email, subject, text: [`Hi ${customer.name},`, "", ...lines, "", page, "", footer].join("\n"), key: `${event}:${booking.id}:customer` });
  const toHost = (subject: string, lines: string[]) =>
    queueEmail(tx, { to: host.email, subject, text: [`Hi ${host.name},`, "", ...lines, "", page, "", footer].join("\n"), key: `${event}:${booking.id}:host` });
  const whenC = whenFor(customer, booking.startsAt);
  const whenH = whenFor(host, booking.startsAt);

  switch (event) {
    case "sent":
      await toCustomer(`Your request to ${hostShown} was sent`, [
        `You asked ${hostShown} for a ${length} call on ${whenC}.`,
        `This is a request, not a booking yet. Other people may ask for the same time, and ${hostShown} chooses. You will hear by ${whenFor(customer, booking.respondBy ?? booking.startsAt)}.`,
        "Nothing is held on your card unless your request is accepted. You can take the request back for free until then.",
      ]);
      break;
    case "accepted":
      await toCustomer(`${hostShown} accepted your request`, [
        `Your ${length} call with ${hostShown} is booked for ${whenC}.`,
        booking.totalCents > 0
          ? `The booked price of $${(booking.totalCents / 100).toFixed(2)} will be held on your card 2 days before the call (or right away if the call is sooner). You are charged after the call, for the time that counted.`
          : "This call is free.",
      ]);
      await toHost(`You accepted a call with ${customer.name}`, [`Your ${length} call with ${customer.name} is booked for ${whenH}.`]);
      break;
    case "declined":
      await toCustomer(`${hostShown} could not take your request`, [
        `Your request for a ${length} call on ${whenC} was declined. Nothing was held or charged, and your card details have been removed.`,
      ]);
      break;
    case "passed_over":
      await toCustomer(`${hostShown} accepted another request for that time`, [
        `Your request for a ${length} call on ${whenC} cannot go ahead, because ${hostShown} accepted another request that takes that time. Nothing was held or charged, and your card details have been removed.`,
        "You are welcome to ask for a different time.",
      ]);
      break;
    case "ran_out":
      await toCustomer(`Your request to ${hostShown} was not answered in time`, [
        `${hostShown} did not answer your request for a ${length} call on ${whenC} in time, so it has ended. Nothing was held or charged, and your card details have been removed.`,
        "You are welcome to ask again.",
      ]);
      break;
    case "card_problem":
      await toCustomer("Your card needs your attention", [
        `We could not place the hold for your call with ${hostShown} on ${whenC}. Your bank may have refused it, or may want you to approve it.`,
        `Please open the call's page and pay there before ${whenFor(customer, booking.payBy ?? booking.startsAt)}. If the money is not held by then, the booking is cancelled at no cost to you.`,
      ]);
      break;
    case "cancelled_unpaid":
      await toCustomer(`Your call with ${hostShown} was cancelled`, [
        `The hold for your call on ${whenC} could not be placed in time, so the booking was cancelled. Nothing was charged.`,
      ]);
      await toHost(`Your call with ${customer.name} was cancelled`, [
        `The customer's payment for the call on ${whenH} could not be held in time, so the booking was cancelled. That time is open again.`,
      ]);
      break;
    case "cancelled_by_host":
      await toCustomer(`${hostShown} cancelled your call`, [`Your call on ${whenC} was cancelled by ${hostShown}. You pay nothing.`]);
      break;
    case "cancelled_by_customer":
      await toHost(`${customer.name} cancelled their call`, [`The call on ${whenH} was cancelled by ${customer.name}. That time is open again.`]);
      break;
    case "cancelled_by_connect":
      await toCustomer("Your call was cancelled", [`Your call with ${hostShown} on ${whenC} was cancelled by Connect. You pay nothing.`]);
      await toHost("Your call was cancelled", [`Your call with ${customer.name} on ${whenH} was cancelled by Connect.`]);
      break;
  }
}
