/**
 * A new membership cancelled within 14 days of joining (plans/46-part-3-money-owed.md, decisions 13
 * and 14, as the founder changed them on 26 November 2026; the draft Payment Terms, section 12.3).
 *
 * Every member has it, wherever they live: nobody is asked for their country. There are two ways in.
 * The member presses "Cancel within 14 days" on their membership's page. Or the member writes to
 * Connect, and the founder presses the button on the Memberships page, with the day the request
 * arrived (a cancellation in writing counts too, so that way has to exist).
 *
 * Both end the membership at once, with a reason of its own. Everything else is what ending a
 * membership already does (ending.ts): the renewal stops; a month that is only to be paid or held
 * is given up and its hold let go; for a month that was taken, the free money and the money set
 * aside for calls still to come go back to the card through the pay-back lines there are, and
 * nothing of this month expires to the host. Time that was really used stays paid at the member
 * price, and so does a late cancellation or a missed call that was already charged. This file adds
 * no sum of its own: that could pay back twice.
 *
 * Only for the first month of a membership that was newly joined, and only while that month runs.
 * After it has ended, the unused money may already have gone to the host and a second month may have
 * begun: both buttons refuse, and the founder settles that case by hand.
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import type { Tx } from "@/lib/payments/operations";
import { recordAdminAction } from "@/lib/safety/audit";
import { cleanUpEnding } from "./ending";
import { lockPeople } from "./join";
import { lockCalendar, lockMembership, lockMonth } from "./locks";
import { MembershipError } from "./rules";
import { endMembership } from "./state";

/** How many days after the day of joining a membership can be cancelled this way. */
export const RIGHT_DAYS = 14;
const DAY_MS = 24 * 3_600_000;

/** Why the membership ended: on the founder's page, and in the email to both. */
export const FOURTEEN_DAYS_REASON = "it was cancelled within 14 days of joining, as the member asked";

/** A moment's calendar day, in UTC, as "2026-11-21". Days are counted in UTC here, for everybody the same. */
export const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

/** The last day it counts: 14 days after the day of joining. */
export const lastDayFor = (joinedAt: Date): string => dayOf(new Date(Date.parse(`${dayOf(joinedAt)}T00:00:00Z`) + RIGHT_DAYS * DAY_MS));

/** Whether the member's own button is still open at this moment: through the whole of the last day. */
export const withinTheDays = (joinedAt: Date, now: Date): boolean => dayOf(now) <= lastDayFor(joinedAt);

/** Why the day the founder entered (the day a written request arrived) cannot be right, or null when it can. */
export function requestDayRefusal(input: { requestDay: string; joinedAt: Date; now: Date }): string | null {
  const { requestDay, joinedAt, now } = input;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(requestDay) ? Date.parse(`${requestDay}T00:00:00Z`) : Number.NaN;
  // "2026-02-31" parses to a day in March: only a day that reads back the same is one.
  if (Number.isNaN(parsed) || dayOf(new Date(parsed)) !== requestDay) return "Enter the day the member's request reached Connect.";
  if (requestDay < dayOf(joinedAt)) return `The request cannot have reached Connect before the day of joining (${dayOf(joinedAt)}).`;
  if (requestDay > dayOf(now)) return "The day the request reached Connect cannot be later than today.";
  if (requestDay > lastDayFor(joinedAt)) return `The request reached Connect more than 14 days after joining: the last day was ${lastDayFor(joinedAt)}. If you still want to give money back, settle it by hand.`;
  return null;
}

type Reader = Pick<Tx, "select">;

/** Why this way of cancelling is not open for a membership. */
export type NotOpen = "ended" | "paused" | "not_joined" | "resumed" | "not_first_month" | "month_over" | "bank" | "earlier";

/** The sentence for the founder, who can settle a case by hand. */
export const WHY_FOR_FOUNDER: Record<NotOpen, string> = {
  ended: "This membership has already ended.",
  paused: "This membership is paused: it has no month and no payment to cancel.",
  not_joined: "Nobody has joined this membership yet.",
  resumed: "This membership was resumed, not newly joined: cancelling within 14 days is for a new membership.",
  not_first_month: "This is not the first month of a new membership: cancelling within 14 days is for the first month after joining.",
  month_over: "The first month has already ended. Its unused money may have gone to the host and a second month may have begun, so this button cannot work it out: settle this case by hand.",
  bank: "The member's bank has a question or a dispute about this month's payment. Nothing is cancelled here while the bank is in it.",
  earlier: "This person has had a membership with this host before: cancelling within 14 days is for a new membership.",
};

const NORMAL_WAY = 'You can still cancel the normal way, with "Cancel at the end of the month".';
/** The sentence for the member. */
export const WHY_FOR_MEMBER: Record<NotOpen, string> = {
  ended: "This membership has already ended.",
  paused: "This membership is paused: nothing is being charged for it.",
  not_joined: "This membership has not started yet.",
  resumed: `Cancelling within 14 days is for the first 14 days of a new membership, and this one was resumed. ${NORMAL_WAY}`,
  not_first_month: `Cancelling within 14 days is for the first 14 days of a new membership. ${NORMAL_WAY}`,
  month_over: `Cancelling within 14 days is for the first 14 days of a new membership. ${NORMAL_WAY}`,
  bank: "Your bank is looking at this month's payment. Until that is settled, nothing of this month can be changed here.",
  earlier: `Cancelling within 14 days is for your first membership with this host. ${NORMAL_WAY}`,
};
export const DAYS_OVER_FOR_MEMBER = `The 14 days after joining are over. ${NORMAL_WAY}`;

/** Whether this way of cancelling applies to this membership right now: its first month and when the member joined, or why not. */
export type FourteenDayCase = { ok: true; month: MembershipMonth; joinedAt: Date; lastDay: string } | { ok: false; why: NotOpen };

/**
 * Judges a membership as it stands. It applies to the first membership this person has had with this host that
 * was really joined, while its first month is the one that is running, with nothing about a bank on it. (Whether
 * the 14 days are over is asked apart: the founder's day and the member's own press count differently.)
 */
export async function fourteenDayCase(reader: Reader, membership: Membership, now: Date): Promise<FourteenDayCase> {
  const no = (why: NotOpen): FourteenDayCase => ({ ok: false, why });
  if (membership.status === "ended") return no("ended");
  if (membership.status === "paused") return no("paused");
  if (membership.status === "invited" || !membership.currentMonthId) return no("not_joined");
  const [month] = await reader.select().from(schema.membershipMonths).where(eq(schema.membershipMonths.id, membership.currentMonthId));
  if (!month) return no("not_joined");
  const [agreement] = await reader.select().from(schema.membershipAgreements).where(eq(schema.membershipAgreements.id, month.agreementId));
  // Only a joining, never a resuming; and only the first month the joining was for.
  if (!agreement || agreement.kind !== "joined" || month.number !== agreement.firstMonthNumber) return no(agreement?.kind === "resumed" ? "resumed" : "not_first_month");
  if (!["to_pay", "held", "running"].includes(month.status) || (month.endsAt && now >= month.endsAt)) return no("month_over");
  if (month.dispute !== "none") return no("bank");
  // An earlier month of the same two people that the bank authorised, in this membership or an earlier one: this is not their first.
  const [earlier] = await reader
    .select({ id: schema.membershipMonths.id })
    .from(schema.membershipMonths)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .where(and(eq(schema.memberships.hostId, membership.hostId), eq(schema.memberships.customerId, membership.customerId), ne(schema.membershipMonths.id, month.id), isNotNull(schema.membershipMonths.authorisedAt)))
    .limit(1);
  if (earlier) return no("earlier");
  // "Joined" is the moment the first month was authorised by the bank. A first month that never was: the moment they agreed.
  const joinedAt = month.authorisedAt ?? agreement.at;
  return { ok: true, month, joinedAt, lastDay: lastDayFor(joinedAt) };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * What the member is told beside "your membership has ended": that it was within the 14 days, what goes back, and
 * which calls stay paid for. Plain, so every sentence is tested.
 */
export function fourteenDayNote(input: {
  /** The day a written request reached Connect, when the founder pressed; null when the member pressed themselves. */
  requestDay: string | null;
  monthTaken: boolean;
  stays: Array<{ when: string; amount: string; why: "used" | "late" }>;
  unsettled: number;
}): string {
  const lines = [input.requestDay ? `You asked to cancel your new membership within 14 days of joining; your request reached us on ${input.requestDay}.` : "You cancelled your new membership within 14 days of joining."];
  if (!input.monthTaken) lines.push("Nothing was charged for it: an amount that was only held on your card is let go.");
  else if (input.stays.length > 0 || input.unsettled > 0) lines.push("What you paid for this month is given back to your card, except for what is listed below. Each amount is confirmed by an email of its own when it has gone through.");
  else lines.push("What you paid for this month is given back to your card. Each amount is confirmed by an email of its own when it has gone through.");
  if (input.stays.length > 0) {
    lines.push("", "These stay paid for, at the member price:");
    for (const call of input.stays) lines.push(`- your call on ${call.when}: ${call.amount} (${call.why === "late" ? "it was cancelled late or missed, and charged under your booking's terms" : "the time you used"})`);
  }
  if (input.unsettled > 0) {
    const one = input.unsettled === 1;
    lines.push("", `${one ? "One call" : `${input.unsettled} calls`} that had already begun or taken place ${one ? "is" : "are"} not worked out yet. What ${one ? "it comes" : "they come"} to is paid for at the member price, as for any call; the rest of what was set aside for ${one ? "it" : "them"} goes back to your card.`);
  }
  return lines.join("\n");
}

/** Who presses: the member, on their own membership; or the founder, for a request that came in writing. */
export type Canceller = { as: "member"; memberId: string } | { as: "founder"; adminId: string; requestDay: string };

/**
 * Cancels a new membership within the 14 days. Refuses, with a sentence for whoever pressed, whenever the case is
 * not the plain one; then ends the membership in one step and runs the usual clean-up. Pressed twice, the second
 * press finds the membership ended and refuses, so nothing is paid back twice.
 */
export async function cancelWithin14Days(input: { membershipId: string; by: Canceller; now?: Date }): Promise<void> {
  const { by } = input;
  const ended = await db.transaction(async (tx) => {
    const [found] = await tx.select({ hostId: schema.memberships.hostId, customerId: schema.memberships.customerId }).from(schema.memberships).where(eq(schema.memberships.id, input.membershipId));
    // Someone else's membership and one that does not exist look the same.
    if (!found || (by.as === "member" && found.customerId !== by.memberId)) throw new MembershipError("Membership not found.");
    // The locks in the one order: the host's calendar, the two people, the membership, its month.
    await lockCalendar(tx, found.hostId);
    await lockPeople(tx, [found.hostId, found.customerId]);
    const membership = await lockMembership(tx, input.membershipId);
    // The moment is taken now that the locks are held: which side of the month's end, and of the last day, it falls on decides everything.
    const at = input.now ? new Date(Math.max(input.now.getTime(), Date.now())) : new Date();
    const judged = await fourteenDayCase(tx, membership, at);
    if (!judged.ok) throw new MembershipError((by.as === "member" ? WHY_FOR_MEMBER : WHY_FOR_FOUNDER)[judged.why]);
    const month = await lockMonth(tx, judged.month.id);
    if (by.as === "member") {
      if (!withinTheDays(judged.joinedAt, at)) throw new MembershipError(DAYS_OVER_FOR_MEMBER);
    } else {
      const refusal = requestDayRefusal({ requestDay: by.requestDay, joinedAt: judged.joinedAt, now: at });
      if (refusal) throw new MembershipError(refusal);
    }
    // If the month's money is being taken at this very moment, its outcome is not known yet.
    const [taking] = await tx.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.monthId, month.id), eq(schema.moneyOperations.kind, "capture"), eq(schema.moneyOperations.status, "started")));
    if (taking) throw new MembershipError("This month's payment is being taken at this moment. Please try again in a minute.");

    // The calls of this month that stay paid for, and the ones that have begun and are not worked out yet.
    const calls = await tx
      .select({ startsAt: schema.calls.startsAt, cancelledAt: schema.calls.cancelledAt, status: schema.payments.status, chargedCents: schema.payments.chargedCents, chargeReason: schema.payments.chargeReason })
      .from(schema.payments)
      .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
      .where(and(eq(schema.payments.monthId, month.id), eq(schema.payments.kind, "member_call")))
      .orderBy(schema.calls.startsAt);
    const stays = calls.filter((call) => call.status === "charged" && (call.chargedCents ?? 0) > 0);
    const unsettled = calls.filter((call) => call.status === "held" && (call.startsAt <= at || call.cancelledAt !== null)).length;
    const [member] = await tx.select({ timeZone: schema.user.timeZone }).from(schema.user).where(eq(schema.user.id, membership.customerId));
    const note = fourteenDayNote({
      requestDay: by.as === "founder" ? by.requestDay : null,
      monthTaken: month.status === "running",
      stays: stays.map((call) => ({ when: whenFor(member ?? { timeZone: null }, call.startsAt), amount: money(call.chargedCents!), why: call.chargeReason === "late_cancel" ? ("late" as const) : ("used" as const) })),
      unsettled,
    });

    if (by.as === "founder") {
      await recordAdminAction({ adminId: by.adminId, action: "membership cancelled within 14 days", targetUserId: membership.customerId, targetId: membership.id, detail: `The request reached Connect on ${by.requestDay}; joined ${dayOf(judged.joinedAt)}.` }, tx);
    }
    // (Who ended it: "admin", or the member's own account, as for every ending.)
    return endMembership(tx, membership, { by: by.as === "founder" ? "admin" : by.memberId, reason: FOURTEEN_DAYS_REASON, memberNote: note }, at);
  });
  // The clean-up: the hold let go, coming member calls cancelled, free money owed back. The helper repeats it until it is done.
  if (ended) await cleanUpEnding(input.membershipId, input.now ?? new Date()).catch((error) => console.error(`[membership] the clean-up of membership ${input.membershipId}, cancelled within 14 days, did not finish; the helper will retry`, error));
}

/** For the founder's page: the memberships the button applies to right now, each with the day of joining and the last day. */
export async function fourteenDayCases(memberships: Membership[], now: Date): Promise<Map<string, { joinedDay: string; lastDay: string }>> {
  const cases = new Map<string, { joinedDay: string; lastDay: string }>();
  for (const membership of memberships) {
    if (!membership.currentMonthId || !["joining", "active", "unpaid"].includes(membership.status)) continue;
    const judged = await fourteenDayCase(db, membership, now);
    // Shown for the whole first month: a request that arrived in time may be handled some days after the last day.
    if (judged.ok) cases.set(membership.id, { joinedDay: dayOf(judged.joinedAt), lastDay: judged.lastDay });
  }
  return cases;
}

/** For the member's own page: until which day their own button is open, or null when it is not. */
export async function ownFourteenDays(membership: Membership, now: Date): Promise<{ lastDay: string } | null> {
  const judged = await fourteenDayCase(db, membership, now);
  return judged.ok && withinTheDays(judged.joinedAt, now) ? { lastDay: judged.lastDay } : null;
}
