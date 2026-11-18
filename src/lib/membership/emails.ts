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
export async function queuePaymentFailedEmail(tx: Writer, membership: Membership, month: MembershipMonth, input: { failedTry: number | "lost"; needsAction: boolean; giveUpAt: Date; noCard?: boolean; triedAgain?: boolean }): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, hostName } = found;
  await queueEmail(tx, {
    to: member.email,
    key: `month-failed:${month.id}:${input.failedTry}`,
    subject: `Your membership payment for ${hostName} did not go through`,
    text:
      `Hi ${member.name},\n\nWe could not hold ${money(month.totalCents)} on your card for the next month of your membership with ${hostName}. ` +
      (input.failedTry === "lost" ? "Your bank released the hold on your card before the payment was taken. " : input.noCard ? "We have no card of yours to try. " : input.needsAction ? "Your bank wants you to approve this payment yourself. " : "Your bank refused it. ") +
      `Until it goes through you have no membership time and cannot book as a member.\n\n` +
      `You can pay here: ${payPage(membership)}\n\n${input.triedAgain === false ? "We will not try by ourselves again. " : "We will also try your card again. "}If no payment has gone through by ${whenFor(member, input.giveUpAt)}, your membership is paused. Nothing is charged while it is paused, and you can resume it whenever you like.\n`,
  });
}

const PAUSED_WHY: Record<string, string> = {
  payment: "the monthly payment did not go through",
  cancel_now: "you cancelled it",
  member: "you cancelled it, and the month you paid for has ended",
  host: "the host paused it",
  // Said as what happened, not as how things stand now: the membership may be on again by the time this is read.
  offer_off: "the host switched the membership off",
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
    text: `Hi ${member.name},\n\nYour membership with ${hostName} is paused, because ${why}.\n\n${reason === "cancel_now" ? "Nothing was charged for this month. If an amount was held on your card, the hold is let go; your bank may still show it for a few days. " : ""}Nothing is charged while it is paused, and you have no membership time. You can still book ${hostName} like any customer. When you resume, you get ${hostName}'s membership as it is then.\n\nYour membership: ${memberPage(membership)}\n`,
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

// ---------------------------------------------------------------------------
// Part 1b: how a membership comes to exist and what people do with it
// ---------------------------------------------------------------------------

async function handleOf(tx: Writer, hostId: string): Promise<string> {
  const [profile] = await tx.select({ handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
  return profile?.handle ?? "";
}

/** The host invites someone. To the invited person, with the link that carries this invitation. */
export async function queueInvitedEmail(tx: Writer, membership: Membership, input: { inviteId: string; pricePer15Cents: number; minutes: number; expiresAt: Date }): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, hostName } = found;
  const monthly = (input.pricePer15Cents * input.minutes) / 15;
  await queueEmail(tx, {
    to: member.email,
    key: `membership-invited:${input.inviteId}`,
    subject: `${hostName} invites you to a membership`,
    text:
      `Hi ${member.name},\n\n${hostName} invites you to become a member: ${timeWords(input.minutes)} of calls each month for ${money(monthly)} a month (${money(input.pricePer15Cents)} per 15 minutes). As a member you book without waiting for an answer, also in times kept for members.\n\n` +
      `The invitation is open until ${whenFor(member, input.expiresAt)}. Nothing is charged unless you join.\n\n${appUrl()}/h/${await handleOf(tx, membership.hostId)}/membership?invite=${input.inviteId}\n`,
  });
}

/** An invitation is over without a joining: taken back by the host (the person is told), or run out (both are told). */
export async function queueInvitationOverEmail(tx: Writer, membership: Membership, inviteId: string, how: "taken_back" | "ran_out"): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, host, hostName } = found;
  await queueEmail(tx, {
    to: member.email,
    key: `membership-invite-over:${inviteId}:member`,
    subject: `The invitation from ${hostName} is no longer open`,
    text: `Hi ${member.name},\n\n${how === "ran_out" ? `The invitation to ${hostName}'s membership was open for 24 hours and has run out.` : `${hostName} has taken back the invitation to the membership.`} Nothing was charged. You can still book ${hostName} like any customer.\n`,
  });
  if (how === "ran_out") {
    await queueEmail(tx, {
      to: host.email,
      key: `membership-invite-over:${inviteId}:host`,
      subject: `Your invitation to ${member.name} has run out`,
      text: `Hi ${host.name},\n\n${member.name} did not join within 24 hours, so the invitation has ended and its place is free again. You can invite them again from "People you have talked to".\n\n${appUrl()}/host#membership\n`,
    });
  }
}

/** Someone joined, or came back after a pause. To the host (the member has the receipt). */
export async function queueJoinedEmail(tx: Writer, membership: Membership, month: MembershipMonth, resumed: boolean): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, host } = found;
  await queueEmail(tx, {
    to: host.email,
    key: `membership-joined:${month.id}`,
    subject: resumed ? `${member.name} has resumed their membership` : `${member.name} is now a member`,
    text: `Hi ${host.name},\n\n${member.name} ${resumed ? "has resumed their membership with you" : "has joined your membership"}: ${timeWords(month.includedMinutes)} a month for ${money(month.totalCents)}. They can book your open times without waiting for your answer. You are paid as their time is used, and for unused time when each month ends.\n\n${appUrl()}/host#membership\n`,
  });
}

/** The renewal is stopped, by the member or by the host. The member keeps the month they paid for. */
export async function queueRenewalStoppedEmail(tx: Writer, membership: Membership, by: "member" | "host", endsAt: Date, at: Date): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, host, hostName } = found;
  const key = `membership-stopped:${membership.id}:${by}:${at.getTime()}`;
  await queueEmail(tx, {
    to: member.email,
    key: `${key}:member`,
    subject: by === "member" ? `Your membership with ${hostName} ends on its paid month's last day` : `${hostName} has paused your membership after this month`,
    text:
      `Hi ${member.name},\n\n${by === "member" ? "You cancelled your membership" : `${hostName} has chosen to pause your membership`} with ${hostName} after this month. Nothing changes until ${whenFor(member, endsAt)}: your bookings stay, and the time you have left can still be booked and used. No new month is charged. On that day your membership is paused.\n\n` +
      `${by === "member" ? `Changed your mind? Until then you can switch it back on with "Keep my membership".` : "A paused membership costs nothing, and you can resume it by yourself when there is room."}\n\n${memberPage(membership)}\n`,
  });
  if (by === "member") {
    await queueEmail(tx, {
      to: host.email,
      key: `${key}:host`,
      subject: `${member.name} has cancelled their membership`,
      text: `Hi ${host.name},\n\n${member.name} has cancelled their membership with you. It runs until ${whenFor(host, endsAt)} and is then paused. Until then they can still book and use their time, and they can switch it back on.\n\n${appUrl()}/host#membership\n`,
    });
  }
}

/**
 * One side takes its stop back. To both, and saying how things really stand: if another stop is
 * still there (`left` names whose), the membership is still paused at the month's end.
 */
export async function queueRenewalBackEmail(tx: Writer, membership: Membership, by: "member" | "host", at: Date, left: "member" | "host" | "offer_off" | null): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, host, hostName } = found;
  const key = `membership-back:${membership.id}:${by}:${at.getTime()}`;
  const still = "it is still paused when the month you paid for ends";
  const forMember = {
    host: `You switched your membership with ${hostName} back on. But ${hostName} has paused it after this month, so ${still}. Only ${hostName} can take that back.`,
    member: `${hostName} has taken back the pause. But you cancelled your membership yourself, so ${still}, unless you switch it back on with "Keep my membership".`,
    offer_off: `${hostName} has taken back the pause. But the membership was switched off for a while during this month, which stopped your renewal, so ${still}, unless you switch it back on with "Keep my membership".`,
    none: `${by === "member" ? "You switched your membership back on" : `${hostName} has taken back the pause`}. Your membership with ${hostName} renews as before at the end of the month you paid for. Nothing is charged today.`,
  }[left ?? "none"];
  const forHost = {
    host: `${member.name} has switched their membership back on. Your own pause after this month still stands, so it is paused when their paid month ends unless you take the pause back.`,
    member: `You took back the pause for ${member.name}. They cancelled their membership themselves, so it is still paused when their paid month ends unless they switch it back on.`,
    offer_off: `You took back the pause for ${member.name}. Their renewal is still stopped, because your membership was switched off for a while during this month. Only they can bring it back, with "Keep my membership".`,
    none: by === "member" ? `${member.name} has switched their membership back on. It renews as before.` : `You took back the pause for ${member.name}. Their membership renews as before.`,
  }[left ?? "none"];
  await queueEmail(tx, { to: member.email, key: `${key}:member`, subject: left ? `Your membership with ${hostName}: still set to pause` : `Your membership with ${hostName} goes on`, text: `Hi ${member.name},\n\n${forMember}\n\n${memberPage(membership)}\n` });
  await queueEmail(tx, { to: host.email, key: `${key}:host`, subject: left ? `${member.name}'s membership is still set to pause` : by === "member" ? `${member.name} keeps their membership` : `${member.name}'s membership goes on`, text: `Hi ${host.name},\n\n${forHost}\n\n${appUrl()}/host#membership\n` });
}

/** The host lowered the member price: this member pays less from their next month, for the same time. */
export async function queueLowerPriceEmail(tx: Writer, membership: Membership, input: { fromPricePer15Cents: number; toPricePer15Cents: number; minutes: number; offerVersion: number; openMonthCents: number | null }): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, hostName } = found;
  const monthly = (price: number) => money((price * input.minutes) / 15);
  await queueEmail(tx, {
    to: member.email,
    key: `membership-price:${membership.id}:${input.offerVersion}`,
    subject: `Your membership with ${hostName} costs less from your next month`,
    text:
      `Hi ${member.name},\n\n${hostName} has lowered the member price. ` +
      (input.openMonthCents !== null
        ? `The month whose payment is open now keeps its amount of ${money(input.openMonthCents)}. From the month after it you pay ${monthly(input.toPricePer15Cents)} a month`
        : `From your next month you pay ${monthly(input.toPricePer15Cents)} a month instead of ${monthly(input.fromPricePer15Cents)}`) +
      `, for the same ${timeWords(input.minutes)}. The month you have already paid for does not change. You do not have to do anything.\n\n${memberPage(membership)}\n`,
  });
}

/** The host cuts her hours and offers this member less time instead of a pause. */
export async function queueLessTimeOfferEmail(tx: Writer, membership: Membership, input: { offerId: string; offeredMinutes: number; minutesNow: number; pricePer15Cents: number; answerBy: Date }): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, hostName } = found;
  const monthly = (minutes: number) => money((input.pricePer15Cents * minutes) / 15);
  await queueEmail(tx, {
    to: member.email,
    key: `membership-offer:${input.offerId}`,
    subject: `${hostName} offers you less time instead of a pause`,
    text:
      `Hi ${member.name},\n\n${hostName} is cutting the hours. ${hostName} offers you ${timeWords(input.offeredMinutes)} a month instead of ${timeWords(input.minutesNow)}, at your same price. You would pay ${monthly(input.offeredMinutes)} a month instead of ${monthly(input.minutesNow)}, from your next month on ${whenFor(member, input.answerBy)}. Answer before then.\n\n` +
      `If you say no, or do not answer in time, your membership is paused when this month ends. The month you paid for stays as it is either way.\n\n` +
      `The smaller time stays, also if ${hostName} adds hours again later; to get more time you would need a new invitation, or to come back after a pause on the terms at that time.\n\n${memberPage(membership)}?offer=${input.offerId}\n`,
  });
}

/** What became of an offer of less time. To both. */
export async function queueLessTimeOutcomeEmail(tx: Writer, membership: Membership, input: { offerId: string; outcome: "accepted" | "declined" | "taken_back_kept" | "taken_back_paused"; offeredMinutes: number }): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, host, hostName } = found;
  const toMember = {
    accepted: `You accepted ${timeWords(input.offeredMinutes)} a month with ${hostName}. It applies from your next month, and you pay less from then on. Nothing is charged today.`,
    declined: `You said no to less time with ${hostName}. Your membership is paused when the month you paid for ends. You can resume it by yourself when there is room.`,
    taken_back_kept: `${hostName} has taken back the offer of less time. Your membership goes on with the time you had.`,
    taken_back_paused: `${hostName} has taken back the offer of less time. Your membership is paused when the month you paid for ends. You can resume it by yourself when there is room.`,
  }[input.outcome];
  const toHost = {
    accepted: `${member.name} accepted ${timeWords(input.offeredMinutes)} a month. It applies from their next month.`,
    declined: `${member.name} said no to less time. Their membership is paused when their paid month ends.`,
    taken_back_kept: `You took back the offer of less time to ${member.name}. Their membership goes on with the time they had.`,
    taken_back_paused: `You took back the offer of less time to ${member.name}. Their membership is paused when their paid month ends.`,
  }[input.outcome];
  await queueEmail(tx, { to: member.email, key: `membership-offer-outcome:${input.offerId}:member`, subject: `Your membership with ${hostName}: the offer of less time`, text: `Hi ${member.name},\n\n${toMember}\n\n${memberPage(membership)}\n` });
  await queueEmail(tx, { to: host.email, key: `membership-offer-outcome:${input.offerId}:host`, subject: `${member.name} and your offer of less time`, text: `Hi ${host.name},\n\n${toHost}\n\n${appUrl()}/host#membership\n` });
}

/** The host switched her membership off: this member keeps the month they paid for, and is paused when it ends unless it is on again and they keep it. */
export async function queueOfferOffEmail(tx: Writer, membership: Membership, endsAt: Date, at: Date): Promise<void> {
  const found = await peopleOf(tx, membership);
  if (!found) return;
  const { member, hostName } = found;
  await queueEmail(tx, {
    to: member.email,
    key: `membership-offer-off:${membership.id}:${at.getTime()}`,
    subject: `${hostName} is not offering the membership at the moment`,
    text: `Hi ${member.name},\n\n${hostName} has switched the membership off. Nothing changes until ${whenFor(member, endsAt)}: your bookings stay, and the time you have left can still be booked and used. No new month is charged, and on that day your membership is paused.\n\nIf ${hostName} switches the membership on again before then, you can keep yours with "Keep my membership". After that day you can resume it whenever it is offered again and there is room.\n\n${memberPage(membership)}\n`,
  });
}
