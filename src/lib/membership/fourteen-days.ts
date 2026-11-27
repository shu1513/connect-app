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
 * Only for the first month of a member's first membership with a host, once the bank has authorised
 * that month (someone still at the card step is not a member yet, and has paid nothing), and only
 * while that month runs. After it has ended, the unused money may already have gone to the host and
 * a second month may have begun: both buttons refuse, and the founder settles that case by hand. So
 * does a month whose payment has a problem the founder must look at.
 *
 * The request is written down first. The first press that passes every rule is saved on the
 * membership with its moment, before any call is cancelled. If the cancelling cannot be finished
 * then (the database fails for one call, or the month's money is being taken at that very moment),
 * the request stays on record: a later press counts as made in time, also after the 14 days, and
 * the helper finishes it by itself. Every other rule is asked again at that later moment.
 */
import { and, eq, gt, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import type { Tx } from "@/lib/payments/operations";
import { recordAdminAction } from "@/lib/safety/audit";
import { cancelUpcomingMemberCalls, cleanUpEnding } from "./ending";
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

/** Who asked: the member, with their own button; or the founder, for a request that reached Connect in writing on a day. */
export type Asker = { as: "member" } | { as: "founder"; adminId: string; requestDay: string };

/** The first press that passed every rule, as it is on record: when it was asked, and by whom. */
export type RequestOnRecord = { askedAt: Date; by: Asker };

/**
 * The request on record for this month of the membership, or null when there is none. One that was written down
 * for another month counts for nothing (there is only ever one first month, so this is a second lock on the door).
 */
export function requestOnRecord(membership: Pick<Membership, "fourteenAskedAt" | "fourteenMonthId" | "fourteenAdminId" | "fourteenRequestDay">, monthId: string): RequestOnRecord | null {
  if (!membership.fourteenAskedAt || membership.fourteenMonthId !== monthId) return null;
  const by: Asker = membership.fourteenAdminId && membership.fourteenRequestDay ? { as: "founder", adminId: membership.fourteenAdminId, requestDay: membership.fourteenRequestDay } : { as: "member" };
  return { askedAt: membership.fourteenAskedAt, by };
}

/**
 * Whether the member's own press counts as made in time: on one of the 14 days, or at any later moment when a
 * request that was made in time is on record for this month. (Every other rule is asked apart, at the later moment.)
 */
export const memberInTime = (input: { joinedAt: Date; now: Date; onRecord: RequestOnRecord | null }): boolean => input.onRecord !== null || withinTheDays(input.joinedAt, input.now);

type Reader = Pick<Tx, "select">;

/** Why this way of cancelling is not open for a membership. */
export type NotOpen = "ended" | "paused" | "not_joined" | "resumed" | "not_first_month" | "month_over" | "problem" | "bank" | "earlier";

/** The sentence for the founder, who can settle a case by hand. */
export const WHY_FOR_FOUNDER: Record<NotOpen, string> = {
  ended: "This membership has already ended.",
  paused: "This membership is paused: it has no month and no payment to cancel.",
  not_joined: "Nobody has joined this membership yet: no month of it was ever held on a card, so nothing was paid. An invitation that is not finished runs out by itself.",
  resumed: "This membership was resumed, not newly joined: cancelling within 14 days is for a new membership.",
  not_first_month: "This is not the first month of a new membership: cancelling within 14 days is for the first month after joining.",
  month_over: "The first month has already ended. Its unused money may have gone to the host and a second month may have begun, so this button cannot work it out: settle this case by hand.",
  problem: "This month's payment has a problem that needs you first (Stripe took a part of it, or holds more than one payment). This button cannot work that out: settle the payment by hand, and then the cancellation.",
  bank: "The member's bank has a question or a dispute about this month's payment. Nothing is cancelled here while the bank is in it.",
  earlier: "This person has had a membership with this host before: cancelling within 14 days is for a new membership.",
};

const NORMAL_WAY = "The normal way of cancelling is still there: your membership then runs to the end of the month you paid for.";
/** The sentence for the member. */
export const WHY_FOR_MEMBER: Record<NotOpen, string> = {
  ended: "This membership has already ended.",
  paused: "This membership is paused: nothing is being charged for it.",
  not_joined: "This membership has not started yet: nothing was held on your card or charged.",
  resumed: `Cancelling within 14 days is for the first 14 days of a new membership, and this one was resumed. ${NORMAL_WAY}`,
  not_first_month: `Cancelling within 14 days is for the first 14 days of a new membership. ${NORMAL_WAY}`,
  month_over: `Cancelling within 14 days is for the first 14 days of a new membership. ${NORMAL_WAY}`,
  problem: "There is a problem with this month's payment, and we are looking into it. To cancel within the 14 days, please write to us: we will do it for you.",
  bank: "Your bank is looking at this month's payment. Until that is settled, nothing of this month can be changed here.",
  earlier: `Cancelling within 14 days is for your first membership with this host. ${NORMAL_WAY}`,
};
export const DAYS_OVER_FOR_MEMBER = `The 14 days after joining are over. ${NORMAL_WAY}`;
/** The form was drawn for a month that is no longer the membership's current one. */
export const MOVED_ON = "This membership has moved on since this page was opened. Nothing was changed. Please look at it again.";


/** Whether this way of cancelling applies to this membership right now: its first month and when the member joined, or why not. */
export type FourteenDayCase = { ok: true; month: MembershipMonth; joinedAt: Date; lastDay: string } | { ok: false; why: NotOpen };

/**
 * Judges a membership as it stands. It applies to the first membership this person has had with this host that
 * was really joined (the bank authorised its first month), while that month is the one that is running, with
 * nothing about a bank on it and no problem with its payment. (Whether the 14 days are over is asked apart: the
 * founder's day and the member's own press count differently.)
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
  // Still at the card step: the bank never authorised this month, so the person is not a member and has paid nothing.
  if (!month.authorisedAt) return no("not_joined");
  // Stripe took a part of the amount, or holds more than one payment: the founder settles that first. (Such a month
  // can still say "held" although money was taken, so "nothing was charged" would be untrue.)
  if (month.problem) return no("problem");
  if (!["held", "running"].includes(month.status) || (month.endsAt && now >= month.endsAt)) return no("month_over");
  if (month.dispute !== "none") return no("bank");
  // An earlier month of the same two people that the bank authorised, in this membership or an earlier one: this is not their first.
  const [earlier] = await reader
    .select({ id: schema.membershipMonths.id })
    .from(schema.membershipMonths)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .where(and(eq(schema.memberships.hostId, membership.hostId), eq(schema.memberships.customerId, membership.customerId), ne(schema.membershipMonths.id, month.id), isNotNull(schema.membershipMonths.authorisedAt)))
    .limit(1);
  if (earlier) return no("earlier");
  // "Joined" is the moment the bank authorised the first month.
  return { ok: true, month, joinedAt: month.authorisedAt, lastDay: lastDayFor(month.authorisedAt) };
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
  /** One line for each call that stays paid for: what is kept of it now (after anything already given back). */
  stays: Array<{ when: string; amount: string; why: "used" | "late" }>;
  /** How many calls had begun, or were cancelled, and are not worked out yet. */
  unsettled: number;
}): string {
  const lines = [input.requestDay ? `You asked to cancel your new membership within 14 days of joining; your request reached us on ${input.requestDay}.` : "You cancelled your new membership within 14 days of joining."];
  if (!input.monthTaken) lines.push("Nothing was charged for it: the amount that was only held on your card is let go. Your bank may still show it for a few days.");
  else if (input.stays.length > 0 || input.unsettled > 0) lines.push("What you paid for this month is given back to your card, except for what is listed below. Each amount is confirmed by an email of its own when it has gone through.");
  else lines.push("What you paid for this month is given back to your card. Each amount is confirmed by an email of its own when it has gone through.");
  if (input.stays.length > 0) {
    lines.push("", "These stay paid for, at the member price, under your booking's terms:");
    for (const call of input.stays) lines.push(`- your call on ${call.when}: ${call.amount} (${call.why === "late" ? "charged because it was cancelled late" : "charged for the call"})`);
  }
  if (input.unsettled > 0) {
    const one = input.unsettled === 1;
    lines.push("", `${one ? "One call" : `${input.unsettled} calls`} that had already begun or taken place ${one ? "is" : "are"} not worked out yet. What ${one ? "it comes" : "they come"} to is paid for at the member price, as for any call; the rest of what was set aside for ${one ? "it" : "them"} goes back to your card.`);
  }
  return lines.join("\n");
}

/** One payment of a member's call, as the note needs it. */
export type CallPayment = { callId: string; startsAt: Date; cancelledAt: Date | null; status: string; chargedCents: number | null; refundedCents: number; chargeReason: string | null };

/**
 * The calls of the month for the member's email, one line for each call (not for each payment): what stays paid
 * for now, after anything that was already given back, and how many calls had begun or were cancelled and are not
 * worked out yet. A call of which nothing is kept is not listed.
 */
export function callsForNote(payments: CallPayment[], at: Date): { stays: Array<{ startsAt: Date; keptCents: number; why: "used" | "late" }>; unsettled: number } {
  const byCall = new Map<string, { startsAt: Date; keptCents: number; late: boolean; open: boolean }>();
  for (const p of payments) {
    const call = byCall.get(p.callId) ?? { startsAt: p.startsAt, keptCents: 0, late: false, open: false };
    if (p.status === "charged") {
      call.keptCents += Math.max(0, (p.chargedCents ?? 0) - p.refundedCents);
      if (p.chargeReason === "late_cancel") call.late = true;
    }
    if (p.status === "held" && (p.startsAt <= at || p.cancelledAt !== null)) call.open = true;
    byCall.set(p.callId, call);
  }
  const all = [...byCall.values()];
  return { stays: all.filter((call) => call.keptCents > 0).map((call) => ({ startsAt: call.startsAt, keptCents: call.keptCents, why: call.late ? ("late" as const) : ("used" as const) })), unsettled: all.filter((call) => call.open).length };
}

/**
 * Who presses: the member, on their own membership; the founder, for a request that came in writing; or the
 * helper, which only ever finishes a request that is already on record, as whoever asked it.
 */
export type Canceller = { as: "member"; memberId: string } | { as: "founder"; adminId: string; requestDay: string } | { as: "helper" };

/**
 * The request passed every rule and is on record, but could not be finished just now. Not a refusal: calls may
 * have been cancelled already, and the helper goes on with it.
 */
export class NotFinishedYet extends MembershipError {}
/** Only inside this file: the second look found the membership ended this very way by another press of the same request. */
class FinishedMeanwhile extends MembershipError {}

/** What whoever pressed is told when it could not be finished: it is on record, and what happens next. */
export const ON_RECORD = "The request is on record with the moment it was first made, so the 14 days cannot run out on it. Connect keeps trying to finish it by itself; you can also press again in a minute.";
/** A call still to come could not be cancelled just now (the database, say): the membership is not ended yet. */
export const CALLS_NOT_CANCELLED = `One of the calls booked from this membership could not be cancelled just now, so the membership was not cancelled yet. ${ON_RECORD}`;
/** The month's money is being taken at this very moment: its outcome is not known yet, so nothing is ended yet. */
export const BEING_TAKEN = `This month's payment is being taken at this moment, so the membership was not cancelled yet. ${ON_RECORD}`;
/**
 * A rule stopped it after the request was on record and the cancelling had begun (a bank's question that arrived
 * in that moment, say). Added to the rule's own sentence: not "nothing was changed".
 */
export const STOPPED_MEANWHILE = "This came up while the cancelling was under way: calls booked from this membership that were still to come may already have been cancelled. The request stays on record.";
/** The helper was asked to finish a request that is not on record: it never makes one up. */
export const NOTHING_ON_RECORD = "No request to cancel this membership within 14 days is on record for its current month.";

/**
 * With every lock held (the host's calendar, the two people, the membership, its current month, in the one order):
 * whether this membership may be cancelled this way at this moment, and for whom. Throws a sentence for whoever
 * pressed when not.
 *
 * The one thing it writes: when every rule has passed and no request is on record for this month yet, the request
 * is written down, with this moment. That is the member's own press on one of the 14 days, or the founder's form
 * with a day that counts; nothing else can make one. The helper never does: it only finishes what is on record.
 *
 * With a request on record, a later press is not asked about the 14 days again, and it is finished as whoever
 * asked first: a later press never changes who asked or on which day. Everything else is asked again, as it
 * stands now: the first month's end, a bank's question, a payment with a problem.
 *
 * `fixedAt` is the moment of a first look that already said yes: the second look, right before the ending, judges
 * the month's end by that same moment, so that a press a second before the month ends is not refused a second
 * after it with its calls already cancelled.
 *
 * `taking` says that the month's money is being taken at this very moment. That is handed back, not thrown: the
 * request that was just written down must stay written down.
 */
async function decide(tx: Tx, input: { membershipId: string; by: Canceller; shownMonthId?: string; now?: Date }, fixedAt?: Date): Promise<{ membership: Membership; month: MembershipMonth; joinedAt: Date; at: Date; /** Who asked first: the request on record, or this press when it is the first. */ who: Asker; taking: boolean }> {
  const { by } = input;
  const [found] = await tx.select({ hostId: schema.memberships.hostId, customerId: schema.memberships.customerId }).from(schema.memberships).where(eq(schema.memberships.id, input.membershipId));
  // Someone else's membership and one that does not exist look the same.
  if (!found || (by.as === "member" && found.customerId !== by.memberId)) throw new MembershipError("Membership not found.");
  await lockCalendar(tx, found.hostId);
  await lockPeople(tx, [found.hostId, found.customerId]);
  const membership = await lockMembership(tx, input.membershipId);
  // The second look of a press whose first look said yes: if the membership has ended this very way meanwhile,
  // another press of the same request got there first (the member's second press, or the helper).
  if (fixedAt && membership.status === "ended" && membership.endedReason === FOURTEEN_DAYS_REASON && membership.fourteenAskedAt) throw new FinishedMeanwhile(WHY_FOR_FOUNDER.ended);
  // Its current month is locked before anything is judged (a collection, or the taking of the money, can hold it).
  if (membership.currentMonthId) await lockMonth(tx, membership.currentMonthId);
  // The moment is taken only now, with every lock held: which side of the month's end, and of the last day, it
  // falls on decides everything, and the wait for a lock must not move it back.
  const at = fixedAt ?? (input.now ? new Date(Math.max(input.now.getTime(), Date.now())) : new Date());
  // The month, read again under its lock, is the one that is judged.
  const judged = await fourteenDayCase(tx, membership, at);
  if (!judged.ok) throw new MembershipError((by.as === "member" ? WHY_FOR_MEMBER : WHY_FOR_FOUNDER)[judged.why]);
  const month = judged.month;
  // The form was drawn for one month. If the membership's current month is another one by now, nothing is cancelled.
  if (input.shownMonthId && input.shownMonthId !== month.id) throw new MembershipError(MOVED_ON);
  const onRecord = requestOnRecord(membership, month.id);
  // The helper finishes a request as whoever asked it, and has nothing to finish without one.
  if (by.as === "helper" && !onRecord) throw new MembershipError(NOTHING_ON_RECORD);
  // With a request on record, it is finished as whoever asked first, on the day that is on record: whoever presses
  // now only finishes it, and the day the founder's form carries is not looked at. Without one, this press is judged.
  let who: Asker;
  if (onRecord) who = onRecord.by;
  else if (by.as === "member") {
    if (!memberInTime({ joinedAt: judged.joinedAt, now: at, onRecord })) throw new MembershipError(DAYS_OVER_FOR_MEMBER);
    who = { as: "member" };
  } else if (by.as === "founder") {
    const refusal = requestDayRefusal({ requestDay: by.requestDay, joinedAt: judged.joinedAt, now: at });
    if (refusal) throw new MembershipError(refusal);
    who = { as: "founder", adminId: by.adminId, requestDay: by.requestDay };
  } else throw new MembershipError(NOTHING_ON_RECORD);
  // Every rule has passed. The first time that happens, it is written down, before anything is cancelled.
  let recorded = membership;
  if (!onRecord) {
    [recorded] = await tx
      .update(schema.memberships)
      .set({ fourteenAskedAt: at, fourteenMonthId: month.id, fourteenAdminId: who.as === "founder" ? who.adminId : null, fourteenRequestDay: who.as === "founder" ? who.requestDay : null, updatedAt: at })
      .where(eq(schema.memberships.id, membership.id))
      .returning();
  }
  // If the month's money is being taken at this very moment, its outcome is not known yet.
  const [taking] = await tx.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.monthId, month.id), eq(schema.moneyOperations.kind, "capture"), eq(schema.moneyOperations.status, "started")));
  return { membership: recorded, month, joinedAt: judged.joinedAt, at, who, taking: Boolean(taking) };
}

/**
 * Cancels a new membership within the 14 days. Refuses, with a sentence for whoever pressed, whenever the case is
 * not the plain one. Then, in this order:
 *
 *   1. the request is on record (the first look writes it down, if it is the first that passed every rule);
 *   2. the calls booked from the membership that are still to come are cancelled (their time goes back into the
 *      month, as for any call Connect cancels);
 *   3. only then the membership is ended, in one step, and the month's free money is owed back to the card by the
 *      clean-up every ending has.
 *
 * The order matters. An ending is saved before its clean-up runs, and a clean-up that came late would pass over a
 * call that had started meanwhile: the member, told that their calls are cancelled, would be charged for it. Here
 * no call is still to come when the membership ends. A call that had already begun is worked out as usual, and
 * the member's email says so.
 *
 * If step 2 or 3 cannot finish, nothing is ended and `NotFinishedYet` is thrown; calls that were cancelled stay
 * cancelled, with their time back in the month. The request stays on record, so the same press later (by the
 * member, the founder, or the helper, see `runFourteenDayRequests`) is not too late, whatever the day is by then.
 *
 * The membership is ended as whoever asked: the member's own account, or "admin" for a request in writing.
 *
 * Pressed twice, the second press finds the membership ended and refuses, so nothing is paid back twice.
 */
export async function cancelWithin14Days(input: { membershipId: string; by: Canceller; /** The month the form was drawn for: if another one is current by now, nothing is cancelled. */ shownMonthId?: string; now?: Date }): Promise<void> {
  const { by } = input;
  // A first look: every refusal comes before any call is cancelled, and the request is on record from here on.
  const first = await db.transaction(async (tx) => {
    const { at, taking, month } = await decide(tx, input);
    return { at, taking, monthId: month.id };
  });
  if (first.taking) throw new NotFinishedYet(BEING_TAKEN);
  // The calls still to come, of this month alone: a month that begins while this is under way is none of its
  // business. (Each call in a step of its own, with its own locks: the membership's are not held here.)
  // If even the list of them cannot be read, that is "not finished" like a call that would not cancel: the request
  // is on record by now, and whoever pressed is told so, not "we could not confirm what happened".
  const callsDone = await cancelUpcomingMemberCalls(input.membershipId, first.at, first.monthId).catch((error) => {
    console.error(`[membership] could not look for the coming calls of membership ${input.membershipId}, which is being cancelled within 14 days; will retry`, error);
    return false;
  });
  if (!callsDone) {
    // Unless another press of the same request has finished it meanwhile (no lock of the membership is held here):
    // then this press has what it asked for.
    if (await finishedThisWay(input.membershipId)) return;
    throw new NotFinishedYet(CALLS_NOT_CANCELLED);
  }

  // The ending, judged once more under the locks, by the moment of the first look, and for the same month.
  let ended: boolean;
  try {
    ended = await db.transaction(async (tx) => {
      const { membership, month, joinedAt, at, who, taking } = await decide(tx, { ...input, shownMonthId: first.monthId }, first.at);
      if (taking) throw new NotFinishedYet(BEING_TAKEN);
      // The payments of this month's calls (a call can have more than one: its own, and time added from the membership).
      const payments = await tx
        .select({ callId: schema.calls.id, startsAt: schema.calls.startsAt, cancelledAt: schema.calls.cancelledAt, status: schema.payments.status, chargedCents: schema.payments.chargedCents, refundedCents: schema.payments.refundedCents, chargeReason: schema.payments.chargeReason })
        .from(schema.payments)
        .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
        .where(and(eq(schema.payments.monthId, month.id), eq(schema.payments.kind, "member_call")))
        .orderBy(schema.calls.startsAt);
      // Judged by the clock as it is now, not by the first look: a call that began while the coming ones were being
      // cancelled has begun.
      const calls = callsForNote(payments, new Date(Math.max(at.getTime(), Date.now())));
      const [member] = await tx.select({ timeZone: schema.user.timeZone }).from(schema.user).where(eq(schema.user.id, membership.customerId));
      const note = fourteenDayNote({
        requestDay: who.as === "founder" ? who.requestDay : null,
        monthTaken: month.status === "running",
        stays: calls.stays.map((call) => ({ when: whenFor(member ?? { timeZone: null }, call.startsAt), amount: money(call.keptCents), why: call.why })),
        unsettled: calls.unsettled,
      });

      // The founder's record, one line: under the founder who pressed now, or, when the member or the helper
      // finished a request in writing, under the founder who entered it. Who entered it and the day it arrived are
      // always in the line (and stay on the membership itself).
      const action = { action: "membership cancelled within 14 days", targetUserId: membership.customerId, targetId: membership.id };
      if (who.as === "founder") {
        const finishedBy = by.as === "helper" ? " Finished by the helper: it could not be finished when the form was pressed." : by.as === "member" ? " Finished by the member's own press: it could not be finished when the form was pressed." : by.adminId !== who.adminId ? ` Entered by another admin (${who.adminId}), who could not finish it; finished with the form.` : "";
        await recordAdminAction({ ...action, adminId: by.as === "founder" ? by.adminId : who.adminId, detail: `The request reached Connect on ${who.requestDay}; joined ${dayOf(joinedAt)}.${finishedBy}` }, tx);
      } else if (by.as === "founder") {
        await recordAdminAction({ ...action, adminId: by.adminId, detail: `The member pressed their own button on ${dayOf(membership.fourteenAskedAt ?? at)}, and it could not be finished then; finished with the founder's form. Joined ${dayOf(joinedAt)}.` }, tx);
      }
      // (Who ended it: "admin", or the member's own account, as for every ending. It is whoever asked first.)
      return endMembership(tx, membership, { by: who.as === "founder" ? "admin" : membership.customerId, reason: FOURTEEN_DAYS_REASON, memberNote: note }, at);
    });
  } catch (error) {
    // Another press of the same request got there first: this press has what it asked for, and adds nothing.
    if (error instanceof FinishedMeanwhile) return;
    // A rule that stops it only now, with the request on record and calls perhaps cancelled: said as that, never
    // as "nothing was changed".
    if (error instanceof MembershipError && !(error instanceof NotFinishedYet)) throw new NotFinishedYet(`${error.message} ${STOPPED_MEANWHILE}`);
    throw error;
  }
  // The clean-up: the hold let go, free money owed back, and any call booked in the moment between. The helper
  // repeats it until it is done. (Its clock is read now: a moment handed in before the wait for the locks would
  // date the clean-up before the ending.)
  if (ended) await cleanUpEnding(input.membershipId, new Date(Math.max(first.at.getTime(), Date.now()))).catch((error) => console.error(`[membership] the clean-up of membership ${input.membershipId}, cancelled within 14 days, did not finish; the helper will retry`, error));
}

/** Whether the membership has ended by a cancelling within 14 days. Read without a lock: an ending is for good. */
async function finishedThisWay(membershipId: string): Promise<boolean> {
  const [now] = await db.select({ status: schema.memberships.status, endedReason: schema.memberships.endedReason }).from(schema.memberships).where(eq(schema.memberships.id, membershipId));
  return now?.status === "ended" && now.endedReason === FOURTEEN_DAYS_REASON;
}

/** A press is left this long to finish by itself before the helper takes its request up. */
const LEFT_TO_FINISH_MS = 60_000;
/** The memberships a request on record could still be finished for: live, and still in the month it was asked for. */
const LIVE = ["joining", "active", "unpaid"];

/**
 * For the helper: requests on record that were not finished (a call could not be cancelled, or the month's money
 * was being taken) are finished, as whoever asked them, without anybody pressing again. Only a membership that is
 * still in the month the request was for is looked at, and only while the case is open as it stands now: one that
 * a rule stops (a bank's question, a payment with a problem) waits for the founder, whose page lists it.
 *
 * Every such request gets its turn in every round, page after page (`batch` at a time): ones that a rule stops,
 * or that keep failing, never keep a later one from being tried.
 *
 * `only` keeps it to these memberships. The helper never passes it; a check script does, so that its moved clock
 * cannot finish anybody else's request in a database it shares.
 */
export async function runFourteenDayRequests(now: Date, opts: { batch?: number; only?: string[] } = {}): Promise<void> {
  const m = schema.memberships;
  const batch = opts.batch ?? 50;
  if (opts.only && opts.only.length === 0) return;
  const old = new Date(now.getTime() - LEFT_TO_FINISH_MS);
  let after: { askedAt: Date; id: string } | null = null;
  for (;;) {
    const page: Membership[] = await db
      .select()
      .from(m)
      .where(and(isNotNull(m.fourteenAskedAt), lte(m.fourteenAskedAt, old), inArray(m.status, LIVE), eq(m.currentMonthId, m.fourteenMonthId), opts.only ? inArray(m.id, opts.only) : undefined, after ? or(gt(m.fourteenAskedAt, after.askedAt), and(eq(m.fourteenAskedAt, after.askedAt), gt(m.id, after.id))) : undefined))
      .orderBy(m.fourteenAskedAt, m.id)
      .limit(batch);
    for (const membership of page) {
      try {
        // Asked without a lock first, so that a case a rule stops is not locked round after round.
        if (!(await fourteenDayCase(db, membership, now)).ok) continue;
        await cancelWithin14Days({ membershipId: membership.id, by: { as: "helper" }, shownMonthId: membership.fourteenMonthId ?? undefined, now });
        console.log(`[membership] finished the cancelling within 14 days of membership ${membership.id}, asked on ${dayOf(membership.fourteenAskedAt!)}`);
      } catch (error) {
        if (error instanceof MembershipError) console.log(`[membership] the cancelling within 14 days of membership ${membership.id} is not finished yet: ${error.message}`);
        else console.error(`[membership] could not finish the cancelling within 14 days of membership ${membership.id}; will retry`, error);
      }
    }
    if (page.length < batch) return;
    const last = page[page.length - 1];
    after = { askedAt: last.fourteenAskedAt!, id: last.id };
  }
}

/** A request on record that is not finished, for the founder's page. */
export type OpenRequest = {
  membershipId: string;
  askedDay: string;
  by: Asker;
  /** Why it cannot be finished as things stand, in the founder's sentence; null when it can, and the helper is at it. */
  stoppedBy: string | null;
  /** It can never be finished by the button any more (its month has ended): the founder settles it, and then says so. */
  byHand: boolean;
};

/** The request was in time and was not finished before its month ended: the founder's sentence. */
export const MONTH_ENDED_UNFINISHED = "The first month ended before this could be finished. Its unused money may have gone to the host, and a second month may have begun or the membership may be paused or ended: settle this case by hand, then press \"Settled by hand\".";
/** The founder's record of having settled such a request by hand. It takes the request off the list. */
export const SETTLED_BY_HAND = "14-day request settled by hand";

/**
 * Where a request on record stands, for the founder: null when there is nothing for the founder to see (none on
 * record, or it was finished, or nothing is owed).
 *
 *   - The membership ended by this very cancelling: finished.
 *   - Still in the month of the request: the helper is at it, or a rule stops it for now.
 *   - Past that month (a second month, paused, or ended some other way after that month's end): it can no longer
 *     be finished by the button, and the first month's unused money was not paid back. The founder settles it.
 *   - Two cases where nothing is owed: the month was given up with nothing taken (the member's "Cancel now",
 *     say); or the membership ended some other way before that month's end, which pays the unused money back
 *     like any ending.
 */
async function openRequestOf(membership: Membership, now: Date): Promise<OpenRequest | null> {
  if (!membership.fourteenAskedAt || !membership.fourteenMonthId) return null;
  if (membership.status === "ended" && membership.endedReason === FOURTEEN_DAYS_REASON) return null;
  const onRecord = requestOnRecord(membership, membership.fourteenMonthId)!;
  const line = (stoppedBy: string | null, byHand: boolean): OpenRequest => ({ membershipId: membership.id, askedDay: dayOf(onRecord.askedAt), by: onRecord.by, stoppedBy, byHand });
  if (membership.currentMonthId === membership.fourteenMonthId && LIVE.includes(membership.status)) {
    const judged = await fourteenDayCase(db, membership, now);
    return line(judged.ok ? null : WHY_FOR_FOUNDER[judged.why], false);
  }
  const [month] = await db.select({ status: schema.membershipMonths.status, endsAt: schema.membershipMonths.endsAt }).from(schema.membershipMonths).where(eq(schema.membershipMonths.id, membership.fourteenMonthId));
  if (!month || month.status === "given_up") return null;
  if (membership.status === "ended" && membership.endedAt && month.endsAt && membership.endedAt < month.endsAt) return null;
  return line(MONTH_ENDED_UNFINISHED, true);
}

/**
 * For the founder's page: every request on record that is not finished and not settled. Normally none: a press
 * finishes in the same moment, and the helper finishes what a press could not. What stays here is what a rule
 * stops (a bank's question, a payment with a problem), and what can no longer be finished because the first month
 * ended first. The second kind stays, whatever becomes of the membership, until the founder has settled it by
 * hand and said so (`settleFourteenDayRequestByHand`).
 */
export async function openFourteenDayRequests(memberships: Membership[], now: Date): Promise<OpenRequest[]> {
  const withOne = memberships.filter((membership) => membership.fourteenAskedAt && membership.fourteenMonthId && !(membership.status === "ended" && membership.endedReason === FOURTEEN_DAYS_REASON));
  if (withOne.length === 0) return [];
  const settled = new Set((await db.select({ id: schema.adminActions.targetId }).from(schema.adminActions).where(and(eq(schema.adminActions.action, SETTLED_BY_HAND), inArray(schema.adminActions.targetId, withOne.map((membership) => membership.id))))).map((row) => row.id));
  const open: OpenRequest[] = [];
  for (const membership of withOne) {
    if (settled.has(membership.id)) continue;
    const request = await openRequestOf(membership, now);
    if (request) open.push(request);
  }
  return open;
}

/**
 * The founder says that a request which could not be finished before its month ended has been settled by hand. It
 * is written on the founder's record, once, and the request leaves the list. Only for a request that can no longer
 * be finished by the button: one the helper can still finish, or that only waits for a rule, is refused.
 */
export async function settleFourteenDayRequestByHand(input: { membershipId: string; adminId: string; now?: Date }): Promise<void> {
  await db.transaction(async (tx) => {
    const membership = await lockMembership(tx, input.membershipId);
    const [before] = await tx.select({ id: schema.adminActions.id }).from(schema.adminActions).where(and(eq(schema.adminActions.action, SETTLED_BY_HAND), eq(schema.adminActions.targetId, membership.id))).limit(1);
    if (before) return; // pressed twice
    const request = await openRequestOf(membership, input.now ?? new Date());
    if (!request) throw new MembershipError("There is no request to cancel this membership within 14 days that is waiting to be settled.");
    if (!request.byHand) throw new MembershipError("This request can still be finished with the form on the membership, so there is nothing to settle by hand yet.");
    await recordAdminAction({ adminId: input.adminId, action: SETTLED_BY_HAND, targetUserId: membership.customerId, targetId: membership.id, detail: `Asked on ${request.askedDay}${request.by.as === "founder" ? ` (in writing, reached Connect on ${request.by.requestDay})` : " (the member's own button)"}; the first month ended before it could be finished.` }, tx);
  });
}

/** For the founder's page: the memberships the button applies to right now, each with the day of joining, the last day, and the day to enter for a request that is already on record. */
export async function fourteenDayCases(memberships: Membership[], now: Date): Promise<Map<string, { monthId: string; joinedDay: string; lastDay: string; onRecordDay: string | null }>> {
  const cases = new Map<string, { monthId: string; joinedDay: string; lastDay: string; onRecordDay: string | null }>();
  for (const membership of memberships) {
    if (!membership.currentMonthId || !LIVE.includes(membership.status)) continue;
    const judged = await fourteenDayCase(db, membership, now);
    if (!judged.ok) continue;
    const onRecord = requestOnRecord(membership, judged.month.id);
    // Shown for the whole first month: a request that arrived in time may be handled some days after the last day.
    // With a request on record, the day that counts is its own: the day the member pressed, or the day the founder entered.
    cases.set(membership.id, { monthId: judged.month.id, joinedDay: dayOf(judged.joinedAt), lastDay: judged.lastDay, onRecordDay: onRecord ? (onRecord.by.as === "founder" ? onRecord.by.requestDay : dayOf(onRecord.askedAt)) : null });
  }
  return cases;
}

/** What the member's page says when a request is on record and a rule stops it for now. No button is shown with it. */
export const BLOCKED_FOR_MEMBER: Record<"problem" | "bank", string> = {
  problem: "It cannot be finished while there is a problem with this month's payment, which we are looking into. You do not need to do anything: your request stays on record, and we will write to you.",
  bank: "It cannot be finished while your bank is looking at this month's payment. Your request stays on record.",
};

/** What the member's own page needs to know about cancelling within 14 days. */
export type OwnFourteenDays = {
  /** The last day (UTC) of the 14; null when the button is not offered. */
  lastDay: string | null;
  /** A request on record that is not finished: the day it counts from (the day the member pressed, or the day their request in writing reached Connect). */
  asked: { day: string; inWriting: boolean } | null;
  /** Only with a request on record: the rule that stops it for now, in a sentence for the member. Then there is no button. */
  blockedBy: string | null;
};

/**
 * For the member's own page: whether their own button is open, or null when there is nothing to show. With a
 * request on record that is not finished, the button stays, also after the last day. If a rule stops such a
 * request for now (a payment with a problem, a bank's question), the page still says that it is on record and
 * what stops it, without the button: pressing would only be refused.
 */
export async function ownFourteenDays(membership: Membership, now: Date): Promise<OwnFourteenDays | null> {
  const asked = (onRecord: RequestOnRecord) => (onRecord.by.as === "founder" ? { day: onRecord.by.requestDay, inWriting: true } : { day: dayOf(onRecord.askedAt), inWriting: false });
  const judged = await fourteenDayCase(db, membership, now);
  if (!judged.ok) {
    const onRecord = (judged.why === "problem" || judged.why === "bank") && membership.currentMonthId ? requestOnRecord(membership, membership.currentMonthId) : null;
    return onRecord && (judged.why === "problem" || judged.why === "bank") ? { lastDay: null, asked: asked(onRecord), blockedBy: BLOCKED_FOR_MEMBER[judged.why] } : null;
  }
  const onRecord = requestOnRecord(membership, judged.month.id);
  if (!memberInTime({ joinedAt: judged.joinedAt, now, onRecord })) return null;
  return { lastDay: judged.lastDay, asked: onRecord ? asked(onRecord) : null, blockedBy: null };
}
