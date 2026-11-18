/**
 * Who may see what of a membership. Every page and every action of the later parts asks here
 * first, and nothing else decides it.
 *
 * Each function answers "not found" (null, or false) in the same way for something that belongs
 * to someone else and for something that does not exist, so nobody can find out which it is.
 */
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth, MembershipOffer } from "@/db/schema";

const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HostForMember = {
  userId: string;
  handle: string;
  displayName: string;
  about: string;
  /** The regular price per 15 minutes, shown beside the member price. */
  pricePer15Cents: number;
  /** False while the host's page is waiting to be approved again: it can be looked at, but nothing new can be booked. */
  canBook: boolean;
};

/**
 * The way a member or an invited person reaches a host whose page is hidden from the public.
 * (The public reader, `publicProfile`, is not loosened: it still shows a hidden page to nobody.)
 * Null for anyone who is neither, for a suspended or declined host, and for a closed account.
 */
export async function hostForMember(viewerId: string, hostId: string, now: Date = new Date()): Promise<HostForMember | null> {
  const [link] = await db
    .select({ status: schema.memberships.status, inviteExpiresAt: schema.memberships.inviteExpiresAt })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.hostId, hostId), eq(schema.memberships.customerId, viewerId), ne(schema.memberships.status, "ended")))
    .limit(1);
  // An invitation opens the page only for its 24 hours, also when the helper has not closed it yet.
  if (!link || (link.status === "invited" && (!link.inviteExpiresAt || link.inviteExpiresAt <= now))) return null;
  const [row] = await db
    .select({ userId: schema.hostProfiles.userId, handle: schema.hostProfiles.handle, displayName: schema.hostProfiles.displayName, about: schema.hostProfiles.about, pricePer15Cents: schema.hostProfiles.pricePer15Cents, status: schema.hostProfiles.status })
    .from(schema.hostProfiles)
    .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
    .where(and(eq(schema.hostProfiles.userId, hostId), inArray(schema.hostProfiles.status, ["approved", "pending"]), isNull(schema.user.closedAt), isNull(schema.user.pausedAt)));
  if (!row) return null;
  return { userId: row.userId, handle: row.handle, displayName: row.displayName, about: row.about, pricePer15Cents: row.pricePer15Cents, canBook: row.status === "approved" };
}

/**
 * An open invitation, for the person it was sent to and nobody else, by the id its link carries.
 * `expired` says its 24 hours are over (the page then says so; "Join" would be refused anyway).
 */
export async function invitationFor(viewerId: string, inviteId: string, now: Date = new Date()): Promise<{ membership: Membership; offer: MembershipOffer; host: HostForMember; expired: boolean } | null> {
  if (!IS_ID.test(inviteId)) return null;
  const [membership] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.inviteId, inviteId), eq(schema.memberships.customerId, viewerId), eq(schema.memberships.status, "invited")));
  if (!membership) return null;
  const [offer] = await db.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, membership.hostId));
  const expired = !membership.inviteExpiresAt || membership.inviteExpiresAt <= now;
  // (Read as of the invitation's own time, so that a link whose 24 hours are over can still say so.)
  const host = await hostForMember(viewerId, membership.hostId, expired ? new Date(0) : now);
  if (!offer || !host) return null;
  return { membership, offer, host, expired };
}

/** One membership with its months, the newest first, for its member only. */
export async function membershipFor(viewerId: string, membershipId: string): Promise<{ membership: Membership; months: MembershipMonth[] } | null> {
  if (!IS_ID.test(membershipId)) return null;
  const [membership] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.customerId, viewerId)));
  if (!membership) return null;
  const months = await db.select().from(schema.membershipMonths).where(eq(schema.membershipMonths.membershipId, membershipId)).orderBy(desc(schema.membershipMonths.number));
  return { membership, months };
}

/** Every membership a person has or had as a member, for "Your account". */
export async function membershipsOf(viewerId: string): Promise<Membership[]> {
  return db.select().from(schema.memberships).where(eq(schema.memberships.customerId, viewerId)).orderBy(desc(schema.memberships.createdAt));
}

/** A host's own members and invitations (everything that has not ended), each with its current month if it has one, for her member list. (Months of earlier periods and ended memberships are not here; the pages of part three read those on their own.) */
export async function membersOfHost(hostId: string): Promise<Array<{ membership: Membership; month: MembershipMonth | null }>> {
  return db
    .select({ membership: schema.memberships, month: schema.membershipMonths })
    .from(schema.memberships)
    .leftJoin(schema.membershipMonths, eq(schema.membershipMonths.id, schema.memberships.currentMonthId))
    .where(and(eq(schema.memberships.hostId, hostId), ne(schema.memberships.status, "ended")))
    .orderBy(schema.memberships.createdAt);
}

async function monthOf(viewerId: string, monthId: string): Promise<MembershipMonth | null> {
  if (!IS_ID.test(monthId)) return null;
  const [row] = await db
    .select({ month: schema.membershipMonths })
    .from(schema.membershipMonths)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .where(and(eq(schema.membershipMonths.id, monthId), eq(schema.memberships.customerId, viewerId)));
  return row?.month ?? null;
}

/**
 * May this person start or confirm this month's payment, or be given its secret? Only the member,
 * and only while the month may still be paid.
 */
export async function mayPay(viewerId: string, monthId: string, now: Date = new Date()): Promise<boolean> {
  const month = await monthOf(viewerId, monthId);
  if (!month || month.status !== "to_pay" || month.endedHow || month.problem) return false;
  // Not after the card step's time or the 7 days are over, also when the helper has not been by yet.
  return !(month.cardStepExpiresAt && month.cardStepExpiresAt <= now) && !(month.giveUpAt && month.giveUpAt <= now);
}

/**
 * May this person see or refresh this month's outcome? The member, always, also after the payment
 * step has closed (so the page can say what became of it). Returns the month, or null.
 */
export async function maySeePayment(viewerId: string, monthId: string): Promise<MembershipMonth | null> {
  return monthOf(viewerId, monthId);
}
