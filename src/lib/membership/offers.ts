/**
 * The host's one membership: its switch, its member price and its time (the rulebook's "Setting
 * it up", "Changing the membership" and "Switching the offer off").
 *
 * Two functions that share one calculation: `previewOfferChange` works out what a change would do
 * WITHOUT saving anything, for the page that shows it before the host confirms; `saveOffer` works
 * it out again under the host's calendar lock and saves. The preview returns a short mark of the
 * state it was worked out from, and saving refuses if that mark no longer fits, so the host never
 * confirms one thing and gets another.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MembershipOffer } from "@/db/schema";
import type { Tx } from "@/lib/payments/operations";
import { stripeConfigured } from "@/lib/payments/stripe";
import { membershipsOnFor } from "@/lib/safety/switches";
import { giveUpInStep, letHoldGo } from "./charge";
import { queueLowerPriceEmail } from "./emails";
import { endInvitation } from "./join";
import { lockCalendar, lockMembership, lockMonth } from "./locks";
import { hostMinutes } from "./room";
import { MembershipError, monthTotalCents, offerProblem, timeWords } from "./rules";

type Reader = Pick<typeof db, "select">;

export type OfferInput = { on: boolean; pricePer15Cents: number; includedMinutes: number };

export type OfferChange = {
  /** Why this cannot be saved, in words for the host, or null. */
  problem: string | null;
  /** The price or the time of the membership changes (or it is set up for the first time). */
  termsChanged: boolean;
  switchingOn: boolean;
  switchingOff: boolean;
  /** Members whose own price goes down for good, from their next month. */
  lowered: Array<{ membershipId: string; fromPricePer15Cents: number; toPricePer15Cents: number; minutes: number }>;
  /** What those members together pay less a month. */
  lessPerMonthCents: number;
  /** Open invitations (and joinings still at the card step) that are taken back. */
  invitationsTakenBack: number;
  /** When switching off: members whose month goes on and who are paused when it ends. */
  renewalsStopping: number;
  /** When switching off: members whose payment was being tried, who are paused at once. */
  pausedAtOnce: number;
  /** The state this was worked out from. Saving takes it back and refuses if it no longer fits. */
  mark: string;
};

export async function offerOfHost(reader: Reader, hostId: string): Promise<MembershipOffer | null> {
  const [offer] = await reader.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, hostId));
  return offer ?? null;
}

/** The one calculation. Reads only; the saving step runs it again under the calendar lock. */
async function workOut(reader: Reader, hostId: string, input: OfferInput): Promise<OfferChange & { current: MembershipOffer | null }> {
  const current = await offerOfHost(reader, hostId);
  const [profile] = await reader.select({ pricePer15Cents: schema.hostProfiles.pricePer15Cents }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
  const [settings] = await reader.select({ payoutsReady: schema.hostSettings.payoutsReady }).from(schema.hostSettings).where(eq(schema.hostSettings.userId, hostId));
  const members = await reader
    .select({ id: schema.memberships.id, status: schema.memberships.status, own: schema.memberships.ownPricePer15Cents, minutes: schema.memberships.ownMinutes, inviteId: schema.memberships.inviteId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.memberships.status, ["invited", "joining", "active", "unpaid"])))
    .orderBy(schema.memberships.id);
  const hours = await hostMinutes(reader, hostId);
  const open = await membershipsOnFor(hostId, reader);

  // Switching off keeps the price and the time as they are; only the switch moves.
  const price = input.on || !current ? input.pricePer15Cents : current.pricePer15Cents;
  const minutes = input.on || !current ? input.includedMinutes : current.includedMinutes;
  const switchingOn = input.on && !(current?.on ?? false);
  const switchingOff = !input.on && (current?.on ?? false);
  const termsChanged = input.on && (!current || price !== current.pricePer15Cents || minutes !== current.includedMinutes);
  const onlyLowersThePrice = Boolean(current) && input.on && !switchingOn && minutes === current!.includedMinutes && price <= current!.pricePer15Cents;

  let problem: string | null = null;
  if (!profile) problem = "You do not have a host page yet.";
  else if (!input.on && !current) problem = "There is no membership to switch off.";
  else if (input.on) {
    problem = offerProblem({ pricePer15Cents: price, includedMinutes: minutes, regularPricePer15Cents: profile.pricePer15Cents });
    if (!problem && (!settings?.payoutsReady || !stripeConfigured())) problem = "Your payout account must be ready before you can offer a membership.";
    // While memberships are not open for this host she can still look after what exists: lower her price, or switch her membership off.
    if (!problem && !open && !onlyLowersThePrice) problem = "Memberships are not open at the moment.";
    // An offer that does not fit even once is refused. A lower price can always be saved: it promises nobody a new place.
    if (!problem && (switchingOn || !current || minutes !== current.includedMinutes) && hours < minutes) {
      problem = `Your weekly hours offer ${timeWords(hours)} a month. That is less than the ${timeWords(minutes)} one member would get. Add weekly hours, or choose less time.`;
    }
  }

  const paying = members.filter((member) => member.status === "active" || member.status === "unpaid");
  const lowered = input.on ? paying.filter((member) => member.own !== null && member.own > price).map((member) => ({ membershipId: member.id, fromPricePer15Cents: member.own!, toPricePer15Cents: price, minutes: member.minutes ?? 0 })) : [];
  const mark = createHash("sha256")
    .update(JSON.stringify({ current: current ? [current.on, current.pricePer15Cents, current.includedMinutes, current.version] : null, regular: profile?.pricePer15Cents ?? null, hours, open, members: members.map((member) => [member.id, member.status, member.own, member.minutes, member.inviteId]) }))
    .digest("hex")
    .slice(0, 24);
  return {
    current,
    problem,
    termsChanged,
    switchingOn,
    switchingOff,
    lowered,
    lessPerMonthCents: lowered.reduce((sum, member) => sum + monthTotalCents(member.fromPricePer15Cents - member.toPricePer15Cents, member.minutes), 0),
    invitationsTakenBack: termsChanged || switchingOff ? members.filter((member) => member.status === "invited" || member.status === "joining").length : 0,
    renewalsStopping: switchingOff ? members.filter((member) => member.status === "active").length : 0,
    pausedAtOnce: switchingOff ? members.filter((member) => member.status === "unpaid").length : 0,
    mark,
  };
}

/** What saving this would do, without saving anything: for the page that shows it before the host confirms. */
export async function previewOfferChange(hostId: string, input: OfferInput): Promise<OfferChange> {
  const { current, ...change } = await workOut(db, hostId, input);
  void current;
  return change;
}

/**
 * Saves the host's membership, with everything the change means, in one step:
 *   - open invitations are taken back when the price or the time changes, or the membership is
 *     switched off (an invitation is for the membership as it stood), and a joining or resuming
 *     that is still at the card step is undone;
 *   - members whose own price is higher than a new, lower member price get the lower price for
 *     good, from the next month that is written down for them, and are told;
 *   - switching off pauses at once a member whose payment was being tried (the open payment is
 *     cancelled). Members whose month has started go on to its end and are paused then: that is
 *     decided when their month ends, from the switch itself, so nothing is stored on them here.
 */
export async function saveOffer(hostId: string, input: OfferInput, mark: string, now: Date = new Date()): Promise<OfferChange> {
  const saved = await db.transaction(async (tx) => {
    await lockCalendar(tx, hostId);
    const { current, ...change } = await workOut(tx, hostId, input);
    if (change.problem) throw new MembershipError(change.problem);
    if (mark !== change.mark) throw new MembershipError("Something about your membership or your members changed while this page was open. Nothing was saved. Please look at it again.");

    const price = input.on || !current ? input.pricePer15Cents : current.pricePer15Cents;
    const minutes = input.on || !current ? input.includedMinutes : current.includedMinutes;
    const version = (current?.version ?? 0) + (change.termsChanged || !current ? 1 : 0);
    await tx
      .insert(schema.membershipOffers)
      .values({ hostId, on: input.on, pricePer15Cents: price, includedMinutes: minutes, version, updatedAt: now })
      .onConflictDoUpdate({ target: schema.membershipOffers.hostId, set: { on: input.on, pricePer15Cents: price, includedMinutes: minutes, version, updatedAt: now } });

    // Every membership this touches is locked first, in one order; their months only after.
    const touched = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.hostId, hostId), inArray(schema.memberships.status, ["invited", "joining", "active", "unpaid"])))
      .orderBy(schema.memberships.id);
    const locked = [];
    for (const { id } of touched) locked.push(await lockMembership(tx, id));

    const letGo: string[] = [];
    for (const membership of locked) {
      if (change.termsChanged || change.switchingOff) {
        if (membership.status === "joining" && membership.currentMonthId) {
          // Still at the card step under the old terms: undone, and its payment cancelled after this step.
          const month = await lockMonth(tx, membership.currentMonthId);
          if (await giveUpInStep(tx, { membership, month }, "card_step", now)) letGo.push(month.id);
          const after = await lockMembership(tx, membership.id);
          if (after.status === "invited") await endInvitation(tx, after, "taken_back", now);
        } else if (membership.status === "invited") {
          await endInvitation(tx, membership, "taken_back", now);
        }
      }
      if (change.switchingOff && membership.status === "unpaid" && membership.currentMonthId) {
        const month = await lockMonth(tx, membership.currentMonthId);
        if (await giveUpInStep(tx, { membership, month }, "given_up", now, "offer_off")) letGo.push(month.id);
      }
    }
    await lowerPrices(tx, change.lowered, version, now);
    return { change, letGo };
  });
  for (const monthId of saved.letGo) {
    await letHoldGo(monthId, now).catch((error) => console.error(`[membership] could not let go of month ${monthId} yet; the helper will retry`, error));
  }
  return saved.change;
}

/** A lower member price: each member's own price goes down for good, with a line of its own on record and an email. */
async function lowerPrices(tx: Tx, lowered: OfferChange["lowered"], offerVersion: number, now: Date): Promise<void> {
  for (const change of lowered) {
    const [member] = await tx
      .update(schema.memberships)
      .set({ ownPricePer15Cents: change.toPricePer15Cents, updatedAt: now })
      .where(and(eq(schema.memberships.id, change.membershipId), sql`${schema.memberships.ownPricePer15Cents} > ${change.toPricePer15Cents}`))
      .returning();
    if (!member) continue;
    const [last] = await tx.select({ number: sql<number>`coalesce(max(${schema.membershipMonths.number}), 0)::int` }).from(schema.membershipMonths).where(eq(schema.membershipMonths.membershipId, member.id));
    // No new agreement is needed (the one the member ticked allows a lower price for the same time); this line says from which month it applies.
    await tx.insert(schema.membershipAgreements).values({ membershipId: member.id, requestId: randomUUID(), kind: "price_lowered", offerVersion, pricePer15Cents: change.toPricePer15Cents, minutes: change.minutes, firstMonthNumber: last.number + 1, at: now });
    await queueLowerPriceEmail(tx, member, { fromPricePer15Cents: change.fromPricePer15Cents, toPricePer15Cents: change.toPricePer15Cents, minutes: change.minutes, offerVersion });
  }
}
