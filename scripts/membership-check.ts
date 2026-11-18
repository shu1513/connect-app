/**
 * Testing tool: plays a host and a member through membership journeys against the Stripe sandbox
 * and the local database, and checks every result. No real money moves, and nobody can buy a
 * membership: the founder's switch is set only in the local database, and off again at the end.
 *
 * Nothing that makes a membership exists yet (that is part 1b), so this script puts its test
 * memberships straight into the database, and then uses the real code for everything else.
 * It uses a pretend "now" so nothing has to wait. Where the code measures age on the real clock,
 * the script makes the written record old.
 *
 * Usage: npx tsx scripts/membership-check.ts            (everything)
 *        npx tsx scripts/membership-check.ts --only=7   (one journey)
 *        npx tsx scripts/membership-check.ts --payouts  (also collecting; needs the test host's payout account)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${!ok && detail !== "" ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  // The jobs below act on every membership in the database, with a pretend "now". Never run them on shared data.
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { stripeCustomerFor } = await import("../src/lib/payments/hold");
  const { capturePayment } = await import("../src/lib/payments/actions");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { reconcileOperations } = await import("../src/lib/payments/jobs");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { healthProblems } = await import("../src/lib/health");
  const C = await import("../src/lib/membership/charge");
  const { closeMonth } = await import("../src/lib/membership/close");
  const { runMembershipJobs } = await import("../src/lib/membership/jobs");
  const P = await import("../src/lib/membership/payback");
  const E = await import("../src/lib/membership/ending");
  const S = await import("../src/lib/membership/state");
  const L = await import("../src/lib/membership/locks");
  const Mo = await import("../src/lib/membership/months");
  const Cards = await import("../src/lib/membership/cards");
  const Room = await import("../src/lib/membership/room");
  const { membershipsToLookAt } = await import("../src/lib/membership/health");
  const { monthEnd } = await import("../src/lib/membership/rules");
  const { block } = await import("../src/lib/safety/blocks");
  const { pauseAccount } = await import("../src/lib/safety/reports");
  const { closeAccount } = await import("../src/lib/profiles/closing");
  const { decideProfile, updateHostProfile, ProfileError } = await import("../src/lib/profiles/profiles");
  const { addWeeklyHours, removeWeeklyHours, CalendarError } = await import("../src/lib/booking/calendar");
  const { RULES } = await import("../src/lib/terms");
  const J = await import("../src/lib/membership/join");
  const O = await import("../src/lib/membership/offers");
  const A = await import("../src/lib/membership/access");
  const { MembershipError } = await import("../src/lib/membership/rules");
  const { MEMBERSHIP_WORDING_VERSION: WORDING } = await import("../src/lib/membership/wording");
  const { changeWeeklyHours, previewWeeklyHoursChange } = await import("../src/lib/booking/calendar");
  const { publicProfile } = await import("../src/lib/profiles/profiles");
  type MemberChoice = import("../src/lib/booking/calendar").MemberChoice;

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const RUN = randomUUID().slice(0, 8);
  const months = schema.membershipMonths;
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",").map(Number);
  type Person = { id: string; name: string; email: string };
  let made = 0;
  const named: string[] = [];

  // ------------------------------------------------------------------------
  // Making people, hosts and memberships
  // ------------------------------------------------------------------------
  async function person(kind: string): Promise<Person> {
    const id = `mc-${RUN}-${++made}-${kind}`;
    const stamp = new Date();
    const row = { id, name: `Member check ${kind} ${made}`, email: `membercheck-${RUN}-${made}@example.test` };
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
    return row;
  }
  /** A host with a regular price of $10.00, 3 hours a week (12 hours in four weeks), and a membership of 2 hours at $7.50: $60.00 a month. */
  async function newHost(opts: { weeklyMinutes?: number; named?: boolean; offer?: boolean } = {}): Promise<Person> {
    const p = await person("host");
    const stamp = new Date();
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `mc${RUN}${made}`, handleKey: `mc${RUN}${made}`, displayName: `Host ${made}`, pricePer15Cents: 1000, status: "approved", usConfirmedAt: stamp });
    // (Marked as able to be paid: a payout account cannot be made ready from a script. Only the collecting journey sends money, and it borrows the real test account.)
    await db.insert(schema.hostSettings).values({ userId: p.id, payoutsReady: true }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values({ hostId: p.id, weekday: 1, startMinute: 540, endMinute: 540 + (opts.weeklyMinutes ?? 180) });
    if (opts.offer !== false) await db.insert(schema.membershipOffers).values({ hostId: p.id, on: true, pricePer15Cents: 750, includedMinutes: 120 });
    if (opts.named !== false) {
      named.push(p.id);
      await setSwitches({ memberships: "named", membershipsHosts: named });
    }
    return p;
  }
  type Made = { host: Person; member: Person; membershipId: string; monthId: string };
  /** A membership at the card step: written straight into the database, with its agreement and its first month. */
  async function atCardStep(host: Person, opts: { cardStepMs?: number; member?: Person } = {}): Promise<Made> {
    const member = opts.member ?? (await person("member"));
    const at = new Date();
    return db.transaction(async (tx) => {
      await L.lockCalendar(tx, host.id);
      const [m] = await tx
        .insert(schema.memberships)
        .values({ hostId: host.id, customerId: member.id, status: "joining", period: 1, ownPricePer15Cents: 750, ownMinutes: 120, inviteId: randomUUID(), invitedAt: at, inviteExpiresAt: new Date(at.getTime() + DAY), inviteOfferVersion: 1, inviteMinutes: 120 })
        .returning();
      const [agreement] = await tx.insert(schema.membershipAgreements).values({ membershipId: m.id, requestId: randomUUID(), kind: "joined", offerVersion: 1, pricePer15Cents: 750, minutes: 120, cardWordingVersion: "check", firstMonthNumber: 1, at }).returning();
      const [agreed] = await tx.update(schema.memberships).set({ agreementId: agreement.id }).where(eq(schema.memberships.id, m.id)).returning();
      const month = await C.writeDownMonth(tx, agreed, { originKey: `agreement:${agreement.id}`, agreementId: agreement.id, pricePer15Cents: 750, includedMinutes: 120, cardStepExpiresAt: new Date(at.getTime() + (opts.cardStepMs ?? 30 * MIN)) }, at);
      return { host, member, membershipId: m.id, monthId: month.id };
    });
  }
  /** Pays a month the way the member's browser would, with one of Stripe's test cards. */
  async function pay(monthId: string, card = "pm_card_visa") {
    const [owner] = await db.select({ customerId: schema.memberships.customerId }).from(months).innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId)).where(eq(months.id, monthId));
    // The page's own way in: only the member is given the payment's secret.
    if (!(await C.payNow({ monthId, memberId: owner.customerId }))) return M(monthId);
    try {
      await stripe().paymentIntents.confirm((await M(monthId)).stripePaymentIntentId!, { payment_method: card, return_url: "https://example.com/return" });
    } catch {
      // A declined card throws. syncMonth below records the real state.
    }
    return C.syncMonth(monthId, new Date());
  }
  /** The member's own payment reaches Stripe, and we have not heard of it yet. */
  async function confirmOnly(monthId: string, card = "pm_card_visa") {
    const [owner] = await db.select({ customerId: schema.memberships.customerId }).from(months).innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId)).where(eq(months.id, monthId));
    await C.payNow({ monthId, memberId: owner.customerId });
    await stripe().paymentIntents.confirm((await M(monthId)).stripePaymentIntentId!, { payment_method: card, return_url: "https://example.com/return" });
  }
  /** The member resumes (the real resuming is part 1b's): a new period, a new agreement, a new first month at the card step. Returns the new month. */
  async function resume(m: Made): Promise<string> {
    const at = new Date();
    return db.transaction(async (tx) => {
      await L.lockCalendar(tx, m.host.id);
      const before = await L.lockMembership(tx, m.membershipId);
      const [agreement] = await tx.insert(schema.membershipAgreements).values({ membershipId: m.membershipId, requestId: randomUUID(), kind: "resumed", offerVersion: 1, pricePer15Cents: 750, minutes: 120, cardWordingVersion: "check", firstMonthNumber: 0, at }).returning();
      const [again] = await tx.update(schema.memberships).set({ status: "joining", period: before.period + 1, agreementId: agreement.id, pausedAt: null, memberStoppedAt: null, hostStoppedAt: null, offerStoppedAt: null }).where(eq(schema.memberships.id, m.membershipId)).returning();
      const month = await C.writeDownMonth(tx, again, { originKey: `agreement:${agreement.id}`, agreementId: agreement.id, pricePer15Cents: 750, includedMinutes: 120, cardStepExpiresAt: new Date(at.getTime() + 30 * MIN) }, at);
      return month.id;
    });
  }
  /** A finished booking of this member with this host, for the card checks. */
  async function booking(host: Person, member: Person): Promise<string> {
    const startsAt = new Date(Date.now() - DAY);
    const [row] = await db
      .insert(schema.bookings)
      .values({ hostId: host.id, customerId: member.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 1000, totalCents: 2000, freeCancelMinutes: 0, stage: "ran_out", requestKey: randomUUID() })
      .returning();
    return row.id;
  }
  /** Stripe's test card that is always disputed: waits until the dispute on the month's charge exists. */
  async function disputeOn(monthId: string): Promise<string | undefined> {
    const intentId = (await M(monthId)).stripePaymentIntentId!;
    for (let i = 0; i < 30; i++) {
      const found = (await stripe().disputes.list({ payment_intent: intentId, limit: 1 })).data[0]?.id;
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return undefined;
  }
  async function disputeBecomes(disputeId: string, wanted: string): Promise<string> {
    let status = "";
    for (let i = 0; i < 30 && status !== wanted; i++) {
      status = (await stripe().disputes.retrieve(disputeId)).status;
      if (status !== wanted) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return status;
  }

  /** A member whose first month is held. */
  async function held(host: Person, card = "pm_card_visa"): Promise<Made> {
    const m = await atCardStep(host);
    await pay(m.monthId, card);
    return m;
  }
  /** A member whose first month is taken and running. */
  async function running(host: Person, card = "pm_card_visa"): Promise<Made> {
    const m = await held(host, card);
    await C.takeNow(m.monthId, new Date());
    return m;
  }
  /** Replaces the membership's saved card with another of Stripe's test cards (one that fails later, for example). */
  async function saveCard(m: Made, testCard: string): Promise<string> {
    const customer = await stripeCustomerFor(m.member);
    const method = await stripe().paymentMethods.attach(testCard, { customer });
    await db.update(schema.membershipCards).set({ retiredAt: new Date() }).where(and(eq(schema.membershipCards.membershipId, m.membershipId), sql`${schema.membershipCards.retiredAt} is null`));
    await db.insert(schema.membershipCards).values({ membershipId: m.membershipId, stripePaymentMethodId: method.id, savedAt: new Date() });
    return method.id;
  }

  /** Makes another of Stripe's test cards the card in use (as saveCard), for a member whose months are still open. */
  const saveCardKeeping = saveCard;

  // ------------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------------
  const M = async (id: string) => (await db.select().from(months).where(eq(months.id, id)))[0];
  const MS = async (id: string) => (await db.select().from(schema.memberships).where(eq(schema.memberships.id, id)))[0];
  const monthsOf = (membershipId: string) => db.select().from(months).where(eq(months.membershipId, membershipId)).orderBy(months.number);
  const intentOf = async (monthId: string) => stripe().paymentIntents.retrieve((await M(monthId)).stripePaymentIntentId!);
  const placesOf = (m: Awaited<ReturnType<typeof M>>) => [m.freeCents, m.setAsideCents, m.usedCents, m.expiredCents, m.toPayBackCents, m.paidBackCents];
  const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
  const ledger = async (owner: { monthId: string } | { paymentId: string }, kind: string) =>
    (
      await db
        .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amountCents}), 0)::int`, lines: sql<number>`count(*)::int` })
        .from(schema.ledgerEntries)
        .where(and("monthId" in owner ? eq(schema.ledgerEntries.monthId, owner.monthId) : eq(schema.ledgerEntries.paymentId, owner.paymentId), eq(schema.ledgerEntries.kind, kind)))
    )[0];
  const emails = async (to: string, subject: string) => (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)))).length;
  const operations = (monthId: string, kind: string) => db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.monthId, monthId), eq(schema.moneyOperations.kind, kind)));
  const refundsOf = (monthId: string) => db.select().from(schema.membershipRefunds).where(eq(schema.membershipRefunds.monthId, monthId));
  const expiredPayment = async (monthId: string) => (await db.select().from(schema.payments).where(and(eq(schema.payments.monthId, monthId), eq(schema.payments.kind, "member_expired"))))[0];
  const cardsOf = (membershipId: string) => db.select().from(schema.membershipCards).where(eq(schema.membershipCards.membershipId, membershipId)).orderBy(schema.membershipCards.savedAt);
  /** The helper, run until it has nothing left to do. */
  async function helper(now: Date, rounds = 2) {
    for (let i = 0; i < rounds; i++) {
      await reconcileOperations(now);
      await runMembershipJobs(now);
    }
  }
  /** Makes a written-down action old enough for the helper to look at it (it waits a minute), or too old to repeat (23 hours). */
  const age = (operationId: string, ms: number) => db.update(schema.moneyOperations).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.moneyOperations.id, operationId));

  /**
   * Compared after every journey, each read on its own: the month's six places against what was
   * paid; Stripe asked afresh, with EVERY PaymentIntent of the member listed in full, so each month
   * has exactly one and none exists that the database does not know; every refund on it; the money
   * record; and no work left owed.
   */
  async function audit(label: string, m: Made, opts: { owed?: boolean } = {}) {
    const problems: string[] = [];
    const [customer] = await db.select().from(schema.stripeCustomers).where(eq(schema.stripeCustomers.userId, m.member.id));
    const all = await db.select({ month: months }).from(months).innerJoin(schema.memberships, eq(schema.memberships.id, months.membershipId)).where(eq(schema.memberships.customerId, m.member.id));
    const intents = customer ? await stripe().paymentIntents.list({ customer: customer.stripeCustomerId, limit: 100 }).autoPagingToArray({ limit: 1000 }) : [];
    const known = new Map(all.filter(({ month }) => month.stripePaymentIntentId).map(({ month }) => [month.stripePaymentIntentId!, month]));
    for (const intent of intents) if (!known.has(intent.id)) problems.push(`Stripe has a payment ${intent.id} the database does not know`);
    for (const { month } of all) {
      const mine = intents.filter((intent) => intent.metadata?.monthId === month.id);
      if (mine.length > 1) problems.push(`month ${month.number} has ${mine.length} payments at Stripe`);
      const intent = mine[0];
      if ((intent?.id ?? null) !== month.stripePaymentIntentId) problems.push(`month ${month.number}: Stripe's payment for it is ${intent?.id}, the month has ${month.stripePaymentIntentId} saved`);
      const places = sum(placesOf(month));
      const charged = await ledger({ monthId: month.id }, "customer_charge");
      const refunded = await ledger({ monthId: month.id }, "customer_refund");
      if (["running", "closed", "finished"].includes(month.status)) {
        if (places !== month.totalCents) problems.push(`month ${month.number}: the six places add up to ${places}, not ${month.totalCents}`);
        if (!intent || intent.status !== "succeeded" || intent.amount_received !== month.totalCents) problems.push(`month ${month.number}: Stripe took ${intent?.amount_received}, state ${intent?.status}`);
        if (charged.lines !== 1 || charged.total !== month.totalCents) problems.push(`month ${month.number}: ${charged.lines} "charged" lines for ${charged.total}`);
        const atStripe = intent ? await stripe().refunds.list({ payment_intent: intent.id, limit: 100 }).autoPagingToArray({ limit: 1000 }) : [];
        const back = sum(atStripe.filter((refund) => refund.status === "succeeded").map((refund) => refund.amount));
        if (back !== month.paidBackCents) problems.push(`month ${month.number}: Stripe paid back ${back}, the month says ${month.paidBackCents}`);
        if (refunded.total !== -month.paidBackCents) problems.push(`month ${month.number}: the money record says ${refunded.total} paid back`);
      } else {
        if (places !== 0) problems.push(`month ${month.number} is "${month.status}" and has money in its places`);
        if (month.takenCents === null) {
          if (intent && intent.amount_received !== 0) problems.push(`month ${month.number} is "${month.status}" but Stripe took ${intent.amount_received}`);
          if (charged.lines !== 0) problems.push(`month ${month.number} is "${month.status}" but has a "charged" line`);
          if (month.status === "given_up" && intent && intent.status !== "canceled") problems.push(`month ${month.number} is given up but its payment is "${intent.status}"`);
          if (month.status === "held" && intent?.status !== "requires_capture") problems.push(`month ${month.number} is held but its payment is "${intent?.status}"`);
        } else if (intent?.amount_received !== month.takenCents || charged.total !== month.takenCents) {
          problems.push(`month ${month.number}: an odd charge of ${month.takenCents}, Stripe says ${intent?.amount_received}, the record ${charged.total}`);
        }
      }
      const started = await db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.monthId, month.id), eq(schema.moneyOperations.status, "started")));
      if (started.length > 0) problems.push(`month ${month.number} has an action without an answer`);
      const owed = (await refundsOf(month.id)).filter((line) => line.status !== "done");
      if (owed.length > 0 && !opts.owed) problems.push(`month ${month.number} has a pay-back that is not done`);
    }
    const unfinished = await db.select().from(schema.memberships).where(and(eq(schema.memberships.customerId, m.member.id), eq(schema.memberships.status, "ended"), sql`${schema.memberships.cleanupDoneAt} is null`));
    if (unfinished.length > 0) problems.push("an ended membership is not cleaned up");
    check(`${label}: the books, Stripe and the money record agree, and nothing is left to do`, problems.length === 0, problems.join("; "));
  }

  // ------------------------------------------------------------------------
  // Cleaning up: only this script's own people (ids starting "mc-")
  // ------------------------------------------------------------------------
  /** If an earlier run stopped while one of its hosts held the test payout account, the seeded host gets it back before anything is deleted. */
  async function payoutAccountBack() {
    const [holder] = await db.select().from(schema.hostSettings).where(and(like(schema.hostSettings.userId, "mc-%"), sql`${schema.hostSettings.stripeAccountId} is not null`));
    const [seeded] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, "host@test.local"));
    if (!holder || !seeded) return;
    await db.transaction(async (tx) => {
      await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, holder.userId));
      await tx.update(schema.hostSettings).set({ stripeAccountId: holder.stripeAccountId }).where(eq(schema.hostSettings.userId, seeded.id));
    });
    console.log("   (the test payout account was given back to host@test.local)");
  }

  async function wipe(everything = false) {
    await payoutAccountBack();
    const mine = or(like(schema.memberships.hostId, "mc-%"), like(schema.memberships.customerId, "mc-%"));
    const all = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(mine);
    const ids = all.map((row) => row.id);
    if (ids.length > 0) {
      const theirMonths = await db.select().from(months).where(inArray(months.membershipId, ids));
      const monthIds = theirMonths.map((month) => month.id);
      // Nothing stays held on a test card.
      for (const month of theirMonths) {
        if (month.stripePaymentIntentId && (month.status === "to_pay" || month.status === "held")) await stripe().paymentIntents.cancel(month.stripePaymentIntentId).catch(() => undefined);
      }
      if (monthIds.length > 0) {
        const payments = (await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.monthId, monthIds))).map((row) => row.id);
        if (payments.length > 0) {
          await db.delete(schema.collectionItems).where(inArray(schema.collectionItems.paymentId, payments));
          await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, payments));
          await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, payments));
        }
        await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.monthId, monthIds));
        await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.monthId, monthIds));
        await db.delete(schema.membershipRefunds).where(inArray(schema.membershipRefunds.monthId, monthIds));
        if (payments.length > 0) await db.delete(schema.payments).where(inArray(schema.payments.id, payments));
      }
      await db.update(schema.memberships).set({ currentMonthId: null, agreementId: null, offerMonthId: null }).where(inArray(schema.memberships.id, ids));
      if (monthIds.length > 0) await db.delete(months).where(inArray(months.id, monthIds));
      await db.delete(schema.membershipCards).where(inArray(schema.membershipCards.membershipId, ids));
      await db.delete(schema.membershipAgreements).where(inArray(schema.membershipAgreements.membershipId, ids));
      await db.delete(schema.membershipInvitations).where(inArray(schema.membershipInvitations.membershipId, ids));
      await db.delete(schema.memberships).where(inArray(schema.memberships.id, ids));
    }
    const theirBookings = (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(like(schema.bookings.hostId, "mc-%"), like(schema.bookings.customerId, "mc-%")))).map((row) => row.id);
    if (theirBookings.length > 0) {
      await db.delete(schema.bookingCards).where(inArray(schema.bookingCards.bookingId, theirBookings));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, theirBookings));
    }
    const theirCalls = (await db.select({ id: schema.calls.id }).from(schema.calls).where(or(like(schema.calls.hostId, "mc-%"), like(schema.calls.customerId, "mc-%")))).map((row) => row.id);
    if (theirCalls.length > 0) {
      const callPayments = (await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.callId, theirCalls))).map((row) => row.id);
      if (callPayments.length > 0) {
        await db.delete(schema.collectionItems).where(inArray(schema.collectionItems.paymentId, callPayments));
        await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, callPayments));
        await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, callPayments));
        await db.delete(schema.payments).where(inArray(schema.payments.id, callPayments));
      }
      await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, theirCalls));
      await db.delete(schema.calls).where(inArray(schema.calls.id, theirCalls));
    }
    if (!everything) return;
    // The people themselves, at the very end. Anything that still points at one is left for the next run.
    const steps: Array<() => Promise<unknown>> = [
      () => db.delete(schema.collections).where(like(schema.collections.hostId, "mc-%")),
      () => db.delete(schema.blocks).where(or(like(schema.blocks.blockerId, "mc-%"), like(schema.blocks.blockedId, "mc-%"))),
      () => db.delete(schema.adminActions).where(like(schema.adminActions.targetUserId, "mc-%")),
      () => db.delete(schema.weeklyHours).where(like(schema.weeklyHours.hostId, "mc-%")),
      () => db.delete(schema.hostCalendars).where(like(schema.hostCalendars.userId, "mc-%")),
      () => db.delete(schema.membershipOffers).where(like(schema.membershipOffers.hostId, "mc-%")),
      () => db.delete(schema.hostSettings).where(like(schema.hostSettings.userId, "mc-%")),
      () => db.delete(schema.hostProfiles).where(like(schema.hostProfiles.userId, "mc-%")),
      () => db.delete(schema.stripeCustomers).where(like(schema.stripeCustomers.userId, "mc-%")),
      () => db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "membercheck-%")),
      () => db.delete(schema.session).where(like(schema.session.userId, "mc-%")),
      () => db.delete(schema.user).where(like(schema.user.id, "mc-%")),
    ];
    for (const step of steps) await step().catch((error) => console.log(`   (clean-up: ${error instanceof Error ? error.message.split("\n")[0] : error})`));
  }

  const journeys: Array<[string, () => Promise<void>]> = [];
  const journey = (title: string, run: () => Promise<void>) => journeys.push([title, run]);

  // ========================================================================
  journey("A first month: the hold, the receipt, and the money taken at the first booking", async () => {
    const host = await newHost();
    const m = await atCardStep(host);
    const before = await M(m.monthId);
    check("the month is written down before Stripe is asked: $60.00, to pay, no payment yet", before.status === "to_pay" && before.totalCents === 6000 && before.stripePaymentIntentId === null && before.number === 1, before);
    check("and it is the membership's current month", (await MS(m.membershipId)).currentMonthId === m.monthId);

    const month = await pay(m.monthId);
    const intent = await intentOf(m.monthId);
    check("the hold is in place: the month is held, and Stripe holds exactly $60.00", month.status === "held" && intent.status === "requires_capture" && intent.amount_capturable === 6000, `${month.status} ${intent.status}`);
    check("the month starts at the bank's own time and ends one calendar month later", month.startsAt !== null && month.authorisedAt?.getTime() === month.startsAt.getTime() && month.endsAt?.getTime() === monthEnd(month.startsAt).getTime());
    const usual = month.authorisedAt!.getTime() + 72 * HOUR + 3 * MIN;
    check("the money will be taken 72 hours and 3 minutes after the hold (or 12 hours before the hold's own end, if that is sooner)", month.takeAt?.getTime() === Math.min(usual, month.holdExpiresAt!.getTime() - 12 * HOUR), `${month.takeAt?.toISOString()} ${month.holdExpiresAt?.toISOString()}`);
    check("the card's country and the hold's end are stored", month.cardCountry === "US" && month.holdExpiresAt! > month.authorisedAt!);
    check("while only held, none of the money is in any of the six places", sum(placesOf(month)) === 0);
    const membership = await MS(m.membershipId);
    check("the membership is active, since the hold", membership.status === "active" && membership.since?.getTime() === month.authorisedAt?.getTime(), membership.status);
    const cards = await cardsOf(m.membershipId);
    check("the card is saved as the membership's card in use", cards.length === 1 && cards[0].retiredAt === null && cards[0].id === month.cardId);
    check("the member gets the monthly receipt, once", (await emails(m.member.email, "for this month")) === 1);
    await C.syncMonth(m.monthId, new Date());
    await handleStripeEvent({ type: "payment_intent.amount_capturable_updated", data: { object: { metadata: { monthId: m.monthId } } } });
    check("the same news from Stripe again changes nothing", (await M(m.monthId)).status === "held" && (await emails(m.member.email, "for this month")) === 1);

    const taken = await C.takeNow(m.monthId, new Date());
    const after = await intentOf(m.monthId);
    check("the first booking takes the money: the month runs and all $60.00 is free", taken.status === "running" && taken.freeCents === 6000 && sum(placesOf(taken)) === 6000 && taken.takenCents === 6000, taken.status);
    check("Stripe received exactly $60.00", after.status === "succeeded" && after.amount_received === 6000);
    check("one \"charged to the customer\" line on the month's money record", (await ledger({ monthId: m.monthId }, "customer_charge")).lines === 1);
    await C.takeNow(m.monthId, new Date());
    await C.syncMonth(m.monthId, new Date());
    await handleStripeEvent({ type: "payment_intent.succeeded", data: { object: { metadata: { monthId: m.monthId } } } });
    check("taking again, and Stripe's message about it, change nothing", (await operations(m.monthId, "capture")).length === 1 && (await ledger({ monthId: m.monthId }, "customer_charge")).lines === 1 && (await M(m.monthId)).freeCents === 6000);
    await audit("after the first month", m);
  });

  // ========================================================================
  journey("The timed taking, and the timed taking and a first booking at the same moment", async () => {
    const host = await newHost();
    const a = await held(host);
    const b = await held(host);
    const takeAt = (await M(a.monthId)).takeAt!;
    await helper(new Date(takeAt.getTime() - MIN), 1);
    check("a minute before its time, the money is still only held", (await M(a.monthId)).status === "held" && (await intentOf(a.monthId)).status === "requires_capture");
    await helper(new Date(Math.max(takeAt.getTime(), (await M(b.monthId)).takeAt!.getTime())), 1);
    check("at its time the helper takes it", (await M(a.monthId)).status === "running" && (await intentOf(a.monthId)).amount_received === 6000);
    await audit("after the timed taking", a);

    const c = await held(host);
    await Promise.all([C.takeMonth(c.monthId, new Date()), C.takeNow(c.monthId, new Date()), C.takeMonth(c.monthId, new Date())]);
    await helper(new Date());
    const month = await M(c.monthId);
    check("three takings at once take the money once", month.status === "running" && month.freeCents === 6000 && (await intentOf(c.monthId)).amount_received === 6000 && (await ledger({ monthId: c.monthId }, "customer_charge")).lines === 1, month.status);
    await audit("after three takings at once", c);
  });

  // ========================================================================
  journey("A month that expires whole, its renewal, and the same month closed twice", async () => {
    const host = await newHost();
    const m = await running(host);
    const first = await M(m.monthId);
    await helper(new Date(first.endsAt!.getTime() - MIN), 1);
    check("a minute before its end the month still runs", (await M(m.monthId)).status === "running" && (await monthsOf(m.membershipId)).length === 1);

    await Promise.all([closeMonth(m.monthId, first.endsAt!), closeMonth(m.monthId, first.endsAt!)]);
    const closed = await M(m.monthId);
    check("at its end all $60.00 has expired, and the month is finished", closed.status === "finished" && closed.expiredCents === 6000 && closed.freeCents === 0, `${closed.status} ${closed.expiredCents}`);
    const payment = await expiredPayment(m.monthId);
    check("one \"expired time\" payment: $60.00, no call, charged, not a card payment", payment?.chargedCents === 6000 && payment.callId === null && payment.status === "charged" && payment.stripePaymentIntentId === null && payment.stripeChargeId === closed.stripeChargeId, payment);
    // $60.00 on a US card: 4.9% is $2.94, plus the month's 30 cents: $3.24. The host earns $56.76.
    check("fee $2.94 plus the month's 30 cents; the host earns $56.76", payment.originalFeeCents === 324 && payment.originalHostShareCents === 5676, `${payment.originalFeeCents} ${payment.originalHostShareCents}`);
    check("the host can collect it 24 hours after the month's end", payment.transferStatus === "not_due" && payment.transferDueAt?.getTime() === first.endsAt!.getTime() + DAY);
    check("the payment's money record has the fee and the host's share, and no second \"charged to the customer\"", (await ledger({ paymentId: payment.id }, "platform_fee")).total === 324 && (await ledger({ paymentId: payment.id }, "host_share")).total === 5676 && (await ledger({ paymentId: payment.id }, "customer_charge")).lines === 0);
    const refused = await capturePayment({ paymentId: payment.id, amountCents: 100, reason: "attendance", frozen: null, callEndsAt: new Date() }).catch((error) => error);
    check("the card code refuses this payment before Stripe is asked", refused instanceof MoneyError, String(refused));

    const all = await monthsOf(m.membershipId);
    const renewal = all[1];
    check("two closings at once wrote exactly one renewal", all.length === 2 && renewal.originKey === `renewal:${m.monthId}` && renewal.number === 2 && renewal.period === 1, all.length);
    check("the renewal has its own payment, held on the saved card in the background", renewal.status === "held" && renewal.stripePaymentIntentId !== first.stripePaymentIntentId && (await intentOf(renewal.id)).status === "requires_capture", { status: renewal.status, tries: (await operations(renewal.id, "hold")).map((o) => `${o.status}: ${o.error}`), stripe: (await intentOf(renewal.id)).last_payment_error?.message });
    check("it is now the membership's current month, and the membership stays active", (await MS(m.membershipId)).currentMonthId === renewal.id && (await MS(m.membershipId)).status === "active");
    check("the member gets a receipt for the new month", (await emails(m.member.email, "for this month")) === 2);
    await helper(first.endsAt!);
    check("the helper, run again, adds nothing", (await monthsOf(m.membershipId)).length === 2 && (await operations(renewal.id, "hold")).length === 1);
    await audit("after a renewal", m);
  });

  // ========================================================================
  journey("A saved card that is refused: tries on the rulebook's days, then giving up and a pause", async () => {
    const host = await newHost();
    const m = await running(host);
    const failing = await saveCard(m, "pm_card_chargeCustomerFail");
    const first = await M(m.monthId);
    const T = first.endsAt!;
    await closeMonth(m.monthId, T);
    const renewal = (await monthsOf(m.membershipId))[1];
    let month = await M(renewal.id);
    check("the renewal's first try is refused: the month stays to pay, and the payment is kept", month.status === "to_pay" && month.try === 2 && month.stripePaymentIntentId !== null && (await intentOf(renewal.id)).status === "requires_payment_method", `${month.status} ${month.try}`);
    check("the 7 days count from the first failure; the next try is a day later", month.firstFailedAt?.getTime() === T.getTime() && month.nextTryAt?.getTime() === T.getTime() + DAY && month.giveUpAt?.getTime() === T.getTime() + 7 * DAY && !month.needsAction);
    check("the membership is unpaid, and the member is told at once, with a link to pay", (await MS(m.membershipId)).status === "unpaid" && (await emails(m.member.email, "did not go through")) === 1);
    check("the old month is not touched: it finished on its own date", (await M(m.monthId)).status === "finished");

    await helper(new Date(T.getTime() + DAY - MIN));
    check("before the next day, nothing is tried again", (await operations(renewal.id, "hold")).length === 1);
    for (const [day, tries, next] of [[1, 2, 3], [3, 3, 5], [5, 4, null]] as const) {
      await helper(new Date(T.getTime() + day * DAY));
      month = await M(renewal.id);
      check(`day ${day}: tried again, as a new action of its own, and refused`, (await operations(renewal.id, "hold")).length === tries && month.try === tries + 1 && (next === null ? month.nextTryAt === null : month.nextTryAt?.getTime() === T.getTime() + next * DAY), `${(await operations(renewal.id, "hold")).length} ${month.try}`);
    }
    check("every failed try told the member", (await emails(m.member.email, "did not go through")) === 4);
    check("the same payment all along: Stripe has two for this member, one per month", (await intentOf(renewal.id)).id === renewal.stripePaymentIntentId);
    await helper(new Date(T.getTime() + 7 * DAY - MIN));
    check("a minute before the 7 days are over it is still open", (await M(renewal.id)).status === "to_pay" && (await MS(m.membershipId)).status === "unpaid");

    await helper(new Date(T.getTime() + 7 * DAY));
    month = await M(renewal.id);
    const membership = await MS(m.membershipId);
    check("after 7 days the payment is given up and cancelled at Stripe", month.status === "given_up" && month.endedHow === "given_up" && (await intentOf(renewal.id)).status === "canceled", `${month.status} ${month.endedHow}`);
    check("the membership is paused, with no current month, and both are told", membership.status === "paused" && membership.pausedReason === "payment" && membership.currentMonthId === null && (await emails(m.member.email, "is paused")) === 1 && (await emails(host.email, "membership is paused")) === 1, membership);
    const cards = await cardsOf(m.membershipId);
    check("its card is used for nothing new, and removed at Stripe once nothing needs it", cards.every((card) => card.retiredAt !== null) && cards.find((card) => card.stripePaymentMethodId === failing)?.removedAt != null && (await stripe().paymentMethods.retrieve(failing)).customer === null, cards);
    await helper(new Date(T.getTime() + 40 * DAY));
    check("a payment we gave up is never followed by a new month", (await monthsOf(m.membershipId)).length === 2 && (await MS(m.membershipId)).status === "paused");
    await audit("after giving up", m);
  });

  // ========================================================================
  journey("A bank that wants the member's own approval; then \"Pay now\" with a new card", async () => {
    const host = await newHost();
    const m = await running(host);
    const old = await saveCard(m, "pm_card_authenticationRequired");
    const T = (await M(m.monthId)).endsAt!;
    await closeMonth(m.monthId, T);
    const renewal = (await monthsOf(m.membershipId))[1];
    let month = await M(renewal.id);
    check("a card that needs the member's approval counts as a failed try, marked as such", month.status === "to_pay" && month.needsAction && month.try === 2 && (await MS(m.membershipId)).status === "unpaid", `${month.status} ${month.needsAction} ${(await intentOf(renewal.id)).status}`);
    const stranger = await person("stranger");
    check("only the member is given the payment's secret", (await C.payNow({ monthId: renewal.id, memberId: stranger.id })) === null && Boolean((await C.payNow({ monthId: renewal.id, memberId: m.member.id }))?.clientSecret));

    month = await pay(renewal.id, "pm_card_visa");
    check("the member pays on the page with another card: the same payment is now held", month.status === "held" && month.stripePaymentIntentId === renewal.stripePaymentIntentId && !month.needsAction && month.nextTryAt === null && month.giveUpAt === null, month.status);
    check("the membership is active again", (await MS(m.membershipId)).status === "active");
    const cards = await cardsOf(m.membershipId);
    const inUse = cards.filter((card) => card.retiredAt === null);
    check("the new card is the card in use; the old ones are retired", inUse.length === 1 && inUse[0].id === month.cardId && inUse[0].stripePaymentMethodId !== old && cards.length === 3, cards.length);
    await helper(new Date());
    check("while a month is still only held, a retired card is not removed yet", (await cardsOf(m.membershipId)).find((card) => card.stripePaymentMethodId === old)?.removedAt === null);
    await C.takeNow(renewal.id, new Date());
    await helper(new Date());
    check("once nothing open needs it, the old card is removed at Stripe; the card in use stays", (await cardsOf(m.membershipId)).find((card) => card.stripePaymentMethodId === old)?.removedAt != null && (await stripe().paymentMethods.retrieve(inUse[0].stripePaymentMethodId)).customer !== null);
    check("a payment that went through is never turned into \"not paid\" by a later try", (await C.tryHold(renewal.id, new Date())).status === "running");
    check("the page has no secret to give for a month that is paid", (await C.payNow({ monthId: renewal.id, memberId: m.member.id })) === null);
    await audit("after Pay now", m);
  });

  // ========================================================================
  journey("\"Pay now\" and an automatic try at the same moment", async () => {
    const host = await newHost();
    const m = await running(host);
    const T = (await M(m.monthId)).endsAt!;
    // The renewal is written down without its first try, so both can arrive together.
    const renewalId = await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, m.monthId);
      const next = await C.writeDownMonth(tx, locked.membership, { originKey: `renewal:${m.monthId}`, agreementId: locked.membership.agreementId!, pricePer15Cents: 750, includedMinutes: 120, tryNow: true }, T);
      return next.id;
    });
    await Promise.all([C.tryHold(renewalId, T), pay(renewalId, "pm_card_mastercard"), C.tryHold(renewalId, T)]);
    await helper(new Date());
    const month = await M(renewalId);
    const intent = await intentOf(renewalId);
    check("one hold, on one payment, whichever of them won", month.status === "held" && intent.status === "requires_capture" && intent.amount_capturable === 6000, `${month.status} ${intent.status}`);
    check("exactly one card is in use", (await cardsOf(m.membershipId)).filter((card) => card.retiredAt === null).length === 1);
    await db.update(months).set({ status: "finished", expiredCents: 6000, freeCents: 0 }).where(eq(months.id, m.monthId)); // the old month is not this journey's subject
    await audit("after two ways to pay at once", m);
  });

  // ========================================================================
  journey("A hold the bank lets go: replaced once; with an offer of less time open: paused", async () => {
    const host = await newHost();
    const m = await held(host);
    const lost = await M(m.monthId);
    await stripe().paymentIntents.cancel(lost.stripePaymentIntentId!); // the bank drops the hold
    const T = new Date();
    await C.syncMonth(m.monthId, T);
    await C.syncMonth(m.monthId, T);
    await handleStripeEvent({ type: "payment_intent.canceled", data: { object: { metadata: { monthId: m.monthId } } } });
    const all = await monthsOf(m.membershipId);
    check("the month is closed as not paid", (await M(m.monthId)).status === "given_up" && (await M(m.monthId)).endedHow === "hold_lost");
    check("a new month with the same price and time is written down, once, however often we hear of it", all.length === 2 && all[1].originKey === `replacement:${m.monthId}` && all[1].totalCents === 6000 && all[1].includedMinutes === 120, all.length);
    check("it goes the failed-payment way: unpaid, the member told, 7 days from the moment the hold was found gone", (await MS(m.membershipId)).status === "unpaid" && (await emails(m.member.email, "did not go through")) === 1 && all[1].giveUpAt?.getTime() === T.getTime() + 7 * DAY);
    await helper(T);
    const replacement = await M(all[1].id);
    check("the helper tries the saved card on a payment of its own, and it is held", replacement.status === "held" && replacement.stripePaymentIntentId !== lost.stripePaymentIntentId && (await MS(m.membershipId)).status === "active" && (await MS(m.membershipId)).currentMonthId === replacement.id, replacement.status);
    check("taking the lost month's money does nothing", (await C.takeNow(m.monthId, new Date())).status === "given_up");
    await audit("after a lost hold", m);

    const o = await held(host);
    await db.update(schema.memberships).set({ offerId: randomUUID(), offerMonthId: o.monthId, offeredMinutes: 60, offeredAt: new Date() }).where(eq(schema.memberships.id, o.membershipId));
    await stripe().paymentIntents.cancel((await M(o.monthId)).stripePaymentIntentId!);
    await C.syncMonth(o.monthId, new Date());
    await helper(new Date());
    const paused = await MS(o.membershipId);
    check("with an offer of less time open the member is paused instead, and nothing new is tried", paused.status === "paused" && paused.pausedReason === "hold_lost" && paused.offerId === null && (await monthsOf(o.membershipId)).length === 1, paused.status);
    await audit("after a lost hold with an offer open", o);
  });

  // ========================================================================
  journey("Giving a month up on purpose; a hold that arrives afterwards; money taken in that very moment", async () => {
    const host = await newHost();
    const a = await held(host);
    await C.abandonMonth(a.monthId, "cancel_now", new Date());
    await C.abandonMonth(a.monthId, "cancel_now", new Date());
    let month = await M(a.monthId);
    check("\"Cancel now\": the hold is let go and nothing was ever charged", month.status === "given_up" && month.endedHow === "cancel_now" && (await intentOf(a.monthId)).status === "canceled" && (await intentOf(a.monthId)).amount_received === 0, month.status);
    check("the membership is paused, and its card retired", (await MS(a.membershipId)).status === "paused" && (await MS(a.membershipId)).pausedReason === "cancel_now" && (await cardsOf(a.membershipId))[0].retiredAt !== null);
    await helper(new Date(Date.now() + 40 * DAY));
    check("no new month ever follows", (await monthsOf(a.membershipId)).length === 1 && (await operations(a.monthId, "release")).length === 1);
    await audit("after Cancel now", a);

    // A hold that arrives for a month that was already given up is let go, never accepted.
    const b = await atCardStep(host);
    const found = (await C.intentFor(b.monthId, new Date()))!;
    await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, b.monthId);
      await tx.update(months).set({ endedHow: "card_step" }).where(eq(months.id, b.monthId));
      await S.settleAfterGivenUp(tx, locked, "card_step", new Date());
    });
    await stripe().paymentIntents.confirm(found.intentId, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    check("(the hold really arrived at Stripe)", (await intentOf(b.monthId)).status === "requires_capture");
    await handleStripeEvent({ type: "payment_intent.amount_capturable_updated", data: { object: { metadata: { monthId: b.monthId } } } });
    month = await M(b.monthId);
    check("a hold that arrives after the month was given up is let go, and gives no time", month.status === "given_up" && (await intentOf(b.monthId)).status === "canceled" && (await cardsOf(b.membershipId)).length === 0, month.status);
    check("the joining is undone: the invitation stands again while it has time left", (await MS(b.membershipId)).status === "invited" && (await MS(b.membershipId)).currentMonthId === null);
    check("the secret of a month that was given up is given to nobody", (await C.payNow({ monthId: b.monthId, memberId: b.member.id })) === null);
    await audit("after a hold for a month given up", b);

    // The money goes through in the very moment the month is being given up: all of it is owed back.
    const c = await held(host);
    await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, c.monthId);
      await tx.update(months).set({ endedHow: "cancel_now" }).where(eq(months.id, c.monthId));
      await S.settleAfterGivenUp(tx, locked, "cancel_now", new Date());
    });
    await stripe().paymentIntents.capture((await M(c.monthId)).stripePaymentIntentId!); // taken at Stripe before our cancellation got there
    await C.letHoldGo(c.monthId, new Date());
    month = await M(c.monthId);
    let lines = await refundsOf(c.monthId);
    check("taken in the very moment it was given up: recorded once, and all $60.00 is owed back", month.status === "closed" && month.toPayBackCents === 6000 && month.freeCents === 0 && lines.length === 1 && lines[0].sourceKey === `late:${c.monthId}` && lines[0].status === "owed", `${month.status} ${month.toPayBackCents}`);
    await C.syncMonth(c.monthId, new Date());
    await C.letHoldGo(c.monthId, new Date());
    check("hearing of it again changes nothing", (await refundsOf(c.monthId)).length === 1 && (await ledger({ monthId: c.monthId }, "customer_charge")).lines === 1);
    await helper(new Date());
    month = await M(c.monthId);
    lines = await refundsOf(c.monthId);
    const atStripe = await stripe().refunds.list({ payment_intent: month.stripePaymentIntentId!, limit: 10 });
    check("the helper pays it back in full, and the month is finished", month.status === "finished" && month.paidBackCents === 6000 && month.toPayBackCents === 0 && lines[0].status === "done" && atStripe.data.length === 1 && atStripe.data[0].amount === 6000 && atStripe.data[0].metadata?.attempt === "1", `${month.status} ${lines[0].status}`);
    check("the member is told, and it gave no time and no new month", (await emails(c.member.email, "paid back to your card")) === 1 && (await monthsOf(c.membershipId)).length === 1 && (await MS(c.membershipId)).status === "paused");
    await audit("after money taken while giving up", c);
  });

  // ========================================================================
  journey("The card step: it runs out, a hold comes in time or too late, no room, and the switch", async () => {
    const host = await newHost();
    const a = await atCardStep(host, { cardStepMs: -MIN });
    const b = await atCardStep(host, { cardStepMs: -MIN });
    await db.update(schema.memberships).set({ inviteExpiresAt: new Date(Date.now() - MIN) }).where(eq(schema.memberships.id, b.membershipId));
    await helper(new Date());
    check("no hold by the end of the card step: the month is given up, and nothing was ever asked of Stripe", (await M(a.monthId)).status === "given_up" && (await M(a.monthId)).endedHow === "card_step" && (await M(a.monthId)).stripePaymentIntentId === null);
    check("the joining is undone, and the invitation stands while it has time left", (await MS(a.membershipId)).status === "invited" && (await MS(a.membershipId)).currentMonthId === null);
    const over = await MS(b.membershipId);
    check("with the invitation over too, it ends quietly: this person was never a member", over.status === "ended" && over.cleanupDoneAt !== null && (await emails(b.member.email, "has ended")) === 0, over.status);

    const c = await atCardStep(host);
    await confirmOnly(c.monthId);
    await db.update(months).set({ cardStepExpiresAt: new Date(Date.now() + 5_000) }).where(eq(months.id, c.monthId));
    await helper(new Date(Date.now() + HOUR), 1);
    check("a hold that came in time counts, also when the helper only looks an hour later", (await M(c.monthId)).status === "held" && (await MS(c.membershipId)).status === "active", (await M(c.monthId)).status);

    const d = await atCardStep(host);
    await C.payNow({ monthId: d.monthId, memberId: d.member.id }); // the card form is opened in time
    await db.update(months).set({ cardStepExpiresAt: new Date(Date.now() - HOUR) }).where(eq(months.id, d.monthId));
    await stripe().paymentIntents.confirm((await M(d.monthId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" }); // and the card is entered after the time is over
    await C.syncMonth(d.monthId, new Date());
    check("a hold that came after the card step's time is let go, and nothing starts", (await M(d.monthId)).status === "given_up" && (await M(d.monthId)).endedHow === "card_step" && (await intentOf(d.monthId)).status === "canceled" && (await MS(d.membershipId)).status === "invited", (await M(d.monthId)).status);
    for (const m of [a, c, d]) await audit("after the card step", m);

    // Room for exactly one member: 30 minutes a week is 2 hours in four weeks.
    const small = await newHost({ weeklyMinutes: 30 });
    const first = await held(small);
    check("the first member has the host's only place", (await M(first.monthId)).status === "held" && (await Room.roomLeft(db, small.id, new Date())) === 0);
    const second = await atCardStep(small);
    await pay(second.monthId);
    check("a hold that comes back when there is no room is let go, and nothing starts", (await M(second.monthId)).status === "given_up" && (await M(second.monthId)).endedHow === "no_room" && (await intentOf(second.monthId)).status === "canceled" && (await MS(second.membershipId)).status === "invited", (await M(second.monthId)).endedHow);
    await audit("after a hold without room", second);

    const unnamed = await newHost({ named: false });
    const e = await atCardStep(unnamed);
    await pay(e.monthId);
    check("for a host the founder has not named, a hold is let go and nothing starts", (await M(e.monthId)).status === "given_up" && (await intentOf(e.monthId)).status === "canceled" && (await MS(e.membershipId)).status === "invited", (await M(e.monthId)).status);
    await setSwitches({ memberships: "named", membershipsHosts: [] });
    const f = await atCardStep(host);
    await pay(f.monthId);
    check("with \"named hosts\" and nobody named, memberships are on for nobody", (await M(f.monthId)).status === "given_up" && (await MS(f.membershipId)).status === "invited");
    await setSwitches({ memberships: "off" });
    const g = await atCardStep(host);
    await pay(g.monthId);
    check("with the switch off, nothing starts either", (await M(g.monthId)).status === "given_up" && (await intentOf(g.monthId)).status === "canceled");
    await setSwitches({ memberships: "named", membershipsHosts: named });
    await audit("after the switch refused a hold", g);
  });

  // ========================================================================
  journey("Stripe reports a different amount; and a charge first found after the fact", async () => {
    const host = await newHost();
    const a = await held(host);
    await stripe().paymentIntents.capture((await M(a.monthId)).stripePaymentIntentId!, { amount_to_capture: 5000 });
    await C.syncMonth(a.monthId, new Date());
    await C.syncMonth(a.monthId, new Date());
    let month = await M(a.monthId);
    check("a different amount than the whole: the month gives no time and stays out of the six places", month.status === "held" && sum(placesOf(month)) === 0 && month.takenCents === 5000 && Boolean(month.problem), month);
    check("the real amount is on the month's money record, once", (await ledger({ monthId: a.monthId }, "customer_charge")).total === 5000 && (await ledger({ monthId: a.monthId }, "customer_charge")).lines === 1);
    await helper(new Date(Date.now() + 80 * HOUR));
    check("nothing is tried on it; it waits for the founder", (await M(a.monthId)).status === "held" && (await operations(a.monthId, "capture")).length === 0);
    check("the founder sees it on the admin page, and the health check says so", (await membershipsToLookAt(new Date())).withProblem.some((row) => row.month.id === a.monthId) && (await healthProblems(new Date())).some((line) => line.includes("needs the founder")));
    await audit("after an odd amount", a);
    await db.update(months).set({ problem: null, status: "given_up", endedHow: "cancelled_at_stripe" }).where(eq(months.id, a.monthId)); // out of the way of the next part

    const b = await running(host);
    await saveCard(b, "pm_card_chargeCustomerFail");
    await closeMonth(b.monthId, (await M(b.monthId)).endsAt!);
    const renewal = (await monthsOf(b.membershipId))[1];
    check("(the renewal is waiting for a payment)", (await M(renewal.id)).status === "to_pay" && (await MS(b.membershipId)).status === "unpaid");
    await confirmOnly(renewal.id);
    await stripe().paymentIntents.capture(renewal.stripePaymentIntentId ?? (await M(renewal.id)).stripePaymentIntentId!); // taken without our code ever accepting the hold
    await C.syncMonth(renewal.id, new Date());
    await C.syncMonth(renewal.id, new Date());
    month = await M(renewal.id);
    check("a charge on a month we never accepted: recorded once, all of it owed back, no time given", month.status === "closed" && month.toPayBackCents === 6000 && (await refundsOf(renewal.id)).length === 1 && (await refundsOf(renewal.id))[0].sourceKey === `late:${renewal.id}`, month.status);
    const membership = await MS(b.membershipId);
    check("it was the current month: the membership is paused and its card retired", membership.status === "paused" && membership.currentMonthId === null && (await cardsOf(b.membershipId)).every((card) => card.retiredAt !== null), membership.status);
    await helper(new Date());
    check("paid back in full, and never renewed or replaced", (await M(renewal.id)).status === "finished" && (await M(renewal.id)).paidBackCents === 6000 && (await monthsOf(b.membershipId)).length === 2);
    await audit("after a charge found after the fact", b);

    // The helper was down when the 7 days ran out, and the member paid after them.
    const c = await running(host);
    await saveCard(c, "pm_card_chargeCustomerFail");
    await closeMonth(c.monthId, (await M(c.monthId)).endsAt!);
    const late = (await monthsOf(c.membershipId))[1];
    await db.update(months).set({ giveUpAt: new Date(Date.now() - HOUR) }).where(eq(months.id, late.id));
    await confirmOnly(late.id);
    await helper(new Date());
    month = await M(late.id);
    check("a hold placed after the 7 days is not accepted: it is let go, and the membership is paused", month.status === "given_up" && month.endedHow === "given_up" && (await intentOf(late.id)).status === "canceled" && (await MS(c.membershipId)).status === "paused", `${month.status} ${month.endedHow}`);
    await audit("after a hold placed too late", c);
  });

  // ========================================================================
  journey("Pay-backs: owed once, tried as often as needed, each answer applied only to its own try", async () => {
    const host = await newHost();
    const a = await running(host);
    // $15.00 of the free money came back because of the host (part two's calls will do this; here it is put on the month).
    await db.update(months).set({ hostCausedCents: 1500 }).where(eq(months.id, a.monthId));
    await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, a.membershipId));
    const end = (await M(a.monthId)).endsAt!;
    await closeMonth(a.monthId, end);
    let month = await M(a.monthId);
    check("at the month's end the host-caused $15.00 is owed back to the card, and the other $45.00 has expired", month.status === "closed" && month.toPayBackCents === 1500 && month.expiredCents === 4500 && month.freeCents === 0 && month.hostCausedCents === 0, month);
    const expired = await expiredPayment(a.monthId);
    // $45.00: 4.9% is $2.205, rounded to $2.21, plus the month's 30 cents: $2.51. The host earns $42.49.
    check("the host earns on the $45.00 only: fee $2.51, share $42.49", expired.chargedCents === 4500 && expired.originalFeeCents === 251 && expired.originalHostShareCents === 4249, `${expired.originalFeeCents} ${expired.originalHostShareCents}`);
    check("the member stopped the renewal, so the membership is paused at the month's end and nothing new is charged", (await MS(a.membershipId)).status === "paused" && (await MS(a.membershipId)).pausedReason === "member" && (await monthsOf(a.membershipId)).length === 1);
    let [line] = await refundsOf(a.monthId);
    check("owed, with no try started yet", line.status === "owed" && line.sourceKey === `monthend:${a.monthId}` && (await operations(a.monthId, "refund")).length === 0);
    await helper(end);
    month = await M(a.monthId);
    [line] = await refundsOf(a.monthId);
    check("the helper sends it; Stripe confirms; the month is finished", line.status === "done" && month.paidBackCents === 1500 && month.toPayBackCents === 0 && month.status === "finished", `${line.status} ${month.status}`);
    await audit("after a month-end pay-back", a);

    const b = await running(host);
    const owe = (key: string, cents: number) =>
      db.transaction(async (tx) => {
        const locked = await L.lockForMonth(tx, b.monthId);
        return P.owePayBack(tx, locked.month, { amountCents: cents, sourceKey: key, reason: "A check." });
      });
    const once = await owe(`check:${b.monthId}:1`, 1000);
    const twice = await owe(`check:${b.monthId}:1`, 1000);
    check("the same event owing twice owes once", once.created && !twice.created && (await M(b.monthId)).toPayBackCents === 1000 && (await M(b.monthId)).freeCents === 5000);
    const tooMuch = await owe(`check:${b.monthId}:2`, 5001).catch((error) => error);
    check("never more than the month has free", tooMuch instanceof MoneyError && (await M(b.monthId)).toPayBackCents === 1000);

    // Stripe refuses the first try (the payment's id is made wrong for a moment).
    const real = (await M(b.monthId)).stripePaymentIntentId!;
    await db.update(months).set({ stripePaymentIntentId: "pi_not_a_real_payment" }).where(eq(months.id, b.monthId));
    await P.sendPayBack(once.refund.id, new Date());
    await db.update(months).set({ stripePaymentIntentId: real }).where(eq(months.id, b.monthId));
    [line] = await refundsOf(b.monthId);
    check("a try Stripe refuses leaves the money \"to be paid back\"; the next try will be a new one", line.status === "owed" && line.attempt === 2 && line.lastFailedAt !== null && (await M(b.monthId)).toPayBackCents === 1000, line);
    check("the founder will see it once it has been owed for an hour", (await membershipsToLookAt(new Date(Date.now() + 61 * MIN))).payBacks.some((row) => row.refund.id === line.id));
    await db.transaction(async (tx) => P.applyPayBackOutcome(tx, await L.lockForMonth(tx, b.monthId), { refundId: line.id, attempt: 1, stripeRefundId: "re_late_answer", status: "done" }, new Date()));
    check("a late answer about the first try does not touch the second", (await refundsOf(b.monthId))[0].status === "owed" && (await refundsOf(b.monthId))[0].attempt === 2 && (await M(b.monthId)).paidBackCents === 0);
    await helper(new Date(Date.now() + 30 * MIN), 1);
    check("it is not tried again within the hour", (await operations(b.monthId, "refund")).length === 1);
    await helper(new Date(Date.now() + 61 * MIN), 1);
    [line] = await refundsOf(b.monthId);
    const atStripe = await stripe().refunds.list({ payment_intent: real, limit: 10 });
    check("an hour later it is sent again, as try 2, and goes through", line.status === "done" && (await operations(b.monthId, "refund")).length === 2 && atStripe.data.length === 1 && atStripe.data[0].metadata?.attempt === "2" && atStripe.data[0].metadata?.refundId === line.id, line.status);
    await db.transaction(async (tx) => P.applyPayBackOutcome(tx, await L.lockForMonth(tx, b.monthId), { refundId: line.id, attempt: 2, stripeRefundId: null, status: "failed" }, new Date()));
    check("a late \"failed\" cannot reopen a pay-back that is done", (await refundsOf(b.monthId))[0].status === "done" && (await M(b.monthId)).paidBackCents === 1000);

    // An answer that never arrived, found again after 23 hours.
    const never = await owe(`check:${b.monthId}:3`, 700);
    const params = (refund: { id: string; attempt: number; amountCents: number }) => ({ intentId: real, amountCents: refund.amountCents, monthId: b.monthId, refundId: refund.id, attempt: refund.attempt });
    const write = async (refund: { id: string; attempt: number; amountCents: number }) => {
      const label = `monthrefund:${refund.id}:${refund.attempt}:1`;
      const [operation] = await db.insert(schema.moneyOperations).values({ monthId: b.monthId, kind: "refund", label, params: JSON.stringify(params(refund)) }).returning();
      return { label, id: operation.id };
    };
    let written = await write(never.refund);
    await age(written.id, 25 * HOUR);
    await reconcileOperations(new Date());
    [, line] = await refundsOf(b.monthId).then((rows) => rows.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()));
    check("written down but never sent, and too old to repeat: Stripe is asked, has none, and it is owed again as a new try", line.status === "owed" && line.attempt === 2 && (await stripe().refunds.list({ payment_intent: real, limit: 10 })).data.length === 1, line);

    await db.update(schema.membershipRefunds).set({ lastFailedAt: null }).where(eq(schema.membershipRefunds.id, line.id));
    await P.refundAtStripe(params(line), `monthrefund:${line.id}:${line.attempt}:1`); // Stripe did it; the answer never reached us
    if (process.argv.includes("--long")) {
      // More than 100 NEWER refunds on the same payment, so the one we look for is not on Stripe's first page (it lists the newest first).
      for (let i = 0; i < 101; i++) {
        const small = await owe(`check:${b.monthId}:small:${i}`, 1);
        await P.sendPayBack(small.refund.id, new Date());
      }
      const firstPage = await stripe().refunds.list({ payment_intent: real, limit: 100 });
      check("(101 one-cent pay-backs went through, and the one we look for is no longer on Stripe's first page)", (await M(b.monthId)).paidBackCents === 1101 && !firstPage.data.some((refund) => refund.metadata?.refundId === line.id), (await M(b.monthId)).paidBackCents);
    }
    written = await write(line);
    await age(written.id, 25 * HOUR);
    await reconcileOperations(new Date());
    line = (await refundsOf(b.monthId)).find((row) => row.id === line.id)!;
    const all = await stripe().refunds.list({ payment_intent: real, limit: 100 }).autoPagingToArray({ limit: 1000 });
    check("sent, the answer lost, and too old to repeat: found among all of the payment's refunds by its line and its try, and recorded once", line.status === "done" && all.filter((refund) => refund.metadata?.refundId === line.id).length === 1 && (await M(b.monthId)).toPayBackCents === 0, line.status);

    // A pay-back Stripe accepted and has not finished: the helper asks about it by its own id.
    const slow = await owe(`check:${b.monthId}:slow`, 300);
    const slowWritten = await write(slow.refund);
    const atStripeNow = await P.refundAtStripe(params(slow.refund), slowWritten.label);
    await db.transaction(async (tx) => {
      await P.applyPayBackOutcome(tx, await L.lockForMonth(tx, b.monthId), { refundId: slow.refund.id, attempt: 1, stripeRefundId: atStripeNow.id, status: "on_its_way" }, new Date());
      await tx.update(schema.moneyOperations).set({ status: "succeeded", stripeId: atStripeNow.id, finishedAt: new Date() }).where(eq(schema.moneyOperations.id, slowWritten.id));
    });
    const paidBefore = (await M(b.monthId)).paidBackCents;
    check("on its way: the money stays \"to be paid back\", and no second try starts beside it", (await refundsOf(b.monthId)).find((row) => row.id === slow.refund.id)?.status === "at_stripe" && (await M(b.monthId)).toPayBackCents === 300);
    await helper(new Date(), 1);
    check("the helper asks Stripe about it and records it once it is through", (await refundsOf(b.monthId)).find((row) => row.id === slow.refund.id)?.status === "done" && (await M(b.monthId)).paidBackCents === paidBefore + 300 && (await stripe().refunds.list({ payment_intent: real, limit: 100 }).autoPagingToArray({ limit: 1000 })).filter((refund) => refund.metadata?.refundId === slow.refund.id).length === 1);

    // A dispute arrives after one pay-back was written down and another was only owed.
    const writtenDown = await owe(`check:${b.monthId}:written`, 200);
    const waiting = await owe(`check:${b.monthId}:waiting`, 100);
    const before = await write(writtenDown.refund);
    await age(before.id, 2 * MIN);
    await E.recordMonthDispute(b.monthId, "open", new Date());
    const tries = (await operations(b.monthId, "refund")).length;
    await helper(new Date());
    const state = async (id: string) => (await refundsOf(b.monthId)).find((row) => row.id === id)?.status;
    check("a pay-back that was written down before the dispute is still carried out, under the name it was written down with", (await state(writtenDown.refund.id)) === "done" && (await operations(b.monthId, "refund")).length === tries);
    check("the freeze stops new steps: the pay-back that was only owed waits, and no new one can be owed", (await state(waiting.refund.id)) === "owed" && (await owe(`check:${b.monthId}:frozen`, 50).catch((error) => error)) instanceof MoneyError);
    check("the dispute ended the membership, and the frozen month's free money stays where it is", (await MS(b.membershipId)).status === "ended" && (await M(b.monthId)).freeCents > 0 && (await MS(b.membershipId)).cleanupDoneAt !== null);
    await E.recordMonthDispute(b.monthId, "won", new Date());
    await helper(new Date());
    const settled = await M(b.monthId);
    check("won: the waiting pay-back goes out, and the rest of the free money is paid back because the membership has ended", (await state(waiting.refund.id)) === "done" && settled.freeCents === 0 && settled.toPayBackCents === 0 && settled.paidBackCents === 6000, settled);
    await audit("after pay-backs", b);
  });

  // ========================================================================
  journey("A real bank dispute that is lost: the month is frozen, and the membership ends", async () => {
    const host = await newHost();
    const m = await running(host, "pm_card_createDispute"); // Stripe's test card that is always disputed
    const disputeId = await disputeOn(m.monthId);
    check("Stripe opened a dispute on the month's charge", Boolean(disputeId));
    if (!disputeId) return;
    await handleStripeEvent({ type: "charge.dispute.created", data: { object: { id: disputeId } } });
    await handleStripeEvent({ type: "charge.dispute.created", data: { object: { id: disputeId } } });
    let month = await M(m.monthId);
    const membership = await MS(m.membershipId);
    check("the dispute is recorded on the month", month.dispute === "open");
    check("the membership ends at once and for good, and both are told once", membership.status === "ended" && membership.endedBy === "connect" && (await emails(m.member.email, "has ended")) === 1 && (await emails(host.email, "membership has ended")) === 1, membership.status);
    await helper(new Date());
    month = await M(m.monthId);
    check("the month is frozen as it stands: nothing is paid back from it", month.freeCents === 6000 && month.toPayBackCents === 0 && (await refundsOf(m.monthId)).length === 0 && (await MS(m.membershipId)).cleanupDoneAt !== null, month);
    const refused = await db.transaction(async (tx) => Mo.owePayBack(tx, (await L.lockForMonth(tx, m.monthId)).month, { amountCents: 100, sourceKey: `check:${m.monthId}`, reason: "A check." })).catch((error) => error);
    check("a pay-back from a frozen month is refused", refused instanceof MoneyError);

    await stripe().disputes.update(disputeId, { evidence: { uncategorized_text: "losing_evidence" } });
    check("Stripe says the dispute was lost", (await disputeBecomes(disputeId, "lost")) === "lost");
    await handleStripeEvent({ type: "charge.dispute.closed", data: { object: { id: disputeId } } });
    await helper((await M(m.monthId)).endsAt!);
    month = await M(m.monthId);
    check("lost: the month stays frozen past its end. Nothing expires to the host, nothing is paid back, nothing renews", month.dispute === "lost" && month.status === "closed" && month.freeCents === 6000 && (await expiredPayment(m.monthId)) === undefined && (await monthsOf(m.membershipId)).length === 1, month);
    check("the founder sees the disputed month", (await membershipsToLookAt(new Date())).disputed.some((row) => row.month.id === m.monthId));
    await audit("after a lost dispute", m);
  });

  // ========================================================================
  journey("A dispute first heard of when it is already won; and a dispute over a month from before a pause", async () => {
    const host = await newHost();
    const m = await running(host, "pm_card_createDispute");
    const disputeId = await disputeOn(m.monthId);
    check("Stripe opened a dispute", Boolean(disputeId));
    if (disputeId) {
      await stripe().disputes.update(disputeId, { evidence: { uncategorized_text: "winning_evidence" } });
      check("Stripe says the dispute was won", (await disputeBecomes(disputeId, "won")) === "won");
      // The first message we ever handle arrives only now.
      await handleStripeEvent({ type: "charge.dispute.closed", data: { object: { id: disputeId } } });
      let month = await M(m.monthId);
      check("opened and won before we handled a single message: the membership is ended all the same", month.dispute === "won" && (await MS(m.membershipId)).status === "ended");
      check("won: the month is not frozen, and the money that is still free is owed back, because the membership has ended", month.toPayBackCents === 6000 && month.freeCents === 0 && (await refundsOf(m.monthId))[0]?.sourceKey === `won:${m.monthId}`, month);
      await helper(new Date());
      month = await M(m.monthId);
      check("and paid back by the helper", month.paidBackCents === 6000 && (await refundsOf(m.monthId))[0].status === "done", `${month.paidBackCents} ${(await refundsOf(m.monthId))[0].status} ${(await operations(m.monthId, "refund")).map((o) => o.error).join()}`);
      await audit("after a won dispute", m);
      // An old "open" written over the "won" (two messages handled at once, and the second look at Stripe failed).
      await db.update(months).set({ dispute: "open", updatedAt: new Date(Date.now() - 2 * HOUR) }).where(eq(months.id, m.monthId));
      await helper(new Date(), 1);
      check("a month left frozen by an old answer is put right by the helper, which asks Stripe itself every hour", (await M(m.monthId)).dispute === "won" && (await M(m.monthId)).paidBackCents === 6000 && (await refundsOf(m.monthId)).length === 1);
      await audit("after a stale dispute answer", m);
      // Later the host invites the same person again, and the bank disputes the old charge a second time.
      const again = await atCardStep(host, { member: m.member });
      await pay(again.monthId);
      check("(a new membership of the same two is active)", (await MS(again.membershipId)).status === "active" && again.membershipId !== m.membershipId);
      await E.recordMonthDispute(m.monthId, "open", new Date());
      await helper(new Date(), 1);
      check("a new dispute over the old charge ends the membership the two have by then, and its hold is let go", (await MS(again.membershipId)).status === "ended" && (await M(again.monthId)).status === "given_up" && (await intentOf(again.monthId)).status === "canceled");
    }

    // A member pauses, resumes, and their bank then disputes a month from before the pause.
    const p = await running(host);
    await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, p.membershipId));
    await closeMonth(p.monthId, (await M(p.monthId)).endsAt!);
    check("(paused at the month's end)", (await MS(p.membershipId)).status === "paused");
    const second = await resume(p);
    await pay(second);
    await C.takeNow(second, new Date());
    check("(resumed: a new period, a new month, running)", (await MS(p.membershipId)).period === 2 && (await M(second)).status === "running" && (await M(second)).period === 2);
    await E.recordMonthDispute(p.monthId, "open", new Date());
    check("a dispute over the old month ends the membership the two have now", (await MS(p.membershipId)).status === "ended" && (await M(p.monthId)).dispute === "open" && (await M(second)).dispute === "none");
    await helper(new Date());
    check("the new month's free money is paid back; the old month is frozen as it stood", (await M(second)).paidBackCents === 6000 && (await refundsOf(second))[0].sourceKey === `ending:${second}` && (await M(p.monthId)).expiredCents === 6000 && (await M(p.monthId)).status === "finished");
    await audit("after a dispute over an old month", p);
  });

  // ========================================================================
  journey("Endings from today's app: a block, a closed account, a paused account, a suspended host", async () => {
    const [founder] = await db.select().from(schema.user).where(eq(schema.user.email, "admin@test.local"));
    if (!founder) throw new Error("Run `npm run seed` first.");
    const host = await newHost();
    const a = await held(host);
    await block({ blockerId: a.member.id, blockedId: host.id, now: new Date() });
    let membership = await MS(a.membershipId);
    check("a block ends the membership in the same step, for good", membership.status === "ended" && membership.endedBy === "connect" && membership.currentMonthId === null, membership.status);
    check("its hold is let go at once, and the clean-up is done", (await M(a.monthId)).status === "given_up" && (await M(a.monthId)).endedHow === "ending" && (await intentOf(a.monthId)).status === "canceled" && membership.cleanupDoneAt !== null, (await M(a.monthId)).status);
    check("both are told, without a word about who did what", (await emails(a.member.email, "has ended")) === 1 && (await emails(host.email, "membership has ended")) === 1);
    await audit("after a block", a);

    const b = await running(host);
    await closeAccount({ userId: b.member.id, by: founder.id });
    membership = await MS(b.membershipId);
    let month = await M(b.monthId);
    check("a closed account ends the membership; all free money of the month is owed back", membership.status === "ended" && month.toPayBackCents + month.paidBackCents === 6000 && month.freeCents === 0 && (await refundsOf(b.monthId))[0].sourceKey === `ending:${b.monthId}`, `${membership.status} ${month.toPayBackCents}`);
    await helper(new Date());
    await helper((await M(b.monthId)).endsAt!);
    month = await M(b.monthId);
    check("paid back to the card; at the month's end nothing expires to the host and nothing renews", month.status === "finished" && month.paidBackCents === 6000 && month.expiredCents === 0 && (await expiredPayment(b.monthId)) === undefined && (await monthsOf(b.membershipId)).length === 1, month.status);
    await audit("after a closed account", b);

    const host2 = await newHost();
    const c = await running(host2);
    await pauseAccount({ adminId: founder.id, userId: host2.id, ruleKey: RULES[0].key, note: "", requestId: randomUUID() });
    check("a host's account paused by the founder ends her memberships", (await MS(c.membershipId)).status === "ended" && (await M(c.monthId)).freeCents === 0);

    const host3 = await newHost();
    const other = await newHost();
    const d = await running(host3);
    const own = await atCardStep(other, { member: host3 }); // the host is herself a member of another host
    await pay(own.monthId);
    await decideProfile({ userId: host3.id, decision: "suspended", by: founder.id });
    check("suspending a host ends the memberships she offers", (await MS(d.membershipId)).status === "ended");
    check("her own membership with another host goes on", (await MS(own.membershipId)).status === "active" && (await M(own.monthId)).status === "held");
    await helper(new Date());
    for (const m of [c, d]) await audit("after a paused or suspended host", m);
    await db.update(schema.user).set({ pausedAt: null, pausedReason: null }).where(eq(schema.user.id, host2.id));
  });

  // ========================================================================
  journey("An ending across a month's end, in either order of the two jobs", async () => {
    const host = await newHost();
    const endAt = async (m: Made, at: Date) => db.transaction(async (tx) => S.endMembership(tx, await L.lockMembership(tx, m.membershipId), { by: "host", reason: "a check" }, at));
    // Ended a minute BEFORE the month's end; the app stops; the helper is back after the end.
    for (const order of ["the closing first", "the clean-up first"] as const) {
      const m = await running(host);
      const end = (await M(m.monthId)).endsAt!;
      await endAt(m, new Date(end.getTime() - MIN));
      const later = new Date(end.getTime() + HOUR);
      if (order === "the closing first") await closeMonth(m.monthId, later);
      else await E.cleanUpEnding(m.membershipId, later);
      await helper(later);
      const month = await M(m.monthId);
      check(`ended a minute before the month's end, ${order}: the free money is paid back and nothing expires`, month.status === "finished" && month.paidBackCents === 6000 && month.expiredCents === 0 && (await expiredPayment(m.monthId)) === undefined && (await MS(m.membershipId)).cleanupDoneAt !== null, month);
      await audit(`after an ending before the month's end (${order})`, m);
    }
    // Ended a minute AFTER the month's end, with the closing job late.
    for (const order of ["the closing first", "the clean-up first"] as const) {
      const m = await running(host);
      const end = (await M(m.monthId)).endsAt!;
      await endAt(m, new Date(end.getTime() + MIN));
      const later = new Date(end.getTime() + HOUR);
      if (order === "the closing first") await closeMonth(m.monthId, later);
      else await E.cleanUpEnding(m.membershipId, later);
      await helper(later);
      const month = await M(m.monthId);
      check(`ended a minute after the month's end, ${order}: the unused money has expired and nothing is paid back`, month.status === "finished" && month.expiredCents === 6000 && month.paidBackCents === 0 && (await refundsOf(m.monthId)).length === 0 && (await monthsOf(m.membershipId)).length === 1, month);
      await audit(`after an ending after the month's end (${order})`, m);
    }
  });

  // ========================================================================
  journey("Renewals that are refused: no room, a host not named, the offer off, a stop; and a lower price", async () => {
    // Room for two members (an hour a week is 4 hours in four weeks); then the host's hours are cut to room for one.
    for (const order of ["the newer member's month closes first", "the older member's month closes first"] as const) {
      const host = await newHost({ weeklyMinutes: 60 });
      const older = await running(host);
      const newer = await running(host);
      await db.update(schema.weeklyHours).set({ endMinute: 570 }).where(eq(schema.weeklyHours.hostId, host.id));
      const inOrder = order.startsWith("the newer") ? [newer, older] : [older, newer];
      for (const m of inOrder) await closeMonth(m.monthId, (await M(m.monthId)).endsAt!);
      const paused = await MS(newer.membershipId);
      check(`without room (${order}): the newer member is paused at the renewal and nothing is charged`, paused.status === "paused" && paused.pausedReason === "no_room" && (await monthsOf(newer.membershipId)).length === 1 && (await emails(newer.member.email, "is paused")) === 1, paused.status);
      check("their old month finished in the usual way", (await M(newer.monthId)).status === "finished" && (await M(newer.monthId)).expiredCents === 6000);
      const kept = await monthsOf(older.membershipId);
      check("the longest-standing member who fits keeps their place: their next month is held, beside the other's month that had started", (await MS(older.membershipId)).status === "active" && kept.length === 2 && kept[1].status === "held", `${(await MS(older.membershipId)).status} ${kept[1]?.status} ${kept[1]?.endedHow}`);
      await audit("after a renewal without room", newer);
      await audit("after a renewal with room", older);
    }

    // A host the founder takes off the list is treated as if the switch had gone off for her.
    const host2 = await newHost();
    const heldOne = await held(host2);
    const runningOne = await running(host2);
    named.splice(named.indexOf(host2.id), 1);
    await setSwitches({ membershipsHosts: named });
    check("a month that has started goes on: its held money is still taken", (await C.takeNow(heldOne.monthId, new Date())).status === "running");
    await closeMonth(runningOne.monthId, (await M(runningOne.monthId)).endsAt!);
    const off = await MS(runningOne.membershipId);
    check("at its end there is no renewal: the member is paused, and nothing is charged", off.status === "paused" && off.pausedReason === "switch" && (await monthsOf(runningOne.membershipId)).length === 1 && (await M(runningOne.monthId)).status === "finished", off.pausedReason);
    await audit("after a host was taken off the list", runningOne);

    const host3 = await newHost();
    const a = await running(host3);
    const b = await running(host3);
    const c = await running(host3);
    await db.update(schema.memberships).set({ hostStoppedAt: new Date() }).where(eq(schema.memberships.id, a.membershipId));
    await closeMonth(a.monthId, (await M(a.monthId)).endsAt!);
    check("the host paused this member after the month: paused at its end", (await MS(a.membershipId)).status === "paused" && (await MS(a.membershipId)).pausedReason === "host" && (await MS(a.membershipId)).hostStoppedAt === null);
    await db.update(schema.membershipOffers).set({ pricePer15Cents: 600 }).where(eq(schema.membershipOffers.hostId, host3.id));
    await closeMonth(b.monthId, (await M(b.monthId)).endsAt!);
    const cheaper = (await monthsOf(b.membershipId))[1];
    check("the host lowered the member price: the next month is written down at the lower price, for the same time", cheaper.pricePer15Cents === 600 && cheaper.includedMinutes === 120 && cheaper.totalCents === 4800 && (await intentOf(cheaper.id)).amount === 4800 && cheaper.status === "held", cheaper);
    await db.update(schema.membershipOffers).set({ on: false }).where(eq(schema.membershipOffers.hostId, host3.id));
    await closeMonth(c.monthId, (await M(c.monthId)).endsAt!);
    check("the host's membership is switched off: paused at the month's end", (await MS(c.membershipId)).status === "paused" && (await MS(c.membershipId)).pausedReason === "offer_off" && (await monthsOf(c.membershipId)).length === 1);
    for (const m of [a, b, c]) await audit("after a refused or cheaper renewal", m);
  });

  // ========================================================================
  journey("Today's app: the regular price, weekly hours, and a card that is a booking's or a membership's, never both", async () => {
    const host = await newHost();
    const m = await held(host);
    const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, host.id));
    const price = (cents: number) => updateHostProfile(host.id, { displayName: profile.displayName, about: profile.about, pricePer15Cents: cents }).then(() => null, (error: unknown) => error as Error);
    const below = await price(700);
    check("the regular price cannot go below the member price", below instanceof ProfileError && /member price/.test(below.message), below?.message);
    check("and a host who offers a membership cannot make her calls free", (await price(0)) instanceof ProfileError);
    check("a regular price at or above the member price is saved", (await price(750)) === null && (await price(1200)) === null);
    await db.update(schema.membershipOffers).set({ on: false }).where(eq(schema.membershipOffers.hostId, host.id));
    check("with the membership switched off, a month that is still held keeps the floor", (await price(700)) instanceof ProfileError);
    await db.update(schema.membershipOffers).set({ on: true }).where(eq(schema.membershipOffers.hostId, host.id));

    const [hours] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host.id));
    const cut = await removeWeeklyHours(host.id, hours.id).then(() => null, (error: unknown) => error as Error);
    check("weekly hours cannot be cut below what the host's members need", cut instanceof CalendarError && /members/.test(cut.message) && (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host.id))).length === 1, cut?.message);
    await addWeeklyHours(host.id, { weekday: 3, from: "09:00", to: "12:00" });
    check("with enough hours left, a stretch can be removed", (await removeWeeklyHours(host.id, hours.id).then(() => null, (error: unknown) => error as Error)) === null && (await Room.hostMinutes(db, host.id)) === 720);
    const free = await newHost();
    const [freeHours] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, free.id));
    await removeWeeklyHours(free.id, freeHours.id);
    check("a host without members removes hours as before", (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, free.id))).length === 0);

    const membersCard = (await cardsOf(m.membershipId))[0].stripePaymentMethodId;
    const bookingId = await booking(host, m.member);
    const seen = (id: string, card: string) => db.transaction((tx) => Cards.bookingCardSeen(tx, id, card));
    const take = (membershipId: string, card: string) => db.transaction((tx) => Cards.takeCardForMembership(tx, membershipId, card, new Date())).then(() => true, (error: unknown) => (error instanceof MoneyError ? false : Promise.reject(error)));
    check("a membership's card offered to a booking is refused, and the booking job never removes it", (await seen(bookingId, membersCard)) === false && (await db.transaction((tx) => Cards.bookingMayRemoveCard(tx, bookingId, membersCard, new Date()))) === false && (await db.select().from(schema.bookingCards)).every((row) => row.stripePaymentMethodId !== membersCard));

    const customer = await stripeCustomerFor(m.member);
    const attach = async (testCard = "pm_card_mastercard") => (await stripe().paymentMethods.attach(testCard, { customer })).id;
    const bookingsCard = await attach();
    check("a booking learns its card: remembered as a booking's", (await seen(bookingId, bookingsCard)) === true);
    check("a booking's card offered as a membership's is refused", (await take(m.membershipId, bookingsCard)) === false);
    check("also after the booking job removed it a moment before, because the booking's line remains", (await db.transaction((tx) => Cards.bookingMayRemoveCard(tx, bookingId, bookingsCard, new Date()))) === true && (await take(m.membershipId, bookingsCard)) === false);
    const unfinished = await attach();
    await db.update(schema.bookings).set({ stripePaymentMethodId: unfinished }).where(eq(schema.bookings.id, bookingId));
    check("and a card on a booking whose card step is not finished", (await take(m.membershipId, unfinished)) === false);

    // The real way in: a renewal paid by hand with a card that is a booking's is not accepted.
    const n = await atCardStep(host);
    const theirs = (await stripe().paymentMethods.attach("pm_card_visa", { customer: await stripeCustomerFor(n.member) })).id;
    await seen(await booking(host, n.member), theirs);
    await pay(n.monthId, theirs);
    check("a month paid with a booking's card is not accepted: the hold is let go", (await M(n.monthId)).status === "given_up" && (await intentOf(n.monthId)).status === "canceled" && (await cardsOf(n.membershipId)).length === 0, (await M(n.monthId)).status);

    const q = await atCardStep(host);
    const setup = await stripe().setupIntents.create({ customer: await stripeCustomerFor(q.member), payment_method: "pm_card_visa", allowed_payment_method_types: ["card"], confirm: true, usage: "off_session", metadata: { bookingId: await booking(host, q.member) } });
    const fromSetup = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method!.id;
    await pay(q.monthId, fromSetup);
    check("a card from a booking's card step that is not finished (our database has not heard of it yet) is refused all the same: Stripe knows whose it is", setup.status === "succeeded" && (await M(q.monthId)).status === "given_up" && (await intentOf(q.monthId)).status === "canceled" && (await cardsOf(q.membershipId)).length === 0, `${setup.status} ${(await M(q.monthId)).status}`);

    for (const order of ["membership first", "booking first"] as const) {
      const card = await attach();
      const results = order === "membership first" ? await Promise.all([take(m.membershipId, card), seen(bookingId, card)]) : await Promise.all([seen(bookingId, card), take(m.membershipId, card)]).then(([s, t]) => [t, s]);
      check(`both reach for the same card at the same moment (${order}): exactly one gets it`, results[0] !== results[1], results);
    }
    check("the card in use is the membership's own all along, or the one it just took", (await cardsOf(m.membershipId)).filter((card) => card.retiredAt === null).length === 1);
  });

  // ========================================================================
  journey("Interruptions: the app stops between writing a step down and hearing Stripe's answer", async () => {
    const host = await newHost();
    const paymentsOf = async (member: Person) => stripe().paymentIntents.list({ customer: await stripeCustomerFor(member), limit: 100 }).autoPagingToArray({ limit: 1000 });

    const a = await atCardStep(host);
    const [x, y] = await Promise.all([C.intentFor(a.monthId), C.intentFor(a.monthId)]);
    check("two callers at once: one claim, one payment", x !== null && x.intentId === y?.intentId && (await paymentsOf(a.member)).length === 1);
    const id = x!.intentId;
    await db.update(months).set({ stripePaymentIntentId: null }).where(eq(months.id, a.monthId)); // made at Stripe, its id never saved
    check("made and not saved, inside 23 hours: the same request again gives the same payment", (await C.intentFor(a.monthId))?.intentId === id && (await paymentsOf(a.member)).length === 1);
    await db.update(months).set({ stripePaymentIntentId: null, intentRequestedAt: new Date(Date.now() - 25 * HOUR) }).where(eq(months.id, a.monthId));
    await helper(new Date());
    check("after 23 hours nothing is created: the helper finds the one that was made, by the month", (await M(a.monthId)).stripePaymentIntentId === id && (await paymentsOf(a.member)).length === 1 && (await M(a.monthId)).status === "to_pay");
    check("the claim itself was never reset", (await M(a.monthId)).intentRequest !== null && (await M(a.monthId)).intentRequestedAt!.getTime() < Date.now() - 24 * HOUR);
    await audit("after a payment was found again", a);

    const b = await atCardStep(host);
    await db.update(months).set({ intentRequestedAt: new Date(Date.now() - 25 * HOUR), intentRequest: JSON.stringify({ customer: await stripeCustomerFor(b.member), amount: 6000, currency: "usd" }) }).where(eq(months.id, b.monthId));
    check("claimed, never made, and too old: none is created; the month is given up and the joining undone", (await C.intentFor(b.monthId)) === null && (await M(b.monthId)).status === "given_up" && (await M(b.monthId)).endedHow === "cancelled_at_stripe" && (await paymentsOf(b.member)).length === 0 && (await MS(b.membershipId)).status === "invited", (await M(b.monthId)).status);

    const c = await atCardStep(host);
    const abandoned = (await C.intentFor(c.monthId))!.intentId;
    await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, c.monthId);
      await tx.update(months).set({ stripePaymentIntentId: null, endedHow: "card_step" }).where(eq(months.id, c.monthId));
      await S.settleAfterGivenUp(tx, locked, "card_step", new Date());
    });
    check("given up while Stripe was answering: its secret goes to nobody", (await C.intentFor(c.monthId)) === null && (await C.payNow({ monthId: c.monthId, memberId: c.member.id })) === null);
    await helper(new Date());
    check("the payment is saved and cancelled, so it can never go through", (await M(c.monthId)).stripePaymentIntentId === abandoned && (await M(c.monthId)).status === "given_up" && (await stripe().paymentIntents.retrieve(abandoned)).status === "canceled", (await M(c.monthId)).status);
    await audit("after a month given up while its payment was being made", c);

    const d = await atCardStep(host);
    const one = (await C.intentFor(d.monthId))!.intentId;
    const two = await stripe().paymentIntents.create({ amount: 6000, currency: "usd", customer: await stripeCustomerFor(d.member), capture_method: "manual", metadata: { monthId: d.monthId } });
    await db.update(months).set({ stripePaymentIntentId: null, intentRequestedAt: new Date(Date.now() - 25 * HOUR) }).where(eq(months.id, d.monthId));
    check("two payments for one month at Stripe: none is used, and it goes to the founder", (await C.intentFor(d.monthId)) === null && (await M(d.monthId)).stripePaymentIntentId === null && Boolean((await M(d.monthId)).problem));
    await stripe().paymentIntents.cancel(one);
    await stripe().paymentIntents.cancel(two.id);
    await db.update(months).set({ problem: null, status: "given_up", endedHow: "cancelled_at_stripe" }).where(eq(months.id, d.monthId));

    // (A host of their own for the rest: the first host's places are taken by the journeys above.)
    const host2 = await newHost();
    // The taking: written down, never sent.
    const e = await held(host2);
    const pi = (await M(e.monthId)).stripePaymentIntentId!;
    const [capture] = await db.insert(schema.moneyOperations).values({ monthId: e.monthId, kind: "capture", label: `monthcapture:${e.monthId}:1`, params: JSON.stringify({ intentId: pi, amountCents: 6000 }) }).returning();
    await C.takeNow(e.monthId, new Date());
    check("while a taking has no answer, no second one starts beside it", (await M(e.monthId)).status === "held" && (await operations(e.monthId, "capture")).length === 1);
    await age(capture.id, 2 * MIN);
    await helper(new Date(), 1);
    check("the helper sends the same request again, and the month runs", (await M(e.monthId)).status === "running" && (await intentOf(e.monthId)).amount_received === 6000 && (await ledger({ monthId: e.monthId }, "customer_charge")).lines === 1);
    await audit("after a taking that was never sent", e);

    // The taking: Stripe did it, the answer was lost, and it is too old to repeat.
    const f = await held(host2);
    const pf = (await M(f.monthId)).stripePaymentIntentId!;
    const [lost] = await db.insert(schema.moneyOperations).values({ monthId: f.monthId, kind: "capture", label: `monthcapture:${f.monthId}:1`, params: JSON.stringify({ intentId: pf, amountCents: 6000 }) }).returning();
    await stripe().paymentIntents.capture(pf, { amount_to_capture: 6000 }, { idempotencyKey: `monthcapture:${f.monthId}:1` });
    await age(lost.id, 25 * HOUR);
    await helper(new Date(), 1);
    check("taken at Stripe, the answer lost, too old to repeat: Stripe is asked, and it is recorded once", (await M(f.monthId)).status === "running" && (await M(f.monthId)).freeCents === 6000 && (await ledger({ monthId: f.monthId }, "customer_charge")).lines === 1);
    await audit("after a taking whose answer was lost", f);

    // A try with the saved card whose answer never arrived.
    const g = await running(host2);
    const T = (await M(g.monthId)).endsAt!;
    const renewalId = await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, g.monthId);
      return (await C.writeDownMonth(tx, locked.membership, { originKey: `renewal:${g.monthId}`, agreementId: locked.membership.agreementId!, pricePer15Cents: 750, includedMinutes: 120, tryNow: true }, T)).id;
    });
    const tryIntent = (await C.intentFor(renewalId))!.intentId;
    const savedCard = (await cardsOf(g.membershipId))[0].stripePaymentMethodId;
    const [tried] = await db.insert(schema.moneyOperations).values({ monthId: renewalId, kind: "hold", label: `monthhold:${renewalId}:1:1`, params: JSON.stringify({ intentId: tryIntent, paymentMethodId: savedCard }) }).returning();
    await C.tryHold(renewalId, T);
    await runMembershipJobs(T);
    check("a try with no answer keeps its number, and no new one starts beside it", (await operations(renewalId, "hold")).length === 1 && (await M(renewalId)).try === 1 && (await M(renewalId)).status === "to_pay" && (await MS(g.membershipId)).status === "active");
    await age(tried.id, 2 * MIN);
    await reconcileOperations(new Date());
    check("the helper sends the same request again under the same name, and the hold is in place", (await M(renewalId)).status === "held" && (await operations(renewalId, "hold")).length === 1 && (await operations(renewalId, "hold"))[0].status === "succeeded", (await M(renewalId)).status);
    await db.update(months).set({ status: "finished", expiredCents: 6000, freeCents: 0 }).where(eq(months.id, g.monthId)); // the old month is not this journey's subject
    await audit("after a try whose answer never arrived", g);

    // An answer from Stripe that went stale while another caller recorded newer news.
    const st = await atCardStep(host2);
    await C.payNow({ monthId: st.monthId, memberId: st.member.id });
    const seenBefore = await M(st.monthId);
    const oldAnswer = await stripe().paymentIntents.retrieve(seenBefore.stripePaymentIntentId!, { expand: ["latest_charge", "payment_method"] });
    await pay(st.monthId); // meanwhile the member paid and the hold was accepted
    const applied = await C.recordIntent(seenBefore, oldAnswer, new Date());
    check("an old answer from Stripe is thrown away once the month has moved on: the accepted hold is untouched", applied === false && (await M(st.monthId)).status === "held" && (await M(st.monthId)).problem === null && oldAnswer.status === "requires_payment_method");
    check("and the month's money can still be taken", (await C.takeNow(st.monthId, new Date())).status === "running");
    await audit("after a stale answer", st);

    // A saved card was refused, and the app stopped before the failure was recorded on the month.
    const k = await running(host2);
    await saveCard(k, "pm_card_chargeCustomerFail");
    const kT = (await M(k.monthId)).endsAt!;
    const kRenewal = await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, k.monthId);
      return (await C.writeDownMonth(tx, locked.membership, { originKey: `renewal:${k.monthId}`, agreementId: locked.membership.agreementId!, pricePer15Cents: 750, includedMinutes: 120, tryNow: true }, kT)).id;
    });
    const kIntent = (await C.intentFor(kRenewal))!.intentId;
    await db.insert(schema.moneyOperations).values({ monthId: kRenewal, kind: "hold", label: `monthhold:${kRenewal}:1:1`, params: JSON.stringify({ intentId: kIntent, paymentMethodId: (await cardsOf(k.membershipId)).at(-1)!.stripePaymentMethodId }), status: "failed", error: "Your card was declined.", finishedAt: new Date() });
    const answer = await stripe().paymentIntents.retrieve(kIntent, { expand: ["latest_charge", "payment_method"] });
    await C.recordIntent(await M(kRenewal), { ...answer, status: "processing" }, new Date());
    check("while the bank has not answered a try, nothing is decided", (await M(kRenewal)).try === 1 && (await MS(k.membershipId)).status === "active");
    await C.recordIntent(await M(kRenewal), answer, new Date(), new Date(Date.now() - MIN));
    check("an answer that was read before the try had its own never records a failure", (await M(kRenewal)).try === 1 && (await MS(k.membershipId)).status === "active" && (await emails(k.member.email, "did not go through")) === 0);
    await Promise.all([C.tryHold(kRenewal, kT), C.tryHold(kRenewal, kT)]);
    const kMonth = await M(kRenewal);
    check("a refused try is never made a second time: the next callers record the failure and wait for the next day", (await operations(kRenewal, "hold")).length === 1 && kMonth.try === 2 && kMonth.nextTryAt?.getTime() === kT.getTime() + DAY && (await MS(k.membershipId)).status === "unpaid" && (await stripe().paymentIntents.retrieve(kIntent)).latest_charge === null, `${(await operations(kRenewal, "hold")).length} ${kMonth.try}`);
    await db.update(months).set({ status: "finished", expiredCents: 6000, freeCents: 0 }).where(eq(months.id, k.monthId)); // the old month is not this journey's subject

    // Letting a hold go: written down, never sent.
    const h = await held(host2);
    await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, h.monthId);
      await tx.update(months).set({ endedHow: "cancel_now" }).where(eq(months.id, h.monthId));
      await S.settleAfterGivenUp(tx, locked, "cancel_now", new Date());
    });
    const [release] = await db.insert(schema.moneyOperations).values({ monthId: h.monthId, kind: "release", label: `monthrelease:${h.monthId}:1`, params: JSON.stringify({ intentId: (await M(h.monthId)).stripePaymentIntentId }) }).returning();
    await age(release.id, 2 * MIN);
    await helper(new Date(), 1);
    check("a letting-go that was written down and never sent is finished by the helper", (await M(h.monthId)).status === "given_up" && (await intentOf(h.monthId)).status === "canceled" && (await operations(h.monthId, "release")).length === 1);
    await audit("after a letting-go that was never sent", h);
  });

  // ========================================================================
  journey("Old work after a resume: a month from before a pause never changes the membership of today", async () => {
    const host = await newHost();
    // A month from before the pause is still running when the member has resumed.
    const a = await running(host);
    const now2 = await resume(a);
    await pay(now2);
    await closeMonth(a.monthId, (await M(a.monthId)).endsAt!);
    check("an old month closes like any other and renews nothing", (await M(a.monthId)).status === "finished" && (await M(a.monthId)).expiredCents === 6000 && (await monthsOf(a.membershipId)).length === 2);
    check("the membership of today is untouched", (await MS(a.membershipId)).status === "active" && (await MS(a.membershipId)).currentMonthId === now2 && (await MS(a.membershipId)).period === 2 && (await M(now2)).status === "held");
    await audit("after an old month closed", a);

    // An old month's hold is lost after the resume.
    const b = await held(host);
    const current = await resume(b);
    await pay(current, "pm_card_mastercard");
    await stripe().paymentIntents.cancel((await M(b.monthId)).stripePaymentIntentId!);
    await C.syncMonth(b.monthId, new Date());
    await handleStripeEvent({ type: "payment_intent.canceled", data: { object: { metadata: { monthId: b.monthId } } } });
    check("an old month that loses its hold is closed as not paid, and gets no replacement", (await M(b.monthId)).status === "given_up" && (await monthsOf(b.membershipId)).length === 2);
    check("the member is not told a payment failed, and stays active on the new month", (await emails(b.member.email, "did not go through")) === 0 && (await MS(b.membershipId)).status === "active" && (await MS(b.membershipId)).currentMonthId === current);
    await audit("after an old month lost its hold", b);

    // An old month's payment fails after the resume.
    const c = await running(host);
    const T = (await M(c.monthId)).endsAt!;
    const old = await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, c.monthId);
      return (await C.writeDownMonth(tx, locked.membership, { originKey: `renewal:${c.monthId}`, agreementId: locked.membership.agreementId!, pricePer15Cents: 750, includedMinutes: 120, tryNow: true }, T)).id;
    });
    const fresh = await resume(c);
    await pay(fresh, "pm_card_mastercard");
    await saveCardKeeping(c, "pm_card_chargeCustomerFail");
    await C.tryHold(old, T);
    check("an old month whose try fails records it on itself only", (await M(old)).try === 2 && (await M(old)).status === "to_pay" && (await MS(c.membershipId)).status === "active" && (await MS(c.membershipId)).currentMonthId === fresh && (await emails(c.member.email, "did not go through")) === 0, (await M(old)).try);
  });

  // ========================================================================
  journey("The health check: each thing the helper should have done by now makes it \"not healthy\"", async () => {
    const host = await newHost();
    const lines = async () => (await healthProblems(new Date())).filter((line) => /membership/.test(line));
    check("with nothing late, the membership work is healthy", (await lines()).length === 0, await lines());
    const says = async (label: string, part: string, make: () => Promise<unknown>, undo: () => Promise<unknown>) => {
      await make();
      const found = await lines();
      check(`not healthy: ${label}`, found.length === 1 && found[0].includes(part), found);
      await undo();
    };
    const tenAgo = new Date(Date.now() - 10 * MIN);
    const a = await atCardStep(host);
    const set = (monthId: string, values: Partial<typeof months.$inferInsert>) => db.update(months).set(values).where(eq(months.id, monthId));
    await says("a payment asked of Stripe 6 minutes ago whose id is not saved", "asked of Stripe", () => set(a.monthId, { intentRequestedAt: tenAgo, intentRequest: "{}" }), () => set(a.monthId, { intentRequestedAt: null, intentRequest: null }));
    await says("a try that is 5 minutes late", "try of a membership payment", () => set(a.monthId, { nextTryAt: tenAgo }), () => set(a.monthId, { nextTryAt: null }));
    await says("a payment that should have been given up", "given up", () => set(a.monthId, { giveUpAt: tenAgo }), () => set(a.monthId, { giveUpAt: null }));
    const b = await held(host);
    const takeAt = (await M(b.monthId)).takeAt;
    await says("held money 5 minutes past the moment it should have been taken", "held money", () => set(b.monthId, { takeAt: tenAgo }), () => set(b.monthId, { takeAt }));
    const c = await running(host);
    const endsAt = (await M(c.monthId)).endsAt;
    await says("a month 5 minutes past its end that is not closed or renewed", "past its end", () => set(c.monthId, { endsAt: tenAgo }), () => set(c.monthId, { endsAt }));
    await says("a month that needs the founder", "needs the founder", () => set(c.monthId, { problem: "a check" }), () => set(c.monthId, { problem: null }));
    const owed = await db.transaction(async (tx) => P.owePayBack(tx, (await L.lockForMonth(tx, c.monthId)).month, { amountCents: 100, sourceKey: `check:${c.monthId}`, reason: "A check." }));
    const createdAt = (at: Date) => db.update(schema.membershipRefunds).set({ createdAt: at }).where(eq(schema.membershipRefunds.id, owed.refund.id));
    await says("a pay-back owed for more than 2 hours", "pay-back", () => createdAt(new Date(Date.now() - 3 * HOUR)), () => createdAt(new Date()));
    // (The member with the running month: an ended membership with a payment still open would, rightly, show two lines.)
    await db.transaction(async (tx) => S.endMembership(tx, await L.lockMembership(tx, c.membershipId), { by: "host", reason: "a check" }, new Date(Date.now() - 20 * MIN)));
    await says("an ending not cleaned up after 10 minutes", "cleaned up", async () => undefined, () => E.cleanUpEnding(c.membershipId, new Date()));
    await says(
      "a payment that was given up and is still open at Stripe after 15 minutes",
      "still open at Stripe",
      () =>
        db.transaction(async (tx) => {
          const locked = await L.lockForMonth(tx, b.monthId);
          await tx.update(months).set({ endedHow: "cancel_now", updatedAt: new Date(Date.now() - 20 * MIN) }).where(eq(months.id, b.monthId));
          await S.settleAfterGivenUp(tx, locked, "cancel_now", new Date());
        }),
      () => C.letHoldGo(b.monthId, new Date()),
    );
    await helper(new Date());
    check("and healthy again once the helper has done its work", (await lines()).length === 0, await lines());
  });

  // ========================================================================
  // Part 1b: how a membership comes to exist and what people do with it. From here on memberships
  // are made the real way: the host invites, the person joins, and pays.
  // ========================================================================
  const refusal = (work: Promise<unknown>) => work.then(() => null, (error: unknown) => (error instanceof MembershipError || error instanceof CalendarError ? error.message : Promise.reject(error)));
  /** The two have had a call, with this host as the host: over, not cancelled, and both were there. */
  async function talked(host: Person, member: Person) {
    const startsAt = new Date(Date.now() - 2 * DAY);
    const [call] = await db.insert(schema.calls).values({ hostId: host.id, customerId: member.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), roomName: `membercheck-${randomUUID()}`, pricePer15Cents: 1000, closedAt: new Date(startsAt.getTime() + 31 * MIN) }).returning();
    await db.insert(schema.bookings).values({ hostId: host.id, customerId: member.id, startsAt, endsAt: call.endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 1000, totalCents: 2000, freeCancelMinutes: 0, stage: "accepted", requestKey: randomUUID(), callId: call.id });
    for (const who of [host.id, member.id]) {
      await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type: "participant_joined", roomSessionId: "RM_membercheck", participantIdentity: who, participantSessionId: `PA_${randomUUID().slice(0, 8)}`, providerTime: startsAt, payload: "{}" });
    }
  }
  /** Someone the host has talked to, invited now (or at `at`). */
  async function invited(host: Person, opts: { member?: Person; at?: Date } = {}) {
    const member = opts.member ?? (await person("member"));
    if (!opts.member) await talked(host, member);
    const invitation = await J.invite({ hostId: host.id, customerId: member.id, now: opts.at ?? new Date() });
    return { host, member, ...invitation };
  }
  /** A member the real way: invited, joined with the box ticked, and (unless told otherwise) paid. */
  async function joined(host: Person, opts: { pay?: boolean; take?: boolean; member?: Person } = {}): Promise<Made> {
    const invitation = await invited(host, { member: opts.member });
    const started = await J.join({ customerId: invitation.member.id, inviteId: invitation.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date() });
    if (opts.pay !== false) await pay(started.monthId);
    if (opts.take) await C.takeNow(started.monthId, new Date());
    return { host, member: invitation.member, ...started };
  }
  /** "Resume", with the version of the host's membership that the page is showing right now. */
  const resumeAs = async (made: Made, requestId: string = randomUUID(), agreed = true) => J.resume({ customerId: made.member.id, membershipId: made.membershipId, requestId, agreed, wordingVersion: WORDING, offerVersion: (await offerOf(made.host)).version, now: new Date() });
  const emailText = async (to: string, subject: string) => (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)))).map((row) => row.body).join("\n");
  const offerOf = async (host: Person) => (await db.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, host.id)))[0];
  const agreementsOf = (membershipId: string) => db.select().from(schema.membershipAgreements).where(eq(schema.membershipAgreements.membershipId, membershipId)).orderBy(schema.membershipAgreements.at);
  const invitationLines = (membershipId: string) => db.select().from(schema.membershipInvitations).where(eq(schema.membershipInvitations.membershipId, membershipId)).orderBy(schema.membershipInvitations.sentAt);
  const save = async (host: Person, input: { on: boolean; pricePer15Cents: number; includedMinutes: number }) => O.saveOffer(host.id, input, (await O.previewOfferChange(host.id, input)).mark, new Date());
  const setHours = (host: Person, minutesAWeek: number) => db.update(schema.weeklyHours).set({ endMinute: 540 + minutesAWeek }).where(eq(schema.weeklyHours.hostId, host.id));

  // ========================================================================
  journey("The host's membership: setting it up, what she is shown before saving, and a price that only goes down", async () => {
    const host = await newHost({ offer: false });
    const input = { on: true, pricePer15Cents: 750, includedMinutes: 120 };
    check("a member price above the regular price is refused", /regular price/.test((await O.previewOfferChange(host.id, { ...input, pricePer15Cents: 1050 })).problem ?? ""));
    check("time that is not on the list is refused", Boolean((await O.previewOfferChange(host.id, { ...input, includedMinutes: 45 })).problem));
    check("an offer that does not fit in her hours even once is refused", /weekly hours offer 12 hours/.test((await O.previewOfferChange(host.id, { ...input, includedMinutes: 750 })).problem ?? ""), (await O.previewOfferChange(host.id, { ...input, includedMinutes: 750 })).problem);
    await db.update(schema.hostSettings).set({ payoutsReady: false }).where(eq(schema.hostSettings.userId, host.id));
    check("a host whose payout account is not ready cannot offer a membership", /payout account/.test((await refusal(save(host, input))) ?? ""));
    await db.update(schema.hostSettings).set({ payoutsReady: true }).where(eq(schema.hostSettings.userId, host.id));
    const preview = await O.previewOfferChange(host.id, input);
    check("the preview saves nothing", preview.problem === null && (await offerOf(host)) === undefined);
    await O.saveOffer(host.id, input, preview.mark, new Date());
    check("saved: switched on, $7.50 per 15 minutes, 2 hours, its first version", (await offerOf(host)).on && (await offerOf(host)).pricePer15Cents === 750 && (await offerOf(host)).includedMinutes === 120 && (await offerOf(host)).version === 1);
    check("the same confirmation a second time is refused: the page was worked out from a state that is gone", /changed while this page was open/.test((await refusal(O.saveOffer(host.id, input, preview.mark, new Date()))) ?? ""));

    const a = await joined(host, { take: true });
    const b = await joined(host);
    const waiting = await invited(host);
    const c = await joined(host, { take: true });
    await saveCard(c, "pm_card_chargeCustomerFail");
    await closeMonth(c.monthId, (await M(c.monthId)).endsAt!);
    const beingPaid = (await monthsOf(c.membershipId))[1];
    // Lowering the price: what she is shown, with numbers.
    const lower = { ...input, pricePer15Cents: 600 };
    const shown = await O.previewOfferChange(host.id, lower);
    // Three members at 2 hours each pay $1.50 less per 15 minutes: $12.00 less a month each, $36.00 together.
    check("before saving she is shown who pays less, by how much, and which invitations are taken back", shown.lowered.length === 3 && shown.lessPerMonthCents === 3600 && shown.invitationsTakenBack.length === 1 && shown.invitationsTakenBack[0] === waiting.membershipId && shown.termsChanged, shown);
    check("and nothing is saved by looking", (await MS(a.membershipId)).ownPricePer15Cents === 750 && (await MS(waiting.membershipId)).status === "invited");
    check("the confirmation belongs to the terms she was shown: other numbers with the same confirmation are refused", /changed while this page was open/.test((await refusal(O.saveOffer(host.id, { ...input, pricePer15Cents: 650 }, shown.mark, new Date()))) ?? "") && (await offerOf(host)).pricePer15Cents === 750);
    await O.saveOffer(host.id, lower, shown.mark, new Date());
    check("saved: both members' own price is lowered for good, with a line on record, and they are told", (await MS(a.membershipId)).ownPricePer15Cents === 600 && (await MS(b.membershipId)).ownPricePer15Cents === 600 && (await agreementsOf(a.membershipId)).at(-1)?.kind === "price_lowered" && (await emails(a.member.email, "will cost less")) === 1);
    check("the months that are running or held keep the price they were written down with", (await M(a.monthId)).pricePer15Cents === 750 && (await M(a.monthId)).totalCents === 6000 && (await M(b.monthId)).totalCents === 6000 && (await intentOf(b.monthId)).amount === 6000);
    check("a month whose payment is still open keeps its amount, and the email says so: the lower price starts the month after", (await MS(c.membershipId)).ownPricePer15Cents === 600 && (await M(beingPaid.id)).totalCents === 6000 && (await intentOf(beingPaid.id)).amount === 6000 && /payment is open now keeps its amount of \$60\.00/.test(await emailText(c.member.email, "will cost less")) && !/payment is open now/.test(await emailText(a.member.email, "will cost less")));
    check("the open invitation was for the membership as it stood: it is taken back, and the person is told", (await MS(waiting.membershipId)).status === "ended" && (await invitationLines(waiting.membershipId))[0].outcome === "taken_back" && (await emails(waiting.member.email, "no longer open")) === 1);
    check("an old link no longer works", (await refusal(J.join({ customerId: waiting.member.id, inviteId: waiting.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date() }))) === "This invitation is no longer open.");

    await save(host, { ...input, pricePer15Cents: 700 });
    check("raised again: members keep the lowest price they ever had", (await MS(a.membershipId)).ownPricePer15Cents === 600 && (await offerOf(host)).pricePer15Cents === 700 && (await offerOf(host)).version === 3);
    const newer = await joined(host);
    check("a new member pays the new price", (await MS(newer.membershipId)).ownPricePer15Cents === 700 && (await M(newer.monthId)).totalCents === 5600 && (await intentOf(newer.monthId)).amount === 5600);
    await closeMonth(a.monthId, (await M(a.monthId)).endsAt!);
    const next = (await monthsOf(a.membershipId))[1];
    check("the older member's next month is written down at their own, lower price: $48.00 for the same 2 hours", next.pricePer15Cents === 600 && next.totalCents === 4800 && next.includedMinutes === 120 && next.status === "held", next);

    await save(host, { on: true, pricePer15Cents: 700, includedMinutes: 60 });
    check("the time changed: only new invitations get it; members keep their time", (await MS(a.membershipId)).ownMinutes === 120 && (await MS(newer.membershipId)).ownMinutes === 120 && (await offerOf(host)).includedMinutes === 60);
    for (const m of [a, b, c, newer]) await audit("after changes to the host's membership", m, { owed: false });
  });

  // ========================================================================
  journey("Switching the host's membership off, and on again", async () => {
    const host = await newHost({ weeklyMinutes: 300 }); // 20 hours a month: room for everyone in this journey
    const heldOne = await joined(host);
    const trying = await joined(host, { take: true });
    await saveCard(trying, "pm_card_chargeCustomerFail");
    await closeMonth(trying.monthId, (await M(trying.monthId)).endsAt!);
    const unpaid = (await monthsOf(trying.membershipId))[1];
    const open = await invited(host);
    const atCard = await joined(host, { pay: false });
    const keeps = await joined(host, { take: true });
    const forgets = await joined(host, { take: true });
    const cancels = await joined(host, { take: true });
    await db.update(schema.memberships).set({ offerId: randomUUID(), offerMonthId: forgets.monthId, offeredMinutes: 60, offeredAt: new Date() }).where(eq(schema.memberships.id, forgets.membershipId));
    // A renewal that was just written down, whose first try has not been made yet.
    const justRenewed = await joined(host, { take: true });
    const fresh = await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, justRenewed.monthId);
      return (await C.writeDownMonth(tx, locked.membership, { originKey: `renewal:${justRenewed.monthId}`, agreementId: locked.membership.agreementId!, pricePer15Cents: 750, includedMinutes: 120, tryNow: true }, new Date())).id;
    });
    await db.update(months).set({ status: "finished", expiredCents: 6000, freeCents: 0 }).where(eq(months.id, justRenewed.monthId)); // the old month is not this journey's subject
    check("(one month held, two running, one payment being tried, one renewal just written down, one invitation open, one person at the card step)", (await M(heldOne.monthId)).status === "held" && (await MS(trying.membershipId)).status === "unpaid" && (await MS(atCard.membershipId)).status === "joining" && (await M(fresh)).status === "to_pay" && (await MS(justRenewed.membershipId)).status === "active");
    const off = { on: false, pricePer15Cents: 750, includedMinutes: 120 };
    const shown = await O.previewOfferChange(host.id, off);
    check("she is shown what switching off does, by name", shown.switchingOff && shown.invitationsTakenBack.length === 2 && shown.renewalsStopping.length === 4 && shown.pausedAtOnce.length === 2 && shown.pausedAtOnce.includes(justRenewed.membershipId), shown);
    await O.saveOffer(host.id, off, shown.mark, new Date());
    check("the invitation is taken back, and the joining at the card step is undone", (await MS(open.membershipId)).status === "ended" && (await MS(atCard.membershipId)).status === "ended" && (await M(atCard.monthId)).status === "given_up");
    const paused = await MS(trying.membershipId);
    check("the member whose payment was being tried is paused at once, and that payment is cancelled", paused.status === "paused" && paused.pausedReason === "offer_off" && (await M(unpaid.id)).status === "given_up" && (await intentOf(unpaid.id)).status === "canceled", paused.status);
    check("so is the one whose renewal had only just been written down: nothing is asked of the card", (await MS(justRenewed.membershipId)).status === "paused" && (await M(fresh)).status === "given_up" && (await M(fresh)).stripePaymentIntentId === null);
    check("a month that had started goes on, also one whose money is only held", (await MS(heldOne.membershipId)).status === "active" && (await M(heldOne.monthId)).status === "held");
    check("its renewal is stopped with a mark of its own, the member is told, and an open offer of less time is closed", (await MS(keeps.membershipId)).offerStoppedAt !== null && (await MS(keeps.membershipId)).memberStoppedAt === null && (await MS(forgets.membershipId)).offerId === null && (await emails(keeps.member.email, "is not offering the membership")) === 1);
    await E.stopRenewal({ membershipId: cancels.membershipId, by: "member", actorId: cancels.member.id, now: new Date() });
    check("a member who then cancels themselves is recorded as that, beside the host's switch", (await MS(cancels.membershipId)).memberStoppedAt !== null && (await MS(cancels.membershipId)).offerStoppedAt !== null);
    check("nobody can resume while it is off", /not offering a membership/.test((await refusal(resumeAs(trying))) ?? ""));
    check("and a stopped renewal cannot be switched back on", /not offering a membership/.test((await refusal(E.undoStop({ membershipId: keeps.membershipId, by: "member", actorId: keeps.member.id, now: new Date() }))) ?? ""));

    // While it is off, the bank lets go of the hold of the month that had started.
    await stripe().paymentIntents.cancel((await M(heldOne.monthId)).stripePaymentIntentId!);
    await C.syncMonth(heldOne.monthId, new Date());
    await helper(new Date(), 1);
    const replacement = (await monthsOf(heldOne.membershipId))[1];
    check("a month that had started keeps going while the membership is off: the lost hold is replaced, and the new hold is accepted", replacement?.originKey === `replacement:${heldOne.monthId}` && replacement.status === "held" && (await MS(heldOne.membershipId)).status === "active" && (await MS(heldOne.membershipId)).offerStoppedAt !== null, replacement?.status);
    await C.takeNow(replacement.id, new Date());
    await closeMonth(replacement.id, (await M(replacement.id)).endsAt!);
    check("at its month's end that member is paused, told why, and nothing more is charged", (await MS(heldOne.membershipId)).status === "paused" && (await MS(heldOne.membershipId)).pausedReason === "offer_off" && (await monthsOf(heldOne.membershipId)).length === 2);

    // Switched on again before the other members' months have ended.
    await save(host, { on: true, pricePer15Cents: 750, includedMinutes: 120 });
    check("switching it on again charges nobody by itself, and brings no renewal back by itself", (await MS(heldOne.membershipId)).status === "paused" && (await monthsOf(heldOne.membershipId)).length === 2 && (await offerOf(host)).version === 1 && (await MS(keeps.membershipId)).offerStoppedAt !== null && (await MS(forgets.membershipId)).offerStoppedAt !== null);
    check("the host cannot bring a member's renewal back for them", (await refusal(E.undoStop({ membershipId: keeps.membershipId, by: "host", actorId: host.id, now: new Date() }))) === null && (await MS(keeps.membershipId)).offerStoppedAt !== null);
    await E.undoStop({ membershipId: keeps.membershipId, by: "member", actorId: keeps.member.id, now: new Date() });
    await E.undoStop({ membershipId: cancels.membershipId, by: "member", actorId: cancels.member.id, now: new Date() });
    check("\"Keep my membership\" takes back the member's side of it, both marks", (await MS(keeps.membershipId)).offerStoppedAt === null && (await MS(cancels.membershipId)).memberStoppedAt === null && (await MS(cancels.membershipId)).offerStoppedAt === null);
    await save(host, { on: false, pricePer15Cents: 750, includedMinutes: 120 });
    await save(host, { on: true, pricePer15Cents: 750, includedMinutes: 120 });
    check("switched off a second time in the same month: stopped again, and told again", (await MS(keeps.membershipId)).offerStoppedAt !== null && (await emails(keeps.member.email, "is not offering the membership")) === 2);
    await E.undoStop({ membershipId: keeps.membershipId, by: "member", actorId: keeps.member.id, now: new Date() });
    await closeMonth(keeps.monthId, (await M(keeps.monthId)).endsAt!);
    await closeMonth(forgets.monthId, (await M(forgets.monthId)).endsAt!);
    check("a member who presses \"Keep my membership\" renews; one who does not is paused at their month's end", (await monthsOf(keeps.membershipId)).length === 2 && (await monthsOf(keeps.membershipId))[1].status === "held" && (await MS(forgets.membershipId)).status === "paused" && (await MS(forgets.membershipId)).pausedReason === "offer_off" && (await monthsOf(forgets.membershipId)).length === 1);
    const back = await resumeAs(heldOne);
    await pay(back.monthId, "pm_card_mastercard");
    check("a paused member can then resume", (await MS(heldOne.membershipId)).status === "active" && (await M(back.monthId)).status === "held");
    for (const m of [heldOne, trying, atCard, keeps, forgets, cancels, justRenewed]) await audit("after the membership was switched off and on", m);
  });

  // ========================================================================
  journey("Inviting: who, how often, a place that is held, taking back, and running out", async () => {
    const host = await newHost({ weeklyMinutes: 60 }); // room for two members
    const stranger = await person("stranger");
    check("only someone she has had a call with can be invited", /already had a call/.test((await refusal(J.invite({ hostId: host.id, customerId: stranger.id, now: new Date() }))) ?? ""));
    check("and not herself", Boolean(await refusal(J.invite({ hostId: host.id, customerId: host.id, now: new Date() }))));
    const T = new Date();
    const first = await invited(host, { at: T });
    const membership = await MS(first.membershipId);
    check("invited: open for 24 hours, for the membership as it stands, and the person gets the link", membership.status === "invited" && membership.inviteExpiresAt?.getTime() === T.getTime() + DAY && membership.inviteMinutes === 120 && membership.inviteOfferVersion === 1 && (await emails(first.member.email, "invites you to a membership")) === 1);
    check("the invitation holds its place", (await Room.roomLeft(db, host.id, T)) === 120);
    const second = await invited(host, { at: T });
    const third = await person("member");
    await talked(host, third);
    check("invitations up to the last place, and one more is refused", (await Room.roomLeft(db, host.id, T)) === 0 && /no room for another member/.test((await refusal(J.invite({ hostId: host.id, customerId: third.id, now: T }))) ?? ""));

    const again = await J.invite({ hostId: host.id, customerId: first.member.id, now: new Date(T.getTime() + HOUR) });
    check("inviting the same person again makes a new invitation with a new 24 hours, on the same place", again.membershipId === first.membershipId && again.inviteId !== first.inviteId && (await MS(first.membershipId)).inviteExpiresAt?.getTime() === T.getTime() + HOUR + DAY && (await Room.roomLeft(db, host.id, T)) === 0);
    check("the old link stops working", (await refusal(J.join({ customerId: first.member.id, inviteId: first.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date(T.getTime() + 2 * HOUR) }))) === "This invitation is no longer open.");
    await J.invite({ hostId: host.id, customerId: first.member.id, now: new Date(T.getTime() + 2 * HOUR) });
    check("a fourth invitation to one person in 30 days is refused", /3 times in the last 30 days/.test((await refusal(J.invite({ hostId: host.id, customerId: first.member.id, now: new Date(T.getTime() + 3 * HOUR) }))) ?? ""));
    check("someone else's link shows nothing, exactly like one that does not exist", (await A.invitationFor(second.member.id, again.inviteId)) === null && (await A.invitationFor(second.member.id, randomUUID())) === null && (await A.invitationFor(second.member.id, second.inviteId, T))?.expired === false);

    await J.takeBackInvitation({ hostId: host.id, membershipId: second.membershipId, now: T });
    check("taken back: it ends, its place is free, and the person is told", (await MS(second.membershipId)).status === "ended" && (await Room.roomLeft(db, host.id, T)) === 120 && (await emails(second.member.email, "no longer open")) === 1 && (await emails(host.email, "has run out")) === 0);
    check("a link that was taken back does not work", (await refusal(J.join({ customerId: second.member.id, inviteId: second.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: T }))) === "This invitation is no longer open.");

    const other = await invited(host, { member: third, at: T });
    await helper(new Date(T.getTime() + DAY - MIN), 1);
    check("a minute before its 24 hours are over the invitation is open", (await MS(other.membershipId)).status === "invited");
    check("\"Join\" after the 24 hours is refused, also when the helper has not been by yet", /has run out/.test((await refusal(J.join({ customerId: third.id, inviteId: other.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date(T.getTime() + DAY) }))) ?? ""));
    await helper(new Date(T.getTime() + DAY), 1);
    check("at 24 hours it ends by itself, its place is free again, and both are told", (await MS(other.membershipId)).status === "ended" && (await invitationLines(other.membershipId))[0].outcome === "ran_out" && (await emails(third.email, "no longer open")) === 1 && (await emails(host.email, "has run out")) === 1);
    const anew = await J.invite({ hostId: host.id, customerId: third.id, now: new Date(T.getTime() + DAY) });
    check("she can invite the same person again: a new membership row, the old one closed", anew.membershipId !== other.membershipId && (await MS(anew.membershipId)).status === "invited");

    // What stands in the way of an invitation.
    const host2 = await newHost();
    const guest = await person("member");
    await talked(host2, guest);
    const tryInvite = () => refusal(J.invite({ hostId: host2.id, customerId: guest.id, now: new Date() }));
    await db.insert(schema.blocks).values({ blockerId: guest.id, blockedId: host2.id });
    check("a block either way: refused, without saying why", (await tryInvite()) === "This person cannot become a member at the moment.");
    await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, guest.id));
    await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, guest.id));
    check("a paused account: refused", Boolean(await tryInvite()));
    await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, guest.id));
    await db.update(schema.hostSettings).set({ verifiedOnly: true }).where(eq(schema.hostSettings.userId, host2.id));
    check("a host who only takes people with a confirmed ID cannot invite someone without one", /confirmed their ID/.test((await tryInvite()) ?? ""));
    await db.update(schema.hostSettings).set({ verifiedOnly: false }).where(eq(schema.hostSettings.userId, host2.id));
    await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, host2.id));
    check("a host whose page is not approved cannot invite", Boolean(await tryInvite()));
    await db.update(schema.hostProfiles).set({ status: "approved" }).where(eq(schema.hostProfiles.userId, host2.id));
    const m = await joined(host2, { member: guest });
    check("someone who is already a member cannot be invited", (await tryInvite()) === "This person is already a member.");
    await E.cancelNow({ membershipId: m.membershipId, memberId: guest.id, now: new Date() });
    check("a paused member needs no invitation: they can resume by themselves", /resume by themselves/.test((await tryInvite()) ?? ""));
    await audit("after invitations", m);
  });

  // ========================================================================
  journey("Joining: the box, one agreement however often it is pressed, the card step, and a refused card", async () => {
    const host = await newHost();
    const invitation = await invited(host);
    const requestId = randomUUID();
    const press = (id = requestId, agreed = true, who = invitation.member.id) => J.join({ customerId: who, inviteId: invitation.inviteId, requestId: id, agreed, wordingVersion: WORDING, now: new Date() });
    check("without the box ticked nothing happens", /tick the box/.test((await refusal(press(requestId, false))) ?? "") && (await MS(invitation.membershipId)).status === "invited");
    const outsider = await person("stranger");
    check("someone else cannot use the link", (await refusal(press(randomUUID(), true, outsider.id))) === "This invitation is no longer open.");
    check("a page whose wording has changed since it was opened must be read again", /wording of this page has changed/.test((await refusal(J.join({ customerId: invitation.member.id, inviteId: invitation.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: "an older wording", now: new Date() }))) ?? "") && (await MS(invitation.membershipId)).status === "invited");
    const [one, two] = await Promise.all([press(), press()]);
    const three = await press();
    const membership = await MS(invitation.membershipId);
    const agreements = await agreementsOf(invitation.membershipId);
    check("\"Join\" pressed twice at once, and once more: one agreement and one month", one.monthId === two.monthId && one.monthId === three.monthId && agreements.length === 1 && (await monthsOf(invitation.membershipId)).length === 1);
    check("what was agreed is on record: the version of her membership, the price, the time, the wording, and when", agreements[0].kind === "joined" && agreements[0].offerVersion === 1 && agreements[0].pricePer15Cents === 750 && agreements[0].minutes === 120 && agreements[0].cardWordingVersion === WORDING && agreements[0].firstMonthNumber === 1);
    check("the place is theirs for the card step; nothing is charged yet", membership.status === "joining" && membership.period === 1 && (await M(one.monthId)).status === "to_pay" && (await M(one.monthId)).cardStepExpiresAt !== null && (await M(one.monthId)).agreementId === agreements[0].id && (await invitationLines(invitation.membershipId))[0].outcome === "accepted");
    check("only this person may pay, and only while the month can be paid", (await A.mayPay(invitation.member.id, one.monthId)) && !(await A.mayPay(outsider.id, one.monthId)) && (await A.maySeePayment(outsider.id, one.monthId)) === null);

    await pay(one.monthId, "pm_card_chargeDeclined");
    check("a refused card at joining: nothing starts, and no \"payment failed\" email (the person is at the card form)", (await M(one.monthId)).status === "to_pay" && (await MS(invitation.membershipId)).status === "joining" && (await emails(invitation.member.email, "did not go through")) === 0);
    await pay(one.monthId, "pm_card_visa");
    const month = await M(one.monthId);
    check("with a good card the first month's amount is held, and the membership starts at that moment", month.status === "held" && (await MS(invitation.membershipId)).status === "active" && (await MS(invitation.membershipId)).since?.getTime() === month.authorisedAt?.getTime());
    check("the member has the receipt; the host is told she has a new member", (await emails(invitation.member.email, "for this month")) === 1 && (await emails(host.email, "is now a member")) === 1);
    check("the payment step is closed, and the member can still see what became of it", !(await A.mayPay(invitation.member.id, one.monthId)) && (await A.maySeePayment(invitation.member.id, one.monthId))?.status === "held" && (await A.membershipFor(invitation.member.id, invitation.membershipId))?.months.length === 1 && (await A.membershipFor(outsider.id, invitation.membershipId)) === null);
    await audit("after joining", { host, member: invitation.member, membershipId: invitation.membershipId, monthId: one.monthId });

    // "Join" pressed just before the 24 hours are over, with the hold arriving after them.
    const T = new Date();
    const late = await invited(host, { at: new Date(T.getTime() - DAY + MIN) });
    const inTime = await J.join({ customerId: late.member.id, inviteId: late.inviteId.toUpperCase(), requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: T });
    // The invitation's 24 hours are really over before the card is entered (the card step's own time is not).
    await db.update(schema.memberships).set({ inviteExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.memberships.id, late.membershipId));
    await helper(new Date(), 1);
    check("pressed a minute before the invitation ran out (the link typed in capitals works too): the helper leaves it alone while the card step runs", (await MS(late.membershipId)).status === "joining");
    await pay(inTime.monthId);
    check("the hold arrives after the 24 hours: joined all the same", (await MS(late.membershipId)).status === "active" && (await M(inTime.monthId)).status === "held" && (await M(inTime.monthId)).authorisedAt! > (await MS(late.membershipId)).inviteExpiresAt! && (await M(inTime.monthId)).authorisedAt! < (await M(inTime.monthId)).cardStepExpiresAt!);

    // The card step is left unfinished.
    const left = await joined(host, { pay: false });
    const tooLate = new Date(Date.now() + 31 * MIN);
    check("after the card step's time the payment can no longer be started, also before the helper has been by", (await M(left.monthId)).status === "to_pay" && !(await A.mayPay(left.member.id, left.monthId, tooLate)) && (await C.payNow({ monthId: left.monthId, memberId: left.member.id, now: tooLate })) === null && (await A.mayPay(left.member.id, left.monthId)));
    await helper(tooLate, 1);
    check("an unfinished card step is undone: nothing is charged, and the invitation stands for the rest of its 24 hours", (await M(left.monthId)).status === "given_up" && (await MS(left.membershipId)).status === "invited" && (await MS(left.membershipId)).currentMonthId === null);
    const [line] = await invitationLines(left.membershipId);
    check("and its own record says \"open\" again, not \"accepted\"", line.outcome === "open");
    const second = await J.join({ customerId: left.member.id, inviteId: line.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date() });
    await pay(second.monthId);
    check("they can press \"Join\" again: a new agreement and a new month, and this time it is held", second.monthId !== left.monthId && (await M(second.monthId)).status === "held" && (await M(second.monthId)).number === 2 && (await agreementsOf(left.membershipId)).length === 2 && (await MS(left.membershipId)).period === 2);
    await audit("after an unfinished card step", left);

    // A new invitation while the clean-up of the old, ended membership is still to be done.
    const old = await joined(host);
    await db.transaction(async (tx) => S.endMembership(tx, await L.lockMembership(tx, old.membershipId), { by: "host", reason: "the host ended it" }, new Date()));
    const fresh = await J.invite({ hostId: host.id, customerId: old.member.id, now: new Date() });
    check("invited again while the old membership's clean-up is still to be done: a membership of its own", fresh.membershipId !== old.membershipId && (await MS(old.membershipId)).cleanupDoneAt === null && (await MS(fresh.membershipId)).status === "invited");
    await helper(new Date(), 1);
    check("the helper cleans up the old one (its hold is let go) and leaves the new one alone", (await MS(old.membershipId)).cleanupDoneAt !== null && (await M(old.monthId)).status === "given_up" && (await intentOf(old.monthId)).status === "canceled" && (await MS(fresh.membershipId)).status === "invited");
    await audit("after a new invitation beside an old ending", old);
  });

  // ========================================================================
  journey("Cancelling, \"Keep my membership\", the host's pause, and \"Cancel now\"", async () => {
    const host = await newHost();
    const m = await joined(host, { take: true });
    const end = (await M(m.monthId)).endsAt!;
    const stop = (by: "member" | "host", made = m, now = new Date()) => E.stopRenewal({ membershipId: made.membershipId, by, actorId: by === "member" ? made.member.id : host.id, now });
    const undo = (by: "member" | "host", made = m, now = new Date()) => refusal(E.undoStop({ membershipId: made.membershipId, by, actorId: by === "member" ? made.member.id : host.id, now }));
    check("someone else cannot cancel it, and learns nothing about it", (await refusal(E.stopRenewal({ membershipId: m.membershipId, by: "member", actorId: host.id, now: new Date() }))) === "Membership not found.");
    await stop("member");
    await stop("member");
    check("the member cancels: only the renewal is stopped, and both are told once", (await MS(m.membershipId)).memberStoppedAt !== null && (await MS(m.membershipId)).status === "active" && (await M(m.monthId)).status === "running" && (await M(m.monthId)).freeCents === 6000 && (await emails(m.member.email, "ends on its paid month")) === 1 && (await emails(host.email, "has cancelled their membership")) === 1);
    check("\"Keep my membership\" brings it back, and nothing is charged", (await undo("member")) === null && (await MS(m.membershipId)).memberStoppedAt === null && (await monthsOf(m.membershipId)).length === 1 && (await emails(host.email, "keeps their membership")) === 1);

    await stop("host");
    check("the host pauses a member after this month: the member is told, and keeps the month", (await MS(m.membershipId)).hostStoppedAt !== null && (await emails(m.member.email, "has paused your membership after this month")) === 1);
    check("a member cannot undo the host's pause", (await undo("member")) === null && (await MS(m.membershipId)).hostStoppedAt !== null);
    await stop("member");
    check("both have stopped it; the host undoes hers: it is still stopped", (await undo("host")) === null && (await MS(m.membershipId)).hostStoppedAt === null && (await MS(m.membershipId)).memberStoppedAt !== null);
    check("and the email to both says so, instead of promising a renewal", (await emails(m.member.email, "still set to pause")) === 1 && (await emails(host.email, "still set to pause")) === 1 && /still paused when the month you paid for ends/.test(await emailText(m.member.email, "still set to pause")));
    check("after the paid month has ended it can no longer be switched back on", /month has ended/.test((await undo("member", m, end)) ?? ""));
    await db.insert(schema.blocks).values({ blockerId: host.id, blockedId: m.member.id });
    check("not with a block either", Boolean(await undo("member")));
    await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, host.id));
    await closeMonth(m.monthId, end);
    check("at the month's end the membership is paused, and nothing new is charged", (await MS(m.membershipId)).status === "paused" && (await MS(m.membershipId)).pausedReason === "member" && (await monthsOf(m.membershipId)).length === 1);
    await audit("after cancelling the normal way", m);

    // Switching back on needs room for the member's next month.
    const small = await newHost({ weeklyMinutes: 60 });
    const stays = await joined(small, { take: true });
    const leaves = await joined(small, { take: true });
    await E.stopRenewal({ membershipId: leaves.membershipId, by: "member", actorId: leaves.member.id, now: new Date() });
    await setHours(small, 30);
    check("a member who stopped their own renewal cannot switch back on once the hours have no room for it", /no room for your next month/.test((await refusal(E.undoStop({ membershipId: leaves.membershipId, by: "member", actorId: leaves.member.id, now: new Date() }))) ?? "") && (await MS(stays.membershipId)).status === "active");

    // "Cancel now", while the month's amount is only held.
    const a = await joined(host);
    await E.cancelNow({ membershipId: a.membershipId, memberId: a.member.id, now: new Date() });
    check("\"Cancel now\": the hold is let go, nothing is charged, and the membership is paused today", (await M(a.monthId)).status === "given_up" && (await intentOf(a.monthId)).status === "canceled" && (await intentOf(a.monthId)).amount_received === 0 && (await MS(a.membershipId)).status === "paused" && (await MS(a.membershipId)).pausedReason === "cancel_now");
    check("the email says that nothing was charged and the hold is let go", /Nothing was charged for this month/.test(await emailText(a.member.email, "is paused")));
    check("pressed again: there is nothing left to cancel", /already paused/.test((await refusal(E.cancelNow({ membershipId: a.membershipId, memberId: a.member.id, now: new Date() }))) ?? ""));
    const b = await joined(host, { take: true });
    check("once the money has been taken, only the normal way is left", /already been taken/.test((await refusal(E.cancelNow({ membershipId: b.membershipId, memberId: b.member.id, now: new Date() }))) ?? "") && (await M(b.monthId)).status === "running");
    const taking = await joined(host);
    const [onItsWay] = await db.insert(schema.moneyOperations).values({ monthId: taking.monthId, kind: "capture", label: `monthcapture:${taking.monthId}:1`, params: JSON.stringify({ intentId: (await M(taking.monthId)).stripePaymentIntentId, amountCents: 6000 }) }).returning();
    check("while the money is being taken at that very moment, \"Cancel now\" promises nothing: the member is asked to try again in a minute", /being taken at this moment/.test((await refusal(E.cancelNow({ membershipId: taking.membershipId, memberId: taking.member.id, now: new Date() }))) ?? "") && (await M(taking.monthId)).endedHow === null && (await emails(taking.member.email, "is paused")) === 0);
    await age(onItsWay.id, 2 * MIN);
    await helper(new Date(), 1);
    check("the taking is finished by the helper, and then only the normal way is left", (await M(taking.monthId)).status === "running" && /already been taken/.test((await refusal(E.cancelNow({ membershipId: taking.membershipId, memberId: taking.member.id, now: new Date() }))) ?? ""));
    const c = await joined(host);
    await E.stopRenewal({ membershipId: c.membershipId, by: "member", actorId: c.member.id, now: new Date() });
    await E.cancelNow({ membershipId: c.membershipId, memberId: c.member.id, now: new Date() });
    check("a member who chose \"at the end of the month\" can still press \"Cancel now\" while the amount is only held", (await MS(c.membershipId)).status === "paused" && (await M(c.monthId)).status === "given_up");

    // At the same moment as the taking, and as the host ending it: one outcome each time.
    const d = await joined(host);
    await Promise.all([refusal(E.cancelNow({ membershipId: d.membershipId, memberId: d.member.id, now: new Date() })), C.takeMonth(d.monthId, new Date())]);
    await helper(new Date());
    const dMonth = await M(d.monthId);
    const dOutcome = dMonth.status === "given_up" ? "cancelled" : dMonth.status === "running" ? "taken" : dMonth.status === "finished" && dMonth.paidBackCents === 6000 ? "taken and paid back in full" : `unexpected: ${dMonth.status}`;
    check(`"Cancel now" and the taking at the same moment: one outcome (${dOutcome})`, !dOutcome.startsWith("unexpected") && (dOutcome === "taken" ? (await MS(d.membershipId)).status === "active" : (await MS(d.membershipId)).status === "paused"), dOutcome);
    const e = await joined(host);
    await Promise.all([refusal(E.cancelNow({ membershipId: e.membershipId, memberId: e.member.id, now: new Date() })), E.endByHost({ membershipId: e.membershipId, hostId: host.id, now: new Date() })]);
    await helper(new Date());
    check("\"Cancel now\" and the host ending the membership at the same moment: the hold is let go once, and the membership is ended whichever came first", (await M(e.monthId)).status === "given_up" && (await intentOf(e.monthId)).status === "canceled" && (await MS(e.membershipId)).status === "ended");
    for (const made of [a, b, c, d, e, taking]) await audit("after Cancel now", made);

    // Without a running month (a payment is being tried), a stop pauses at once.
    const f = await joined(host, { take: true });
    await saveCard(f, "pm_card_chargeCustomerFail");
    await closeMonth(f.monthId, (await M(f.monthId)).endsAt!);
    const open = (await monthsOf(f.membershipId))[1];
    await E.stopRenewal({ membershipId: f.membershipId, by: "host", actorId: host.id, now: new Date() });
    check("\"Pause after this month\" on a member whose payment is being tried pauses at once and cancels the open payment", (await MS(f.membershipId)).status === "paused" && (await MS(f.membershipId)).pausedReason === "host" && (await M(open.id)).status === "given_up" && (await intentOf(open.id)).status === "canceled");

    const g = await joined(host, { take: true });
    const written = await db.transaction(async (tx) => {
      const locked = await L.lockForMonth(tx, g.monthId);
      return (await C.writeDownMonth(tx, locked.membership, { originKey: `renewal:${g.monthId}`, agreementId: locked.membership.agreementId!, pricePer15Cents: 750, includedMinutes: 120, tryNow: true }, new Date())).id;
    });
    await E.stopRenewal({ membershipId: g.membershipId, by: "member", actorId: g.member.id, now: new Date() });
    await helper(new Date(), 1);
    check("a stop on a renewal that was only just written down cancels it before the card is ever tried", (await MS(g.membershipId)).status === "paused" && (await M(written)).status === "given_up" && (await operations(written, "hold")).length === 0);

    // The host's own "End membership".
    await E.endByHost({ membershipId: b.membershipId, hostId: host.id, now: new Date() });
    await helper(new Date());
    check("\"End membership\": ended at once and for good, and all free money of the month is paid back", (await MS(b.membershipId)).status === "ended" && (await MS(b.membershipId)).endedBy === "host" && (await M(b.monthId)).paidBackCents === 6000 && (await emails(b.member.email, "has ended")) === 1);
    await E.endByHost({ membershipId: a.membershipId, hostId: host.id, now: new Date() });
    check("a paused member can be ended too; coming back then needs a new invitation", (await MS(a.membershipId)).status === "ended" && /new invitation/.test((await refusal(resumeAs(a, randomUUID(), true))) ?? ""));
    for (const made of [b, f]) await audit("after the host's pause and ending", made);
  });

  // ========================================================================
  journey("Resuming after a pause: the host's membership as it is then, agreed to again", async () => {
    const host = await newHost();
    const m = await joined(host);
    await E.cancelNow({ membershipId: m.membershipId, memberId: m.member.id, now: new Date() });
    await save(host, { on: true, pricePer15Cents: 700, includedMinutes: 60 });
    const requestId = randomUUID();
    const press = (id = requestId, agreed = true) => resumeAs(m, id, agreed);
    check("resuming needs the box ticked again", /tick the box/.test((await refusal(press(requestId, false))) ?? ""));
    const stale = await refusal(J.resume({ customerId: m.member.id, membershipId: m.membershipId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, offerVersion: 1, now: new Date() }));
    check("\"Resume\" from a page that still showed the old price and time is refused: nobody agrees to terms they did not see", /changed the membership while this page was open/.test(stale ?? "") && (await MS(m.membershipId)).status === "paused" && (await agreementsOf(m.membershipId)).length === 1, stale);
    const [one, two] = await Promise.all([press(), press()]);
    check("\"Resume\" pressed twice: one agreement, one month", one.monthId === two.monthId && (await agreementsOf(m.membershipId)).length === 2 && (await monthsOf(m.membershipId)).length === 2);
    const month = await pay(one.monthId, "pm_card_mastercard");
    const membership = await MS(m.membershipId);
    check("a new month starts at the host's membership as it is now: 1 hour for $28.00", month.status === "held" && month.totalCents === 2800 && month.includedMinutes === 60 && month.period === 2 && membership.status === "active" && membership.ownPricePer15Cents === 700 && membership.ownMinutes === 60, month);
    const [joinedUnder, resumedUnder] = await agreementsOf(m.membershipId);
    const all = await monthsOf(m.membershipId);
    check("each month shows the agreement it was started under", joinedUnder.kind === "joined" && resumedUnder.kind === "resumed" && resumedUnder.offerVersion === 2 && all[0].agreementId === joinedUnder.id && all[1].agreementId === resumedUnder.id);
    check("the host is told they are back; \"since\" counts from this resuming", (await emails(host.email, "has resumed their membership")) === 1 && membership.since?.getTime() === month.authorisedAt?.getTime());
    await E.cancelNow({ membershipId: m.membershipId, memberId: m.member.id, now: new Date() });
    const third = await press(randomUUID());
    await pay(third.monthId, "pm_card_visa");
    check("paused and resumed a second time: a third period with its own agreement", (await MS(m.membershipId)).period === 3 && (await agreementsOf(m.membershipId)).length === 3 && (await M(third.monthId)).status === "held");
    await audit("after resuming twice", m);

    // A card step that is not finished leaves the member paused, as they were.
    const n = await joined(host);
    await E.cancelNow({ membershipId: n.membershipId, memberId: n.member.id, now: new Date() });
    const half = await resumeAs(n, randomUUID(), true);
    await helper(new Date(Date.now() + 31 * MIN), 1);
    check("a resuming that is not finished: paused again as before, nothing charged, no second \"paused\" email", (await MS(n.membershipId)).status === "paused" && (await MS(n.membershipId)).pausedReason === "cancel_now" && (await M(half.monthId)).status === "given_up" && (await emails(n.member.email, "is paused")) === 1);

    // What stands in the way of resuming.
    const tryResume = () => refusal(resumeAs(n, randomUUID(), true));
    await db.insert(schema.blocks).values({ blockerId: n.member.id, blockedId: host.id });
    check("not with a block", (await tryResume()) === "This membership is not available at the moment.");
    await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, n.member.id));
    await setSwitches({ memberships: "off" });
    check("not with the founder's switch off", (await tryResume()) === "Memberships are not open at the moment.");
    await setSwitches({ memberships: "named", membershipsHosts: named });
    await audit("after a resuming that was not finished", n);

    // Two paused members, one place.
    const small = await newHost({ weeklyMinutes: 30 });
    const p = await joined(small);
    await E.cancelNow({ membershipId: p.membershipId, memberId: p.member.id, now: new Date() });
    const q = await joined(small);
    await E.cancelNow({ membershipId: q.membershipId, memberId: q.member.id, now: new Date() });
    const both = await Promise.all([p, q].map((made) => refusal(resumeAs(made, randomUUID(), true))));
    check("two paused members resuming for one place at the same moment: one gets it, the other is told there is no room", both.filter((answer) => answer === null).length === 1 && both.filter((answer) => /no room/.test(answer ?? "")).length === 1, both);
    const winner = both[0] === null ? p : q;
    const loser = both[0] === null ? q : p;
    await pay((await MS(winner.membershipId)).currentMonthId!, "pm_card_mastercard");
    await E.cancelNow({ membershipId: winner.membershipId, memberId: winner.member.id, now: new Date() });
    await helper(new Date(), 1);
    check("when the place frees up, the other can resume", (await refusal(resumeAs(loser, randomUUID(), true))) === null);
  });

  // ========================================================================
  journey("A cut in hours: the host chooses for each member, and can offer less time", async () => {
    // Five members at 2 hours each, with a host who offers exactly 10 hours a month.
    const host = await newHost({ weeklyMinutes: 150 });
    const five: Made[] = [];
    for (let i = 0; i < 5; i++) five.push(await joined(host));
    const [hours] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host.id));
    const toTwoHours = { remove: hours.id, add: { weekday: 1, from: "09:00", to: "09:30" } };
    const cut = await previewWeeklyHoursChange(host.id, toTwoHours);
    check("she is shown what her members need, what she would offer, and what she still owes this month", cut.needed === 600 && cut.hoursAfter === 120 && cut.owedThisMonth === 600 && cut.members.length === 5, cut);
    check("to start with, the newest members are set to \"pause\" until the others fit", cut.members[0].membershipId === five[0].membershipId && cut.members.map((member) => member.suggested).join() === "keep,pause,pause,pause,pause");
    check("looking saves nothing", (await Room.hostMinutes(db, host.id)) === 600);
    check("the cut cannot be saved until she has chosen", /Choose for each member/.test((await refusal(changeWeeklyHours(host.id, toTwoHours))) ?? "") && (await Room.hostMinutes(db, host.id)) === 600);
    const choose = (choices: Array<"keep" | "pause">) => ({ mark: cut.mark, members: five.map((m, index) => ({ membershipId: m.membershipId, choice: choices[index] })) });
    check("nor while the members she keeps do not fit", /members you keep need 4 hours/.test((await refusal(changeWeeklyHours(host.id, toTwoHours, choose(["keep", "keep", "pause", "pause", "pause"])))) ?? ""));
    await changeWeeklyHours(host.id, toTwoHours, choose(["pause", "pause", "keep", "pause", "pause"]));
    const stopped = await Promise.all(five.map(async (m) => (await MS(m.membershipId)).hostStoppedAt !== null));
    check("she can keep any one of the five, not only the oldest: the cut and her choices are saved in one step", (await Room.hostMinutes(db, host.id)) === 120 && stopped.join() === "true,true,false,true,true", stopped);
    check("months that have started are not touched, and the paused members are told", (await M(five[0].monthId)).status === "held" && (await MS(five[0].membershipId)).status === "active" && (await emails(five[0].member.email, "has paused your membership after this month")) === 1);
    const [rowNow] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host.id));
    check("a confirmation from a page that is out of date is refused, and nothing is saved", /changed while this page was open/.test((await refusal(changeWeeklyHours(host.id, { remove: rowNow.id }, choose(["pause", "pause", "pause", "pause", "pause"])))) ?? "") && (await Room.hostMinutes(db, host.id)) === 120);
    check("undoing a pause needs room", /no room for this member/.test((await refusal(E.undoStop({ membershipId: five[0].membershipId, by: "host", actorId: host.id, now: new Date() }))) ?? ""));
    await setHours(host, 60);
    check("adding hours back undoes nothing by itself; she undoes it", (await MS(five[0].membershipId)).hostStoppedAt !== null && (await refusal(E.undoStop({ membershipId: five[0].membershipId, by: "host", actorId: host.id, now: new Date() }))) === null && (await MS(five[0].membershipId)).hostStoppedAt === null);
    for (const m of [five[1], five[2]]) {
      await C.takeNow(m.monthId, new Date()); // (by its end a month's money has long been taken)
      await closeMonth(m.monthId, (await M(m.monthId)).endsAt!);
    }
    check("at their months' ends the paused member is paused and the kept one renews", (await MS(five[1].membershipId)).status === "paused" && (await MS(five[1].membershipId)).pausedReason === "host" && (await monthsOf(five[2].membershipId)).length === 2);

    // Less time instead of a pause.
    const host2 = await newHost({ weeklyMinutes: 60 }); // 4 hours a month
    const older = await joined(host2, { take: true });
    const newer = await joined(host2, { take: true });
    const [hours2] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host2.id));
    const toThreeHours = { remove: hours2.id, add: { weekday: 1, from: "09:00", to: "09:45" } };
    const moved = await previewWeeklyHoursChange(host2.id, { remove: hours2.id, add: { weekday: 4, from: "14:00", to: "15:00" } });
    check("a stretch moved to another time in one go is no cut: nothing to choose", moved.hoursAfter === 240 && moved.needed === 240 && moved.members.every((member) => member.suggested === "keep"));
    check("moving a stretch that is no longer there is refused, instead of adding hours", /changed in the meantime/.test((await refusal(changeWeeklyHours(host2.id, { remove: randomUUID(), add: { weekday: 5, from: "09:00", to: "10:00" } }))) ?? "") && (await Room.hostMinutes(db, host2.id)) === 240);
    const cut2 = await previewWeeklyHoursChange(host2.id, toThreeHours);
    const less = (minutes: number) => ({ mark: cut2.mark, members: [{ membershipId: older.membershipId, choice: "keep" as const }, { membershipId: newer.membershipId, choice: "less" as const, minutes }] });
    check("less time must be less than the member has, in half hours", Boolean(await refusal(changeWeeklyHours(host2.id, toThreeHours, less(120)))) && Boolean(await refusal(changeWeeklyHours(host2.id, toThreeHours, less(45)))));
    const afterTheMonth = new Date((await M(newer.monthId)).endsAt!.getTime() + MIN);
    check("less time cannot be offered for a month that is already over (the closing job is late): there would be no time left to answer", /whose month has started/.test((await refusal(changeWeeklyHours(host2.id, toThreeHours, less(60), afterTheMonth))) ?? "") && (await MS(newer.membershipId)).offerId === null);
    await changeWeeklyHours(host2.id, toThreeHours, less(60));
    const offered = await MS(newer.membershipId);
    check("the newer member is offered 1 hour instead of 2, and gets the email with both amounts", offered.offerId !== null && offered.offeredMinutes === 60 && offered.offerMonthId === newer.monthId && offered.ownMinutes === 120 && (await emails(newer.member.email, "offers you less time")) === 1);
    check("while the offer is open, the smaller time is what is kept for their next month", (await Room.minutesMembersNeed(db, host2.id)) === 180);
    const cut3 = await previewWeeklyHoursChange(host2.id, { add: { weekday: 2, from: "09:00", to: "09:15" } });
    check("a member with an open offer is shown with it", cut3.members.find((member) => member.membershipId === newer.membershipId)?.openOfferMinutes === 60);
    const answer = (what: "accept" | "decline", made: Made, offerId: string) => refusal((what === "accept" ? E.acceptLessTime : E.declineLessTime)({ membershipId: made.membershipId, memberId: made.member.id, offerId, now: new Date() }));
    check("an old or made-up button does nothing", (await answer("accept", newer, randomUUID())) === "This offer is no longer open." && (await answer("accept", older, offered.offerId!)) === "This offer is no longer open.");
    await Promise.all([answer("accept", newer, offered.offerId!), answer("accept", newer, offered.offerId!)]);
    const accepted = await MS(newer.membershipId);
    const record = (await agreementsOf(newer.membershipId)).at(-1)!;
    check("accepted (pressed twice): one new agreement on record, nothing charged, and the running month is unchanged", accepted.offerId === null && accepted.ownMinutes === 60 && record.kind === "less_time" && record.minutes === 60 && record.pricePer15Cents === 750 && (await agreementsOf(newer.membershipId)).length === 2 && (await M(newer.monthId)).includedMinutes === 120 && (await monthsOf(newer.membershipId)).length === 1);
    check("both are told", (await emails(newer.member.email, "the offer of less time")) === 1 && (await emails(host2.email, "your offer of less time")) === 1);
    check("someone else trying the accepted offer's id on their own membership learns nothing from it", (await answer("accept", older, offered.offerId!)) === "This offer is no longer open." && (await agreementsOf(older.membershipId)).length === 1);
    await closeMonth(newer.monthId, (await M(newer.monthId)).endsAt!);
    const smaller = (await monthsOf(newer.membershipId))[1];
    check("from the next month: the smaller time at the member's own price, $30.00 instead of $60.00", smaller.includedMinutes === 60 && smaller.totalCents === 3000 && smaller.agreementId === record.id && smaller.status === "held" && (await intentOf(smaller.id)).amount === 3000, smaller);
    await audit("after an accepted offer of less time", newer);

    // "No thanks", no answer, and the host taking it back.
    const host3 = await newHost({ weeklyMinutes: 120 }); // 8 hours a month
    const members: Made[] = [];
    for (let i = 0; i < 4; i++) members.push(await joined(host3, { take: true }));
    const [hours3] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host3.id));
    const toFour = { remove: hours3.id, add: { weekday: 1, from: "09:00", to: "10:00" } };
    const cut4 = await previewWeeklyHoursChange(host3.id, toFour);
    await changeWeeklyHours(host3.id, toFour, { mark: cut4.mark, members: members.map((m) => ({ membershipId: m.membershipId, choice: "less" as const, minutes: 60 })) });
    const offers = await Promise.all(members.map(async (m) => (await MS(m.membershipId)).offerId!));
    // The same form sent again: the stretch it was about is gone, so it is no cut any more. Nothing is saved, and nobody is told otherwise.
    const again = await refusal(changeWeeklyHours(host3.id, { remove: hours3.id }, { mark: cut4.mark, members: members.map((m) => ({ membershipId: m.membershipId, choice: "pause" as const })) }));
    check("choices sent for hours that were changed meanwhile save nothing, and say so", /changed in the meantime/.test(again ?? "") && (await MS(members[3].membershipId)).hostStoppedAt === null, again);
    check("all four are offered 1 hour; with these offers her 4 hours are enough", offers.every(Boolean) && (await Room.minutesMembersNeed(db, host3.id)) === 240);
    await answer("decline", members[0], offers[0]);
    check("\"No thanks\": the member keeps the month and is stopped, with the reason kept", (await MS(members[0].membershipId)).offerId === null && (await MS(members[0].membershipId)).hostStoppedAt !== null && (await MS(members[0].membershipId)).ownMinutes === 120);
    const undone = await refusal(E.undoStop({ membershipId: members[0].membershipId, by: "host", actorId: host3.id, now: new Date() }));
    check("a \"No thanks\" always stands: the host cannot undo that pause", /that stands/.test(undone ?? "") && (await MS(members[0].membershipId)).hostStoppedAt !== null && (await MS(members[0].membershipId)).pausedReason === "offer", undone);
    // The member cancels and then keeps the membership after all: their own stop is gone, the "No thanks" still stands, and nobody is told the host could take it back.
    await E.stopRenewal({ membershipId: members[0].membershipId, by: "member", actorId: members[0].member.id, now: new Date() });
    await E.undoStop({ membershipId: members[0].membershipId, by: "member", actorId: members[0].member.id, now: new Date() });
    const toldHost = await emailText(host3.email, "still set to pause");
    const toldMember = await emailText(members[0].member.email, "still set to pause");
    check(
      "after a \"No thanks\", a member who cancels and keeps it again is told the truth, and so is the host: nobody can take that pause back",
      /said "No thanks"/.test(toldHost) && !/unless you take the pause back/.test(toldHost) && /said "No thanks"/.test(toldMember) && !/can take that back/.test(toldMember) && (await MS(members[0].membershipId)).memberStoppedAt === null && (await MS(members[0].membershipId)).pausedReason === "offer",
      `${toldHost}\n${toldMember}`,
    );
    await closeMonth(members[0].monthId, (await M(members[0].monthId)).endsAt!);
    await closeMonth(members[1].monthId, (await M(members[1].monthId)).endsAt!);
    check("at the month's end: \"No thanks\" and no answer are both paused, told why, and nothing is charged", (await MS(members[0].membershipId)).status === "paused" && (await MS(members[0].membershipId)).pausedReason === "offer" && (await MS(members[1].membershipId)).status === "paused" && (await MS(members[1].membershipId)).pausedReason === "offer" && (await monthsOf(members[1].membershipId)).length === 1);
    check("after the month's end the offer can no longer be accepted", (await answer("accept", members[1], offers[1])) === "This offer is no longer open.");
    // A cut that touches nobody, saved the way the calendar page saves it: with the mark of what was just worked out and
    // every member kept. If anything changed in between, nothing is saved, so no invitation is taken back unseen.
    const host5 = await newHost({ weeklyMinutes: 240 }); // 16 hours a month
    const kept5 = await joined(host5, { take: true });
    const [hours5] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host5.id));
    const toThree = { remove: hours5.id, add: { weekday: 1, from: "09:00", to: "12:00" } }; // 12 hours a month
    const quiet = await previewWeeklyHoursChange(host5.id, toThree);
    const keepAll = (cut: typeof quiet) => ({ mark: cut.mark, members: cut.members.map((member) => ({ membershipId: member.membershipId, choice: "keep" as const })) });
    const arrived = await invited(host5);
    const outOfDate = await refusal(changeWeeklyHours(host5.id, toThree, keepAll(quiet)));
    check("a cut that touched nobody when it was worked out is not saved if something changed in between", quiet.invitationsTakenBack.length === 0 && /changed while this page was open/.test(outOfDate ?? "") && (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.id, hours5.id))).length === 1, outOfDate);
    await changeWeeklyHours(host5.id, toThree, keepAll(await previewWeeklyHoursChange(host5.id, toThree)));
    check("worked out again, it is saved: the member is kept, and the invitation that still fits stays", (await Room.minutesMembersNeed(db, host5.id)) === 120 && (await MS(kept5.membershipId)).hostStoppedAt === null && (await MS(arrived.membershipId)).status === "invited" && (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.id, hours5.id))).length === 0);
    const takeBack = (m: Made, keep: boolean, offerId: string, now = new Date()) => refusal(E.takeBackLessTime({ membershipId: m.membershipId, hostId: host3.id, offerId, keep, now }));
    check("a take-back button from an older offer, or one pressed after the member's month has ended, does nothing", (await takeBack(members[2], true, randomUUID())) === "This offer is no longer open." && (await takeBack(members[2], true, offers[2], (await M(members[2].monthId)).endsAt!)) === "This offer is no longer open." && (await MS(members[2].membershipId)).offerId === offers[2]);
    check("the host takes an offer back and keeps the member with their old time, now that there is room", (await takeBack(members[2], true, offers[2])) === null && (await MS(members[2].membershipId)).offerId === null && (await MS(members[2].membershipId)).hostStoppedAt === null && (await MS(members[2].membershipId)).ownMinutes === 120);
    check("the old button then says the offer is no longer open", (await answer("accept", members[2], offers[2])) === "This offer is no longer open.");
    await setHours(host3, 45); // she cuts again, to 3 hours a month
    check("keeping the last one with their old time too would no longer fit; taking the offer back with a pause does", /no room for this member's full time/.test((await takeBack(members[3], true, offers[3])) ?? "") && (await takeBack(members[3], false, offers[3])) === null && (await MS(members[3].membershipId)).hostStoppedAt !== null && (await MS(members[3].membershipId)).offerId === null);

    // A second cut with an offer still open; a payment being tried; an invitation that gives way; all hours gone.
    const host4 = await newHost({ weeklyMinutes: 90 }); // 6 hours a month
    const withOffer = await joined(host4, { take: true });
    const tryingToPay = await joined(host4, { take: true });
    const open = await invited(host4); // the third and last place
    const [hours4] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host4.id));
    const first = await previewWeeklyHoursChange(host4.id, { remove: hours4.id, add: { weekday: 1, from: "09:00", to: "09:45" } });
    check("the invitation that no longer fits beside what she owes is named before she saves", first.invitationsTakenBack.length === 1 && first.invitationsTakenBack[0] === open.membershipId && first.hoursAfter === 180);
    await changeWeeklyHours(host4.id, { remove: hours4.id, add: { weekday: 1, from: "09:00", to: "09:45" } }, { mark: first.mark, members: [{ membershipId: withOffer.membershipId, choice: "less", minutes: 60 }, { membershipId: tryingToPay.membershipId, choice: "keep" }] });
    check("invitations give way before members: it is taken back with the cut, and the person is told", (await MS(open.membershipId)).status === "ended" && (await emails(open.member.email, "no longer open")) === 1);
    await saveCard(tryingToPay, "pm_card_chargeCustomerFail");
    await closeMonth(tryingToPay.monthId, (await M(tryingToPay.monthId)).endsAt!);
    check("(one member with an open offer, one whose payment is being tried)", (await MS(tryingToPay.membershipId)).status === "unpaid" && (await MS(withOffer.membershipId)).offerId !== null);
    const [row4] = await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host4.id));
    const toNothing = { remove: row4.id };
    const last = await previewWeeklyHoursChange(host4.id, toNothing);
    const second = (a: MemberChoice["choice"], b: MemberChoice["choice"], minutes?: number) => ({ mark: last.mark, members: [{ membershipId: withOffer.membershipId, choice: a, minutes }, { membershipId: tryingToPay.membershipId, choice: b, minutes }] });
    check("no second offer while one is open, and none to a member whose payment is being tried", /whose month has started and who has no open offer/.test((await refusal(changeWeeklyHours(host4.id, toNothing, second("less", "pause", 30)))) ?? "") && /whose month has started/.test((await refusal(changeWeeklyHours(host4.id, toNothing, second("pause", "less", 30)))) ?? ""));
    await changeWeeklyHours(host4.id, toNothing, second("pause", "pause"));
    await helper(new Date(), 1);
    const unpaidMonth = (await monthsOf(tryingToPay.membershipId))[1];
    check("all weekly hours removed, by pausing everyone: the open offer is taken back, and the payment being tried is cancelled at once", (await Room.hostMinutes(db, host4.id)) === 0 && (await MS(withOffer.membershipId)).offerId === null && (await MS(withOffer.membershipId)).hostStoppedAt !== null && (await MS(tryingToPay.membershipId)).status === "paused" && (await intentOf(unpaidMonth.id)).status === "canceled");
    check("the member's running month is untouched by all of it", (await M(withOffer.monthId)).status === "running" && (await M(withOffer.monthId)).freeCents === 6000);
    for (const m of [withOffer, tryingToPay]) await audit("after all hours were removed", m);
  });

  // ========================================================================
  journey("With the founder's switch off nothing can start; a hidden host page; and no page can start a membership yet", async () => {
    const host = await newHost();
    const m = await joined(host, { take: true });
    const paused = await joined(host);
    await E.cancelNow({ membershipId: paused.membershipId, memberId: paused.member.id, now: new Date() });
    const waiting = await invited(host);
    const guest = await person("member");
    await talked(host, guest);
    await E.stopRenewal({ membershipId: m.membershipId, by: "member", actorId: m.member.id, now: new Date() });
    await setSwitches({ memberships: "off" });
    const closed = "Memberships are not open at the moment.";
    check("off: nobody can invite", (await refusal(J.invite({ hostId: host.id, customerId: guest.id, now: new Date() }))) === closed);
    check("off: nobody can join, also with an invitation from before", (await refusal(J.join({ customerId: waiting.member.id, inviteId: waiting.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date() }))) === closed);
    check("off: nobody can resume", (await refusal(resumeAs(paused, randomUUID(), true))) === closed);
    check("off: no renewal can be switched back on", (await refusal(E.undoStop({ membershipId: m.membershipId, by: "member", actorId: m.member.id, now: new Date() }))) === closed);
    check("off: a host cannot raise her price or change the time", (await O.previewOfferChange(host.id, { on: true, pricePer15Cents: 800, includedMinutes: 120 })).problem === closed && (await O.previewOfferChange(host.id, { on: true, pricePer15Cents: 750, includedMinutes: 60 })).problem === closed);
    await save(host, { on: true, pricePer15Cents: 700, includedMinutes: 120 });
    check("off: she can still look after what exists: lower her member price", (await offerOf(host)).pricePer15Cents === 700 && (await MS(m.membershipId)).ownPricePer15Cents === 700);
    await E.stopRenewal({ membershipId: m.membershipId, by: "host", actorId: host.id, now: new Date() });
    await E.endByHost({ membershipId: paused.membershipId, hostId: host.id, now: new Date() });
    await save(host, { on: false, pricePer15Cents: 700, includedMinutes: 120 });
    check("off: and pause a member, end a member, and switch her membership off", (await MS(m.membershipId)).hostStoppedAt !== null && (await MS(paused.membershipId)).status === "ended" && !(await offerOf(host)).on);
    check("off: the month that has started keeps working to its end", (await M(m.monthId)).status === "running" && (await M(m.monthId)).freeCents === 6000);
    await setSwitches({ memberships: "named", membershipsHosts: named });

    // A host who hides her page from the public keeps her members.
    const hidden = await newHost();
    const member = await joined(hidden);
    const stranger = await person("stranger");
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, hidden.id));
    const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hidden.id));
    check("a hidden page stays closed to the public", (await publicProfile(profile.handle)) === null);
    const asked = await invited(hidden);
    check("an invited person reaches the hidden page too, but only for the invitation's 24 hours, also when the helper is late", (await A.hostForMember(asked.member.id, hidden.id)) !== null && (await A.hostForMember(asked.member.id, hidden.id, new Date(Date.now() + DAY + MIN))) === null && (await A.invitationFor(asked.member.id, asked.inviteId, new Date(Date.now() + DAY + MIN)))?.expired === true);
    const unfinished = await joined(hidden, { pay: false });
    check("so does someone at the card step, but only while it can still be finished", (await A.hostForMember(unfinished.member.id, hidden.id)) !== null && (await A.hostForMember(unfinished.member.id, hidden.id, new Date(Date.now() + 31 * MIN))) === null);
    check("her member still reaches her, and may book; a stranger does not", (await A.hostForMember(member.member.id, hidden.id))?.canBook === true && (await A.hostForMember(stranger.id, hidden.id)) === null);
    await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, hidden.id));
    check("while her page waits to be approved again, the member can look but not book", (await A.hostForMember(member.member.id, hidden.id))?.canBook === false);
    await db.update(schema.hostProfiles).set({ status: "suspended" }).where(eq(schema.hostProfiles.userId, hidden.id));
    check("a suspended host is reached by nobody", (await A.hostForMember(member.member.id, hidden.id)) === null);
    check("a host sees her own members and invitations, and nobody else's", (await A.membersOfHost(host.id)).some((row) => row.membership.id === m.membershipId) && (await A.membersOfHost(hidden.id)).every((row) => row.membership.hostId === hidden.id) && (await A.membershipsOf(m.member.id)).length === 1);

    // With every page built (part three): only the host's and the member's own pages reach the code that changes a
    // membership or pays for one; every action asks who is signed in; and no page that is only being opened can start a payment.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const uses: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (/membership\/(join|offers|ending|charge)["']/.test(text)) uses.push({ path, text });
        }
      }
    };
    walk("src/app");
    const hostsOwn = ["src/app/contacts/actions.ts", "src/app/host/membership-actions.ts", "src/app/host/membership.tsx", "src/app/host/membership/page.tsx"];
    const membersOwn = ["src/app/h/[handle]/membership/actions.ts", "src/app/h/[handle]/membership/page.tsx", "src/app/memberships/[id]/actions.ts", "src/app/memberships/[id]/pay/page.tsx", "src/app/api/memberships/[id]/sync/route.ts"];
    const elsewhere = uses.filter((file) => !hostsOwn.includes(file.path) && !membersOwn.includes(file.path)).map((file) => file.path);
    check("only the host's and the member's own pages reach the code that changes a membership or pays for one", elsewhere.length === 0 && uses.length === hostsOwn.length + membersOwn.length, { elsewhere, found: uses.map((file) => file.path) });
    const actionsOf = (file: { text: string }) => file.text.split(/^export async function /m).slice(1);
    const actions = uses.filter((file) => file.text.startsWith("\"use server\""));
    // Each action that calls the membership code (not the page's older actions, such as saving a private note).
    const hostChanges = /\b(invite|takeBackInvitation|saveOffer|stopRenewal|undoStop|endByHost|takeBackLessTime)\(/;
    const hostActions = actions.filter((file) => hostsOwn.includes(file.path));
    const unasked = hostActions.flatMap((file) => actionsOf(file).filter((action) => hostChanges.test(action) && !action.includes("const user = await requireActiveUser();")).map((action) => `${file.path}: ${action.split("(")[0]}`));
    const guarded = hostActions.flatMap((file) => actionsOf(file).filter((action) => hostChanges.test(action))).length;
    check("each of the host's actions asks who is signed in, and uses that person as the host", hostActions.length === 2 && guarded === 7 && unasked.length === 0 && hostActions.every((file) => !/formData\.get\("hostId"\)/.test(file.text)), { actions: hostActions.map((file) => file.path), unasked });
    // A member's actions: joining, resuming and paying ask who is signed in; the buttons of a membership go through one
    // gate that also checks the membership is this person's own.
    const memberActions = actions.filter((file) => membersOwn.includes(file.path));
    const memberChanges = /\b(join|resume|payNow|stopRenewal|undoStop|cancelNow|acceptLessTime|declineLessTime)\(/;
    const loose = memberActions.flatMap((file) => actionsOf(file).filter((action) => memberChanges.test(action) && !action.includes("const user = await requireActiveUser();") && !action.includes("await mine(formData);")).map((action) => `${file.path}: ${action.split("(")[0]}`));
    const gate = memberActions.find((file) => file.path.endsWith("memberships/[id]/actions.ts"))?.text.match(/async function mine\([\s\S]*?\n}/)?.[0] ?? "";
    check("each of the member's actions asks who is signed in, and the membership's buttons check it is that person's own", memberActions.length === 2 && memberActions.flatMap((file) => actionsOf(file).filter((action) => memberChanges.test(action))).length === 8 && loose.length === 0 && gate.includes("await requireUser()") && gate.includes("membershipFor(user.id") && memberActions.every((file) => !/formData\.get\("(customerId|memberId|userId)"\)/.test(file.text)), { loose, gate: gate.slice(0, 120) });
    // "Starting is an action; loading is only reading": nothing that is drawn or fetched on opening a page may make or change a payment.
    // (Recording what Stripe shows, `syncMonth`, can start a membership too: it belongs to the one address the card form posts to, never to a page.)
    const isRoute = (file: { path: string }) => file.path.endsWith("/route.ts");
    const starting = uses.filter((file) => !file.text.startsWith("\"use server\"") && !isRoute(file) && /import \{[^}]*\b(join|resume|payNow|intentFor|syncMonth|tryHold|takeMonth|takeNow|cancelNow|stopRenewal|undoStop|saveOffer|invite)\b[^}]*\} from "@\/lib\/membership\//.test(file.text)).map((file) => file.path);
    const routes = uses.filter(isRoute);
    check("no page that is only being opened can start a joining, a payment or a change, and the one address that asks Stripe only answers a post", starting.length === 0 && routes.length === 1 && routes.every((file) => /export async function POST\(/.test(file.text) && !/export async function (GET|PUT|PATCH|DELETE)\(/.test(file.text)), { starting, routes: routes.map((file) => file.path) });
  });

  // ========================================================================
  if (process.argv.includes("--payouts")) {
    journey("Collecting: expired member time reaches the host only through \"Collect earnings\", from the month's own charge", async () => {
      const { collectEarnings, unsentEarnings } = await import("../src/lib/payments/collect");
      const { refreshPayoutsReady, getHostSettings } = await import("../src/lib/payments/hosts");
      const [seeded] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
      const settings = seeded ? await getHostSettings(seeded.id) : null;
      const ready = seeded && settings?.stripeAccountId ? await refreshPayoutsReady(seeded.id) : false;
      check("the test host's payout account is ready", Boolean(ready));
      if (!seeded || !settings?.stripeAccountId || !ready) return console.log("   Set up payouts for host@test.local on the Hosting page first.");
      const account = settings.stripeAccountId;
      const host = await newHost();
      // One payout account belongs to one host at a time, so the new host takes over the test account for this journey.
      const give = (from: string, to: string) =>
        db.transaction(async (tx) => {
          await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, from));
          await tx.update(schema.hostSettings).set({ stripeAccountId: account, payoutsReady: true }).where(eq(schema.hostSettings.userId, to));
        });
      await give(seeded.id, host.id);
      try {
        const press = (now: Date) => collectEarnings({ collectionId: randomUUID(), hostId: host.id, startedBy: host.id, now }).then(() => null, (error: unknown) => error as Error);
        const m = await running(host);
        await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, m.membershipId));
        const end = (await M(m.monthId)).endsAt!;
        check("nothing goes to the host before the time is used or has expired: a running month has nothing to collect", (await press(new Date(end.getTime() - MIN))) instanceof MoneyError && (await unsentEarnings(new Date(end.getTime() + 2 * DAY), host.id)).length === 0);
        await closeMonth(m.monthId, end);
        const early = await press(new Date(end.getTime() + DAY - 1000));
        check("the expired money cannot be collected before 24 hours after the month's end", early instanceof MoneyError, early?.message);
        const pressed = await press(new Date(end.getTime() + DAY));
        const payment = await expiredPayment(m.monthId);
        // $56.76 earned, less the 25-cent collection charge: $56.51 sent.
        check("at 24 hours the press is accepted: $56.51 is sent, after the 25-cent collection charge", pressed === null && payment.transferStatus === "sent" && payment.transferCents === 5651 && payment.payoutFeeCents === 25, `${pressed?.message} ${payment.transferStatus} ${payment.transferCents}`);
        const transfers = (await stripe().transfers.list({ transfer_group: m.monthId, limit: 10 })).data;
        check("one transfer at Stripe, to the host's account, from the month's own charge and in the month's group", transfers.length === 1 && transfers[0].amount === 5651 && transfers[0].destination === account && transfers[0].source_transaction === (await M(m.monthId)).stripeChargeId, transfers.length);
        check("the money record matches", (await ledger({ paymentId: payment.id }, "host_transfer")).total === -5651 && (await ledger({ paymentId: payment.id }, "payout_fee")).total === 25);

        const n = await running(host);
        await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, n.membershipId));
        const end2 = (await M(n.monthId)).endsAt!;
        await closeMonth(n.monthId, end2);
        await E.recordMonthDispute(n.monthId, "open", new Date());
        const earning = (await unsentEarnings(new Date(end2.getTime() + 3 * DAY), host.id)).find((row) => row.month?.id === n.monthId);
        const refused = await press(new Date(end2.getTime() + 3 * DAY));
        check("a share of a month whose charge is disputed is held back", Boolean(earning?.heldBack) && refused instanceof MoneyError && (await expiredPayment(n.monthId)).transferStatus === "not_due", earning?.heldBack);

        // One press collects a call's share and expired member time together.
        const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
        const { settleFinishedCalls } = await import("../src/lib/payments/jobs");
        const caller = await person("caller");
        const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
        const paid = await db.transaction(async (tx) => {
          const [call] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: caller.id, startsAt, endsAt: new Date(startsAt.getTime() + 10 * MIN), roomName: `membercheck-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
          await createPaymentForCall(tx, call);
          const [callPayment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
          return { call, payment: callPayment };
        });
        await startHold({ payment: paid.payment, call: paid.call, customer: caller, now: new Date() });
        const [withIntent] = await db.select().from(schema.payments).where(eq(schema.payments.id, paid.payment.id));
        await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
        await syncHold(paid.payment.id, new Date());
        for (const who of [host.id, caller.id]) {
          const event = (type: string, offset: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: paid.call.id, type, roomSessionId: "RM_membercheck", participantIdentity: who, participantSessionId: `PA_${who.slice(-6)}_${randomUUID().slice(0, 6)}`, providerTime: new Date(startsAt.getTime() + offset * 1000), payload: "{}" });
          const session = event("participant_joined", 0);
          await db.insert(schema.attendanceEvents).values([session, { ...event("participant_left", 600), participantSessionId: session.participantSessionId }]);
        }
        await db.update(schema.calls).set({ closedAt: new Date(startsAt.getTime() + 11 * MIN) }).where(eq(schema.calls.id, paid.call.id));
        await settleFinishedCalls(new Date(startsAt.getTime() + (24 * 60 + 3) * MIN));
        const callsShare = async () => (await db.select().from(schema.payments).where(eq(schema.payments.id, paid.payment.id)))[0];
        check("(a 10-minute call at $20.00 per 15 minutes was charged: $13.33, the host's share $12.38)", (await callsShare()).chargedCents === 1333 && (await callsShare()).originalHostShareCents === 1238, `${(await callsShare()).status} ${(await callsShare()).chargedCents}`);
        const o = await running(host);
        await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, o.membershipId));
        const end3 = (await M(o.monthId)).endsAt!;
        await closeMonth(o.monthId, end3);
        const both = await press(new Date(end3.getTime() + 3 * DAY));
        const [fromCall, fromMonth] = [await callsShare(), await expiredPayment(o.monthId)];
        // $12.38 and $56.76 are $69.14; one 25-cent collection charge: $68.89 sent.
        check("one press sends a call's share and expired member time together, with one collection charge", both === null && fromCall.transferStatus === "sent" && fromMonth.transferStatus === "sent" && (fromCall.transferCents ?? 0) + (fromMonth.transferCents ?? 0) === 6889 && (fromCall.payoutFeeCents ?? 0) + (fromMonth.payoutFeeCents ?? 0) === 25, `${both?.message} ${fromCall.transferStatus} ${fromMonth.transferStatus}`);
        const inMonthsGroup = (await stripe().transfers.list({ transfer_group: o.monthId, limit: 10 })).data;
        const inCallsGroup = (await stripe().transfers.list({ transfer_group: paid.call.id, limit: 10 })).data;
        check("each transfer names its own charge and its own group: the month's for expired time, the call's for the call", inMonthsGroup.length === 1 && inMonthsGroup[0].source_transaction === (await M(o.monthId)).stripeChargeId && inCallsGroup.length === 1 && inCallsGroup[0].source_transaction === fromCall.stripeChargeId && inMonthsGroup[0].amount + inCallsGroup[0].amount === 6889);
        check("the disputed month's share is still held back", (await expiredPayment(n.monthId)).transferStatus === "not_due");

        // A transfer of expired member time whose answer was lost, and which is too old to repeat.
        const { acceptCollection } = await import("../src/lib/payments/collect");
        const { transferAtStripe } = await import("../src/lib/payments/actions");
        const r = await running(host);
        await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, r.membershipId));
        const end4 = (await M(r.monthId)).endsAt!;
        await closeMonth(r.monthId, end4);
        const accepted = await acceptCollection({ collectionId: randomUUID(), hostId: host.id, startedBy: host.id, now: new Date(end4.getTime() + 6 * DAY) });
        const mine = accepted.started.filter((item) => item.paymentId !== undefined);
        const share = await expiredPayment(r.monthId);
        const item = mine.find((entry) => entry.paymentId === share.id);
        check("(the collection wrote the month's share down, and nothing of the disputed month)", mine.length === 1 && Boolean(item), mine.length);
        if (item) {
          await transferAtStripe(share, item.params, item.label); // Stripe did it; the answer never reached us
          await age(item.operationId, 25 * HOUR);
          await reconcileOperations(new Date());
          const found = await expiredPayment(r.monthId);
          const inGroup = (await stripe().transfers.list({ transfer_group: r.monthId, limit: 10 })).data;
          check("the helper asks Stripe instead of sending again: the transfer is found in the month's group and recorded once", found.transferStatus === "sent" && inGroup.length === 1 && inGroup[0].amount === found.transferCents && (found.transferCents ?? 0) + (found.payoutFeeCents ?? 0) === 5676, `${found.transferStatus} ${inGroup.length}`);
        }
      } finally {
        await give(host.id, seeded.id);
        await refreshPayoutsReady(seeded.id).catch(() => undefined);
      }
    });
  }

  // ------------------------------------------------------------------------
  // Running
  // ------------------------------------------------------------------------
  if (only && (only.length === 0 || only.some((n) => !Number.isInteger(n) || n < 1 || n > journeys.length))) {
    throw new Error(`--only takes journey numbers from 1 to ${journeys.length}${process.argv.includes("--payouts") ? "" : " (the last one, collecting, needs --payouts)"}.`);
  }
  const before = await switches();
  // Checked before anything is written: this script sets the switch and its list, and puts both back to "off" at the end.
  if (before.memberships !== "off" || before.membershipsHosts.length > 0) throw new Error("The memberships switch is not off in this database. This script would overwrite it. Set it to off first.");
  check("before anything: the founder's memberships switch is off", true);
  await wipe();
  try {
    for (const [index, [title, run]] of journeys.entries()) {
      if (only && !only.includes(index + 1)) continue;
      console.log(`\n${index + 1}. ${title}`);
      try {
        await run();
      } catch (error) {
        check("the journey ran to its end", false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
      }
      await wipe();
    }
  } finally {
    await setSwitches({ memberships: "off", membershipsHosts: [] });
    await wipe(true);
  }
  const afterwards = await switches();
  check("afterwards: the founder's memberships switch is off again, with nobody named", afterwards.memberships === "off" && afterwards.membershipsHosts.length === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
