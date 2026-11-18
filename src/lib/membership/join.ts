/**
 * How a membership comes to exist: inviting, taking an invitation back, an invitation running
 * out, "Join", and resuming after a pause (the rulebook's "Inviting", "Joining" and "A paused
 * membership, and resuming").
 *
 * Every step takes the host's calendar lock first (the lock that guards room), then the two
 * people's rows, then the membership, and checks everything again under them. Nothing here asks
 * Stripe: "Join" and "Resume" write the first month down, and the card step that follows is
 * `payNow` in charge.ts.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership, MembershipOffer } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { stripeConfigured } from "@/lib/payments/stripe";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";
import { membershipsOnFor } from "@/lib/safety/switches";
import { writeDownMonth } from "./charge";
import { queueInvitationOverEmail, queueInvitedEmail } from "./emails";
import { lockCalendar, lockMembership } from "./locks";
import { roomLeft } from "./room";
import { CARD_STEP_MS, INVITATION_MS, INVITATIONS_PER_PERSON, INVITATIONS_WINDOW_MS, MembershipError, timeWords } from "./rules";
import { MEMBERSHIP_WORDING_VERSION } from "./wording";

const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_OPEN = "This invitation is no longer open.";
const NOT_AVAILABLE = "This membership is not available at the moment.";

/** The two people's rows, locked in one order (the way a profile decision locks a person). */
export async function lockPeople(tx: Tx, ids: string[]): Promise<Map<string, { pausedAt: Date | null; closedAt: Date | null }>> {
  const rows = await tx
    .select({ id: schema.user.id, pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt })
    .from(schema.user)
    .where(inArray(schema.user.id, [...new Set(ids)]))
    .orderBy(schema.user.id)
    .for("no key update");
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Everything a new promise between these two needs (an invitation, a joining, a resuming, a
 * renewal switched back on): both accounts active, no block either way, the host approved and
 * able to be paid, her membership switched on, the founder's switch covering her, and her
 * "confirmed ID only" rule met. Throws a plain sentence if not; returns the host's membership.
 * The caller holds the host's calendar lock.
 */
export async function mustBeOpen(tx: Tx, hostId: string, customerId: string, opts: { forTheHost?: boolean } = {}): Promise<MembershipOffer> {
  const people = await lockPeople(tx, [hostId, customerId]);
  const host = people.get(hostId);
  const customer = people.get(customerId);
  // A block looks, from here, exactly like anything else that stands in the way.
  if (!host || !customer || host.pausedAt || host.closedAt || customer.pausedAt || customer.closedAt || (await isBlockedEitherWay(hostId, customerId, tx))) {
    throw new MembershipError(opts.forTheHost ? "This person cannot become a member at the moment." : NOT_AVAILABLE);
  }
  if (!(await membershipsOnFor(hostId, tx))) throw new MembershipError("Memberships are not open at the moment.");
  const [profile] = await tx.select({ status: schema.hostProfiles.status, pricePer15Cents: schema.hostProfiles.pricePer15Cents }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
  const [settings] = await tx.select({ payoutsReady: schema.hostSettings.payoutsReady, verifiedOnly: schema.hostSettings.verifiedOnly }).from(schema.hostSettings).where(eq(schema.hostSettings.userId, hostId));
  if (!profile || profile.status !== "approved" || profile.pricePer15Cents <= 0 || !settings?.payoutsReady || !stripeConfigured()) {
    throw new MembershipError(opts.forTheHost ? "Your host page must be approved and your payout account ready before you can have members." : NOT_AVAILABLE);
  }
  const [offer] = await tx.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, hostId));
  if (!offer || !offer.on) throw new MembershipError(opts.forTheHost ? "Switch your membership on first." : "This host is not offering a membership at the moment.");
  if (settings.verifiedOnly && !(await identityState(customerId, tx)).passed) {
    throw new MembershipError(opts.forTheHost ? "You only take calls from people who have confirmed their ID, and this person has not yet." : "This host only takes members who have confirmed their ID. Please confirm who you are on your account page.");
  }
  return offer;
}

/** Whether the two have had a call with this host as the host: one that is over, was not cancelled, and that both joined. */
async function hadACall(tx: Tx, hostId: string, customerId: string, now: Date): Promise<boolean> {
  const joined = (who: string) => sql`exists (select 1 from ${schema.attendanceEvents} a where a.call_id = ${schema.calls.id} and a.type = 'participant_joined' and a.participant_identity = ${who})`;
  const [call] = await tx
    .select({ id: schema.calls.id })
    .from(schema.calls)
    .innerJoin(schema.bookings, eq(schema.bookings.callId, schema.calls.id))
    .where(and(eq(schema.calls.hostId, hostId), eq(schema.calls.customerId, customerId), ne(schema.bookings.source, "admin"), isNull(schema.calls.cancelledAt), lte(schema.calls.endsAt, now), joined(hostId), joined(customerId)))
    .limit(1);
  return Boolean(call);
}

/**
 * An invitation that ends without a joining: its membership row is closed (this person was never
 * a member, so there is nothing to clean up and nothing to announce as "ended"), the invitation's
 * line says how, and its place is free. The caller holds the calendar lock and the membership.
 */
export async function endInvitation(tx: Tx, membership: Membership, how: "taken_back" | "ran_out", now: Date): Promise<void> {
  if (membership.status !== "invited") return;
  await tx
    .update(schema.memberships)
    .set({ status: "ended", endedAt: now, endedBy: how === "ran_out" ? "connect" : "host", endedReason: how === "ran_out" ? "the invitation ran out" : "the invitation was taken back", cleanupDoneAt: now, updatedAt: now })
    .where(eq(schema.memberships.id, membership.id));
  if (membership.inviteId) {
    await tx.update(schema.membershipInvitations).set({ outcome: how }).where(and(eq(schema.membershipInvitations.inviteId, membership.inviteId), eq(schema.membershipInvitations.outcome, "open")));
    await queueInvitationOverEmail(tx, membership, membership.inviteId, how);
  }
}

/**
 * The host invites someone she has had a call with, to her membership as it stands now. The
 * invitation holds a place of that size for 24 hours. Inviting someone who already has an open
 * invitation makes a new one: the old link stops working.
 */
export async function invite(input: { hostId: string; customerId: string; now: Date }): Promise<{ membershipId: string; inviteId: string; expiresAt: Date }> {
  const { hostId, customerId, now } = input;
  if (hostId === customerId) throw new MembershipError("You cannot invite yourself.");
  return db.transaction(async (tx) => {
    await lockCalendar(tx, hostId);
    const offer = await mustBeOpen(tx, hostId, customerId, { forTheHost: true });
    if (!(await hadACall(tx, hostId, customerId, now))) throw new MembershipError("You can invite people you have already had a call with.");
    const [live] = await tx.select().from(schema.memberships).where(and(eq(schema.memberships.hostId, hostId), eq(schema.memberships.customerId, customerId), ne(schema.memberships.status, "ended"))).for("update");
    if (live && live.status === "paused") throw new MembershipError("This person is a paused member. They can resume by themselves; no invitation is needed.");
    if (live && live.status !== "invited") throw new MembershipError("This person is already a member.");
    const [sent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.membershipInvitations)
      .where(and(eq(schema.membershipInvitations.hostId, hostId), eq(schema.membershipInvitations.customerId, customerId), gt(schema.membershipInvitations.sentAt, new Date(now.getTime() - INVITATIONS_WINDOW_MS))));
    if (sent.n >= INVITATIONS_PER_PERSON) throw new MembershipError(`You have invited this person ${INVITATIONS_PER_PERSON} times in the last 30 days. Please wait before inviting them again.`);
    // Room for someone new: the host's hours, less everything already promised (an invitation being renewed is not counted twice).
    const room = await roomLeft(tx, hostId, now, live?.id);
    if (room < offer.includedMinutes) {
      throw new MembershipError(`Your weekly hours have no room for another member: a member needs ${timeWords(offer.includedMinutes)} a month, and ${timeWords(Math.max(room, 0))} is free. Add weekly hours first.`);
    }

    const inviteId = randomUUID();
    const expiresAt = new Date(now.getTime() + INVITATION_MS);
    const invitation = { inviteId, invitedAt: now, inviteExpiresAt: expiresAt, inviteOfferVersion: offer.version, inviteMinutes: offer.includedMinutes, updatedAt: now };
    let membership: Membership;
    if (live) {
      // The old link stops working.
      if (live.inviteId) await tx.update(schema.membershipInvitations).set({ outcome: "replaced" }).where(and(eq(schema.membershipInvitations.inviteId, live.inviteId), eq(schema.membershipInvitations.outcome, "open")));
      [membership] = await tx.update(schema.memberships).set(invitation).where(eq(schema.memberships.id, live.id)).returning();
    } else {
      [membership] = await tx.insert(schema.memberships).values({ hostId, customerId, status: "invited", ...invitation }).returning();
    }
    await tx.insert(schema.membershipInvitations).values({ hostId, customerId, membershipId: membership.id, inviteId, sentAt: now });
    await queueInvitedEmail(tx, membership, { inviteId, pricePer15Cents: offer.pricePer15Cents, minutes: offer.includedMinutes, expiresAt });
    return { membershipId: membership.id, inviteId, expiresAt };
  });
}

/** The host takes an invitation back, until it is accepted. */
export async function takeBackInvitation(input: { hostId: string; membershipId: string; now: Date }): Promise<void> {
  await db.transaction(async (tx) => {
    await lockCalendar(tx, input.hostId);
    const membership = await lockMembership(tx, input.membershipId).catch(() => null);
    if (!membership || membership.hostId !== input.hostId) throw new MembershipError("Invitation not found.");
    if (membership.status !== "invited") throw new MembershipError("This invitation was already accepted, or is no longer open.");
    await endInvitation(tx, membership, "taken_back", input.now);
  });
}

/** For the helper: invitations whose 24 hours are over end by themselves, and both are told. */
export async function runInvitations(now: Date): Promise<void> {
  const over = await db
    .select({ id: schema.memberships.id, hostId: schema.memberships.hostId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.status, "invited"), lte(schema.memberships.inviteExpiresAt, now)))
    .limit(100);
  for (const row of over) {
    await db
      .transaction(async (tx) => {
        await lockCalendar(tx, row.hostId);
        const membership = await lockMembership(tx, row.id);
        if (membership.status === "invited" && membership.inviteExpiresAt && membership.inviteExpiresAt <= now) await endInvitation(tx, membership, "ran_out", now);
      })
      .catch((error) => console.error(`[membership] could not end invitation ${row.id} that ran out; will retry`, error));
  }
}

/** The month a joining or resuming request already made, if this request was sent before (a button pressed twice). */
async function alreadyAsked(tx: Tx, requestId: string, membershipId: string): Promise<{ membershipId: string; monthId: string } | null> {
  const [agreement] = await tx.select().from(schema.membershipAgreements).where(eq(schema.membershipAgreements.requestId, requestId));
  if (!agreement) return null;
  if (agreement.membershipId !== membershipId) throw new MembershipError("Please open the page again.");
  const [month] = await tx.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(eq(schema.membershipMonths.originKey, `agreement:${agreement.id}`));
  if (!month) throw new MembershipError("Please open the page again.");
  return { membershipId, monthId: month.id };
}

/**
 * The agreement, the membership's new period and its first month, in one step: what "Join" and
 * "Resume" have in common. The place becomes the membership's for the card step, which has the
 * same short time limit a booking's card step has.
 */
async function agreeAndStart(tx: Tx, membership: Membership, offer: MembershipOffer, kind: "joined" | "resumed", requestId: string, now: Date): Promise<{ membershipId: string; monthId: string }> {
  const [last] = await tx.select({ number: sql<number>`coalesce(max(${schema.membershipMonths.number}), 0)::int` }).from(schema.membershipMonths).where(eq(schema.membershipMonths.membershipId, membership.id));
  const [agreement] = await tx
    .insert(schema.membershipAgreements)
    .values({ membershipId: membership.id, requestId, kind, offerVersion: offer.version, pricePer15Cents: offer.pricePer15Cents, minutes: offer.includedMinutes, cardWordingVersion: MEMBERSHIP_WORDING_VERSION, firstMonthNumber: last.number + 1, at: now })
    .returning();
  const [started] = await tx
    .update(schema.memberships)
    // The period goes up once per joining or resuming, so work left over from before can never touch this one.
    .set({ status: "joining", period: membership.period + 1, ownPricePer15Cents: offer.pricePer15Cents, ownMinutes: offer.includedMinutes, agreementId: agreement.id, memberStoppedAt: null, hostStoppedAt: null, offerStoppedAt: null, updatedAt: now })
    .where(eq(schema.memberships.id, membership.id))
    .returning();
  const month = await writeDownMonth(tx, started, { originKey: `agreement:${agreement.id}`, agreementId: agreement.id, pricePer15Cents: offer.pricePer15Cents, includedMinutes: offer.includedMinutes, cardStepExpiresAt: new Date(now.getTime() + CARD_STEP_MS) }, now);
  return { membershipId: membership.id, monthId: month.id };
}

/**
 * "Join": the invited person pressed the button with the box ticked, before the invitation's 24
 * hours were over. `requestId` was made when the page was drawn, so a second press gets the month
 * the first one made. Returns the month to pay (charge.ts, `payNow`).
 */
export async function join(input: { customerId: string; inviteId: string; requestId: string; agreed: boolean; now: Date }): Promise<{ membershipId: string; monthId: string }> {
  const { customerId, inviteId, requestId, now } = input;
  if (!IS_ID.test(inviteId) || !IS_ID.test(requestId)) throw new MembershipError(NOT_OPEN);
  if (!input.agreed) throw new MembershipError("Please tick the box to agree before you join.");
  return db.transaction(async (tx) => {
    // Found by the link's own id, and only for the person it was sent to. Someone else's and one that does not exist look the same.
    const [found] = await tx
      .select({ id: schema.membershipInvitations.membershipId, hostId: schema.membershipInvitations.hostId })
      .from(schema.membershipInvitations)
      .where(and(eq(schema.membershipInvitations.inviteId, inviteId), eq(schema.membershipInvitations.customerId, customerId)));
    if (!found) throw new MembershipError(NOT_OPEN);
    await lockCalendar(tx, found.hostId);
    const before = await alreadyAsked(tx, requestId, found.id);
    if (before) return before;
    const offer = await mustBeOpen(tx, found.hostId, customerId);
    const membership = await lockMembership(tx, found.id);
    if (membership.status !== "invited" || membership.inviteId !== inviteId) throw new MembershipError(NOT_OPEN);
    // The 24 hours are checked here too, so a late helper never lets an old invitation through.
    if (!membership.inviteExpiresAt || membership.inviteExpiresAt <= now) throw new MembershipError("This invitation has run out. Ask the host to invite you again.");
    // An invitation is for the membership as it stood. (A change takes open invitations back; this is the safety net.)
    if (offer.version !== membership.inviteOfferVersion) throw new MembershipError(NOT_OPEN);
    const started = await agreeAndStart(tx, membership, offer, "joined", requestId, now);
    await tx.update(schema.membershipInvitations).set({ outcome: "accepted" }).where(eq(schema.membershipInvitations.inviteId, inviteId));
    return started;
  });
}

/**
 * "Resume membership": joining again without an invitation. Everything joining needs, the host's
 * membership as it is now (`offerVersion` is the version the page showed, so nobody agrees to
 * terms they did not see), a new agreement, and room for one more member now.
 */
export async function resume(input: { customerId: string; membershipId: string; requestId: string; agreed: boolean; offerVersion: number; now: Date }): Promise<{ membershipId: string; monthId: string }> {
  const { customerId, membershipId, requestId, now } = input;
  if (!IS_ID.test(membershipId) || !IS_ID.test(requestId)) throw new MembershipError("Membership not found.");
  if (!input.agreed) throw new MembershipError("Please tick the box to agree before you resume.");
  return db.transaction(async (tx) => {
    const [found] = await tx.select({ hostId: schema.memberships.hostId }).from(schema.memberships).where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.customerId, customerId)));
    if (!found) throw new MembershipError("Membership not found.");
    await lockCalendar(tx, found.hostId);
    const before = await alreadyAsked(tx, requestId, membershipId);
    if (before) return before;
    const offer = await mustBeOpen(tx, found.hostId, customerId);
    const membership = await lockMembership(tx, membershipId);
    if (membership.status !== "paused") throw new MembershipError(membership.status === "ended" ? "This membership has ended. Coming back needs a new invitation from the host." : "This membership is not paused.");
    // What the person agrees to is the membership the page showed them, never one the host changed in the meantime.
    if (offer.version !== input.offerVersion) throw new MembershipError("The host changed the membership while this page was open. Please look at it again before you resume.");
    const room = await roomLeft(tx, found.hostId, now, membershipId);
    if (room < offer.includedMinutes) throw new MembershipError("The host's hours have no room for another member at the moment. Please try again later.");
    return agreeAndStart(tx, membership, offer, "resumed", requestId, now);
  });
}
