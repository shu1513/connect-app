/**
 * What follows when a membership is ended at once, and what a bank dispute does.
 *
 * Ending itself is one database step (`endMembership`, state.ts), saved together with whatever
 * caused it. This file is the work after that step: the clean-up, which the helper repeats until
 * all of it is done.
 *
 * Part 1b adds the people who ask for an ending or a pause here (the two stops and their undoing,
 * "Cancel now", the host's own "End membership", the offer of less time).
 */
import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { whyNoNewPayment } from "@/lib/disputes/paying";
import { db, schema } from "@/db";
import type { Membership } from "@/db/schema";
import { blocksMoney } from "@/lib/disputes/status";
import { cancelCall } from "@/lib/payments/cancel";
import { MoneyError, type Tx } from "@/lib/payments/operations";
import { stripe } from "@/lib/payments/stripe";
import { abandonMonth, giveUpInStep, letHoldGo } from "./charge";
import { ACCOUNT_PAUSE, queueLessTimeOutcomeEmail, queueRenewalBackEmail, queueRenewalStoppedEmail } from "./emails";
import { endInvitation, lockPeople, mustBeFreeToAgree, mustBeOpen } from "./join";
import { lockCalendar, lockForMonth, lockMembership, lockMonth, type LockedMonth } from "./locks";
import { finishIfSettled, owePayBack, setDispute } from "./months";
import { wouldKeepPlace } from "./room";
import { afterTheWait, isFrozen, MembershipError } from "./rules";
import { endMembership } from "./state";

// Ending at once and pausing (the rulebook's "How the parts connect" hands them over with the clean-up).
export { endMembership, pauseMembership } from "./state";

const months = schema.membershipMonths;

/** Paused because one of its two accounts was paused (plans/53): settled like an ending, and it can be resumed. */
const pausedWithAccount = (membership: Pick<Membership, "status" | "pausedReason">) => membership.status === "paused" && membership.pausedReason === ACCOUNT_PAUSE;
/** A membership that stopped before its time and is tidied up after: ended, or paused with an account. */
const stoppedAtOnce = (membership: Pick<Membership, "status" | "pausedReason">) => membership.status === "ended" || pausedWithAccount(membership);

/**
 * The moment a membership stopped at once: when it ended, or when it was paused with an account,
 * whichever came first (a membership paused that way and ended later stopped at the pause). Null
 * for one that did not stop like that.
 */
function stoppedAt(membership: Pick<Membership, "status" | "pausedReason" | "pausedAt" | "endedAt">): Date | null {
  const paused = (membership.status === "paused" || membership.status === "ended") && membership.pausedReason === ACCOUNT_PAUSE ? membership.pausedAt : null;
  const ended = membership.status === "ended" ? membership.endedAt : null;
  if (paused && ended) return paused < ended ? paused : ended;
  return paused ?? ended;
}

/**
 * THE one place in the clean-up that cancels a membership's upcoming member calls (the rulebook's
 * "How the parts connect"). Part two fills it. In part one there are no member calls, so there is
 * nothing to cancel. Returns whether none is left.
 *
 * `onlyMonthId` keeps it to the calls booked from one month: a cancelling within 14 days is about the first month
 * alone, and must never touch a call of a month that began while it was under way. The clean-up after an ending
 * leaves it out: then every coming call of the membership goes.
 */
export async function cancelUpcomingMemberCalls(membershipId: string, now: Date, onlyMonthId?: string, reason = "the membership ended"): Promise<boolean> {
  const upcoming = await db
    .select({ call: schema.calls, payment: schema.payments })
    .from(schema.payments)
    .innerJoin(months, eq(months.id, schema.payments.monthId))
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(eq(months.membershipId, membershipId), onlyMonthId ? eq(months.id, onlyMonthId) : undefined, eq(schema.payments.kind, "member_call"), isNull(schema.payments.extensionId), isNull(schema.calls.cancelledAt), gt(schema.calls.startsAt, now)));
  let noneLeft = true;
  for (const { call, payment } of upcoming) {
    try {
      // As Connect's cancellation: the money comes back, and with the membership ended it is owed to the card.
      // (Money of a month that is disputed stays set aside until the dispute is won.)
      await cancelCall({ call, payment, by: "admin", now, reason });
    } catch (error) {
      // A call that started meanwhile is under way: it is left alone and settles in the usual way.
      if (error instanceof MoneyError) continue;
      console.error(`[membership] could not cancel member call ${call.id} of membership ${membershipId}, which has ended or is being cancelled; will retry`, error);
      noneLeft = false;
    }
  }
  return noneLeft;
}

/**
 * A membership that stopped at once before a month's end (it ended, or it was paused with an
 * account): that month's free money is owed back to the card, once, and nothing of it expires.
 * One that stopped only after the month's end changes nothing for that month. The same test is
 * used by the clean-up and by the closing of a month, so the result is the same whichever gets
 * there first. A frozen month is left as it stands. (One pay-back for a month, whatever stopped
 * the membership: paused with an account and ended afterwards is still one.)
 */
export async function owedAfterEnding(tx: Tx, locked: LockedMonth): Promise<void> {
  const { membership, month } = locked;
  const stopped = stoppedAt(membership);
  if (!stopped || !month.endsAt || stopped >= month.endsAt) return;
  if (month.status !== "running" || isFrozen(month) || month.freeCents < 1) return;
  const reason = membership.status === "ended" ? "Your membership ended, so the time you had not used is paid back." : "Your membership was paused because one of the two accounts was paused, so the time you had not used is paid back.";
  await owePayBack(tx, month, { amountCents: month.freeCents, sourceKey: `ending:${month.id}`, reason });
}

/**
 * The clean-up after an ending, or after a pause with an account, safe to run as often as needed:
 * an open payment is cancelled or its hold let go; upcoming member calls are cancelled; free
 * money is owed back. A call under way and money still set aside are left to settle in the usual
 * way. Returns whether it is all done.
 */
export async function cleanUpEnding(membershipId: string, now: Date = new Date()): Promise<boolean> {
  const [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId));
  if (!membership || !stoppedAtOnce(membership) || membership.cleanupDoneAt) return true;
  const paused = pausedWithAccount(membership);

  const open = await db.select({ id: months.id }).from(months).where(and(eq(months.membershipId, membershipId), inArray(months.status, ["to_pay", "held"])));
  for (const month of open) await abandonMonth(month.id, paused ? "account_paused" : "ending", now);

  const callsDone = await cancelUpcomingMemberCalls(membershipId, now, undefined, paused ? "the membership was paused" : "the membership ended");

  const running = await db.select({ id: months.id }).from(months).where(and(eq(months.membershipId, membershipId), eq(months.status, "running")));
  for (const month of running) {
    await db.transaction(async (tx) => owedAfterEnding(tx, await lockForMonth(tx, month.id)));
  }

  return db.transaction(async (tx) => {
    const locked = await lockMembership(tx, membershipId);
    if (locked.cleanupDoneAt || !stoppedAtOnce(locked)) return true;
    const [stillOpen] = await tx.select({ id: months.id }).from(months).where(and(eq(months.membershipId, membershipId), inArray(months.status, ["to_pay", "held"]))).limit(1);
    if (stillOpen || !callsDone) return false;
    await tx.update(schema.memberships).set({ cleanupDoneAt: now, updatedAt: now }).where(eq(schema.memberships.id, membershipId));
    return true;
  });
}

/** Memberships that ended, or were paused with an account, and whose clean-up is not done: for the helper. */
export async function runEndings(now: Date): Promise<void> {
  const waiting = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(or(eq(schema.memberships.status, "ended"), and(eq(schema.memberships.status, "paused"), eq(schema.memberships.pausedReason, ACCOUNT_PAUSE))), isNull(schema.memberships.cleanupDoneAt)))
    .limit(50);
  for (const membership of waiting) {
    await cleanUpEnding(membership.id, now).catch((error) => console.error(`[membership] could not finish the clean-up of ended membership ${membership.id}; will retry`, error));
  }
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

/**
 * Records where the bank's dispute over a month's charge stands (the rulebook's "Disputes"), in
 * one step with the month:
 *   - open or lost: the month is frozen as it stands;
 *   - won: the month goes on from where it stood, and money that is still free is paid back,
 *     because the membership has ended.
 * Whenever this is the first we record of a dispute on this month, whatever its state already is
 * (and again when a new dispute opens after an earlier one was won),
 * the membership the two people have NOW is ended at once, also when the disputed month belongs
 * to an earlier period or to an earlier, ended membership of the same two. It is the one case
 * where an old month changes a membership.
 */
export async function recordMonthDispute(monthId: string, state: "open" | "won" | "lost", now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ membershipId: schema.memberships.id, hostId: schema.memberships.hostId, customerId: schema.memberships.customerId })
      .from(months)
      .innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId))
      .where(eq(months.id, monthId));
    if (!found) return;
    // The calendar lock first: nobody can make a new membership for these two while we look for the live one.
    await lockCalendar(tx, found.hostId);
    const [live] = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.hostId, found.hostId), eq(schema.memberships.customerId, found.customerId), ne(schema.memberships.status, "ended")));
    const locked = new Map<string, Membership>();
    for (const id of [...new Set([found.membershipId, ...(live ? [live.id] : [])])].sort()) locked.set(id, await lockMembership(tx, id));
    const month = await lockMonth(tx, monthId);

    const { month: marked, first } = await setDispute(tx, month, state, now);
    // Also a NEW dispute on a charge whose earlier dispute was won (a bank can dispute one payment more
    // than once): it ends the membership the two have by then, like the first one did.
    const again = month.dispute === "won" && state !== "won";
    if ((first || again) && live) await endMembership(tx, locked.get(live.id)!, { by: "connect", reason: "the member's bank disputed a membership payment" }, now);
    if (state === "won") {
      if (marked.freeCents > 0 && (marked.status === "running" || marked.status === "closed")) {
        await owePayBack(tx, marked, { amountCents: marked.freeCents, sourceKey: `won:${marked.id}`, reason: "Your membership ended, so the time you had not used is paid back." });
      } else {
        await finishIfSettled(tx, marked, now);
      }
    }
  });
}

/**
 * Asks Stripe where the disputes over a month's charge stand, all of them together, and records
 * it: lost if any is lost, open if any is still with the bank, otherwise won. Stripe is asked
 * once more after recording, so an answer that went stale while we waited is not the last word.
 *
 * Called by Stripe's messages, and by the helper every hour for as long as a month's dispute is
 * open, so that a month can never stay frozen because one message was lost or came out of order.
 */
export async function refreshMonthDispute(monthId: string, now: Date = new Date()): Promise<void> {
  const [month] = await db.select({ intentId: months.stripePaymentIntentId }).from(months).where(eq(months.id, monthId));
  if (!month?.intentId) return;
  let recorded: string | null = null;
  for (let round = 0; round < 3; round++) {
    const disputes = await stripe().disputes.list({ payment_intent: month.intentId, limit: 100 }).autoPagingToArray({ limit: 300 });
    if (disputes.length === 0) break;
    const state = disputes.some((dispute) => dispute.status === "lost") ? "lost" : disputes.some((dispute) => blocksMoney(dispute.status)) ? "open" : "won";
    if (state === recorded) break;
    await recordMonthDispute(monthId, state, now);
    recorded = state;
  }
  // Marked as looked at, so the helper's hourly look goes round all open disputes in turn.
  await db.update(months).set({ updatedAt: now }).where(eq(months.id, monthId));
}

/** For the helper: every month whose dispute is open is asked about again once an hour. */
export async function runDisputeLooks(now: Date): Promise<void> {
  const open = await db
    .select({ id: months.id })
    .from(months)
    .where(and(eq(months.dispute, "open"), lte(months.updatedAt, new Date(now.getTime() - 3_600_000))))
    .orderBy(months.updatedAt)
    .limit(25);
  for (const { id } of open) {
    await refreshMonthDispute(id, now).catch(async (error) => {
      console.error(`[membership] could not ask about the dispute over month ${id}; will retry in an hour`, error);
      // It still takes its turn, so one that keeps failing cannot keep the others from being asked about.
      await db.update(months).set({ updatedAt: now }).where(eq(months.id, id)).catch(() => undefined);
    });
  }
}

// ---------------------------------------------------------------------------
// Part 1b: the people who ask for a stop, a pause or an ending
// ---------------------------------------------------------------------------

const NOT_FOUND = "Membership not found.";
const noOffer = { offerId: null, offerMonthId: null, offeredMinutes: null, offeredAt: null } as const;

/** The membership with the host's calendar and itself locked, for the person who may act on it. Someone else's and one that does not exist look the same. */
async function lockedFor(tx: Tx, membershipId: string, actor: { as: "member" | "host"; id: string }): Promise<Membership> {
  const [found] = await tx.select({ hostId: schema.memberships.hostId, customerId: schema.memberships.customerId }).from(schema.memberships).where(eq(schema.memberships.id, membershipId));
  if (!found || (actor.as === "member" ? found.customerId : found.hostId) !== actor.id) throw new MembershipError(NOT_FOUND);
  await lockCalendar(tx, found.hostId);
  // The two people before the membership, as everywhere (the steps that pause or close an account take them in that order too).
  await lockPeople(tx, [found.hostId, found.customerId]);
  return lockMembership(tx, membershipId);
}

/**
 * The renewal is stopped: by the member ("Cancel membership", the normal way) or by the host
 * ("Pause after this month"). Nothing else changes: the paid month, its bookings and booking from
 * it all go on, and the membership is paused when the month ends. The two stops are kept apart,
 * and each side can only undo its own.
 *
 * A member who has no running month because a payment failed is paused at once instead, and the
 * open payment is cancelled.
 */
export async function stopRenewal(input: { membershipId: string; by: "member" | "host"; actorId: string; now: Date }): Promise<void> {
  const { membershipId, by, now } = input;
  const letGo = await db.transaction(async (tx) => {
    const membership = await lockedFor(tx, membershipId, { as: by, id: input.actorId });
    if (!membership.currentMonthId || !["active", "unpaid"].includes(membership.status)) throw new MembershipError(membership.status === "paused" ? "This membership is already paused." : "This membership cannot be cancelled at the moment.");
    const month = await lockMonth(tx, membership.currentMonthId);
    if (month.status === "to_pay") {
      // No month that has started (a payment being tried again, or a renewal only just written down):
      // paused at once, and the open payment is cancelled. Judged by the month, not by the membership's word for it.
      return (await giveUpInStep(tx, { membership, month }, "given_up", now, by === "member" ? "cancel_now" : "host")) ? month.id : null;
    }
    if (by === "member" ? membership.memberStoppedAt : membership.hostStoppedAt) return null; // pressed twice
    // The member's own cancelling, and the host's pause, both close an open offer of less time.
    await tx
      .update(schema.memberships)
      .set({ ...(by === "member" ? { memberStoppedAt: now } : { hostStoppedAt: now, pausedReason: null }), ...noOffer, updatedAt: now })
      .where(eq(schema.memberships.id, membershipId));
    if (month.endsAt) await queueRenewalStoppedEmail(tx, membership, by, month.endsAt, now);
    return null;
  });
  if (letGo) await letHoldGo(letGo, now).catch((error) => console.error(`[membership] could not let go of month ${letGo} yet; the helper will retry`, error));
}

/**
 * "Keep my membership", and the host undoing her pause: strictly before the paid month ends, and
 * only when everything joining needs is true and there is room for this member's next month.
 * Each side clears only its own stop. The member's side has two marks: their own cancelling, and
 * the stop that came when the host switched her membership off; "Keep my membership" clears both,
 * and the host can clear neither. Nothing is charged.
 */
export async function undoStop(input: { membershipId: string; by: "member" | "host"; actorId: string; now: Date }): Promise<void> {
  const { membershipId, by, now } = input;
  await db.transaction(async (tx) => {
    const membership = await lockedFor(tx, membershipId, { as: by, id: input.actorId });
    if (membership.status !== "active" || !membership.currentMonthId) throw new MembershipError("This membership can no longer be switched back on. If it is paused, it can be resumed.");
    if (!(by === "member" ? membership.memberStoppedAt || membership.offerStoppedAt : membership.hostStoppedAt)) return; // nothing of this side's to undo
    // A member's "No thanks" to an offer of less time always stands (the founder's decision): the host cannot undo that
    // pause. The member is paused when the month ends, and can resume later on her membership as it is then.
    if (by === "host" && membership.pausedReason === "offer") {
      throw new MembershipError("This member said \"No thanks\" to the smaller time, and that stands. Their membership is paused when this month ends; they can resume it later.");
    }
    const [month] = await tx.select({ endsAt: months.endsAt }).from(months).where(eq(months.id, membership.currentMonthId));
    if (!month?.endsAt || afterTheWait(now) >= month.endsAt) throw new MembershipError("The month has ended. A paused membership can be resumed.");
    await mustBeOpen(tx, membership.hostId, membership.customerId, { forTheHost: by === "host" });
    // Renewals back on is a new promise to pay: it is the member who is looked at, also when the host presses.
    await mustBeFreeToAgree(tx, membership.customerId, { forTheHost: by === "host" });
    // What still stops the renewal afterwards, if anything. Room is needed only if nothing does.
    const left = by === "member" ? (membership.hostStoppedAt ? (membership.pausedReason === "offer" ? ("declined" as const) : ("host" as const)) : null) : membership.memberStoppedAt ? ("member" as const) : membership.offerStoppedAt ? ("offer_off" as const) : null;
    if (!left && !(await wouldKeepPlace(tx, membership, membership.ownMinutes ?? 0))) {
      throw new MembershipError(by === "member" ? "The host's hours have no room for your next month, so the membership cannot be switched back on. It will be paused when this month ends, and you can resume it when there is room." : "Your weekly hours have no room for this member's next month.");
    }
    await tx
      .update(schema.memberships)
      .set({ ...(by === "member" ? { memberStoppedAt: null, offerStoppedAt: null } : { hostStoppedAt: null, pausedReason: null }), updatedAt: now })
      .where(eq(schema.memberships.id, membershipId));
    // The email says how things really stand: with another stop still there, nothing renews, and it names whose stop that is.
    await queueRenewalBackEmail(tx, membership, by, now, left);
  });
}

/**
 * "Cancel now, nothing is charged": while the month's amount is only held. The hold is let go,
 * the month given up and the membership paused today. It, the taking and a first booking all take
 * the membership's lock, so exactly one of them wins; the server accepts it until the money has
 * really been taken.
 */
export async function cancelNow(input: { membershipId: string; memberId: string; now: Date }): Promise<void> {
  const { membershipId, now } = input;
  const monthId = await db.transaction(async (tx) => {
    const membership = await lockedFor(tx, membershipId, { as: "member", id: input.memberId });
    if (!membership.currentMonthId || !["active", "unpaid"].includes(membership.status)) throw new MembershipError(membership.status === "paused" ? "This membership is already paused." : "This membership cannot be cancelled at the moment.");
    const month = await lockMonth(tx, membership.currentMonthId);
    if (month.status !== "held" && month.status !== "to_pay") {
      throw new MembershipError("This month's payment has already been taken, so it can no longer be cancelled at no charge. You can still cancel at the end of the month.");
    }
    // If the money is being taken at this very moment, its outcome is not known yet: nothing is promised until it is.
    const [taking] = await tx.select({ id: schema.moneyOperations.id }).from(schema.moneyOperations).where(and(eq(schema.moneyOperations.monthId, month.id), eq(schema.moneyOperations.kind, "capture"), eq(schema.moneyOperations.status, "started")));
    if (taking) throw new MembershipError("This month's payment is being taken at this moment. Please try again in a minute.");
    await giveUpInStep(tx, { membership, month }, "cancel_now", now);
    return month.id;
  });
  await letHoldGo(monthId, now).catch((error) => console.error(`[membership] could not let go of month ${monthId} yet; the helper will retry`, error));
}

/** The host's own "End membership": at once and for good. An invitation that is still open is taken back instead. */
export async function endByHost(input: { membershipId: string; hostId: string; now: Date }): Promise<void> {
  const ended = await db.transaction(async (tx) => {
    const membership = await lockedFor(tx, input.membershipId, { as: "host", id: input.hostId });
    if (membership.status === "invited") {
      await endInvitation(tx, membership, "taken_back", input.now);
      return false;
    }
    // The moment is taken now that the locks are held: which side of a month's end it falls on decides whether unused money is paid back.
    return endMembership(tx, membership, { by: "host", reason: "the host ended it" }, new Date(Math.max(input.now.getTime(), Date.now())));
  });
  if (ended) await cleanUpEnding(input.membershipId, input.now).catch((error) => console.error(`[membership] the clean-up of ended membership ${input.membershipId} did not finish; the helper will retry`, error));
}

// ---------------------------------------------------------------------------
// The offer of less time (the rulebook's row 16). It is made in the step that cuts the host's
// hours (booking/calendar.ts); here are the answers.
// ---------------------------------------------------------------------------

/** The member's open offer, checked to be the one the button was shown for and still answerable: strictly before their month ends. */
async function openOffer(tx: Tx, membership: Membership, offerId: string, now: Date): Promise<{ offeredMinutes: number }> {
  if (!membership.offerId || membership.offerId !== offerId || !membership.offeredMinutes || membership.status !== "active" || membership.offerMonthId !== membership.currentMonthId) {
    throw new MembershipError("This offer is no longer open.");
  }
  const [month] = await tx.select({ endsAt: months.endsAt }).from(months).where(eq(months.id, membership.offerMonthId!));
  // Judged by the moment the answer is really taken (the membership is locked by now), not by when it was sent.
  if (!month?.endsAt || afterTheWait(now) >= month.endsAt) throw new MembershipError("This offer is no longer open.");
  return { offeredMinutes: membership.offeredMinutes };
}

/**
 * The member accepts less time: recorded as a new agreement, charges nothing, and takes effect
 * with the next month that is written down. It never clears the member's own cancellation.
 */
export async function acceptLessTime(input: { membershipId: string; memberId: string; offerId: string; now: Date }): Promise<void> {
  const { membershipId, offerId, now } = input;
  await db.transaction(async (tx) => {
    const membership = await lockedFor(tx, membershipId, { as: "member", id: input.memberId });
    // The offer's own id names the agreement, so a button pressed twice agrees once.
    const [before] = await tx
      .select({ id: schema.membershipAgreements.id })
      .from(schema.membershipAgreements)
      .where(and(eq(schema.membershipAgreements.requestId, offerId), eq(schema.membershipAgreements.membershipId, membershipId), eq(schema.membershipAgreements.kind, "less_time")));
    if (before) return;
    // Taking the host's offer writes a new agreement to pay: a member with a chargeback cannot (plans/47, decision 9).
    // Asked after the look above, so a press repeated after it went through is still answered "done".
    const stopped = await whyNoNewPayment(tx, input.memberId);
    if (stopped) throw new MembershipError(stopped);
    const { offeredMinutes } = await openOffer(tx, membership, offerId, now);
    const [last] = await tx.select({ number: sql<number>`coalesce(max(${months.number}), 0)::int` }).from(months).where(eq(months.membershipId, membershipId));
    const [offer] = await tx.select({ version: schema.membershipOffers.version }).from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, membership.hostId));
    const [agreement] = await tx
      .insert(schema.membershipAgreements)
      .values({ membershipId, requestId: offerId, kind: "less_time", offerVersion: offer?.version ?? 0, pricePer15Cents: membership.ownPricePer15Cents ?? 0, minutes: offeredMinutes, firstMonthNumber: last.number + 1, at: now })
      .returning();
    await tx.update(schema.memberships).set({ ownMinutes: offeredMinutes, agreementId: agreement.id, ...noOffer, updatedAt: now }).where(eq(schema.memberships.id, membershipId));
    await queueLessTimeOutcomeEmail(tx, membership, { offerId, outcome: "accepted", offeredMinutes });
  });
}

/** "No thanks": the member keeps the month they paid for and is paused when it ends. */
export async function declineLessTime(input: { membershipId: string; memberId: string; offerId: string; now: Date }): Promise<void> {
  const { membershipId, offerId, now } = input;
  await db.transaction(async (tx) => {
    const membership = await lockedFor(tx, membershipId, { as: "member", id: input.memberId });
    const { offeredMinutes } = await openOffer(tx, membership, offerId, now);
    // The stop that came with the offer. Its reason is kept, so the pause at the month's end says why.
    await tx.update(schema.memberships).set({ hostStoppedAt: now, pausedReason: "offer", ...noOffer, updatedAt: now }).where(eq(schema.memberships.id, membershipId));
    await queueLessTimeOutcomeEmail(tx, membership, { offerId, outcome: "declined", offeredMinutes });
  });
}

/**
 * The host takes an unanswered offer back, by the id her button was shown for and only while it
 * can still be answered (strictly before the member's month ends): the member is kept with their
 * old time, if everything a new promise needs is true and there is room again, or paused after
 * this month.
 */
export async function takeBackLessTime(input: { membershipId: string; hostId: string; offerId: string; keep: boolean; now: Date }): Promise<void> {
  const { membershipId, offerId, keep, now } = input;
  await db.transaction(async (tx) => {
    const membership = await lockedFor(tx, membershipId, { as: "host", id: input.hostId });
    const { offeredMinutes } = await openOffer(tx, membership, offerId, now);
    if (keep) {
      await mustBeOpen(tx, membership.hostId, membership.customerId, { forTheHost: true });
      if (!(await wouldKeepPlace(tx, membership, membership.ownMinutes ?? 0))) throw new MembershipError("Your weekly hours have no room for this member's full time. Add hours first, or pause them after this month.");
    }
    await tx
      .update(schema.memberships)
      .set({ ...(keep ? {} : { hostStoppedAt: now, pausedReason: null }), ...noOffer, updatedAt: now })
      .where(eq(schema.memberships.id, membershipId));
    await queueLessTimeOutcomeEmail(tx, membership, { offerId, outcome: keep ? "taken_back_kept" : "taken_back_paused", offeredMinutes });
  });
}
