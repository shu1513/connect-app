/**
 * Room for members (the rulebook's "Room for members" and rows 9 to 12 of "The builder's
 * choices"): the time of all of a host's members together can never be more than the host's weekly
 * hours offer in four weeks. Every caller holds the host's calendar lock (locks.ts), so two people
 * cannot both get the last place and a place cannot be given while the hours are being cut.
 */
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
 * they are now. A member whose renewal is stopped by either side, or who has an open offer of less
 * time, does not want one. A member whose payment is being tried keeps their turn.
 */
export async function keepsPlace(reader: Reader, membership: Pick<Membership, "id" | "hostId">): Promise<boolean> {
  const kept = placesKept({ hostMinutes: await hostMinutes(reader, membership.hostId), members: await wantingNextMonth(reader, membership.hostId) });
  return kept.has(membership.id);
}

/** Every member of the host who wants a next month, with their own time and since when they have been a member. */
async function wantingNextMonth(reader: Reader, hostId: string): Promise<Array<{ id: string; since: Date; minutes: number }>> {
  const wanting = await reader
    .select({ id: schema.memberships.id, since: schema.memberships.since, createdAt: schema.memberships.createdAt, minutes: schema.memberships.ownMinutes })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.memberships.status, ["active", "unpaid"]), isNull(schema.memberships.memberStoppedAt), isNull(schema.memberships.hostStoppedAt), isNull(schema.memberships.offerId), gt(schema.memberships.ownMinutes, 0)));
  return wanting.map((m) => ({ id: m.id, since: m.since ?? m.createdAt, minutes: m.minutes ?? 0 }));
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
