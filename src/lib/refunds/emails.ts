/**
 * The emails around a refund request and a refund. Each is written in the
 * same database step as the thing it reports (see queueEmail), so none is
 * lost or sent twice.
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { whenFor } from "@/lib/booking/emails";
import { queueEmail } from "@/lib/email";

type Writer = Pick<typeof db, "insert" | "select">;
type Person = { id: string; name: string; email: string; timeZone: string | null };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** The host and the customer of a call, with the host's name as customers know it. */
async function peopleOf(tx: Writer, call: { hostId: string; customerId: string }): Promise<{ host: Person; customer: Person; hostName: string } | null> {
  const rows = await tx
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, timeZone: schema.user.timeZone })
    .from(schema.user)
    .where(inArray(schema.user.id, [call.hostId, call.customerId]));
  const host = rows.find((row) => row.id === call.hostId);
  const customer = rows.find((row) => row.id === call.customerId);
  if (!host || !customer) return null;
  const [profile] = await tx.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId));
  return { host, customer, hostName: profile?.displayName ?? host.name };
}

type CallRef = { id: string; hostId: string; customerId: string; startsAt: Date };
const results = (call: CallRef) => `${appUrl()}/calls/${call.id}/results`;
const quoted = (label: string, text: string | null | undefined) => (text?.trim() ? `\n${label}\n"${text.trim()}"\n` : "");

/**
 * To the host, at once: a customer asked for a refund. What the host can do depends on where the money
 * stands: still on hold (with the time by which an answer costs nothing), being decided (under review at
 * Connect, or just being taken), or already taken.
 */
export async function queueRequestEmail(tx: Writer, call: CallRef, request: { id: string; reason: string; note: string }, money: { answerBy: Date } | "being_decided" | "taken"): Promise<void> {
  const found = await peopleOf(tx, call);
  if (!found) return;
  const { host, customer } = found;
  const deadline =
    money === "taken"
      ? "The money for this call has already been taken. You can give a refund, or say no."
      : money === "being_decided"
        ? "The charge for this call is still being decided (its record is under review at Connect, or the money is just being taken), so there is nothing for you to answer yet. The call's page shows when there is."
        : `The money for this call has not been taken yet. If you answer by ${whenFor(host, money.answerBy)}, you can charge in full, charge less, or charge nothing, and no card fee is lost. After that the full amount is taken, and you can still give a refund.`;
  await queueEmail(tx, {
    to: host.email,
    key: `refund-request:${request.id}:host`,
    subject: `${customer.name} asked for a refund`,
    text: `${customer.name} asked for a refund for your call on ${whenFor(host, call.startsAt)}.\n\nReason: ${request.reason === "connection" ? "The connection was bad." : "Something else."}\n${quoted("What they wrote:", request.note)}\n${deadline}\n\nYou cannot collect the money for this call until you have answered.\n\nAnswer here:\n${results(call)}\n`,
  });
}

/** To the host, once, halfway through their time. */
export async function queueRequestReminder(tx: Writer, call: CallRef, request: { id: string }, answerBy: Date): Promise<void> {
  const found = await peopleOf(tx, call);
  if (!found) return;
  await queueEmail(tx, {
    to: found.host.email,
    key: `refund-request:${request.id}:reminder`,
    expiresAt: answerBy,
    subject: `A refund request is waiting for your answer`,
    text: `${found.customer.name} asked for a refund for your call on ${whenFor(found.host, call.startsAt)}, and you have not answered yet.\n\nIf you answer by ${whenFor(found.host, answerBy)}, you can still charge less or nothing without a card fee being lost. After that the full amount is taken.\n\nAnswer here:\n${results(call)}\n`,
  });
}

export type AnswerLine = { label: string; choice: "full" | "less" | "nothing"; maxCents: number | null };

/** To the customer: the answer given before the money was taken. */
export async function queueAnswerEmail(tx: Writer, call: CallRef, request: { id: string }, input: { by: "host" | "admin"; lines: AnswerLine[]; message: string | null }): Promise<void> {
  const found = await peopleOf(tx, call);
  if (!found) return;
  const who = input.by === "admin" ? "Connect" : found.hostName;
  const said = (line: AnswerLine) =>
    line.choice === "nothing" ? "nothing is charged" : line.choice === "less" ? `at most ${money(line.maxCents ?? 0)} is charged` : "the charge stays as the call's record gives it";
  const lines = input.lines.length === 1 ? `Answer: ${said(input.lines[0])}.` : input.lines.map((line) => `- ${line.label}: ${said(line)}.`).join("\n");
  await queueEmail(tx, {
    to: found.customer.email,
    key: `refund-request:${request.id}:answer`,
    subject: `${who} answered your refund request`,
    text: `${who} answered your refund request for the call on ${whenFor(found.customer, call.startsAt)}.\n\n${lines}\n${quoted(`Message from ${who}:`, input.message)}\nThe exact amount is on the call's page:\n${results(call)}\n`,
  });
}

/** To the customer: a "no" given after the money was taken, or the request closed by Connect. */
export async function queueClosedEmail(tx: Writer, call: CallRef, request: { id: string }, input: { how: "declined" | "closed"; by: "host" | "admin"; message: string | null }): Promise<void> {
  const found = await peopleOf(tx, call);
  if (!found) return;
  const who = input.by === "admin" ? "Connect" : found.hostName;
  await queueEmail(tx, {
    to: found.customer.email,
    key: `refund-request:${request.id}:${input.how}`,
    subject: input.how === "declined" ? `${who} answered your refund request` : "Your refund request was closed",
    text: `${input.how === "declined" ? `${who} answered your refund request for the call on ${whenFor(found.customer, call.startsAt)}: no refund is given.` : `Connect closed your refund request for the call on ${whenFor(found.customer, call.startsAt)}. No refund is given through this request.`}\n${quoted(`Message from ${who}:`, input.message)}\nThe call's page:\n${results(call)}\n`,
  });
}

/** To the customer: a refund has gone through, with the message that came with it. */
export async function queueRefundEmail(tx: Writer, refund: { id: string; paymentId: string; amountCents: number; decidedAs: string; reason: string | null }): Promise<void> {
  const [row] = await tx
    .select({ id: schema.calls.id, hostId: schema.calls.hostId, customerId: schema.calls.customerId, startsAt: schema.calls.startsAt })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(eq(schema.payments.id, refund.paymentId));
  const found = row ? await peopleOf(tx, row) : null;
  if (!row || !found) return;
  const who = refund.decidedAs === "admin" ? "Connect" : found.hostName;
  await queueEmail(tx, {
    to: found.customer.email,
    key: `refund:${refund.id}`,
    subject: `A refund of ${money(refund.amountCents)} is on its way to you`,
    text: `${who} refunded ${money(refund.amountCents)} for your call on ${whenFor(found.customer, row.startsAt)}. Your bank usually shows it within 5 to 10 days.\n${quoted(`Message from ${who}:`, refund.reason)}\nThe call's page:\n${results(row)}\n`,
  });
}
