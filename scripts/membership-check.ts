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
  async function newHost(opts: { weeklyMinutes?: number; named?: boolean } = {}): Promise<Person> {
    const p = await person("host");
    const stamp = new Date();
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `mc${RUN}${made}`, handleKey: `mc${RUN}${made}`, displayName: `Host ${made}`, pricePer15Cents: 1000, status: "approved", usConfirmedAt: stamp });
    await db.insert(schema.hostSettings).values({ userId: p.id }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values({ hostId: p.id, weekday: 1, startMinute: 540, endMinute: 540 + (opts.weeklyMinutes ?? 180) });
    await db.insert(schema.membershipOffers).values({ hostId: p.id, on: true, pricePer15Cents: 750, includedMinutes: 120 });
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
      const [again] = await tx.update(schema.memberships).set({ status: "joining", period: before.period + 1, agreementId: agreement.id, pausedAt: null, memberStoppedAt: null, hostStoppedAt: null }).where(eq(schema.memberships.id, m.membershipId)).returning();
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
  async function wipe(everything = false) {
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
    const theirBookings = (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(like(schema.bookings.hostId, "mc-%"), like(schema.bookings.customerId, "mc-%")))).map((row) => row.id);
    if (theirBookings.length > 0) {
      await db.delete(schema.bookingCards).where(inArray(schema.bookingCards.bookingId, theirBookings));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, theirBookings));
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
    await confirmOnly(d.monthId);
    await db.update(months).set({ cardStepExpiresAt: new Date(Date.now() - HOUR) }).where(eq(months.id, d.monthId));
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
    await db.transaction(async (tx) => S.endMembership(tx, await L.lockMembership(tx, b.membershipId), { by: "host", reason: "a check" }, new Date(Date.now() - 20 * MIN)));
    await says("an ending not cleaned up after 10 minutes", "cleaned up", async () => undefined, () => E.cleanUpEnding(b.membershipId, new Date()));
    await helper(new Date());
    check("and healthy again once the helper has done its work", (await lines()).length === 0, await lines());
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
      } finally {
        await give(host.id, seeded.id);
        await refreshPayoutsReady(seeded.id).catch(() => undefined);
      }
    });
  }

  // ------------------------------------------------------------------------
  // Running
  // ------------------------------------------------------------------------
  const before = await switches();
  check("before anything: the founder's memberships switch is off", before.memberships === "off", before.memberships);
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
