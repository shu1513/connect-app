/**
 * Testing tool: plays a host, contributors and the founder through the money of a contribution
 * against the Stripe sandbox and the local database, and checks every result (plans/25, part 2a).
 * No real money moves.
 *
 * Nothing that starts a contribution exists yet (that is part 2b), so this script puts its test
 * contributions straight into the database at the card step, and then uses the real code for
 * everything else. It uses a pretend "now" so nothing has to wait. Where the code measures age on
 * the real clock, the script makes the written record old.
 *
 * It works on this computer's test database only, makes its own people (their ids start "ctb-"),
 * sets the founder's projects switch for its journeys, and at the end puts the switch back and
 * removes everything it made. It must have the test database to itself while it runs.
 *
 * Usage: npx tsx scripts/contribution-check.ts            (everything)
 *        npx tsx scripts/contribution-check.ts --only=3   (one journey)
 *        npx tsx scripts/contribution-check.ts --payouts  (also collecting; needs the test host's payout account)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { requireLocalDatabase } from "./local-only";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${!ok && detail !== "" ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  // The jobs below act on every contribution in the database, with a pretend "now". Never run them on shared data.
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { stripeCustomerFor } = await import("../src/lib/payments/hold");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { reconcileOperations } = await import("../src/lib/payments/jobs");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { unsentEarnings, collectEarnings } = await import("../src/lib/payments/collect");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { healthProblems } = await import("../src/lib/health");
  const { startProject, runningProjectOf } = await import("../src/lib/projects/projects");
  const C = await import("../src/lib/contributions/charge");
  const R = await import("../src/lib/contributions/refund");
  const D = await import("../src/lib/contributions/dispute");
  const E = await import("../src/lib/contributions/ending");
  const F = await import("../src/lib/contributions/founder");
  const Cards = await import("../src/lib/contributions/cards");
  const { runContributionJobs } = await import("../src/lib/contributions/jobs");
  const { ContributionError, CONTRIBUTION } = await import("../src/lib/contributions/rules");
  const MemberCards = await import("../src/lib/membership/cards");

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const RUN = randomUUID().slice(0, 8);
  const pays = schema.contributionPayments;
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",").map(Number);
  type Person = { id: string; name: string; email: string };
  let made = 0;

  // ------------------------------------------------------------------------
  // Making people, hosts and contributions
  // ------------------------------------------------------------------------
  async function person(kind: string): Promise<Person> {
    const id = `ctb-${RUN}-${++made}-${kind}`;
    const stamp = new Date();
    const row = { id, name: `Contribution check ${kind} ${made}`, email: `contributioncheck-${RUN}-${made}@example.test` };
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
    return row;
  }
  /** A host whose page is approved, with a running project. */
  async function newHost(): Promise<Person> {
    const p = await person("host");
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `ctb${RUN}${made}`, handleKey: `ctb${RUN}${made}`, displayName: `Host ${made}`, pricePer15Cents: 1000, status: "approved", usConfirmedAt: new Date() });
    // (Marked as able to be paid: a payout account cannot be made ready from a script. Only the collecting journey sends money, and it borrows the real test account.)
    await db.insert(schema.hostSettings).values({ userId: p.id, payoutsReady: true }).onConflictDoNothing();
    await startProject({ hostId: p.id, name: "A film about the sea", description: "", now: new Date() });
    return p;
  }
  type Made = { host: Person; giver: Person; contributionId: string; paymentId: string };
  /** A contribution at the card step: written straight into the database, with its first payment. */
  async function atCardStep(host: Person, opts: { kind?: "once" | "monthly"; amountCents?: number; giver?: Person; cardStepMs?: number } = {}): Promise<Made> {
    const giver = opts.giver ?? (await person("giver"));
    const project = (await runningProjectOf(host.id))!;
    return db.transaction(async (tx) => {
      const [c] = await tx.insert(schema.contributions).values({ projectId: project.id, hostId: host.id, contributorId: giver.id, kind: opts.kind ?? "once", amountCents: opts.amountCents ?? 2500, requestKey: randomUUID() }).returning();
      const payment = await C.writeDownPayment(tx, c, { number: 1, originKey: `first:${c.id}`, cardStepExpiresAt: new Date(Date.now() + (opts.cardStepMs ?? 30 * MIN)) }, new Date());
      return { host, giver, contributionId: c.id, paymentId: payment.id };
    });
  }
  const RETURN = "https://example.com/return";
  /** The contributor's own payment reaches Stripe, and we have not heard of it yet. */
  async function confirmOnly(paymentId: string, card = "pm_card_visa") {
    const found = await C.intentFor(paymentId);
    if (!found) return false;
    await stripe().paymentIntents.confirm(found.intentId, { payment_method: card, return_url: RETURN }).catch(() => undefined);
    return true;
  }
  /** Pays a payment the way the contributor's browser would, with one of Stripe's test cards. */
  async function pay(paymentId: string, card = "pm_card_visa") {
    await confirmOnly(paymentId, card);
    return C.syncPayment(paymentId, new Date());
  }
  /** A contribution whose first payment is held. */
  async function held(host: Person, opts: Parameters<typeof atCardStep>[1] & { card?: string } = {}): Promise<Made> {
    const m = await atCardStep(host, opts);
    await pay(m.paymentId, opts.card);
    return m;
  }
  /** A contribution whose first payment is taken, at its own moment. Returns that moment too. */
  async function taken(host: Person, opts: Parameters<typeof held>[1] = {}): Promise<Made & { at: Date }> {
    const m = await held(host, opts);
    const at = (await PM(m.paymentId)).takeAt!;
    await C.takePayment(m.paymentId, at);
    return { ...m, at };
  }
  /** Writes down the next month of a monthly contribution, to be tried with the saved card at once. */
  async function nextMonth(m: Made, number: number, now: Date): Promise<string> {
    return db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.contributions).where(eq(schema.contributions.id, m.contributionId)).for("update");
      return (await C.writeDownPayment(tx, c, { number, originKey: `month:${c.id}:${number}`, tryNow: true }, now)).id;
    });
  }
  /** Replaces the contribution's saved card with another of Stripe's test cards (one that fails later, for example). */
  async function saveCard(m: Made, testCard: string): Promise<string> {
    const customer = await stripeCustomerFor(m.giver);
    const method = await stripe().paymentMethods.attach(testCard, { customer });
    await db.update(schema.contributionCards).set({ retiredAt: new Date() }).where(and(eq(schema.contributionCards.contributionId, m.contributionId), sql`${schema.contributionCards.retiredAt} is null`));
    await db.insert(schema.contributionCards).values({ contributionId: m.contributionId, stripePaymentMethodId: method.id, savedAt: new Date() });
    return method.id;
  }

  // ------------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------------
  const PM = async (id: string) => (await db.select().from(pays).where(eq(pays.id, id)))[0];
  const CO = async (id: string) => (await db.select().from(schema.contributions).where(eq(schema.contributions.id, id)))[0];
  const shareOf = async (paymentId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.contributionPaymentId, paymentId)))[0];
  const intentOf = async (paymentId: string) => stripe().paymentIntents.retrieve((await PM(paymentId)).stripePaymentIntentId!);
  const refundsOf = (paymentId: string) => db.select().from(schema.contributionRefunds).where(eq(schema.contributionRefunds.contributionPaymentId, paymentId)).orderBy(schema.contributionRefunds.createdAt);
  const ledger = async (owner: { contributionPaymentId: string } | { paymentId: string }, kind?: string) => {
    const mine = "paymentId" in owner ? eq(schema.ledgerEntries.paymentId, owner.paymentId) : eq(schema.ledgerEntries.contributionPaymentId, owner.contributionPaymentId);
    const [row] = await db.select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amountCents}), 0)::int`, lines: sql<number>`count(*)::int` }).from(schema.ledgerEntries).where(kind ? and(mine, eq(schema.ledgerEntries.kind, kind)) : mine);
    return row;
  };
  const operations = (paymentId: string, kind?: string) =>
    db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.contributionPaymentId, paymentId), kind ? eq(schema.moneyOperations.kind, kind) : undefined)).orderBy(schema.moneyOperations.createdAt);
  /** The words a refusal came with, or null when the thing went through. */
  async function refusal(work: Promise<unknown>): Promise<string | null> {
    try {
      await work;
      return null;
    } catch (error) {
      if (error instanceof ContributionError || error instanceof MoneyError) return error.message;
      throw error;
    }
  }
  /** Makes a written-down action look as old as the helper needs before it looks at it. */
  const age = (operationId: string, ms: number) => db.update(schema.moneyOperations).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.moneyOperations.id, operationId));

  // ------------------------------------------------------------------------
  // Cleaning up: only this script's own people (ids starting "ctb-")
  // ------------------------------------------------------------------------
  /** If an earlier run stopped while one of its hosts held the test payout account, the seeded host gets it back before anything is deleted. */
  async function payoutAccountBack() {
    const [holder] = await db.select().from(schema.hostSettings).where(and(like(schema.hostSettings.userId, "ctb-%"), sql`${schema.hostSettings.stripeAccountId} is not null`));
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
    const mine = like(schema.user.id, everything ? "ctb-%" : `ctb-${RUN}-%`);
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(mine)).map((row) => row.id);
    if (ids.length === 0) return;
    const contributionIds = (await db.select({ id: schema.contributions.id }).from(schema.contributions).where(or(inArray(schema.contributions.hostId, ids), inArray(schema.contributions.contributorId, ids)))).map((row) => row.id);
    const cpIds = contributionIds.length ? (await db.select({ id: pays.id }).from(pays).where(inArray(pays.contributionId, contributionIds))).map((row) => row.id) : [];
    const shareIds = cpIds.length ? (await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.contributionPaymentId, cpIds))).map((row) => row.id) : [];
    await db.delete(schema.collectionItems).where(inArray(schema.collectionItems.collectionId, db.select({ id: schema.collections.id }).from(schema.collections).where(inArray(schema.collections.hostId, ids))));
    await db.delete(schema.collections).where(inArray(schema.collections.hostId, ids));
    if (shareIds.length) {
      await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, shareIds));
      await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, shareIds));
      await db.delete(schema.payments).where(inArray(schema.payments.id, shareIds));
    }
    if (cpIds.length) {
      await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.contributionPaymentId, cpIds));
      await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.contributionPaymentId, cpIds));
      await db.delete(schema.contributionRefunds).where(inArray(schema.contributionRefunds.contributionPaymentId, cpIds));
      await db.delete(pays).where(inArray(pays.id, cpIds));
    }
    if (contributionIds.length) {
      await db.delete(schema.contributionCards).where(inArray(schema.contributionCards.contributionId, contributionIds));
      await db.delete(schema.contributionAgreements).where(inArray(schema.contributionAgreements.contributionId, contributionIds));
      await db.delete(schema.contributions).where(inArray(schema.contributions.id, contributionIds));
    }
    await db.delete(schema.adminActions).where(or(inArray(schema.adminActions.adminId, ids), inArray(schema.adminActions.targetUserId, ids)));
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    if (projectIds.length) await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds));
    await db.delete(schema.projects).where(inArray(schema.projects.hostId, ids));
    await db.delete(schema.membershipCards).where(inArray(schema.membershipCards.membershipId, db.select({ id: schema.memberships.id }).from(schema.memberships).where(inArray(schema.memberships.hostId, ids))));
    await db.delete(schema.memberships).where(inArray(schema.memberships.hostId, ids));
    await db.delete(schema.admins).where(inArray(schema.admins.userId, ids));
    await db.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids));
    await db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.user).where(mine);
  }

  const journeys: Array<[string, () => Promise<void>]> = [];
  const journey = (title: string, run: () => Promise<void>) => journeys.push([title, run]);

  // ========================================================================
  journey("A contribution made once: held, then taken at its moment, and the host's share written with its 7 days", async () => {
    const host = await newHost();
    const m = await atCardStep(host, { amountCents: 2500 });
    let p = await PM(m.paymentId);
    check("written down before anything is asked of Stripe: to be paid, with the fee terms of that moment", p.status === "to_pay" && p.amountCents === 2500 && p.stripePaymentIntentId === null && p.feePercentBps === 490 && p.feeFixedCents === 30);
    p = await pay(m.paymentId);
    const intent = await intentOf(m.paymentId);
    check("the card step puts a hold in place: nothing is taken, and the contribution runs", p.status === "held" && intent.status === "requires_capture" && intent.amount_received === 0 && (await CO(m.contributionId)).status === "running", { status: p.status, intent: intent.status, problem: p.problem, endedHow: p.endedHow });
    check("the payment at Stripe carries its own id under a name of its own, is held first, and does not keep the card of a contribution made once", intent.metadata.contributionPaymentId === m.paymentId && intent.capture_method === "manual" && intent.setup_future_usage === null && intent.transfer_group === m.paymentId);
    check("the money is to be taken 72 hours and 3 minutes after the bank's own time for the hold", p.authorisedAt !== null && p.takeAt?.getTime() === p.authorisedAt.getTime() + 72 * HOUR + 3 * MIN, { authorisedAt: p.authorisedAt, takeAt: p.takeAt });
    check("the end of the hold is Stripe's own answer, and the last moment to take it is one hour before that", p.holdExpiresAt !== null && p.takeBy?.getTime() === p.holdExpiresAt.getTime() - HOUR && p.takeBy > p.takeAt!, { holdExpiresAt: p.holdExpiresAt, takeBy: p.takeBy });
    check("a second look at Stripe changes nothing", (await C.syncPayment(m.paymentId, new Date())).status === "held" && (await operations(m.paymentId)).length === 0);

    const early = await C.takePayment(m.paymentId, new Date(p.takeAt!.getTime() - 1000));
    check("a second before its moment nothing is taken", early.status === "held" && (await intentOf(m.paymentId)).status === "requires_capture");
    const at = p.takeAt!;
    p = await C.takePayment(m.paymentId, at);
    const after = await intentOf(m.paymentId);
    check("at its moment the money is taken, whole", p.status === "taken" && p.takenCents === 2500 && after.status === "succeeded" && after.amount_received === 2500, { status: p.status, intent: after.status });
    check("the moment kept is the pretended day that was handed in (it lies ahead of the real clock)", p.takenAt?.getTime() === at.getTime());
    const share = await shareOf(m.paymentId);
    // $25.00 at 4.9% plus 30 cents: $1.2250 rounds to $1.23, plus $0.30 is $1.53; the host's share is $23.47.
    check("the host's share is one line among her earnings: $23.47 of $25.00, our fee $1.53", share?.kind === "contribution" && share.chargedCents === 2500 && share.originalFeeCents === 153 && share.originalHostShareCents === 2347 && share.status === "charged" && share.callId === null && share.monthId === null && share.stripePaymentIntentId === null && share.stripeChargeId === p.stripeChargeId, share && { fee: share.originalFeeCents, hostShare: share.originalHostShareCents });
    check("it can be collected 7 days after the taking", share?.transferStatus === "not_due" && share.transferDueAt?.getTime() === at.getTime() + 7 * DAY);
    check("what the contributor paid is written once, under the contribution's payment; the fee and her share under the share's line", (await ledger({ contributionPaymentId: m.paymentId })).total === 2500 && (await ledger({ contributionPaymentId: m.paymentId }, "customer_charge")).lines === 1 && (await ledger({ paymentId: share.id }, "platform_fee")).total === 153 && (await ledger({ paymentId: share.id }, "host_share")).total === 2347 && (await ledger({ paymentId: share.id }, "customer_charge")).lines === 0);
    check("a contribution made once has nothing more to come: it is ended as paid", (await CO(m.contributionId)).status === "ended" && (await CO(m.contributionId)).endedHow === "paid");
    await C.takePayment(m.paymentId, new Date(at.getTime() + HOUR));
    await C.syncPayment(m.paymentId, new Date(at.getTime() + HOUR));
    check("taking again, and looking again, change nothing: one taking, one share", (await ledger({ contributionPaymentId: m.paymentId }, "customer_charge")).lines === 1 && (await db.select().from(schema.payments).where(eq(schema.payments.contributionPaymentId, m.paymentId))).length === 1 && (await operations(m.paymentId, "capture")).length === 1);
    const earnings = await unsentEarnings(new Date(at.getTime() + DAY), host.id);
    check("the host sees it among her earnings, not ready yet, as a contribution to her project", earnings.length === 1 && earnings[0].heldBack === "not_yet" && earnings[0].project === "A film about the sea" && earnings[0].shareCents === 2347);
    check("and ready 7 days after the taking", (await unsentEarnings(new Date(at.getTime() + 7 * DAY), host.id))[0]?.heldBack === null);
    // A message from Stripe about this payment finds its way by the id it carries.
    await handleStripeEvent({ type: "payment_intent.succeeded", data: { object: { id: p.stripePaymentIntentId, metadata: { contributionPaymentId: m.paymentId } } } });
    check("a message from Stripe about it changes nothing either", (await PM(m.paymentId)).status === "taken");
  });

  // ========================================================================
  journey("Cancelling while it is held, and the race with the taking", async () => {
    const host = await newHost();
    const a = await held(host);
    let p = await C.giveUp(a.paymentId, "cancelled", new Date());
    check("cancelled while held: the hold is let go at Stripe, nothing is charged, and the payment is given up with its reason", p.status === "given_up" && p.endedHow === "cancelled" && (await intentOf(a.paymentId)).status === "canceled" && (await ledger({ contributionPaymentId: a.paymentId })).lines === 0);
    check("a contribution made once ends with its only payment, and no share is ever written", (await CO(a.contributionId)).status === "ended" && (await shareOf(a.paymentId)) === undefined);
    check("its money can never be taken afterwards", (await C.takePayment(a.paymentId, new Date(Date.now() + 4 * DAY))).status === "given_up" && (await operations(a.paymentId, "capture")).length === 0);
    await C.giveUp(a.paymentId, "cancelled", new Date());
    check("cancelling twice is one cancellation", (await operations(a.paymentId, "release")).length === 1);

    // The money is taken at Stripe at the very moment the contributor cancels: the cancelling learns of it.
    const b = await held(host);
    await stripe().paymentIntents.capture((await PM(b.paymentId)).stripePaymentIntentId!);
    p = await C.giveUp(b.paymentId, "cancelled", new Date());
    const owed = await refundsOf(b.paymentId);
    check("a cancellation that lost the race with the taking: the payment is recorded as taken, and all of it is owed back", p.status === "taken" && p.endedHow === "cancelled" && p.takenCents === 2500 && owed.length === 1 && owed[0].amountCents === 2500 && owed[0].status === "owed" && owed[0].decidedBy === "app");
    check("no share is written for the host from money that is going back", (await shareOf(b.paymentId)) === undefined);
    await R.runRefunds(new Date());
    const done = (await refundsOf(b.paymentId))[0];
    check("the helper sends that refund, in full", done.status === "done" && Boolean(done.stripeRefundId) && (await stripe().refunds.retrieve(done.stripeRefundId!)).amount === 2500, done);
    check("the books: charged $25.00, refunded $25.00, nothing left", (await ledger({ contributionPaymentId: b.paymentId })).total === 0 && (await PM(b.paymentId)).refundedCents === 2500);
    await R.runRefunds(new Date());
    check("it is sent once", (await stripe().refunds.list({ payment_intent: (await PM(b.paymentId)).stripePaymentIntentId!, limit: 10 })).data.length === 1);
  });

  // ========================================================================
  journey("The card step: it runs out, and a hold that arrived in time counts", async () => {
    const host = await newHost();
    const a = await atCardStep(host, { cardStepMs: -MIN });
    await runContributionJobs(new Date());
    check("no hold by the end of the card step: the contribution is undone and nothing is charged", (await PM(a.paymentId)).status === "given_up" && (await PM(a.paymentId)).endedHow === "card_step" && (await CO(a.contributionId)).status === "ended");
    check("its lines stay, so a hold that arrives late is recognised", Boolean(await PM(a.paymentId)) && Boolean(await CO(a.contributionId)));

    const b = await atCardStep(host);
    await confirmOnly(b.paymentId);
    await db.update(pays).set({ cardStepExpiresAt: new Date(Date.now() + 2 * MIN) }).where(eq(pays.id, b.paymentId));
    await runContributionJobs(new Date(Date.now() + 5 * MIN));
    check("a hold the bank placed in time counts, also when the helper only learns of it after the card step's end", (await PM(b.paymentId)).status === "held");

    const c = await atCardStep(host);
    await C.intentFor(c.paymentId);
    await db.update(pays).set({ cardStepExpiresAt: new Date(Date.now() - 10 * MIN) }).where(eq(pays.id, c.paymentId));
    await stripe().paymentIntents.confirm((await PM(c.paymentId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
    const late = await C.syncPayment(c.paymentId, new Date());
    check("a hold placed after the card step's end is not accepted: it is let go, and nothing is charged", late.status === "given_up" && late.endedHow === "card_step" && (await intentOf(c.paymentId)).status === "canceled");
  });

  // ========================================================================
  journey("A monthly contribution: the card is kept, later months use it, and what a failing card does", async () => {
    const host = await newHost();
    const m = await held(host, { kind: "monthly", amountCents: 1000 });
    const first = await PM(m.paymentId);
    const c = await CO(m.contributionId);
    const card = await Cards.cardInUse(db, m.contributionId);
    check("the first payment keeps the card for the months that follow", (await intentOf(m.paymentId)).setup_future_usage === "off_session" && card !== null && first.cardId === card.id);
    check("the moment of the first hold is the contribution's day of the month", c.status === "running" && c.firstHoldAt?.getTime() === first.authorisedAt?.getTime() && c.lastWrittenMonth === 1);
    await C.takePayment(m.paymentId, first.takeAt!);
    check("after its first month is taken a monthly contribution goes on running", (await PM(m.paymentId)).status === "taken" && (await CO(m.contributionId)).status === "running");

    const T = new Date(first.takeAt!.getTime() + 27 * DAY);
    const second = await nextMonth(m, 2, T);
    check("the next month's payment exists once, however often it is written down", (await nextMonth(m, 2, T)) === second && (await CO(m.contributionId)).lastWrittenMonth === 2);
    let p = await C.tryHold(second, T);
    check("the next month is held on the saved card, in the background", p.status === "held" && (await intentOf(second)).status === "requires_capture" && (await operations(second, "hold")).length === 1, { status: p.status, problem: p.problem });
    await C.tryHold(second, T);
    check("trying again changes nothing: one try, one hold", (await operations(second, "hold")).length === 1);
    await C.takePayment(second, (await PM(second)).takeAt!);
    check("and taken three days after that month's hold", (await PM(second)).status === "taken" && (await shareOf(second))?.originalHostShareCents === 921);

    // A card that is saved and then fails.
    await saveCard(m, "pm_card_chargeCustomerFail");
    const third = await nextMonth(m, 3, T);
    p = await C.tryHold(third, T);
    check("a saved card that fails: no hold; the try is counted, the next one is a day later, and the 7 days start", p.status === "to_pay" && p.try === 2 && p.firstFailedAt?.getTime() === T.getTime() && p.nextTryAt?.getTime() === T.getTime() + DAY && p.giveUpAt?.getTime() === T.getTime() + 7 * DAY && !p.needsAction, { status: p.status, try: p.try, nextTryAt: p.nextTryAt });
    check("the contribution goes on for now", (await CO(m.contributionId)).status === "running");
    await C.tryHold(third, new Date(T.getTime() + HOUR));
    check("nothing is tried before the next try's day", (await operations(third, "hold")).length === 1);
    p = await C.tryHold(third, new Date(T.getTime() + DAY));
    check("the second try, a day later, fails too: the third is on day 3", p.try === 3 && p.nextTryAt?.getTime() === T.getTime() + 3 * DAY && (await operations(third, "hold")).length === 2);
    // The contributor pays by hand on day six, with a card that works.
    await stripe().paymentIntents.confirm(p.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
    p = await C.syncPayment(third, new Date(T.getTime() + 6 * DAY));
    check("a hold that is found on day six, inside the 7 days, counts, and is to be taken three days after the bank's own time for it", p.status === "held" && p.takeAt?.getTime() === p.authorisedAt!.getTime() + 72 * HOUR + 3 * MIN && p.giveUpAt === null && p.nextTryAt === null);
    check("a try that succeeds late does not move the contribution's day", (await CO(m.contributionId)).firstHoldAt?.getTime() === first.authorisedAt?.getTime());
    await C.giveUp(third, "skipped", new Date());
    check("letting one month's hold go skips that month: the contribution goes on", (await PM(third)).status === "given_up" && (await CO(m.contributionId)).status === "running");

    // Seven days without a hold.
    await saveCard(m, "pm_card_chargeCustomerFail");
    const fourth = await nextMonth(m, 4, T);
    await C.tryHold(fourth, T);
    await runContributionJobs(new Date(T.getTime() + 7 * DAY + MIN));
    p = await PM(fourth);
    check("after 7 days without a hold the monthly contribution is stopped, and the month that was not paid is simply not paid", p.status === "given_up" && p.endedHow === "given_up" && (await CO(m.contributionId)).status === "ended" && (await CO(m.contributionId)).endedHow === "given_up", { status: p.status, endedHow: p.endedHow });
    check("its card is retired, and nothing more is ever tried", (await Cards.cardInUse(db, m.contributionId)) === null && (await C.tryHold(fourth, new Date(T.getTime() + 9 * DAY))).status === "given_up");
  });

  // ========================================================================
  journey("A bank that wants a confirmation, a card that is gone, and a bank that says never again", async () => {
    const host = await newHost();
    const T = new Date(Date.now() + 30 * DAY);
    const a = await held(host, { kind: "monthly", amountCents: 1000 });
    await saveCard(a, "pm_card_authenticationRequired");
    const second = await nextMonth(a, 2, T);
    let p = await C.tryHold(second, T);
    check("the bank wants the contributor to confirm: that is not a hold, and it is marked so", p.status === "to_pay" && p.needsAction && p.try === 2, { status: p.status, needsAction: p.needsAction });
    const stillSame = p.stripePaymentIntentId;
    await stripe().paymentIntents.confirm(p.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
    p = await C.syncPayment(second, new Date(T.getTime() + HOUR));
    check("confirming opens that same payment, never a new one; the three days start when the hold is in place", p.status === "held" && p.stripePaymentIntentId === stillSame && !p.needsAction);

    const b = await held(host, { kind: "monthly", amountCents: 1000 });
    await db.update(schema.contributionCards).set({ retiredAt: new Date() }).where(eq(schema.contributionCards.contributionId, b.contributionId));
    const noCard = await nextMonth(b, 2, T);
    await C.tryHold(noCard, T);
    check("the saved card is gone: the monthly contribution ends, and its payments that are not taken are let go", (await CO(b.contributionId)).endedHow === "card_gone" && (await PM(noCard)).status === "given_up" && (await PM(b.paymentId)).status === "given_up" && (await intentOf(b.paymentId)).status === "canceled");

    // The bank says not to try this card again. Stripe has no saved test card that says so later, so its answer is handed in by hand.
    const c = await held(host, { kind: "monthly", amountCents: 1000 });
    const never = await nextMonth(c, 2, T);
    const found = (await C.intentFor(never, T))!;
    await db.insert(schema.moneyOperations).values({ contributionPaymentId: never, kind: "hold", label: `contributionhold:${never}:1:1`, params: "{}", status: "failed", finishedAt: new Date(Date.now() - MIN) });
    const real = await stripe().paymentIntents.retrieve(found.intentId, { expand: ["latest_charge", "payment_method"] });
    const refused = { ...real, status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "lost_card" } } as unknown as Stripe.PaymentIntent;
    await C.recordIntent(await PM(never), refused, T, { holdEndsAt: null });
    check("the bank says never again: the monthly contribution ends at once, and nothing is tried again", (await CO(c.contributionId)).endedHow === "never_again" && (await PM(never)).endedHow === "never_again" && (await C.tryHold(never, new Date(T.getTime() + DAY))).status === "given_up");
  });

  // ========================================================================
  journey("A hold that is lost, a hold whose end Stripe does not say, and the last moment", async () => {
    const host = await newHost();
    const a = await held(host, { kind: "monthly", amountCents: 1000 });
    await stripe().paymentIntents.cancel((await PM(a.paymentId)).stripePaymentIntentId!);
    let p = await C.syncPayment(a.paymentId, new Date());
    check("the bank lets a hold go: the payment is given up as lost, and no new hold is placed for it", p.status === "given_up" && p.endedHow === "hold_lost" && (await db.select().from(pays).where(eq(pays.contributionId, a.contributionId))).length === 1);

    // Stripe not saying when a hold ends: its answer is handed in without that date.
    const b = await atCardStep(host);
    await confirmOnly(b.paymentId);
    const intent = await stripe().paymentIntents.retrieve((await PM(b.paymentId)).stripePaymentIntentId!, { expand: ["latest_charge", "payment_method"] });
    await C.recordIntent(await PM(b.paymentId), intent, new Date(), { holdEndsAt: null });
    p = await PM(b.paymentId);
    check("Stripe does not say when a hold ends: no date is assumed, the hold is let go, and the founder is shown it", p.status === "given_up" && p.endedHow === "no_hold_end" && Boolean(p.problem) && p.takeAt === null && (await intentOf(b.paymentId)).status === "canceled", { status: p.status, endedHow: p.endedHow });

    const edge = await held(host);
    check("at its own last moment the money is still taken", (await C.takePayment(edge.paymentId, (await PM(edge.paymentId)).takeBy!)).status === "taken");
    const c = await held(host);
    const held3 = await PM(c.paymentId);
    p = await C.takePayment(c.paymentId, new Date(held3.takeBy!.getTime() + 1000));
    check("a second after the last moment the money is not taken: the payment is given up as not taken in time, and its hold let go", p.status === "given_up" && p.endedHow === "not_taken_in_time" && (await intentOf(c.paymentId)).status === "canceled" && (await ledger({ contributionPaymentId: c.paymentId })).lines === 0);
    const d = await held(host);
    await runContributionJobs(new Date((await PM(d.paymentId)).takeBy!.getTime() + HOUR));
    check("a helper that comes too late does the same, by itself", (await PM(d.paymentId)).endedHow === "not_taken_in_time" && (await PM(d.paymentId)).status === "given_up");
    const e = await held(host);
    await runContributionJobs(new Date((await PM(e.paymentId)).takeAt!.getTime() + 2 * HOUR));
    check("a helper that is late but in time still takes the money", (await PM(e.paymentId)).status === "taken");

    // The helper hands in the moment its round began, which can be minutes old. The real clock decides.
    const stale = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - 2 * HOUR), takeBy: new Date(Date.now() - 1000) }).where(eq(pays.id, stale.paymentId));
    p = await C.takePayment(stale.paymentId, new Date(Date.now() - 10 * MIN));
    check("a round that began before the last moment and reaches the payment after it does not take the money", p.status === "given_up" && p.endedHow === "not_taken_in_time" && (await intentOf(stale.paymentId)).amount_received === 0);
    const slow = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - HOUR) }).where(eq(pays.id, slow.paymentId));
    const began = Date.now();
    p = await C.takePayment(slow.paymentId, new Date(began - 30 * MIN));
    check("the moment a taking is recorded at is read after Stripe has answered, never the moment the round began", p.status === "taken" && p.takenAt!.getTime() >= began && (await shareOf(slow.paymentId)).transferDueAt!.getTime() === p.takenAt!.getTime() + 7 * DAY, { takenAt: p.takenAt, began: new Date(began) });
    // The last moment goes by between the decision to take and the request to Stripe (the script holds the request back for that).
    const gap = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - HOUR), takeBy: new Date(Date.now() + 2000) }).where(eq(pays.id, gap.paymentId));
    p = await C.takePayment(gap.paymentId, undefined, { beforeDispatch: () => new Promise((resolve) => setTimeout(resolve, 3500)) });
    const gapOps = await operations(gap.paymentId, "capture");
    check("the clock is looked at once more at the very moment before Stripe is asked: too late by then, nothing is sent, and the payment is given up and let go", p.status === "given_up" && p.endedHow === "not_taken_in_time" && gapOps.length === 1 && gapOps[0].status === "failed" && (await intentOf(gap.paymentId)).status === "canceled" && (await intentOf(gap.paymentId)).amount_received === 0, { status: p.status, endedHow: p.endedHow, ops: gapOps.map((o) => o.status) });
    // And the moment that is recorded is read after Stripe's answer, not just before the request.
    const answered = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - HOUR) }).where(eq(pays.id, answered.paymentId));
    let sentAt = 0;
    p = await C.takePayment(answered.paymentId, undefined, { beforeDispatch: async () => void (sentAt = Date.now()) });
    check("the recorded moment of a taking is later than the moment the request left: it is read after Stripe answered", p.status === "taken" && sentAt > 0 && p.takenAt!.getTime() - sentAt >= 50, { ms: p.takenAt ? p.takenAt.getTime() - sentAt : null });

    const heard = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - HOUR) }).where(eq(pays.id, heard.paymentId));
    await stripe().paymentIntents.capture((await PM(heard.paymentId)).stripePaymentIntentId!);
    const asked = Date.now();
    p = await C.syncPayment(heard.paymentId, new Date(asked - 30 * MIN));
    check("the same when a taking is learned of by looking at Stripe", p.status === "taken" && p.takenAt!.getTime() >= asked);
  });

  // ========================================================================
  journey("Interruptions (a payment asked for, a taking, a letting-go, a refund) are finished by the helper, without a second charge", async () => {
    const host = await newHost();
    // Asked for at Stripe, and the id never saved.
    const a = await atCardStep(host);
    const made1 = (await C.intentFor(a.paymentId))!;
    await db.update(pays).set({ stripePaymentIntentId: null }).where(eq(pays.id, a.paymentId));
    const again = (await C.intentFor(a.paymentId))!;
    check("a payment asked for whose id was never saved: asked again under the same name, Stripe gives the same one", again.intentId === made1.intentId && (await PM(a.paymentId)).stripePaymentIntentId === made1.intentId);
    await db.update(pays).set({ stripePaymentIntentId: null, intentRequestedAt: new Date(Date.now() - 24 * HOUR) }).where(eq(pays.id, a.paymentId));
    check("and when that is too old to send again, it is found in Stripe's own list", (await C.intentFor(a.paymentId))?.intentId === made1.intentId);

    // After a stop a claim is never sent again, and a PaymentIntent that arrives late for a payment already written off is cancelled.
    const lateOne = await atCardStep(host);
    const lateIntent = (await C.intentFor(lateOne.paymentId))!;
    await db.update(pays).set({ stripePaymentIntentId: null, endedHow: "cancelled", status: "given_up" }).where(eq(pays.id, lateOne.paymentId));
    const countBefore = (await stripe().paymentIntents.list({ customer: await stripeCustomerFor(lateOne.giver), limit: 10 })).data.length;
    check("a stopped payment's request is not sent again: Stripe is only asked what was made, and that one is cancelled", (await C.intentFor(lateOne.paymentId)) === null && (await stripe().paymentIntents.list({ customer: await stripeCustomerFor(lateOne.giver), limit: 10 })).data.length === countBefore && (await stripe().paymentIntents.retrieve(lateIntent.intentId)).status === "canceled" && (await PM(lateOne.paymentId)).stripePaymentIntentId === lateIntent.intentId);
    const lateOps = await operations(lateOne.paymentId, "release");
    check("that cancellation is a letting-go written down first, like every other, and the payment is given up again once Stripe has answered", (await PM(lateOne.paymentId)).status === "given_up" && lateOps.length === 1 && lateOps[0].status === "succeeded", { status: (await PM(lateOne.paymentId)).status, ops: lateOps.map((o) => o.status) });
    // A stopped payment whose request may still be on its way: Stripe's list showing none is not believed yet.
    check("every asking for a PaymentIntent writes its moment down first", (await PM(lateOne.paymentId)).intentAskedAt !== null && (await PM(lateOne.paymentId)).intentAskedAt!.getTime() >= (await PM(lateOne.paymentId)).intentRequestedAt!.getTime());
    const onItsWay = await atCardStep(host);
    const longAgo = new Date(Date.now() - C.CLAIM_ON_ITS_WAY_MS - 60_000);
    // First asked long ago, asked again a moment ago, then stopped.
    await db.update(pays).set({ intentRequestedAt: longAgo, intentAskedAt: new Date(), intentRequest: JSON.stringify({ customer: await stripeCustomerFor(onItsWay.giver) }), endedHow: "cancelled" }).where(eq(pays.id, onItsWay.paymentId));
    const firstAnswer = await C.intentFor(onItsWay.paymentId);
    const waiting = await PM(onItsWay.paymentId);
    await db.update(pays).set({ intentAskedAt: longAgo }).where(eq(pays.id, onItsWay.paymentId));
    await runContributionJobs(new Date());
    check("a stopped payment that was asked for again a moment ago is not written off when Stripe's list shows none, however old its first asking; it is once the last asking is 8 minutes old", firstAnswer === null && waiting.status === "to_pay" && waiting.stripePaymentIntentId === null && (await PM(onItsWay.paymentId)).status === "given_up", { then: waiting.status, now: (await PM(onItsWay.paymentId)).status });
    // The process stops right after the late PaymentIntent's id was saved (what that step leaves is put in by hand).
    const cutOff = await atCardStep(host);
    const cutIntent = (await C.intentFor(cutOff.paymentId))!;
    await db.update(pays).set({ endedHow: "cancelled", status: "to_pay" }).where(eq(pays.id, cutOff.paymentId));
    await runContributionJobs(new Date());
    check("and if the app stops right after saving a late PaymentIntent's id, the helper cancels it on its next round", (await stripe().paymentIntents.retrieve(cutIntent.intentId)).status === "canceled" && (await PM(cutOff.paymentId)).status === "given_up");

    // The taking was written down, and Stripe was never asked.
    const b = await held(host);
    const at = (await PM(b.paymentId)).takeAt!;
    const [op1] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: b.paymentId, kind: "capture", label: `contributioncapture:${b.paymentId}:1`, params: JSON.stringify({ intentId: (await PM(b.paymentId)).stripePaymentIntentId, amountCents: 2500 }) }).returning();
    await age(op1.id, 2 * MIN);
    await reconcileOperations(at);
    check("a taking that was written down and never sent: the helper sends it under the same name, and it is taken once", (await PM(b.paymentId)).status === "taken" && (await ledger({ contributionPaymentId: b.paymentId }, "customer_charge")).lines === 1 && (await operations(b.paymentId, "capture")).every((o) => o.status === "succeeded") && (await shareOf(b.paymentId))?.originalHostShareCents === 2347, (await operations(b.paymentId)).map((o) => `${o.kind}:${o.status}`));

    // The taking went through at Stripe, and the answer never arrived.
    const c = await held(host);
    const at2 = (await PM(c.paymentId)).takeAt!;
    const label = `contributioncapture:${c.paymentId}:1`;
    const [op2] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: c.paymentId, kind: "capture", label, params: JSON.stringify({ intentId: (await PM(c.paymentId)).stripePaymentIntentId, amountCents: 2500 }) }).returning();
    await stripe().paymentIntents.capture((await PM(c.paymentId)).stripePaymentIntentId!, { amount_to_capture: 2500 }, { idempotencyKey: label });
    await age(op2.id, 2 * MIN);
    await reconcileOperations(at2);
    check("a taking that went through unheard: recorded once, with the host's share", (await PM(c.paymentId)).status === "taken" && (await shareOf(c.paymentId))?.originalHostShareCents === 2347 && (await stripe().paymentIntents.retrieve((await PM(c.paymentId)).stripePaymentIntentId!)).amount_received === 2500);

    // Recovery after a stop: a taking was written down, the payment was given up meanwhile, and Stripe never took it.
    const d = await held(host);
    const [op3] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: d.paymentId, kind: "capture", label: `contributioncapture:${d.paymentId}:1`, params: JSON.stringify({ intentId: (await PM(d.paymentId)).stripePaymentIntentId, amountCents: 2500 }) }).returning();
    await db.update(pays).set({ endedHow: "cancelled" }).where(eq(pays.id, d.paymentId));
    await age(op3.id, 2 * MIN);
    await reconcileOperations((await PM(d.paymentId)).takeAt!);
    await runContributionJobs((await PM(d.paymentId)).takeAt!);
    check("after a stop the helper never sends a taking again: it finds out, and lets the hold go", (await PM(d.paymentId)).status === "given_up" && (await intentOf(d.paymentId)).status === "canceled" && (await intentOf(d.paymentId)).amount_received === 0 && (await operations(d.paymentId, "capture"))[0].status === "failed");

    // And after the last moment.
    const e = await held(host);
    const [op4] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: e.paymentId, kind: "capture", label: `contributioncapture:${e.paymentId}:1`, params: JSON.stringify({ intentId: (await PM(e.paymentId)).stripePaymentIntentId, amountCents: 2500 }) }).returning();
    await age(op4.id, 2 * MIN);
    const tooLate = new Date((await PM(e.paymentId)).takeBy!.getTime() + MIN);
    await reconcileOperations(tooLate);
    await runContributionJobs(tooLate);
    check("nor after the last moment: nothing is taken, and the payment is given up", (await PM(e.paymentId)).status === "given_up" && (await PM(e.paymentId)).endedHow === "not_taken_in_time" && (await intentOf(e.paymentId)).amount_received === 0);

    // By the real clock, with no pretended day: a taking that was written down, and the last moment passes before the helper comes.
    const e2 = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - 2 * HOUR), takeBy: new Date(Date.now() - MIN) }).where(eq(pays.id, e2.paymentId));
    const [op4b] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: e2.paymentId, kind: "capture", label: `contributioncapture:${e2.paymentId}:1`, params: JSON.stringify({ intentId: (await PM(e2.paymentId)).stripePaymentIntentId, amountCents: 2500 }) }).returning();
    await age(op4b.id, 2 * MIN);
    await reconcileOperations(new Date());
    check("the helper that finds it gives the payment up and lets the hold go at once, without waiting out the hour between two tries", (await PM(e2.paymentId)).status === "given_up" && (await PM(e2.paymentId)).endedHow === "not_taken_in_time" && (await intentOf(e2.paymentId)).status === "canceled");

    // A taking was written down while the switch covered the host; the founder switches projects off before the helper comes.
    const sw = await held(host);
    const swAt = (await PM(sw.paymentId)).takeAt!;
    const [op4c] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: sw.paymentId, kind: "capture", label: `contributioncapture:${sw.paymentId}:1`, params: JSON.stringify({ intentId: (await PM(sw.paymentId)).stripePaymentIntentId, amountCents: 2500 }) }).returning();
    await age(op4c.id, 2 * MIN);
    await setSwitches({ projects: "off" });
    await reconcileOperations(swAt);
    check("with the switch off, recovery does not send that taking: nothing is taken", (await PM(sw.paymentId)).status === "held" && (await intentOf(sw.paymentId)).amount_received === 0 && (await operations(sw.paymentId, "capture"))[0].status === "failed");
    await runContributionJobs(swAt);
    check("and the helper's first job then gives the hold up and lets it go", (await PM(sw.paymentId)).endedHow === "switch" && (await intentOf(sw.paymentId)).status === "canceled");
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    // The same for a try with the saved card that was written down and never sent.
    const swm = await held(host, { kind: "monthly", amountCents: 1000 });
    const swNext = await nextMonth(swm, 2, new Date());
    const swIntent = (await C.intentFor(swNext))!;
    const swCard = (await Cards.cardInUse(db, swm.contributionId))!.stripePaymentMethodId;
    const [opHold] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: swNext, kind: "hold", label: `contributionhold:${swNext}:1:1`, params: JSON.stringify({ intentId: swIntent.intentId, paymentMethodId: swCard }) }).returning();
    await age(opHold.id, 2 * MIN);
    await setSwitches({ projects: "off" });
    await reconcileOperations(new Date());
    check("with the switch off, recovery does not send a saved-card try again either: no hold is placed", (await stripe().paymentIntents.retrieve(swIntent.intentId)).status === "requires_payment_method" && (await operations(swNext, "hold"))[0].status === "failed" && (await PM(swNext)).status === "to_pay");
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    await E.endContribution(swm.contributionId, "stopped", new Date());

    // A try with the saved card that Stripe accepted, and whose result is not recorded on the payment yet: the helper
    // stopped right after Stripe's answer. $600 a month, so the second month takes the pair over $1,000.
    const { confirmSavedCard } = await import("../src/lib/membership/charge");
    const mo = await held(host, { kind: "monthly", amountCents: 60_000 });
    const moAt = (await PM(mo.paymentId)).takeAt!;
    await C.takePayment(mo.paymentId, moAt);
    const second = await nextMonth(mo, 2, moAt);
    await db.update(pays).set({ nextTryAt: null }).where(eq(pays.id, second));
    const secondIntent = (await C.intentFor(second))!;
    const moCard = (await Cards.cardInUse(db, mo.contributionId))!.stripePaymentMethodId;
    const holdLabel = `contributionhold:${second}:1:1`;
    await confirmSavedCard({ intentId: secondIntent.intentId, paymentMethodId: moCard }, holdLabel);
    await db.insert(schema.moneyOperations).values({ contributionPaymentId: second, kind: "hold", label: holdLabel, params: JSON.stringify({ intentId: secondIntent.intentId, paymentMethodId: moCard }), status: "succeeded", stripeId: secondIntent.intentId, finishedAt: new Date() });
    const ready = new Date(moAt.getTime() + 8 * DAY);
    const first = () => unsentEarnings(ready, host.id).then((all) => all.find((x) => x.payment.contributionPaymentId === mo.paymentId));
    check("while a try's result is not recorded yet, the pair cannot be counted: the earlier share of that pair waits, and the host is told so", (await PM(second)).status === "to_pay" && (await first())?.heldBack === "being_sent");
    await C.syncPayment(second, new Date());
    const counted = moAt.getTime() > Date.now() - CONTRIBUTION.windowMs;
    check("when the hold is recorded, the pair is counted: over $1,000 now, so the earlier share waits 30 days from its own taking", (await PM(second)).status === "held" && counted && (await shareOf(mo.paymentId)).transferDueAt?.getTime() === moAt.getTime() + 30 * DAY && (await first())?.heldBack === "not_yet");
    // And a try that ends in a refusal: the try number moves on, so the pair is not held up by it.
    const re = await held(host, { kind: "monthly", amountCents: 1000 });
    const reAt = (await PM(re.paymentId)).takeAt!;
    await C.takePayment(re.paymentId, reAt);
    await saveCard(re, "pm_card_authenticationRequired");
    const reNext = await nextMonth(re, 2, reAt);
    await C.tryHold(reNext, reAt);
    check("a try the bank answers with a request to confirm does not hold the pair's earlier share up", (await PM(reNext)).try === 2 && (await unsentEarnings(new Date(reAt.getTime() + 8 * DAY), host.id)).find((x) => x.payment.contributionPaymentId === re.paymentId)?.heldBack === null);
    await E.endContribution(mo.contributionId, "stopped", new Date());
    await E.endContribution(re.contributionId, "stopped", new Date());

    // Letting go, written down and never sent.
    const f = await held(host);
    await db.update(pays).set({ endedHow: "cancelled" }).where(eq(pays.id, f.paymentId));
    const [op5] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: f.paymentId, kind: "release", label: `contributionrelease:${f.paymentId}:1`, params: JSON.stringify({ intentId: (await PM(f.paymentId)).stripePaymentIntentId }) }).returning();
    await age(op5.id, 2 * MIN);
    await reconcileOperations(new Date());
    check("a letting-go that was written down and never sent is finished", (await PM(f.paymentId)).status === "given_up" && (await intentOf(f.paymentId)).status === "canceled");

    // A refund, written down and never sent.
    const g = await taken(host);
    const line = await R.refundContribution({ paymentId: g.paymentId, amountCents: 500, by: "host", deciderId: host.id, reason: "A part back", requestKey: randomUUID() });
    const [op6] = await db
      .insert(schema.moneyOperations)
      .values({ contributionPaymentId: g.paymentId, kind: "refund", label: `contributionrefund:${line.id}:1:1`, params: JSON.stringify({ intentId: (await PM(g.paymentId)).stripePaymentIntentId, amountCents: 500, contributionPaymentId: g.paymentId, refundId: line.id, attempt: 1 }) })
      .returning();
    await age(op6.id, 2 * MIN);
    await reconcileOperations(new Date());
    await R.runRefunds(new Date());
    check("a refund that was written down and never sent is sent once", (await refundsOf(g.paymentId))[0].status === "done" && (await stripe().refunds.list({ payment_intent: (await PM(g.paymentId)).stripePaymentIntentId!, limit: 10 })).data.length === 1 && (await PM(g.paymentId)).refundedCents === 500);
  });

  // ========================================================================
  journey("Refunds: before the share is sent, against a sending, and the founder's after it", async () => {
    const host = await newHost();
    const admin = await person("admin");
    await db.insert(schema.admins).values({ userId: admin.id });
    const m = await taken(host, { amountCents: 10_000 });
    const share = await shareOf(m.paymentId);
    // $100.00: fee $4.90 + $0.30 = $5.20; her share $94.80.
    check("(a taken $100.00: her share is $94.80)", share.originalHostShareCents === 9480);
    const key = randomUUID();
    const part = await R.refundContribution({ paymentId: m.paymentId, amountCents: 2500, by: "host", deciderId: host.id, reason: "A quarter back", requestKey: key });
    check("the host refunds a part: the line is what makes it owed", part.status === "owed" && part.connectsOwn === false && (await R.refundContribution({ paymentId: m.paymentId, amountCents: 2500, by: "host", deciderId: host.id, reason: "", requestKey: key })).id === part.id);
    const twiceKey = randomUUID();
    const twice = await Promise.allSettled([1, 2].map(() => R.refundContribution({ paymentId: m.paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "The same press, twice", requestKey: twiceKey })));
    check("the same press sent twice at the same moment is one refund, and both get it", twice.every((r) => r.status === "fulfilled") && new Set(twice.map((r) => (r.status === "fulfilled" ? r.value.id : ""))).size === 1 && (await refundsOf(m.paymentId)).length === 2, twice.map((r) => r.status));
    check("while it is owed, her share cannot be collected", (await unsentEarnings(new Date(m.at.getTime() + 8 * DAY), host.id))[0]?.heldBack === "refund");
    check("what is owed already counts against what can still be refunded", /At most \$74\.00/.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 7401, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) ?? ""));
    await R.runRefunds(new Date());
    let s = await shareOf(m.paymentId);
    // $26.00 back of $100.00: her share shrinks in the same proportion, to $70.15 (74% of $94.80, rounded), and our fee to $3.85.
    check("when Stripe has sent them, her share and our fee shrink in the same proportion: $70.15 and $3.85", (await PM(m.paymentId)).refundedCents === 2600 && s.refundedCents === 2600 && (await ledger({ paymentId: s.id }, "host_share")).total === 7015 && (await ledger({ paymentId: s.id }, "platform_fee")).total === 385 && (await ledger({ contributionPaymentId: m.paymentId })).total === 7400, { refunded: s.refundedCents, share: (await ledger({ paymentId: s.id }, "host_share")).total });
    check("someone else's host cannot refund it, and a refund needs an amount", /not found/i.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 100, by: "host", deciderId: (await newHost()).id, reason: "", requestKey: randomUUID() }))) ?? "") && /amount/.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 0, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) ?? ""));

    // A sending of the share is written down and not finished.
    const [sending] = await db.insert(schema.moneyOperations).values({ paymentId: s.id, kind: "transfer", label: `transfer:${s.id}:1`, params: "{}" }).returning();
    check("while a sending of the share is written down, nothing is refunded from it", /being sent/.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) ?? ""));
    await db.update(schema.moneyOperations).set({ status: "failed", finishedAt: new Date() }).where(eq(schema.moneyOperations.id, sending.id));
    check("if Stripe refuses that sending, the host can refund as before", (await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) === null);
    await R.runRefunds(new Date());

    // A refund Stripe refuses is tried again, never dropped. (Stripe's refusal is handed in by hand: its test mode does not refuse a refund on request.)
    const again = await R.refundContribution({ paymentId: m.paymentId, amountCents: 200, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() });
    await db.transaction(async (tx) => {
      const { lockForPayment } = await import("../src/lib/contributions/locks");
      await R.applyRefundOutcome(tx, await lockForPayment(tx, m.paymentId), { refundId: again.id, attempt: 1, stripeRefundId: null, status: "failed" }, new Date());
    });
    let line = (await refundsOf(m.paymentId)).find((r) => r.id === again.id)!;
    check("a refund Stripe refuses stays owed, as a new try", line.status === "owed" && line.attempt === 2 && line.lastFailedAt !== null);
    await R.runRefunds(new Date());
    check("it is not tried again within the hour, and her share stays held back meanwhile", (await refundsOf(m.paymentId)).find((r) => r.id === again.id)!.status === "owed" && (await unsentEarnings(new Date(m.at.getTime() + 8 * DAY), host.id))[0]?.heldBack === "refund");
    await R.runRefunds(new Date(Date.now() + 61 * MIN));
    line = (await refundsOf(m.paymentId)).find((r) => r.id === again.id)!;
    check("and is sent on the next try", line.status === "done" && (await PM(m.paymentId)).refundedCents === 2900);

    // After the share was sent: only the founder, from Connect's own money.
    s = await shareOf(m.paymentId);
    const hers = { fee: (await ledger({ paymentId: s.id }, "platform_fee")).total, share: (await ledger({ paymentId: s.id }, "host_share")).total };
    await db.update(schema.payments).set({ transferStatus: "sent", transferCents: hers.share, transferredAt: new Date() }).where(eq(schema.payments.id, s.id));
    check("once her share was sent, the host can no longer refund", /only Connect/.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) ?? ""));
    const own = await R.refundContribution({ paymentId: m.paymentId, amountCents: 1000, by: "founder", deciderId: admin.id, reason: "A mistake of ours", requestKey: randomUUID() });
    await R.runRefunds(new Date());
    s = await shareOf(m.paymentId);
    check("the founder's refund after that is Connect's own money: her share is not lowered, and the books record Connect's cost", own.connectsOwn && s.refundedCents === 2900 && s.transferStatus === "sent" && (await ledger({ paymentId: s.id }, "host_share")).total === hers.share && (await ledger({ contributionPaymentId: m.paymentId }, "connect_cost")).total === 1000 && (await ledger({ contributionPaymentId: m.paymentId }, "customer_refund")).total === -3900 && (await PM(m.paymentId)).refundedCents === 3900);
    check("never more than was taken", /At most \$61\.00/.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 6101, by: "founder", deciderId: admin.id, reason: "", requestKey: randomUUID() }))) ?? ""));

    const full = await taken(host, { amountCents: 2500 });
    await R.refundContribution({ paymentId: full.paymentId, amountCents: 2500, by: "host", deciderId: host.id, reason: "All of it", requestKey: randomUUID() });
    await R.runRefunds(new Date());
    const gone = await shareOf(full.paymentId);
    check("a refund in full leaves nothing owed to the host", gone.transferStatus === "not_owed" && (await ledger({ paymentId: gone.id })).total === 0 && (await ledger({ contributionPaymentId: full.paymentId })).total === 0);
    check("money that has not been taken cannot be refunded", /not been taken/.test((await refusal(R.refundContribution({ paymentId: (await held(host)).paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) ?? ""));
  });

  // ========================================================================
  journey("The $1,000 rule, counted for one contributor and one host", async () => {
    const host = await newHost();
    const giver = await person("giver");
    const first = await taken(host, { giver, amountCents: 60_000 });
    check("$600 from one person: the usual 7 days", (await shareOf(first.paymentId)).transferDueAt?.getTime() === first.at.getTime() + 7 * DAY && !(await PM(first.paymentId)).thirtyDayMark);
    const second = await held(host, { giver, amountCents: 60_000 });
    const firstShare = await shareOf(first.paymentId);
    // The count is made at the real moment the hold is accepted, so the first taking (pretended three days ahead) only counts when it lies inside the 30 days behind that moment.
    const counted = first.at.getTime() > Date.now() - CONTRIBUTION.windowMs;
    check("(the first taking lies within the 30 days of the second hold)", counted);
    check("a second $600 is held: over $1,000 now, so the hold gets its mark, and the earlier share that was not collected waits 30 days from its own taking", (await PM(second.paymentId)).thirtyDayMark && firstShare.transferDueAt?.getTime() === first.at.getTime() + 30 * DAY);
    await C.giveUp(second.paymentId, "cancelled", new Date());
    check("the second is cancelled: the wait of the first never gets shorter by itself", (await shareOf(first.paymentId)).transferDueAt?.getTime() === first.at.getTime() + 30 * DAY);

    // Crossing while held, and the other hold then cancelled: the mark stays.
    const other = await person("giver");
    const a = await held(host, { giver: other, amountCents: 60_000 });
    const b = await held(host, { giver: other, amountCents: 60_000 });
    check("two holds of one person, counted one after the other: both carry the mark", (await PM(a.paymentId)).thirtyDayMark && (await PM(b.paymentId)).thirtyDayMark);
    await C.giveUp(b.paymentId, "cancelled", new Date());
    const atA = (await PM(a.paymentId)).takeAt!;
    await C.takePayment(a.paymentId, atA);
    check("one is cancelled, the other is taken: it keeps the mark it got while held, and waits 30 days", (await shareOf(a.paymentId)).transferDueAt?.getTime() === atA.getTime() + 30 * DAY);

    // The founder releases a payment while it is still only held: that is kept to when its money is taken.
    const admin0 = await person("admin");
    await db.insert(schema.admins).values({ userId: admin0.id });
    const freed = await person("giver");
    const f1 = await held(host, { giver: freed, amountCents: 60_000 });
    const f2 = await held(host, { giver: freed, amountCents: 60_000 });
    await F.release({ paymentId: f1.paymentId, adminId: admin0.id, note: "Known to us", now: new Date() });
    await C.giveUp(f2.paymentId, "cancelled", new Date());
    const atF = (await PM(f1.paymentId)).takeAt!;
    await C.takePayment(f1.paymentId, atF);
    check("a payment the founder released while it was held, mark and all, waits the usual 7 days once taken, never less", (await PM(f1.paymentId)).thirtyDayMark && (await shareOf(f1.paymentId)).transferDueAt?.getTime() === atF.getTime() + 7 * DAY);

    // Exactly $1,000 does not cross the line; another host, and another person, are counted apart.
    const exact = await person("giver");
    const e1 = await taken(host, { giver: exact, amountCents: 50_000 });
    const e2 = await taken(host, { giver: exact, amountCents: 50_000 });
    check("exactly $1,000 does not cross the line", (await shareOf(e1.paymentId)).transferDueAt?.getTime() === e1.at.getTime() + 7 * DAY && (await shareOf(e2.paymentId)).transferDueAt?.getTime() === e2.at.getTime() + 7 * DAY);
    const elsewhere = await taken(await newHost(), { giver: exact, amountCents: 50_000 });
    check("what the same person gives another host is counted apart", (await shareOf(elsewhere.paymentId)).transferDueAt?.getTime() === elsewhere.at.getTime() + 7 * DAY);
    const stranger = await taken(host, { amountCents: 50_000 });
    check("and so is what another person gives this host", (await shareOf(stranger.paymentId)).transferDueAt?.getTime() === stranger.at.getTime() + 7 * DAY);

    // The founder's hold and release.
    const admin = await person("admin");
    await db.insert(schema.admins).values({ userId: admin.id });
    check("the founder's hold and release each need a reason", /reason/.test((await refusal(F.holdBack({ paymentId: e1.paymentId, adminId: admin.id, note: " ", now: new Date() }))) ?? ""));
    await F.holdBack({ paymentId: e1.paymentId, adminId: admin.id, note: "Looking into this one", now: new Date() });
    const whenReady = new Date(e1.at.getTime() + 8 * DAY);
    const heldOne = (await unsentEarnings(whenReady, host.id)).find((x) => x.payment.contributionPaymentId === e1.paymentId);
    check("a share the founder holds back cannot be collected, and the host is told so", heldOne?.heldBack === "founder" && (await db.select().from(schema.adminActions).where(and(eq(schema.adminActions.adminId, admin.id), eq(schema.adminActions.action, "contribution held back")))).length === 1);
    const releasedAt = new Date(first.at.getTime() + 2 * DAY);
    await F.release({ paymentId: first.paymentId, adminId: admin.id, note: "Known to us", now: releasedAt });
    check("the founder releases the $600 that waits 30 days: it can be collected from that moment", (await shareOf(first.paymentId)).transferDueAt?.getTime() === releasedAt.getTime() && (await PM(first.paymentId)).founderHold === "released");
    const third = await taken(host, { giver, amountCents: 60_000 });
    check("counting again does not put its 30 days back, while the new payment that crosses the line waits 30", (await shareOf(first.paymentId)).transferDueAt?.getTime() === releasedAt.getTime() && (await shareOf(third.paymentId)).transferDueAt?.getTime() === third.at.getTime() + 30 * DAY);
    await F.release({ paymentId: e1.paymentId, adminId: admin.id, note: "Fine", now: whenReady });
    check("a release lifts the founder's own hold", (await unsentEarnings(whenReady, host.id)).find((x) => x.payment.contributionPaymentId === e1.paymentId)?.heldBack === null);
  });

  // ========================================================================
  journey("A bank dispute: the share is held back, nothing is refunded, and a monthly contribution ends", async () => {
    const host = await newHost();
    const m = await held(host, { kind: "monthly", amountCents: 1000, card: "pm_card_createDispute" }); // Stripe's test card that is always disputed
    const at = (await PM(m.paymentId)).takeAt!;
    await C.takePayment(m.paymentId, at);
    const next = await nextMonth(m, 2, at);
    let disputeId: string | undefined;
    for (let i = 0; i < 30 && !disputeId; i++) {
      disputeId = (await stripe().disputes.list({ payment_intent: (await PM(m.paymentId)).stripePaymentIntentId!, limit: 1 })).data[0]?.id;
      if (!disputeId) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    check("(Stripe's test card opened a dispute)", Boolean(disputeId));
    if (!disputeId) return;
    await handleStripeEvent({ type: "charge.dispute.created", data: { object: { id: disputeId } } });
    check("a message about a dispute finds the contribution's payment and records it as open", (await PM(m.paymentId)).dispute === "open");
    check("the monthly contribution ends, and its payment that was not taken is given up", (await CO(m.contributionId)).endedHow === "dispute" && (await PM(next)).endedHow === "dispute");
    const when = new Date(at.getTime() + 8 * DAY);
    check("the share cannot be collected while the dispute is open", (await unsentEarnings(when, host.id))[0]?.heldBack === "dispute");
    check("and nothing can be refunded from it", /disputed/.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) ?? ""));
    await D.recordDispute(m.paymentId, "won", new Date());
    // (Won and lost are written by hand here: Stripe's test dispute cannot be decided from a script.)
    check("won: the share can be collected again, and the contribution stays ended", (await unsentEarnings(when, host.id))[0]?.heldBack === null && (await CO(m.contributionId)).status === "ended");
    await D.recordDispute(m.paymentId, "lost", new Date());
    check("lost: held back again, for the founder to settle", (await unsentEarnings(when, host.id))[0]?.heldBack === "dispute");
  });

  // ========================================================================
  journey("Ending, the founder's switch, and cards", async () => {
    const host = await newHost();
    const a = await held(host, { kind: "monthly", amountCents: 1000 });
    const cardId = (await Cards.cardInUse(db, a.contributionId))!.stripePaymentMethodId;
    await E.endContribution(a.contributionId, "stopped", new Date());
    check("a monthly contribution ends with a payment held: the hold is let go, and nothing is charged", (await CO(a.contributionId)).endedHow === "stopped" && (await PM(a.paymentId)).status === "given_up" && (await intentOf(a.paymentId)).status === "canceled");
    await E.endContribution(a.contributionId, "stopped again", new Date());
    check("ending twice is one ending", (await CO(a.contributionId)).endedHow === "stopped" && (await operations(a.paymentId, "release")).length === 1);
    check("its card is retired at once", (await Cards.cardInUse(db, a.contributionId)) === null);
    await Cards.removeRetiredCards(new Date());
    const [gone] = await db.select().from(schema.contributionCards).where(eq(schema.contributionCards.contributionId, a.contributionId));
    check("and removed at Stripe once nothing needs it; its line stays", gone.removedAt !== null && (await stripe().paymentMethods.retrieve(cardId)).customer === null);

    // A card that is, or was, a contribution's is never taken by a membership or a booking.
    const b = await held(host, { kind: "monthly", amountCents: 1000 });
    const inUse = (await Cards.cardInUse(db, b.contributionId))!.stripePaymentMethodId;
    const [membership] = await db.insert(schema.memberships).values({ hostId: host.id, customerId: b.giver.id, status: "joining", period: 1, ownPricePer15Cents: 750, ownMinutes: 120 }).returning();
    const tookIt = await db.transaction((tx) => MemberCards.takeCardForMembership(tx, membership.id, inUse, new Date())).then(() => true, (error) => !(error instanceof MoneyError));
    check("a contribution's card is refused by a membership", tookIt === false);
    check("and by a booking", (await db.transaction((tx) => MemberCards.bookingCardSeen(tx, randomUUID(), inUse))) === false);
    check("a retired card that an open payment may still be using is not removed", (await E.endContribution(b.contributionId, "stopped", new Date()), true) && (await db.update(pays).set({ status: "held", endedHow: null }).where(eq(pays.id, b.paymentId)), true) && (await Cards.removeRetiredCards(new Date())) === 0);
    await db.update(pays).set({ status: "given_up", endedHow: "stopped" }).where(eq(pays.id, b.paymentId));

    // The founder's switch.
    const c = await held(host);
    const d = await atCardStep(host);
    await setSwitches({ projects: "off" });
    check("with the switch off, held money is not taken", (await C.takePayment(c.paymentId, (await PM(c.paymentId)).takeAt!)).status === "held" && (await intentOf(c.paymentId)).amount_received === 0);
    check("and no payment is asked for", (await C.intentFor(d.paymentId)) === null);
    await runContributionJobs(new Date());
    check("the helper gives up what is only held for a host the switch does not cover, and lets the hold go", (await PM(c.paymentId)).endedHow === "switch" && (await PM(c.paymentId)).status === "given_up" && (await intentOf(c.paymentId)).status === "canceled");
    // Named hosts: only the payments of a host who is not named are given up.
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    const namedHost = await newHost();
    const other = await newHost();
    const stays = await held(namedHost);
    const goes = await held(other);
    await setSwitches({ projects: "named", projectsHosts: [namedHost.id] });
    await runContributionJobs(new Date());
    check("with the switch on for named hosts, a named host's hold stays and another host's is given up", (await PM(stays.paymentId)).status === "held" && (await PM(goes.paymentId)).endedHow === "switch");
    await C.giveUp(stays.paymentId, "cancelled", new Date());
    const done = await taken(await newHostWithSwitchOn(), { amountCents: 2500 });
    await setSwitches({ projects: "off" });
    await R.refundContribution({ paymentId: done.paymentId, amountCents: 500, by: "host", deciderId: done.host.id, reason: "", requestKey: randomUUID() });
    await runContributionJobs(new Date());
    check("what only finishes goes on with the switch off: a refund is still sent", (await refundsOf(done.paymentId))[0].status === "done");
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    await runContributionJobs(new Date());
    check("turning the switch on again brings no old payment back", (await PM(c.paymentId)).status === "given_up" && (await intentOf(c.paymentId)).status === "canceled");
  });
  async function newHostWithSwitchOn(): Promise<Person> {
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    return newHost();
  }

  // ========================================================================
  journey("The watch: each thing the helper should have done by now makes the answer \"not healthy\"", async () => {
    const host = await newHost();
    const mentions = async (now: Date, words: RegExp) => (await healthProblems(now)).some((problem) => words.test(problem));
    const a = await held(host);
    const takeAt = (await PM(a.paymentId)).takeAt!;
    check("held money 5 minutes past its moment with nothing under way", !(await mentions(new Date(takeAt.getTime() + 4 * MIN), /contribution's held money/)) && (await mentions(new Date(takeAt.getTime() + 6 * MIN), /contribution's held money/)));
    await C.giveUp(a.paymentId, "cancelled", new Date());

    const b = await atCardStep(host);
    await db.update(pays).set({ intentRequestedAt: new Date(Date.now() - 11 * MIN), intentRequest: "{}" }).where(eq(pays.id, b.paymentId));
    check("a payment asked of Stripe more than 10 minutes ago whose answer is not saved", await mentions(new Date(), /contribution's payment was asked of Stripe/));
    await db.update(pays).set({ intentRequestedAt: null, intentRequest: null, status: "given_up", endedHow: "card_step" }).where(eq(pays.id, b.paymentId));

    const c = await held(host);
    await db.update(pays).set({ endedHow: "cancelled", updatedAt: new Date(Date.now() - 11 * MIN) }).where(eq(pays.id, c.paymentId));
    check("a payment that was given up and still has its hold after 10 minutes", await mentions(new Date(), /given up still has its hold/));
    await C.letGo(c.paymentId, new Date());

    const d = await taken(host);
    const line = await R.refundContribution({ paymentId: d.paymentId, amountCents: 500, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() });
    await db.update(schema.contributionRefunds).set({ createdAt: new Date(Date.now() - 11 * MIN) }).where(eq(schema.contributionRefunds.id, line.id));
    check("a refund owed for more than 10 minutes with nothing under way", await mentions(new Date(), /refund has been owed/));
    await db.update(schema.contributionRefunds).set({ lastFailedAt: new Date(Date.now() - 5 * MIN) }).where(eq(schema.contributionRefunds.id, line.id));
    check("but not one Stripe refused and that waits for its next try", !(await mentions(new Date(), /refund has been owed/)));
    await db.update(schema.contributionRefunds).set({ lastFailedAt: null }).where(eq(schema.contributionRefunds.id, line.id));
    await R.runRefunds(new Date());
    // (A payment set aside for the founder in an earlier journey is still said, and is meant to be, until the founder has settled it.)
    const FOUR = /contribution's held money|was asked of Stripe|given up still has its hold|refund has been owed/;
    check("when the helper has caught up, none of these four is said any more", !(await mentions(new Date(), FOUR)), (await healthProblems(new Date())).filter((problem) => FOUR.test(problem)));
    check("a payment that needs the founder is said for as long as it does", (await db.select({ id: pays.id }).from(pays).where(sql`${pays.problem} is not null`)).length === 0 || (await mentions(new Date(), /needs the founder/)));
  });

  // ========================================================================
  if (process.argv.includes("--payouts")) {
    journey("Collecting: a contribution's share reaches the host through \"Collect earnings\", and the books add up to the cent", async () => {
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
        const m = await taken(host, { amountCents: 2500 });
        const early = await press(new Date(m.at.getTime() + 7 * DAY - 1000));
        check("a second before its 7 days nothing can be collected", early instanceof MoneyError, early?.message);
        const refunding = await R.refundContribution({ paymentId: m.paymentId, amountCents: 500, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() });
        const blocked = await press(new Date(m.at.getTime() + 7 * DAY));
        check("a refund that is owed keeps the share from being collected: the two never meet", blocked instanceof MoneyError && refunding.status === "owed", blocked?.message);
        await R.runRefunds(new Date());
        const pressed = await press(new Date(m.at.getTime() + 7 * DAY));
        const share = await shareOf(m.paymentId);
        // $20.00 kept of $25.00: her share $18.78 (four fifths of $23.47, rounded), less the 25-cent collection charge.
        check("at 7 days the share is sent to her payout account: $18.78 less the 25-cent collection charge", pressed === null && share.transferStatus === "sent" && share.transferCents === 1853 && share.payoutFeeCents === 25 && Boolean(share.stripeTransferId), { pressed: pressed?.message, status: share.transferStatus, sent: share.transferCents });
        const transfer = share.stripeTransferId ? await stripe().transfers.retrieve(share.stripeTransferId) : null;
        check("the transfer names the contribution's own charge as its source, and is grouped under the contribution's payment", transfer?.amount === 1853 && transfer.source_transaction === (await PM(m.paymentId)).stripeChargeId && transfer.transfer_group === m.paymentId && transfer.destination === account);
        check("the money record adds up to the cent: paid $25.00, refunded $5.00, our fee, her share, the transfer and the collection charge", (await ledger({ contributionPaymentId: m.paymentId })).total === 2000 && (await ledger({ paymentId: share.id }, "platform_fee")).total === 122 && (await ledger({ paymentId: share.id }, "host_share")).total === 1878 && (await ledger({ paymentId: share.id }, "host_transfer")).total === -1853 && (await ledger({ paymentId: share.id }, "payout_fee")).total === 25);
        // The $1,000 rule's third moment: the host collects. Two payments of one person that are over the line together,
        // with their dates put back to 7 days as if the earlier counts had been missed.
        const big = await person("giver");
        const one = await taken(host, { giver: big, amountCents: 60_000 });
        const two = await taken(host, { giver: big, amountCents: 60_000 });
        await db.update(schema.payments).set({ transferDueAt: new Date(one.at.getTime() + 7 * DAY) }).where(inArray(schema.payments.contributionPaymentId, [one.paymentId, two.paymentId]));
        const later = new Date(Math.max(one.at.getTime(), two.at.getTime()) + 8 * DAY);
        const notYet = await press(new Date(later.getTime() + 2 * DAY));
        check("at the moment of collecting the pair is counted again: over $1,000, so both shares wait 30 days each from its own taking, and nothing of them is sent", notYet instanceof MoneyError && (await shareOf(one.paymentId)).transferDueAt?.getTime() === one.at.getTime() + 30 * DAY && (await shareOf(two.paymentId)).transferDueAt?.getTime() === two.at.getTime() + 30 * DAY && (await shareOf(one.paymentId)).transferStatus === "not_due", notYet?.message);
        // A payment of that pair whose outcome is not known makes the pair's shares wait.
        const third = await held(host, { giver: big, amountCents: 1000 });
        const [unknown] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: third.paymentId, kind: "capture", label: `contributioncapture:${third.paymentId}:1`, params: "{}" }).returning();
        const waits = (await unsentEarnings(new Date(two.at.getTime() + 31 * DAY), host.id)).filter((e) => e.payment.contributionPaymentId === one.paymentId || e.payment.contributionPaymentId === two.paymentId);
        const blockedPair = await press(new Date(two.at.getTime() + 32 * DAY));
        check("while a payment of that pair has an outcome that is not known, the pair's shares wait, and the earnings list says so", blockedPair instanceof MoneyError && waits.length === 2 && waits.every((e) => e.heldBack === "being_sent") && (await shareOf(one.paymentId)).transferStatus === "not_due", { refused: blockedPair?.message, shown: waits.map((e) => e.heldBack) });
        await db.update(schema.moneyOperations).set({ status: "failed", finishedAt: new Date() }).where(eq(schema.moneyOperations.id, unknown.id));
        await C.giveUp(third.paymentId, "cancelled", new Date());
        const both = await press(new Date(two.at.getTime() + 33 * DAY));
        check("after their 30 days both are collected in one collection", both === null && (await shareOf(one.paymentId)).transferStatus === "sent" && (await shareOf(two.paymentId)).transferStatus === "sent", both?.message);
        check("after that the host can no longer refund it; only the founder can", /only Connect/.test((await refusal(R.refundContribution({ paymentId: m.paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "", requestKey: randomUUID() }))) ?? ""));
      } finally {
        await give(host.id, seeded.id);
      }
    });
  }

  // ------------------------------------------------------------------------
  if (only && (only.length === 0 || only.some((n) => !Number.isInteger(n) || n < 1 || n > journeys.length))) throw new Error(`--only takes journey numbers from 1 to ${journeys.length}.`);
  // Whatever an earlier run left behind (it may have been stopped) is cleared first, so the jobs of this run meet only its own contributions.
  await wipe(true);
  const before = await switches();
  console.log(`(The founder's projects switch is "${before.projects}"; it is put back at the end.)`);
  try {
    for (const [index, [title, run]] of journeys.entries()) {
      if (only && !only.includes(index + 1)) continue;
      console.log(`\n${index + 1}. ${title}`);
      await setSwitches({ projects: "everyone", projectsHosts: [] });
      try {
        await run();
      } catch (error) {
        check("the journey ran to its end", false, error instanceof Error ? `${error.message}\n${error.stack}` : String(error));
      }
    }
  } finally {
    await setSwitches({ projects: before.projects, projectsHosts: before.projectsHosts }).catch((error) => check("afterwards: the projects switch could be put back", false, String(error)));
    await wipe().catch((error) => check("afterwards: what this run made could be removed", false, String(error)));
  }
  const afterwards = await switches();
  check("afterwards: the founder's projects switch is as it was before the script", afterwards.projects === before.projects && afterwards.projectsHosts.join(",") === before.projectsHosts.join(","));
  check("afterwards: nothing this run made is left", (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.id, `ctb-${RUN}-%`))).length === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
