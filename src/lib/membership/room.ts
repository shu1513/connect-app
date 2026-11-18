/**
 * Room for members (the rulebook's "Room for members" and rows 9 to 12 of "The builder's
 * choices"): the time of all of a host's members together can never be more than the host's weekly
 * hours offer in four weeks. Every caller holds the host's calendar lock (locks.ts), so two people
 * cannot both get the last place and a place cannot be given while the hours are being cut.
 */
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership } from "@/db/schema";
import { hostMinutesInFourWeeks, placesKept } from "./rules";

type Reader = Pick<typeof db, "select">;

/** What the host's weekly hours offer in four weeks, in minutes. No calendar, or no weekly hours, means no room. */
export async function hostMinutes(reader: Reader, hostId: string): Promise<number> {
  const [calendar] = await reader.select({ userId: schema.hostCalendars.userId }).from(schema.hostCalendars).where(eq(schema.hostCalendars.userId, hostId));
  if (!calendar) return 0;
  const weekly = await reader.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, hostId));
  return hostMinutesInFourWeeks(weekly);
}

/**
 * Everything the host has already promised, in minutes, each with its own agreed time: every
 * member whose month is running or held (also one whose renewal is stopped) or whose payment is
 * being tried or who is at the card step, and every open invitation. Paused and ended memberships
 * do not count. `except` leaves one membership out (the one that is being asked about).
 */
export async function promisedMinutes(reader: Reader, hostId: string, now: Date, except?: string): Promise<number> {
  const rows = await reader
    .select({ id: schema.memberships.id, status: schema.memberships.status, ownMinutes: schema.memberships.ownMinutes, inviteMinutes: schema.memberships.inviteMinutes, inviteExpiresAt: schema.memberships.inviteExpiresAt, monthMinutes: schema.membershipMonths.includedMinutes })
    .from(schema.memberships)
    .leftJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.memberships.currentMonthId))
    .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.memberships.status, ["invited", "joining", "active", "unpaid"])));
  let total = 0;
  for (const row of rows) {
    if (row.id === except) continue;
    if (row.status === "invited") {
      if (row.inviteExpiresAt && row.inviteExpiresAt > now) total += row.inviteMinutes ?? 0;
    } else total += row.monthMinutes ?? row.ownMinutes ?? 0;
  }
  return total;
}

/** How many minutes are free for someone new (an invitation, a joining, a resuming). */
export async function roomLeft(reader: Reader, hostId: string, now: Date, except?: string): Promise<number> {
  return (await hostMinutes(reader, hostId)) - (await promisedMinutes(reader, hostId, now, except));
}

/**
 * Whether this member keeps their place for a next month: the one calculation of rules.ts
 * (placesKept), over every member of the host who wants a next month, with the host's hours as
 * they are now. A member whose renewal is stopped by either side does not want one. A member with
 * an open offer of less time counts with the smaller time, and one whose payment is being tried
 * keeps their turn.
 */
export async function keepsPlace(reader: Reader, membership: Pick<Membership, "id" | "hostId">): Promise<boolean> {
  const kept = placesKept({ hostMinutes: await hostMinutes(reader, membership.hostId), members: await wantingNextMonth(reader, membership.hostId) });
  return kept.has(membership.id);
}

/**
 * Every member of the host who wants a next month, with their time and since when they have been
 * a member. A member with an open offer of less time counts with the smaller time (the rulebook's
 * row 11): that is the time they can still say yes to.
 */
async function wantingNextMonth(reader: Reader, hostId: string): Promise<Array<{ id: string; since: Date; minutes: number }>> {
  const wanting = await reader
    .select({ id: schema.memberships.id, since: schema.memberships.since, createdAt: schema.memberships.createdAt, minutes: schema.memberships.ownMinutes, offerId: schema.memberships.offerId, offeredMinutes: schema.memberships.offeredMinutes })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.memberships.status, ["active", "unpaid"]), isNull(schema.memberships.memberStoppedAt), isNull(schema.memberships.hostStoppedAt), gt(schema.memberships.ownMinutes, 0)));
  return wanting.map((m) => ({ id: m.id, since: m.since ?? m.createdAt, minutes: (m.offerId ? m.offeredMinutes : null) ?? m.minutes ?? 0 }));
}

/** What the host's members need of her hours for their next months, in minutes. A cut in hours may not go below this. */
export async function minutesMembersNeed(reader: Reader, hostId: string): Promise<number> {
  return (await wantingNextMonth(reader, hostId)).reduce((sum, member) => sum + member.minutes, 0);
}

/**
 * The lowest regular price this host may have (the rulebook's "Changing the membership"): the
 * member price of a membership that is switched on, and the price of every month that is running,
 * held or still being paid for. Zero when nothing stands in the way. The caller holds the host's
 * calendar lock.
 */
export async function memberPriceFloor(reader: Reader, hostId: string): Promise<number> {
  const [offer] = await reader.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, hostId));
  const open = await reader
    .select({ price: schema.membershipMonths.pricePer15Cents })
    .from(schema.membershipMonths)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.membershipMonths.status, ["to_pay", "held", "running"]), isNull(schema.membershipMonths.endedHow)));
  return Math.max(offer?.on ? offer.pricePer15Cents : 0, ...open.map((month) => month.price));
}

/**
 * Whether there is room for this member's next month, with this much time, BESIDE everyone who
 * already wants one: for switching a stopped renewal back on, and for taking back an offer of
 * less time. Stricter than the safety net on purpose: bringing one member back must never be what
 * costs another member their place, however long either has been a member.
 */
export async function wouldKeepPlace(reader: Reader, membership: Pick<Membership, "id" | "hostId">, minutes: number): Promise<boolean> {
  const others = (await wantingNextMonth(reader, membership.hostId)).filter((member) => member.id !== membership.id);
  return others.reduce((sum, member) => sum + member.minutes, 0) + minutes <= (await hostMinutes(reader, membership.hostId));
}

export type CutMember = {
  membershipId: string;
  customerId: string;
  since: Date;
  /** Their own time, which a next month would have. */
  minutes: number;
  /** The smaller time of an offer that is still open, or null. */
  openOfferMinutes: number | null;
  /** Their month has started (running, or held): only then can they be offered less time. */
  monthStarted: boolean;
  /** Their payment is being tried: they can be kept, or paused at once. */
  unpaid: boolean;
  /** What the page starts with: the newest members are set to "pause" until the others fit. */
  suggested: "keep" | "pause";
};

export type Cut = {
  /** What the host's weekly hours offer in four weeks after the change. */
  hoursAfter: number;
  /** What her members need for their next months, as things stand. */
  needed: number;
  /** What she still owes this month: months that have started go on whatever she chooses. */
  owedThisMonth: number;
  /** Every member who would get a next month, the longest-standing first. */
  members: CutMember[];
  /** Members whose renewal is already stopped: leaving anyway, no choice needed. */
  leaving: string[];
  /** Open invitations that no longer fit beside what she owes, and would be taken back (the oldest stay first). */
  invitationsTakenBack: string[];
  /** The state this was worked out from. Saving takes it back and refuses if it no longer fits. */
  mark: string;
};

/**
 * What a cut in hours would need, worked out WITHOUT saving anything (the rulebook's "When a host
 * later offers fewer hours"). `reader` already sees the hours as they would be. The caller holds
 * the host's calendar lock when it is about to save.
 */
export async function workOutCut(reader: Reader, hostId: string, now: Date): Promise<Cut> {
  const hoursAfter = await hostMinutes(reader, hostId);
  const rows = await reader
    .select({ membership: schema.memberships, monthStatus: schema.membershipMonths.status, monthMinutes: schema.membershipMonths.includedMinutes })
    .from(schema.memberships)
    .leftJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.memberships.currentMonthId))
    .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.memberships.status, ["invited", "joining", "active", "unpaid"])))
    .orderBy(schema.memberships.id);

  const paying = rows.filter(({ membership }) => membership.status === "active" || membership.status === "unpaid");
  const wanting = paying.filter(({ membership }) => !membership.memberStoppedAt && !membership.hostStoppedAt && (membership.ownMinutes ?? 0) > 0);
  const members: CutMember[] = wanting
    .map(({ membership, monthStatus }) => ({
      membershipId: membership.id,
      customerId: membership.customerId,
      since: membership.since ?? membership.createdAt,
      minutes: membership.ownMinutes ?? 0,
      openOfferMinutes: membership.offerId ? membership.offeredMinutes : null,
      monthStarted: monthStatus === "running" || monthStatus === "held",
      unpaid: membership.status === "unpaid",
      suggested: "keep" as "keep" | "pause",
    }))
    .sort((a, b) => a.since.getTime() - b.since.getTime() || (a.membershipId < b.membershipId ? -1 : 1));
  const counted = (member: CutMember) => member.openOfferMinutes ?? member.minutes;
  const needed = members.reduce((sum, member) => sum + counted(member), 0);
  // To start with, the newest members are set to "pause" until the others fit.
  let left = needed;
  for (const member of [...members].reverse()) {
    if (left <= hoursAfter) break;
    member.suggested = "pause";
    left -= counted(member);
  }

  // What is owed now: every month that has started, every payment being tried, every joining at its card step.
  const owedThisMonth = rows.filter(({ membership }) => membership.status !== "invited").reduce((sum, { membership, monthMinutes }) => sum + (monthMinutes ?? membership.ownMinutes ?? 0), 0);
  // Invitations give way before members: the ones that still fit beside what is owed stay, the oldest first.
  let room = hoursAfter - owedThisMonth;
  const invitationsTakenBack: string[] = [];
  const invitations = rows.filter(({ membership }) => membership.status === "invited" && membership.inviteExpiresAt && membership.inviteExpiresAt > now).sort((a, b) => (a.membership.invitedAt?.getTime() ?? 0) - (b.membership.invitedAt?.getTime() ?? 0));
  for (const { membership } of invitations) {
    const minutes = membership.inviteMinutes ?? 0;
    if (minutes <= room) room -= minutes;
    else invitationsTakenBack.push(membership.id);
  }

  const mark = createHash("sha256")
    .update(JSON.stringify({ hoursAfter, rows: rows.map(({ membership, monthStatus }) => [membership.id, membership.status, membership.ownMinutes, membership.memberStoppedAt?.getTime() ?? null, membership.hostStoppedAt?.getTime() ?? null, membership.offerId, membership.inviteId, monthStatus]) }))
    .digest("hex")
    .slice(0, 24);
  return { hoursAfter, needed, owedThisMonth, members, leaving: paying.filter(({ membership }) => membership.memberStoppedAt || membership.hostStoppedAt).map(({ membership }) => membership.id), invitationsTakenBack, mark };
}
