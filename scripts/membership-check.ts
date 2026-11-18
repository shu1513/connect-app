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
