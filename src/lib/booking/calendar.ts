/**
 * A host's calendar settings: time zone, lengths, notice, weekly hours and
 * time off. Everything that changes them goes through here.
 */
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import type { HostCalendar } from "@/db/schema";
import { BREAK_CHOICES_MINUTES, DEFAULT_LENGTHS, HORIZON_CHOICES_WEEKS, LENGTH_CHOICES_MINUTES, NOTICE_CHOICES_HOURS } from "./rules";
import { isCalendarZone } from "./slots";
import { randomUUID } from "node:crypto";
import type { Membership } from "@/db/schema";
import { giveUpInStep, letHoldGo } from "@/lib/membership/charge";
import { queueLessTimeOfferEmail, queueLessTimeOutcomeEmail, queueRenewalStoppedEmail } from "@/lib/membership/emails";
import { endInvitation } from "@/lib/membership/join";
import { lockCalendar, lockMembership, lockMonth } from "@/lib/membership/locks";
import { hostMinutes, workOutCut, type Cut } from "@/lib/membership/room";
import { lessTimeProblem, timeWords } from "@/lib/membership/rules";
import type { Tx } from "@/lib/payments/operations";
import { membershipsOnFor } from "@/lib/safety/switches";

/** A problem the host can fix. Its message is safe to show them. */
export class CalendarError extends Error {}

const includes = (choices: readonly number[], value: number) => choices.includes(value);

/**
 * The host's calendar, created on first use in their own time zone, with calls from 30 minutes to
 * 2 hours. A calendar that already exists is left exactly as it is.
 */
export async function calendarOf(userId: string, fallbackZone: string | null): Promise<HostCalendar> {
  await db
    .insert(schema.hostCalendars)
    .values({ userId, timeZone: fallbackZone && isCalendarZone(fallbackZone) ? fallbackZone : "America/New_York", lengths: DEFAULT_LENGTHS.join(",") })
    .onConflictDoNothing();
  const [calendar] = await db.select().from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, userId));
  return calendar;
}

export async function saveCalendarChoices(
  userId: string,
  input: { timeZone: string; lengths: number[]; noticeHours: number; horizonWeeks: number; breakMinutes: number },
): Promise<void> {
  const lengths = [...new Set(input.lengths)].filter((n) => includes(LENGTH_CHOICES_MINUTES, n)).sort((a, b) => a - b);
  if (!isCalendarZone(input.timeZone)) throw new CalendarError("Choose your calendar's time zone from the list.");
  if (lengths.length === 0) throw new CalendarError("Offer at least one call length.");
  if (!includes(NOTICE_CHOICES_HOURS, input.noticeHours)) throw new CalendarError("Choose one of the listed notice periods.");
  if (!includes(HORIZON_CHOICES_WEEKS, input.horizonWeeks)) throw new CalendarError("Choose how far ahead you can be booked from the list.");
  if (!includes(BREAK_CHOICES_MINUTES, input.breakMinutes)) throw new CalendarError("Choose one of the listed breaks.");
  await db
    .update(schema.hostCalendars)
    .set({ timeZone: input.timeZone, lengths: lengths.join(","), noticeHours: input.noticeHours, horizonWeeks: input.horizonWeeks, breakMinutes: input.breakMinutes, updatedAt: new Date() })
    .where(eq(schema.hostCalendars.userId, userId));
}

/** "18:30" as minutes from midnight, or null. */
function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) <= 23 && Number(match[2]) <= 59 ? minutes : null;
}

/** A stretch of weekly hours as the host types it. "To" of 00:00 means midnight at the end of the day. */
export type HoursInput = { weekday: number; from: string; to: string; membersOnly?: boolean };
/** One change of weekly hours: a stretch removed, a stretch added, or both in one go (a stretch changed or moved). */
export type HoursChange = { remove?: string; add?: HoursInput };
/** What the host decided for one of her members in the step that cuts her hours. */
export type MemberChoice = { membershipId: string; choice: "keep" | "less" | "pause"; minutes?: number };

/** Applies one change to the weekly hours, inside the caller's step. Checks the typed times as before. */
async function applyHoursChange(tx: Tx, userId: string, change: HoursChange): Promise<void> {
  if (change.remove !== undefined) {
    const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(change.remove);
    const removed = valid ? await tx.delete(schema.weeklyHours).where(and(eq(schema.weeklyHours.id, change.remove), eq(schema.weeklyHours.hostId, userId))).returning({ id: schema.weeklyHours.id }) : [];
    // A stretch that is being changed or moved must still be there: otherwise this would add hours instead of moving them.
    if (change.add && removed.length === 0) throw new CalendarError("Those hours were changed in the meantime. Please look at your calendar again.");
    if (!valid) return;
  }
  if (change.add) {
    const start = minutesOf(change.add.from);
    const typedEnd = minutesOf(change.add.to);
    const weekday = change.add.weekday;
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new CalendarError("Choose a day of the week.");
    if (start === null || typedEnd === null) throw new CalendarError("Enter both times, for example 18:00 and 21:00.");
    const end = typedEnd === 0 ? 1440 : typedEnd;
    if (end <= start) throw new CalendarError("The end must be later than the start. To go past midnight, add the rest on the next day.");
    const sameDay = await tx.select().from(schema.weeklyHours).where(and(eq(schema.weeklyHours.hostId, userId), eq(schema.weeklyHours.weekday, weekday)));
    if (sameDay.some((h) => start < h.endMinute && end > h.startMinute)) throw new CalendarError("Those hours overlap hours you already have on that day.");
    if (sameDay.length >= 6) throw new CalendarError("That is a lot of separate hours for one day. Remove some first.");
    // The tick does not change the week's total, so it never starts the step for a cut in hours.
    await tx.insert(schema.weeklyHours).values({ hostId: userId, weekday, startMinute: start, endMinute: end, membersOnly: change.add.membersOnly === true });
  }
}

class NothingSaved extends Error {
  constructor(readonly cut: Cut) {
    super("nothing saved");
  }
}

/**
 * What a change of weekly hours would need of the host's members, worked out WITHOUT saving
 * anything: the change is made inside a step that is then thrown away. For the page that shows
 * the host her members and her choices before she confirms.
 */
export async function previewWeeklyHoursChange(userId: string, change: HoursChange, now: Date = new Date()): Promise<Cut> {
  try {
    await db.transaction(async (tx) => {
      await lockCalendar(tx, userId);
      await applyHoursChange(tx, userId, change);
      throw new NothingSaved(await workOutCut(tx, userId, now));
    });
  } catch (error) {
    if (error instanceof NothingSaved) return error.cut;
    throw error;
  }
  throw new Error("unreachable");
}

/**
 * Every change of weekly hours: one step under the host's calendar lock (the lock a booking and
 * a membership take), so hours cannot change while a time is being booked or a place is given.
 *
 * A change that leaves less than the host's members need for their next months is saved only
 * together with her choice for each of them (the rulebook's "When a host later offers fewer
 * hours"): keep, offer less time, or pause after this month, so that those she keeps fit. The
 * choices carry the mark of the preview they were made on; if anything about her members changed
 * since, nothing is saved. Without choices such a cut is refused with a plain sentence.
 *
 * Months that have started are never touched. Open invitations give way before members: the ones
 * that no longer fit beside what she owes are taken back, the oldest staying first.
 */
export async function changeWeeklyHours(userId: string, change: HoursChange, choices?: { mark: string; members: MemberChoice[] }, asOf: Date = new Date()): Promise<void> {
  let now = asOf;
  const letGo = await db.transaction(async (tx) => {
    await lockCalendar(tx, userId);
    // The clock is read again now that the lock is held: an offer of less time must still be answerable when it is saved, not when the wait for the lock began.
    now = new Date(Math.max(asOf.getTime(), Date.now()));
    const before = await hostMinutes(tx, userId);
    await applyHoursChange(tx, userId, change);
    // Hours that stay the same or grow promise nothing less: nothing more to do, and no member is looked at.
    if ((await hostMinutes(tx, userId)) >= before) {
      // Choices for members belong to a cut. If this change no longer makes the week shorter (the stretch was changed or
      // removed meanwhile), nothing is saved, so that nobody is told their choices were kept when they were not looked at.
      if (choices) throw new CalendarError("These hours were changed in the meantime, so there is nothing to choose for your members any more. Nothing was saved. Please look at your calendar again.");
      return [];
    }
    const cut = await workOutCut(tx, userId, now);
    if (cut.needed > cut.hoursAfter && !choices) {
      // Thrown inside the step, so the hours stay as they were.
      throw new CalendarError(`Your members' time would no longer fit: for their next months they need ${timeWords(cut.needed)} a month, and these hours would offer ${timeWords(cut.hoursAfter)}. Choose for each member whether to keep them, offer less time or pause them after this month.`);
    }
    return choices ? saveCut(tx, userId, cut, choices, now) : takeBackInvitations(tx, cut, now);
  });
  for (const monthId of letGo) {
    await letHoldGo(monthId, now).catch((error) => console.error(`[membership] could not let go of month ${monthId} yet; the helper will retry`, error));
  }
}

/** Invitations that no longer fit beside what the host owes are taken back. Returns nothing to let go. */
async function takeBackInvitations(tx: Tx, cut: Cut, now: Date): Promise<string[]> {
  for (const id of [...cut.invitationsTakenBack].sort()) await endInvitation(tx, await lockMembership(tx, id), "taken_back", now);
  return [];
}

/** Saves the host's choices for her members with the cut, in the same step. Returns the months whose open payment must be cancelled after it. */
async function saveCut(tx: Tx, userId: string, cut: Cut, choices: { mark: string; members: MemberChoice[] }, now: Date): Promise<string[]> {
  if (choices.mark !== cut.mark) throw new CalendarError("Something about your members changed while this page was open. Nothing was saved. Please look at it again.");
  const chosen = new Map(choices.members.map((choice) => [choice.membershipId, choice]));
  let kept = 0;
  for (const member of cut.members) {
    const choice = chosen.get(member.membershipId);
    if (!choice) throw new CalendarError("Choose for each member whether to keep them, offer less time or pause them after this month.");
    if (choice.choice === "less") {
      // Only a member whose month has started, and who has no open offer already: one offer at a time.
      if (!member.monthStarted || member.openOfferMinutes !== null) throw new CalendarError("Less time can only be offered to a member whose month has started and who has no open offer.");
      const problem = lessTimeProblem({ offeredMinutes: choice.minutes ?? 0, minutesNow: member.minutes });
      if (problem) throw new CalendarError(problem);
      kept += choice.minutes!;
    } else if (choice.choice === "keep") {
      // A member with an open offer who is kept is left with that offer, and counts with its smaller time.
      kept += member.openOfferMinutes ?? member.minutes;
    }
  }
  if (kept > cut.hoursAfter) throw new CalendarError(`The members you keep need ${timeWords(kept)} a month, and these hours offer ${timeWords(cut.hoursAfter)}. Pause more members, or offer less time.`);

  // Every membership this touches is locked first, in one order; their months only after.
  const locked = new Map<string, Membership>();
  for (const id of [...cut.members.map((member) => member.membershipId), ...cut.invitationsTakenBack].sort()) locked.set(id, await lockMembership(tx, id));
  const letGo: string[] = [];
  for (const member of cut.members) {
    const choice = chosen.get(member.membershipId)!;
    const membership = locked.get(member.membershipId)!;
    const month = membership.currentMonthId ? await lockMonth(tx, membership.currentMonthId) : null;
    if (choice.choice === "pause") {
      if (month?.status === "to_pay") {
        // No month that has started (a payment being tried, or a renewal only just written down): paused at once, and the open payment is cancelled.
        if (await giveUpInStep(tx, { membership, month }, "given_up", now, "host")) letGo.push(month.id);
        continue;
      }
      // Pausing takes an open offer back.
      await tx.update(schema.memberships).set({ hostStoppedAt: now, pausedReason: null, offerId: null, offerMonthId: null, offeredMinutes: null, offeredAt: null, updatedAt: now }).where(eq(schema.memberships.id, membership.id));
      if (membership.offerId && membership.offeredMinutes) await queueLessTimeOutcomeEmail(tx, membership, { offerId: membership.offerId, outcome: "taken_back_paused", offeredMinutes: membership.offeredMinutes });
      else if (month?.endsAt) await queueRenewalStoppedEmail(tx, membership, "host", month.endsAt, now);
    } else if (choice.choice === "less") {
      // An offer must still be answerable: the member has until their month ends, strictly before it.
      if (!month?.endsAt || month.endsAt <= now || (month.status !== "running" && month.status !== "held")) throw new CalendarError("This member's month has just ended, so less time can no longer be offered for it. Please look at the page again.");
      const offerId = randomUUID();
      await tx.update(schema.memberships).set({ offerId, offerMonthId: month.id, offeredMinutes: choice.minutes!, offeredAt: now, updatedAt: now }).where(eq(schema.memberships.id, membership.id));
      await queueLessTimeOfferEmail(tx, membership, { offerId, offeredMinutes: choice.minutes!, minutesNow: member.minutes, pricePer15Cents: membership.ownPricePer15Cents ?? 0, answerBy: month.endsAt });
    }
  }
  for (const id of cut.invitationsTakenBack) await endInvitation(tx, locked.get(id)!, "taken_back", now);
  return letGo;
}

/** Adds a stretch of weekly hours. */
export async function addWeeklyHours(userId: string, input: HoursInput): Promise<void> {
  await changeWeeklyHours(userId, { add: input });
}

/** Removes a stretch of weekly hours. Refused when the host's members would no longer fit and she has not chosen what happens to them. */
export async function removeWeeklyHours(userId: string, id: string): Promise<void> {
  await changeWeeklyHours(userId, { remove: id });
}

/** A date-and-time typed by the host ("2026-12-24T09:00"), read in their calendar's time zone. */
function momentIn(timeZone: string, typed: string): Date | null {
  try {
    return new Date(Temporal.PlainDateTime.from(typed).toZonedDateTime(timeZone, { disambiguation: "compatible" }).epochMilliseconds);
  } catch {
    return null;
  }
}

export async function addTimeOff(userId: string, timeZone: string, input: { from: string; to: string }, now: Date): Promise<void> {
  const startsAt = momentIn(timeZone, input.from);
  const endsAt = momentIn(timeZone, input.to);
  if (!startsAt || !endsAt) throw new CalendarError("Enter when your time off starts and ends.");
  if (endsAt <= startsAt) throw new CalendarError("The end must be later than the start.");
  if (endsAt <= now) throw new CalendarError("That time off is already over.");
  if (endsAt.getTime() - startsAt.getTime() > 366 * 24 * 3_600_000) throw new CalendarError("Time off can be at most a year long.");
  const existing = await db.select({ id: schema.timeOff.id }).from(schema.timeOff).where(and(eq(schema.timeOff.hostId, userId), gt(schema.timeOff.endsAt, now)));
  if (existing.length >= 50) throw new CalendarError("You have a lot of time off saved. Remove some first.");
  await db.insert(schema.timeOff).values({ hostId: userId, startsAt, endsAt });
}

export async function removeTimeOff(userId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.delete(schema.timeOff).where(and(eq(schema.timeOff.id, id), eq(schema.timeOff.hostId, userId)));
}

/**
 * Whether this host may keep hours for members only: the founder's memberships switch covers her,
 * or she already has such hours (months that are paid for go on while the switch is off, and so
 * do her members' hours). The calendar page and its action both ask here, so the tick is never
 * shown and then ignored.
 */
export async function mayKeepMemberHours(userId: string): Promise<boolean> {
  if (await membershipsOnFor(userId)) return true;
  const [has] = await db.select({ id: schema.weeklyHours.id }).from(schema.weeklyHours).where(and(eq(schema.weeklyHours.hostId, userId), eq(schema.weeklyHours.membersOnly, true))).limit(1);
  return Boolean(has);
}

export async function hoursAndTimeOff(userId: string, now: Date) {
  const [hours, off] = await Promise.all([
    db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, userId)).orderBy(asc(schema.weeklyHours.weekday), asc(schema.weeklyHours.startMinute)),
    db.select().from(schema.timeOff).where(and(eq(schema.timeOff.hostId, userId), gt(schema.timeOff.endsAt, now))).orderBy(asc(schema.timeOff.startsAt)),
  ]);
  return { hours, off };
}

/** 1110 → "18:30"; 1440 → "24:00". */
export function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A moment written out in a given time zone, for the host's own lists. */
export function inZone(timeZone: string, moment: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(moment);
}
