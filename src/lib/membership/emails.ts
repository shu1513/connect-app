/**
 * The emails that report something that happened to a membership. Each is written in the same
 * database step as the thing it reports (see queueEmail), so none is lost or sent twice.
 *
 * Their links use the addresses fixed in the rulebook (plans/19-memberships.md, "How the parts
 * connect"). Those pages are built in part three; until then only the check scripts get these.
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import { queueEmail } from "@/lib/email";
import { timeWords } from "./rules";

export { timeWords };

type Writer = Pick<typeof db, "insert" | "select">;
type Person = { id: string; name: string; email: string; timeZone: string | null };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

const memberPage = (membership: Pick<Membership, "id">) => `${appUrl()}/memberships/${membership.id}`;
const payPage = (membership: Pick<Membership, "id">) => `${appUrl()}/memberships/${membership.id}/pay`;

/** The host and the member of a membership, with the host's name as customers know it. */
async function peopleOf(tx: Writer, membership: Pick<Membership, "hostId" | "customerId">): Promise<{ host: Person; member: Person; hostName: string } | null> {
  const rows = await tx
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, timeZone: schema.user.timeZone })
    .from(schema.user)
    .where(inArray(schema.user.id, [membership.hostId, membership.customerId]));
  const host = rows.find((row) => row.id === membership.hostId);
  const member = rows.find((row) => row.id === membership.customerId);
  if (!host || !member) return null;
  const [profile] = await tx.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, membership.hostId));
  return { host, member, hostName: profile?.displayName ?? host.name };
}

/** The monthly receipt: the amount is held now, when it will be taken, and that cancelling before then costs nothing. */
export async function queueReceiptEmail(tx: Writer, membership: Membership, month: MembershipMonth, offeredUntil: Date): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found || !month.endsAt) return;
  const { member, hostName } = found;
  await queueEmail(tx, {
    to: member.email,
    key: `month-receipt:${month.id}`,
    subject: `Your membership with ${hostName}: ${money(month.totalCents)} for this month`,
    text:
      `Hi ${member.name},\n\nA new month of your membership with ${hostName} has started. It gives you ${timeWords(month.includedMinutes)} of calls and runs until ${whenFor(member, month.endsAt)}. Time you have not used by then expires.\n\n` +
      `${money(month.totalCents)} is held on your card now. It is taken when you make your first booking of this month, or on ${whenFor(member, offeredUntil)}, whichever comes first.\n\n` +
      `If you cancel before it is taken, nothing is charged.\n\nYour membership: ${memberPage(membership)}\n`,
  });
}

/** A monthly payment did not go through. Sent once for each try that failed. */
export async function queuePaymentFailedEmail(tx: Writer, membership: Membership, month: MembershipMonth, input: { failedTry: number | "lost"; needsAction: boolean; giveUpAt: Date }): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, hostName } = found;
  await queueEmail(tx, {
    to: member.email,
    key: `month-failed:${month.id}:${input.failedTry}`,
    subject: `Your membership payment for ${hostName} did not go through`,
    text:
      `Hi ${member.name},\n\nWe could not hold ${money(month.totalCents)} on your card for the next month of your membership with ${hostName}. ` +
      (input.failedTry === "lost" ? "Your bank released the hold on your card before the payment was taken. " : input.needsAction ? "Your bank wants you to approve this payment yourself. " : "Your bank refused it. ") +
      `Until it goes through you have no membership time and cannot book as a member.\n\n` +
      `You can pay here: ${payPage(membership)}\n\nWe will also try your card again. If no payment has gone through by ${whenFor(member, input.giveUpAt)}, your membership is paused. Nothing is charged while it is paused, and you can resume it whenever you like.\n`,
  });
}

const PAUSED_WHY: Record<string, string> = {
  payment: "the monthly payment did not go through",
  cancel_now: "you cancelled it",
  member: "you cancelled it, and the month you paid for has ended",
  host: "the host paused it",
  offer_off: "the host is not offering a membership at the moment",
  switch: "memberships are not being renewed at the moment",
  no_room: "the host's hours no longer have room for it",
  offer: "the offer of less time was not accepted",
  hold_lost: "your bank released the hold on your card before the payment was taken",
  card_step: "the card step was not finished in time",
};

/** The membership is paused: why, and that it can be resumed. To the member, and to the host. */
export async function queuePausedEmail(tx: Writer, membership: Membership, reason: string): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, host, hostName } = found;
  const why = PAUSED_WHY[reason] ?? "it could not go on";
  const key = `membership-paused:${membership.id}:${membership.period}`;
  await queueEmail(tx, {
    to: member.email,
    key: `${key}:member`,
    subject: `Your membership with ${hostName} is paused`,
    text: `Hi ${member.name},\n\nYour membership with ${hostName} is paused, because ${why}.\n\nNothing is charged while it is paused, and you have no membership time. You can still book ${hostName} like any customer. When you resume, you get ${hostName}'s membership as it is then.\n\nYour membership: ${memberPage(membership)}\n`,
  });
  await queueEmail(tx, {
    to: host.email,
    key: `${key}:host`,
    subject: `${member.name}'s membership is paused`,
    text: `Hi ${host.name},\n\n${member.name}'s membership with you is paused, because ${why.replace("you cancelled it", "they cancelled it").replace("your bank", "their bank").replace("your card", "their card")}.\n\nThey stay in your member list as paused and can resume by themselves. If you do not want that, end their membership there.\n\n${appUrl()}/host#membership\n`,
  });
}

/** The membership has ended for good. To both. */
export async function queueEndedEmail(tx: Writer, membership: Membership, reason: string): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, host, hostName } = found;
  const key = `membership-ended:${membership.id}`;
  await queueEmail(tx, {
    to: member.email,
    key: `${key}:member`,
    subject: `Your membership with ${hostName} has ended`,
    text: `Hi ${member.name},\n\nYour membership with ${hostName} has ended: ${reason}.\n\nYou will not be charged for it again. Member calls that were still to come are cancelled. Membership time you had not used is paid back to your card; you get an email when that has gone through. (If your bank is disputing a payment, that month's money stays where it is until the bank has decided.)\n\n${memberPage(membership)}\n`,
  });
  await queueEmail(tx, {
    to: host.email,
    key: `${key}:host`,
    subject: `${member.name}'s membership has ended`,
    text: `Hi ${host.name},\n\n${member.name}'s membership with you has ended: ${reason}.\n\nMember calls with them that were still to come are cancelled, and membership time they had not used is paid back to them.\n\n${appUrl()}/host#membership\n`,
  });
}

/** A pay-back has gone through at Stripe. */
export async function queuePayBackEmail(tx: Writer, membership: Membership, refund: { id: string; amountCents: number; reason: string }): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, hostName } = found;
  await queueEmail(tx, {
    to: member.email,
    key: `month-payback:${refund.id}`,
    subject: `${money(refund.amountCents)} paid back to your card`,
    text: `Hi ${member.name},\n\n${money(refund.amountCents)} of your membership with ${hostName} has been paid back to your card. ${refund.reason}\n\nYour bank may take a few days to show it.\n\n${memberPage(membership)}\n`,
  });
}
