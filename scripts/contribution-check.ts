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
  const { startProject, runningProjectOf, changeSuggested, endProject } = await import("../src/lib/projects/projects");
  const S = await import("../src/lib/contributions/start");
  const M = await import("../src/lib/contributions/monthly");
  const { CONTRIBUTION_WORDING_VERSION } = await import("../src/lib/contributions/wording");
  const { ProjectError } = await import("../src/lib/projects/rules");
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
      if (error instanceof ContributionError || error instanceof MoneyError || error instanceof ProjectError) return error.message;
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
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "contributioncheck-%"));
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

    // The contributor cancels after the taking was written down and before Stripe was asked (the script holds the request back for that).
    const lateStop = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - HOUR) }).where(eq(pays.id, lateStop.paymentId));
    p = await C.takePayment(lateStop.paymentId, undefined, { beforeDispatch: async () => void (await C.giveUp(lateStop.paymentId, "cancelled", new Date())) });
    const stopOps = await operations(lateStop.paymentId, "capture");
    check("a cancellation that comes after the taking was written down, and before Stripe was asked, wins: nothing is taken and the hold is let go", p.status === "given_up" && p.endedHow === "cancelled" && stopOps.length === 1 && stopOps[0].status === "failed" && (await intentOf(lateStop.paymentId)).status === "canceled" && (await intentOf(lateStop.paymentId)).amount_received === 0 && (await ledger({ contributionPaymentId: lateStop.paymentId })).lines === 0, { status: p.status, endedHow: p.endedHow, ops: stopOps.map((o) => o.status) });
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
    const noEnd = await atCardStep(host, { kind: "monthly" });
    await confirmOnly(noEnd.paymentId);
    const noEndIntent = await stripe().paymentIntents.retrieve((await PM(noEnd.paymentId)).stripePaymentIntentId!, { expand: ["latest_charge", "payment_method"] });
    await C.recordIntent(await PM(noEnd.paymentId), noEndIntent, new Date(), { holdEndsAt: null });
    check("and the card of such a hold never becomes a monthly contribution's card", (await PM(noEnd.paymentId)).endedHow === "no_hold_end" && (await db.select().from(schema.contributionCards).where(eq(schema.contributionCards.contributionId, noEnd.contributionId))).length === 0);

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
    // The same, when the taking was written down so long ago that the helper may have sent it itself: this process
    // does not say "not sent" then. The action stays unanswered, and the helper finds out.
    const oldOne = await held(host);
    await db.update(pays).set({ takeAt: new Date(Date.now() - HOUR), takeBy: new Date(Date.now() + 2000) }).where(eq(pays.id, oldOne.paymentId));
    p = await C.takePayment(oldOne.paymentId, undefined, {
      beforeDispatch: async () => {
        await db.update(schema.moneyOperations).set({ createdAt: new Date(Date.now() - 2 * MIN) }).where(and(eq(schema.moneyOperations.contributionPaymentId, oldOne.paymentId), eq(schema.moneyOperations.status, "started")));
        await new Promise((resolve) => setTimeout(resolve, 3500));
      },
    });
    const oldOps = await operations(oldOne.paymentId, "capture");
    const leftUnanswered = p.status === "held" && !p.endedHow && oldOps.length === 1 && oldOps[0].status === "started";
    await reconcileOperations(new Date());
    p = await PM(oldOne.paymentId);
    check("when the helper may already have sent the taking itself, a late process leaves the action unanswered; the helper finds nothing was taken, gives the payment up and lets the hold go", leftUnanswered && p.status === "given_up" && p.endedHow === "not_taken_in_time" && (await intentOf(oldOne.paymentId)).status === "canceled" && (await intentOf(oldOne.paymentId)).amount_received === 0, { leftUnanswered, status: p.status, endedHow: p.endedHow });
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

    // What Stripe really took is what counts. (A taking of another amount is the founder's to settle; it is put in by hand here.)
    const odd = await person("giver");
    const o1 = await taken(host, { giver: odd, amountCents: 90_000 });
    await db.update(pays).set({ takenCents: 10_000 }).where(eq(pays.id, o1.paymentId));
    const o2 = await held(host, { giver: odd, amountCents: 20_000 });
    check("money that was taken counts with the amount Stripe really took", !(await PM(o2.paymentId)).thirtyDayMark);
    // Money that was taken although it was not to be is money paid too: the pair is counted at that moment.
    const racer = await person("giver");
    const r1 = await held(host, { giver: racer, amountCents: 30_000 });
    await taken(host, { giver: racer, amountCents: 50_000 });
    const r3 = await atCardStep(host, { giver: racer, amountCents: 30_000 });
    await confirmOnly(r3.paymentId);
    const before3 = (await PM(r1.paymentId)).thirtyDayMark;
    await stripe().paymentIntents.capture((await PM(r3.paymentId)).stripePaymentIntentId!);
    await C.syncPayment(r3.paymentId, new Date());
    check("a payment taken although it was never accepted is owed back in full, and still counts: a hold of that person gets its mark at that moment", !before3 && (await PM(r1.paymentId)).thirtyDayMark && (await PM(r3.paymentId)).status === "taken" && (await refundsOf(r3.paymentId)).length === 1 && (await shareOf(r3.paymentId)) === undefined);
    // The count at a hold's acceptance is made at that moment, not at the moment the helper's round began.
    const aged = await person("giver");
    const g1 = await taken(host, { giver: aged, amountCents: 60_000 });
    await db.update(pays).set({ takenAt: new Date(Date.now() - 30 * DAY - 60_000) }).where(eq(pays.id, g1.paymentId));
    const g2 = await atCardStep(host, { giver: aged, amountCents: 60_000 });
    await confirmOnly(g2.paymentId);
    await C.syncPayment(g2.paymentId, new Date(Date.now() - 10 * MIN));
    check("a taking that left the 30 days a minute ago does not count for a new hold, also when the helper's round began before that", (await PM(g2.paymentId)).status === "held" && !(await PM(g2.paymentId)).thirtyDayMark);
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
    const version = (await PM(m.paymentId)).disputeVersion;
    check("an answer about a dispute that was read before another one was recorded is thrown away, and a fresh one is recorded", (await D.recordDispute(m.paymentId, "won", new Date(), version - 1)) === false && (await PM(m.paymentId)).dispute === "lost" && (await D.recordDispute(m.paymentId, "lost", new Date(), version)) === true && (await PM(m.paymentId)).disputeVersion === version + 1);
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
  journey("Starting a contribution: who may, the agreement, one contribution for one press, and the card step", async () => {
    const host = await newHost();
    const project = (await runningProjectOf(host.id))!;
    const giver = await person("giver");
    const start = (over: Partial<Parameters<typeof S.startContribution>[0]> = {}) =>
      S.startContribution({ contributorId: giver.id, projectId: project.id, kind: "once", amount: "25", requestKey: randomUUID(), agreed: false, wordingVersion: CONTRIBUTION_WORDING_VERSION, now: new Date(), ...over });
    const countOf = async (who: Person) => (await db.select({ id: schema.contributions.id }).from(schema.contributions).where(eq(schema.contributions.contributorId, who.id))).length;

    check("a host who suggests no amount takes no contributions", (await refusal(start())) === S.NOT_TAKING && (await countOf(giver)) === 0);
    check("a suggested amount must be a valid contribution, and there are three at most", /smallest/.test((await refusal(changeSuggested({ hostId: host.id, projectId: project.id, once: ["4"], monthly: [], now: new Date() }))) ?? "") && /up to 3/.test((await refusal(changeSuggested({ hostId: host.id, projectId: project.id, once: ["5", "6", "7", "8"], monthly: [], now: new Date() }))) ?? ""));
    await changeSuggested({ hostId: host.id, projectId: project.id, once: ["25", "", "5"], monthly: [], now: new Date() });
    check("she suggests amounts for contributions made once only: kept sorted, and the monthly kind is not offered", (await runningProjectOf(host.id))!.suggestedOnce === "500,2500" && /only takes|does not take monthly/.test((await refusal(start({ kind: "monthly", agreed: true }))) ?? ""));
    check("another host cannot change her amounts", (await refusal(changeSuggested({ hostId: giver.id, projectId: project.id, once: ["9"], monthly: [], now: new Date() }))) !== null && (await runningProjectOf(host.id))!.suggestedOnce === "500,2500");

    check("nobody contributes to their own project", /your own project/.test((await refusal(start({ contributorId: host.id }))) ?? ""));
    check("the amount is typed in dollars, from $5 to $100,000", /smallest/.test((await refusal(start({ amount: "4.99" }))) ?? "") && /largest/.test((await refusal(start({ amount: "100000.01" }))) ?? "") && /amount in dollars/.test((await refusal(start({ amount: "lots" }))) ?? ""));
    check("a page whose wording has changed since it was opened starts nothing", /wording/.test((await refusal(start({ wordingVersion: "an older one" }))) ?? ""));
    const blocked = await person("giver");
    await db.insert(schema.blocks).values({ blockerId: host.id, blockedId: blocked.id });
    check("someone she has blocked, or who has blocked her, cannot contribute, and is told no more than anyone else", (await refusal(start({ contributorId: blocked.id }))) === S.NOT_TAKING);
    const paused = await person("giver");
    await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, paused.id));
    check("someone whose account is paused cannot contribute", /paused/.test((await refusal(start({ contributorId: paused.id }))) ?? ""));
    await setSwitches({ projects: "off" });
    check("while the founder's switch does not cover her, nothing new starts", (await refusal(start())) === S.NOT_TAKING);
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    check("none of these refusals wrote anything", (await countOf(giver)) + (await countOf(blocked)) + (await countOf(paused)) + (await countOf(host)) === 0);

    // The form is sent.
    const key = randomUUID();
    const first = await start({ requestKey: key });
    const c = await CO(first.contributionId);
    let p = await PM(first.paymentId);
    const [agreement] = await db.select().from(schema.contributionAgreements).where(eq(schema.contributionAgreements.contributionId, first.contributionId));
    check("sending the form writes the contribution at its card step, what was agreed to, and its first payment, in one step", c.status === "card_step" && c.kind === "once" && c.amountCents === 2500 && c.hostId === host.id && agreement?.version === CONTRIBUTION_WORDING_VERSION && agreement.amountCents === 2500 && agreement.kind === "once" && p.status === "to_pay" && p.number === 1 && p.amountCents === 2500);
    check("the card step has 30 minutes", Math.abs(p.cardStepExpiresAt!.getTime() - Date.now() - 30 * MIN) < MIN);
    check("starting asks nothing of Stripe", p.stripePaymentIntentId === null && p.intentRequestedAt === null);
    const again = await start({ requestKey: key, amount: "99" });
    check("the same press, sent twice, is one contribution", again.contributionId === first.contributionId && again.paymentId === first.paymentId && (await countOf(giver)) === 1 && (await CO(first.contributionId)).amountCents === 2500);
    check("someone else's press with that same request is refused", (await refusal(start({ requestKey: key, contributorId: blocked.id }))) !== null);

    // The card step.
    const stranger = await person("giver");
    check("a page that is only loaded makes no payment at Stripe", (await S.secretToPay({ paymentId: first.paymentId, contributorId: giver.id })) === null && (await PM(first.paymentId)).intentRequestedAt === null);
    check("only its contributor can make a payment ready, or see it", (await S.payNow({ paymentId: first.paymentId, contributorId: stranger.id })) === null && (await PM(first.paymentId)).intentRequestedAt === null && (await S.contributionFor(stranger.id, first.contributionId)) === null && (await S.contributionFor(giver.id, first.contributionId))?.payments.length === 1);
    const ready = await S.payNow({ paymentId: first.paymentId, contributorId: giver.id });
    const seen = await S.secretToPay({ paymentId: first.paymentId, contributorId: giver.id });
    check("the pressed button makes the payment ready, and the page then reads that same payment", Boolean(ready?.clientSecret) && seen?.clientSecret === ready?.clientSecret && (await S.secretToPay({ paymentId: first.paymentId, contributorId: stranger.id })) === null);
    check("at Stripe it is made to be held first, and the card of a contribution made once is not kept", (await intentOf(first.paymentId)).capture_method === "manual" && (await intentOf(first.paymentId)).setup_future_usage === null && (await intentOf(first.paymentId)).amount === 2500);
    p = await pay(first.paymentId);
    check("the contributor pays on Stripe's form: the amount is held, and the contribution is running", p.status === "held" && (await CO(first.contributionId)).status === "running" && (await S.payNow({ paymentId: first.paymentId, contributorId: giver.id })) === null);

    // Monthly.
    await changeSuggested({ hostId: host.id, projectId: project.id, once: ["25", "5"], monthly: ["10"], now: new Date() });
    check("a monthly contribution needs the box ticked", /tick the box/.test((await refusal(start({ kind: "monthly", amount: "10" }))) ?? ""));
    const monthly = await start({ kind: "monthly", amount: "10", agreed: true });
    const [agreed] = await db.select().from(schema.contributionAgreements).where(eq(schema.contributionAgreements.contributionId, monthly.contributionId));
    check("with the box ticked it starts, and what was agreed to is kept with the amount and the moment", (await CO(monthly.contributionId)).kind === "monthly" && agreed?.kind === "monthly" && agreed.amountCents === 1000 && Math.abs(agreed.agreedAt.getTime() - Date.now()) < MIN);
    check("one monthly contribution for each person and project, counted from the card step on", /already contribute/.test((await refusal(start({ kind: "monthly", amount: "12", agreed: true }))) ?? ""));
    check("a contribution made once beside a monthly one is fine, and so is a second one", (await refusal(start({ amount: "5" }))) === null && (await refusal(start({ amount: "7.50" }))) === null);
    await S.payNow({ paymentId: monthly.paymentId, contributorId: giver.id });
    check("the first payment of a monthly contribution keeps the card for the months that follow", (await intentOf(monthly.paymentId)).setup_future_usage === "off_session");

    // A block between the two after the contribution started: the payment is no longer made ready, or shown.
    const cutOff = await start({ amount: "8" });
    await S.payNow({ paymentId: cutOff.paymentId, contributorId: giver.id });
    await db.insert(schema.blocks).values({ blockerId: giver.id, blockedId: host.id });
    const another = await start({ amount: "9", requestKey: randomUUID() }).catch(() => null);
    check("after a block between the two, a payment is neither made ready nor shown for paying, and nothing new starts", (await S.payNow({ paymentId: cutOff.paymentId, contributorId: giver.id })) === null && (await S.secretToPay({ paymentId: cutOff.paymentId, contributorId: giver.id })) === null && another === null);
    await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, giver.id), eq(schema.blocks.blockedId, host.id)));

    // A card step that ran out, by the clock, before the helper has been by.
    const lateOne = await start({ amount: "6" });
    check("after the card step's 30 minutes nothing is made ready any more", (await S.payNow({ paymentId: lateOne.paymentId, contributorId: giver.id, now: new Date(Date.now() + 31 * MIN) })) === null && (await PM(lateOne.paymentId)).intentRequestedAt === null);

    await endProject({ hostId: host.id, projectId: project.id, now: new Date() });
    check("a project that has ended takes no contributions", /has ended/.test((await refusal(start())) ?? ""));
  });

  // ========================================================================
  journey("The monthly rhythm, letting one payment go, and stopping", async () => {
    const host = await newHost();
    const { monthlyDue } = await import("../src/lib/contributions/rules");
    const paymentsOf = (contributionId: string) => db.select().from(pays).where(eq(pays.contributionId, contributionId)).orderBy(pays.number);
    /** Two rounds of the helper at one pretended moment: the first writes a month down, the second tries its card. */
    const rounds = async (now: Date) => {
      await runContributionJobs(now);
      await runContributionJobs(now);
    };
    const m = await held(host, { kind: "monthly", amountCents: 1000 });
    const first = (await CO(m.contributionId)).firstHoldAt!;
    await C.takePayment(m.paymentId, (await PM(m.paymentId)).takeAt!);
    await rounds(new Date(monthlyDue(first, 2).getTime() - MIN));
    check("before the next month's day nothing is written", (await paymentsOf(m.contributionId)).length === 1);
    await rounds(monthlyDue(first, 2));
    let all = await paymentsOf(m.contributionId);
    check("on its day the helper writes the month's payment down and holds the amount on the saved card", all.length === 2 && all[1].number === 2 && all[1].status === "held" && all[1].amountCents === 1000 && (await CO(m.contributionId)).lastWrittenMonth === 2, all.map((p) => `${p.number}:${p.status}`));
    await rounds(monthlyDue(first, 2));
    check("a second look on the same day writes nothing more", (await paymentsOf(m.contributionId)).length === 2 && (await CO(m.contributionId)).firstHoldAt!.getTime() === first.getTime());
    await C.takePayment(all[1].id, all[1].takeAt!);

    // The helper was down over the third month's day, and for more than 7 days after it.
    await rounds(new Date(monthlyDue(first, 3).getTime() + 7 * DAY + MIN));
    let c = await CO(m.contributionId);
    check("a month whose day lies more than 7 days back is skipped, and never made up for", (await paymentsOf(m.contributionId)).length === 2 && c.skippedMonths === "[3]" && c.lastWrittenMonth === 3 && c.status === "running");
    await rounds(new Date(monthlyDue(first, 4).getTime() + 2 * DAY));
    all = await paymentsOf(m.contributionId);
    check("the contribution goes on with the next month, also when the helper is two days late", all.length === 3 && all[2].number === 4 && all[2].status === "held");

    // Letting one payment go is not stopping.
    const stranger = await person("giver");
    check("only the contributor, the host or the founder can let a payment go", (await refusal(M.letPaymentGo({ paymentId: all[2].id, by: "contributor", actorId: stranger.id }))) !== null && (await refusal(M.letPaymentGo({ paymentId: all[2].id, by: "host", actorId: stranger.id }))) !== null && (await PM(all[2].id)).status === "held");
    await M.letPaymentGo({ paymentId: all[2].id, by: "host", actorId: host.id });
    c = await CO(m.contributionId);
    check("the host lets a month's hold go: nothing is charged for it, the month is skipped, and the contribution goes on", (await PM(all[2].id)).status === "given_up" && (await PM(all[2].id)).endedHow === "host_let_go" && (await intentOf(all[2].id)).status === "canceled" && c.status === "running" && c.skippedMonths === "[3,4]");
    check("a payment that was let go cannot be let go again, and one whose money was taken cannot be let go at all", /already cancelled/.test((await refusal(M.letPaymentGo({ paymentId: all[2].id, by: "host", actorId: host.id }))) ?? "") && /refund/.test((await refusal(M.letPaymentGo({ paymentId: m.paymentId, by: "contributor", actorId: m.giver.id }))) ?? ""));
    await rounds(monthlyDue(first, 5));
    all = await paymentsOf(m.contributionId);
    check("the month after a skipped one is held as usual", all.length === 4 && all[3].number === 5 && all[3].status === "held");

    // The founder lets one go, with a reason.
    const admin = await person("admin");
    await db.insert(schema.admins).values({ userId: admin.id });
    check("the founder needs a reason to let a payment go", /reason/.test((await refusal(M.letPaymentGo({ paymentId: all[3].id, by: "founder", actorId: admin.id, note: " " }))) ?? ""));
    await M.letPaymentGo({ paymentId: all[3].id, by: "founder", actorId: admin.id, note: "Asked for by the contributor" });
    check("with one, it is let go and written into the record of the founder's actions", (await PM(all[3].id)).endedHow === "founder_let_go" && (await db.select().from(schema.adminActions).where(and(eq(schema.adminActions.adminId, admin.id), eq(schema.adminActions.targetId, all[3].id)))).length === 1);

    // Stopping.
    await rounds(monthlyDue(first, 6));
    all = await paymentsOf(m.contributionId);
    check("(the sixth month is held)", all.length === 5 && all[4].status === "held");
    check("nobody else can stop a contribution", (await refusal(M.stopContribution({ contributionId: m.contributionId, contributorId: stranger.id }))) !== null && (await CO(m.contributionId)).status === "running");
    await setSwitches({ projects: "off" });
    await M.stopContribution({ contributionId: m.contributionId, contributorId: m.giver.id });
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    c = await CO(m.contributionId);
    check("the contributor stops, also while the founder's switch is off: it ends at once, and the month that was only held is let go", c.status === "ended" && c.endedHow === "stopped" && (await PM(all[4].id)).status === "given_up" && (await intentOf(all[4].id)).status === "canceled");
    check("money that was already taken is not touched by stopping", (await PM(m.paymentId)).status === "taken" && (await refundsOf(m.paymentId)).length === 0);
    await rounds(monthlyDue(first, 7));
    check("no further month is ever written", (await paymentsOf(m.contributionId)).length === 5);

    // A contribution made once, and a monthly one that never had its first hold.
    const once = await held(host);
    check("a host cannot cancel a payment the contributor has not paid yet", /Nothing is held/.test((await refusal(M.letPaymentGo({ paymentId: (await atCardStep(host)).paymentId, by: "host", actorId: host.id }))) ?? ""));
    await M.letPaymentGo({ paymentId: once.paymentId, by: "contributor", actorId: once.giver.id });
    check("\"Cancel, nothing is charged\" on a contribution made once: the hold is let go and the contribution ends", (await PM(once.paymentId)).status === "given_up" && (await PM(once.paymentId)).endedHow === "cancelled" && (await CO(once.contributionId)).status === "ended" && (await ledger({ contributionPaymentId: once.paymentId })).lines === 0);
    const early = await atCardStep(host, { kind: "monthly" });
    await M.letPaymentGo({ paymentId: early.paymentId, by: "contributor", actorId: early.giver.id });
    check("cancelling at the card step, before anything was paid, ends a monthly contribution that never began", (await CO(early.contributionId)).status === "ended" && (await PM(early.paymentId)).status === "given_up");
  });

  // ========================================================================
  journey("What ends a contribution from outside: a block, an account paused, suspended or closed, the project's end, and what the founder's switch does", async () => {
    const { block } = await import("../src/lib/safety/blocks");
    const { pauseAccount } = await import("../src/lib/safety/reports");
    const { closeAccount } = await import("../src/lib/profiles/closing");
    const { decideProfile } = await import("../src/lib/profiles/profiles");
    const { saveProjectsSwitch } = await import("../src/lib/contributions/switch");
    const { monthlyDue } = await import("../src/lib/contributions/rules");
    const admin = await person("admin");
    await db.insert(schema.admins).values({ userId: admin.id });
    const paymentsOf = (contributionId: string) => db.select().from(pays).where(eq(pays.contributionId, contributionId)).orderBy(pays.number);
    const rounds = async (now: Date) => {
      await runContributionJobs(now);
      await runContributionJobs(now);
    };
    /** Ended for that reason, its payment given up, and the hold gone at Stripe. */
    const endedFor = async (m: Made, how: string) => (await CO(m.contributionId)).status === "ended" && (await CO(m.contributionId)).endedHow === how && (await PM(m.paymentId)).status === "given_up" && (await intentOf(m.paymentId)).status === "canceled";
    const goesOn = async (m: Made) => (await CO(m.contributionId)).status === "running" && (await PM(m.paymentId)).status === "held";

    // A block.
    const host = await newHost();
    const a = await held(host, { kind: "monthly", amountCents: 1000 });
    const aOnce = await held(host, { giver: a.giver });
    const aTaken = await taken(host, { giver: a.giver });
    const bystander = await held(host);
    await block({ blockerId: a.giver.id, blockedId: host.id, now: new Date() });
    check("either blocks the other: the monthly contribution between them ends at once, and so does one made once that was only held; both holds are let go", (await endedFor(a, "blocked")) && (await endedFor(aOnce, "blocked")));
    check("money that was already taken is not touched by it, and neither is anyone else's contribution", (await PM(aTaken.paymentId)).status === "taken" && (await refundsOf(aTaken.paymentId)).length === 0 && (await goesOn(bystander)));

    // The net behind the block: one that was saved without ending the contribution (put in by hand) is caught by the helper.
    const missed = await held(host, { kind: "monthly", amountCents: 1000 });
    const missedFirst = (await CO(missed.contributionId)).firstHoldAt!;
    await C.takePayment(missed.paymentId, (await PM(missed.paymentId)).takeAt!);
    await db.insert(schema.blocks).values({ blockerId: host.id, blockedId: missed.giver.id });
    await rounds(monthlyDue(missedFirst, 2));
    check("the helper never writes a month for two people with a block between them: it ends the contribution instead", (await CO(missed.contributionId)).status === "ended" && (await CO(missed.contributionId)).endedHow === "blocked" && (await paymentsOf(missed.contributionId)).length === 1);

    // An account paused.
    const b = await held(host, { kind: "monthly", amountCents: 1000 });
    // (A new bystander: the helper's pretended month above has long passed the first one's hold.)
    const another = await held(host);
    await pauseAccount({ adminId: admin.id, userId: b.giver.id, ruleKey: "harassment", note: "", requestId: randomUUID() });
    check("a contributor's account is paused: their contributions end, and what was held is let go; nobody else's is touched", (await endedFor(b, "paused")) && (await goesOn(another)));

    // A host's page suspended, then her account closed.
    const hostTwo = await newHost();
    const hostThree = await newHost();
    const toHer = await held(hostTwo);
    const fromHer = await held(hostThree, { giver: hostTwo });
    await decideProfile({ userId: hostTwo.id, decision: "suspended", by: admin.id });
    check("a host's page is suspended: the contributions to her project end; what she contributes to another host goes on", (await endedFor(toHer, "suspended")) && (await goesOn(fromHer)));
    await closeAccount({ userId: hostTwo.id, by: admin.id });
    check("her account is closed: what she contributes to others ends too", await endedFor(fromHer, "closed"));

    // The host ends her project.
    const hostFour = await newHost();
    const e1 = await held(hostFour, { kind: "monthly", amountCents: 1000 });
    const e2 = await held(hostFour);
    const e3 = await taken(hostFour);
    await endProject({ hostId: hostFour.id, projectId: (await runningProjectOf(hostFour.id))!.id, now: new Date() });
    check("the host ends her project: every monthly contribution stops, and payments that are only held, monthly and once, are let go", (await endedFor(e1, "project_ended")) && (await endedFor(e2, "project_ended")));
    check("money that was already taken stays with the project and the host: nothing is returned by ending", (await PM(e3.paymentId)).status === "taken" && (await refundsOf(e3.paymentId)).length === 0 && (await shareOf(e3.paymentId)) !== undefined);

    // The founder's switch ends nothing.
    const covered = await newHost();
    const uncovered = await newHost();
    const s = await held(uncovered, { kind: "monthly", amountCents: 1000 });
    const sFirst = (await CO(s.contributionId)).firstHoldAt!;
    await C.takePayment(s.paymentId, (await PM(s.paymentId)).takeAt!);
    await rounds(monthlyDue(sFirst, 2));
    const second = (await paymentsOf(s.contributionId))[1];
    const sOnce = await held(uncovered);
    const sWaiting = await atCardStep(uncovered);
    const keeps = await held(covered, { kind: "monthly", amountCents: 1000 });
    const offAt = new Date(monthlyDue(sFirst, 2).getTime() + DAY);
    await saveProjectsSwitch({ adminId: admin.id, values: { projects: "named", projectsHosts: [covered.id] }, detail: "on for one host (check)", now: offAt });
    let c = await CO(s.contributionId);
    check("the switch stops covering a host: her monthly contributions stay, marked with that moment", c.status === "running" && c.switchOffAt?.getTime() === offAt.getTime());
    check("every payment of hers that is not taken is given up in that same step: one that is held, and one still waiting for its card", second?.status === "held" && (await PM(second.id)).endedHow === "switch" && (await intentOf(second.id)).status === "canceled" && (await PM(sOnce.paymentId)).endedHow === "switch" && (await PM(sWaiting.paymentId)).endedHow === "switch" && (await PM(sWaiting.paymentId)).status === "given_up");
    check("a host the switch still covers is not touched", (await goesOn(keeps)) && (await CO(keeps.contributionId)).switchOffAt === null);
    check("the change is written into the record of the founder's actions", (await db.select().from(schema.adminActions).where(and(eq(schema.adminActions.adminId, admin.id), eq(schema.adminActions.action, "projects switch set")))).length === 1);
    await rounds(monthlyDue(sFirst, 3));
    check("while it is off for her, no month is written", (await paymentsOf(s.contributionId)).length === 2);
    const onAt = new Date(monthlyDue(sFirst, 3).getTime() + 2 * DAY);
    await saveProjectsSwitch({ adminId: admin.id, values: { projects: "everyone" }, detail: "on for everyone (check)", now: onAt });
    c = await CO(s.contributionId);
    check("on again: the month whose day passed meanwhile is recorded as skipped, and only that one; the mark is cleared", c.switchOffAt === null && c.skippedMonths === "[3]" && c.status === "running");
    await rounds(onAt);
    check("that month is never charged afterwards, although its day was only two days ago, and no old payment comes back", (await paymentsOf(s.contributionId)).length === 2 && (await PM(second.id)).status === "given_up");
    await rounds(monthlyDue(sFirst, 4));
    const fourth = (await paymentsOf(s.contributionId))[2];
    check("the contribution goes on from its next usual day", fourth?.number === 4 && fourth.status === "held");
  });

  // ========================================================================
  journey("The emails: one for each payment at its hold, and each thing a person has to be told", async () => {
    const { monthlyDue } = await import("../src/lib/contributions/rules");
    const { block } = await import("../src/lib/safety/blocks");
    const mail = async (to: Person, subject: string) => db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to.email), like(schema.emailOutbox.subject, `%${subject}%`)));
    const rounds = async (now: Date) => {
      await runContributionJobs(now);
      await runContributionJobs(now);
    };
    const host = await newHost();
    const page = (m: Made) => `/contributions/${m.contributionId}`;

    // Made once.
    const once = await atCardStep(host);
    check("nothing is sent before a hold is in place", (await mail(once.giver, "")).length === 0 && (await mail(host, "")).length === 0);
    await pay(once.paymentId);
    let sent = await mail(once.giver, "Your contribution to");
    check("when the hold is in place the contributor gets one email: the amount, the moment the money is taken, and the link to cancel before then", sent.length === 1 && sent[0].body.includes("$25.00") && sent[0].body.includes("The money is taken on") && sent[0].body.includes(page(once)) && /receipt/.test(sent[0].body));
    check("the host is told that someone contributes, and a contribution made once has no agreement email", (await mail(host, "contributes to")).length === 1 && (await mail(once.giver, "monthly contribution")).length === 0);
    await C.syncPayment(once.paymentId, new Date());
    await C.takePayment(once.paymentId, (await PM(once.paymentId)).takeAt!);
    check("no second email is sent when the money is taken, however often Stripe is asked", (await mail(once.giver, "")).length === 1);

    // Cancelled while held: "nothing was charged" only once that is known.
    const gone = await held(host);
    await M.letPaymentGo({ paymentId: gone.paymentId, by: "contributor", actorId: gone.giver.id });
    sent = await mail(gone.giver, "Nothing was charged");
    check("\"nothing was charged\" is sent once Stripe has confirmed that the hold is gone, with the reason", (await intentOf(gone.paymentId)).status === "canceled" && sent.length === 1 && sent[0].body.includes("You cancelled it."));
    const never = await atCardStep(host);
    await C.giveUp(never.paymentId, "card_step", new Date());
    check("a payment that never had a hold gets no such email: there was nothing to let go", (await PM(never.paymentId)).status === "given_up" && (await mail(never.giver, "")).length === 0);
    // The money was taken at that very moment: nothing claims "nothing was charged".
    const raced = await held(host);
    await stripe().paymentIntents.capture((await PM(raced.paymentId)).stripePaymentIntentId!);
    await M.letPaymentGo({ paymentId: raced.paymentId, by: "contributor", actorId: raced.giver.id });
    check("when the money was taken at that very moment, \"nothing was charged\" is never said", (await PM(raced.paymentId)).status === "taken" && (await mail(raced.giver, "Nothing was charged")).length === 0);
    await R.runRefunds(new Date());
    sent = await mail(raced.giver, "was paid back");
    check("the refund that follows is told when it has really gone back", (await refundsOf(raced.paymentId))[0].status === "done" && sent.length === 1 && sent[0].subject.includes("$25.00"));

    // Monthly.
    const m = await held(host, { kind: "monthly", amountCents: 1000 });
    const first = (await CO(m.contributionId)).firstHoldAt!;
    sent = await mail(m.giver, "Your monthly contribution to");
    check("a monthly contribution's first hold: the agreement is confirmed at once, word for word, with how to stop", sent.length === 1 && sent[0].body.includes("holds $10.00 on your card today and every month, and takes it three days later each time, until you cancel") && sent[0].body.includes("Stop contributing") && sent[0].body.includes(page(m)));
    check("and the email for the payment is sent as well", (await mail(m.giver, "Your contribution to")).length === 1);
    await C.takePayment(m.paymentId, (await PM(m.paymentId)).takeAt!);
    await rounds(monthlyDue(first, 2));
    check("every month's hold has its own email; the host is told once, not every month", (await mail(m.giver, "Your contribution to")).length === 2 && (await mail(m.giver, "Your monthly contribution to")).length === 1 && (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, host.email), like(schema.emailOutbox.body, `%${m.giver.name}%`), like(schema.emailOutbox.subject, "%contributes to%")))).length === 1);
    const second = (await db.select().from(pays).where(eq(pays.contributionId, m.contributionId)).orderBy(pays.number))[1];
    await C.takePayment(second.id, second.takeAt!);

    // A month whose card fails.
    await saveCard(m, "pm_card_chargeCustomerFail");
    await rounds(monthlyDue(first, 3));
    sent = await mail(m.giver, "did not go through");
    check("a monthly payment that fails: the contributor gets an email with the link to pay, and is told nothing has been charged", sent.length === 1 && sent[0].body.includes(page(m)) && sent[0].body.includes("Nothing has been charged") && sent[0].body.includes("is stopped"));
    await rounds(new Date(monthlyDue(first, 3).getTime() + DAY + MIN));
    check("each try that fails has its own email, and none is sent twice", (await mail(m.giver, "did not go through")).length === 2);

    // Ended.
    await M.stopContribution({ contributionId: m.contributionId, contributorId: m.giver.id });
    sent = await mail(m.giver, "has ended");
    check("the contributor stops: they are told it has ended and why, and the host is told one of her monthly contributors is gone", sent.length === 1 && sent[0].body.includes("You stopped it.") && (await mail(host, "A monthly contribution to")).length === 1);
    const cut = await held(host, { kind: "monthly", amountCents: 1000 });
    await block({ blockerId: host.id, blockedId: cut.giver.id, now: new Date() });
    sent = await mail(cut.giver, "has ended");
    check("ended by a block: the contributor is told it ended, with no reason that gives the block away, and the host gets no email about it", sent.length === 1 && sent[0].body.includes("It can no longer go on.") && !/block/i.test(sent[0].body) && (await mail(host, "A monthly contribution to")).length === 1);
    const last = await held(host, { kind: "monthly", amountCents: 1000 });
    await endProject({ hostId: host.id, projectId: (await runningProjectOf(host.id))!.id, now: new Date() });
    sent = await mail(last.giver, "has ended");
    check("the host ends her project: her monthly contributors are told so by email", sent.length === 1 && sent[0].body.includes("ended the project") && (await mail(last.giver, "Nothing was charged")).length === 1);

    // The founder's notice.
    const admin = await person("admin");
    await db.insert(schema.admins).values({ userId: admin.id });
    const big = await newHost();
    const giver = await person("giver");
    await held(big, { giver, amountCents: 60_000 });
    check("under the $1,000 line the founder gets no email", (await mail(admin, "over $1,000")).length === 0);
    await held(big, { giver, amountCents: 60_000 });
    await held(big, { giver, amountCents: 60_000 });
    sent = await mail(admin, "over $1,000");
    check("when one person's contributions to a host cross $1,000 in 30 days the founder is told, once", sent.length === 1 && sent[0].body.includes("$1200.00") && sent[0].body.includes("/admin/projects"));

    const all = await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.to, `contributioncheck-${RUN}-%`));
    check("no email calls a contribution a donation", all.length > 10 && all.every((email) => !/donat/i.test(email.body.replace(/not a donation to a charity/g, "")) && !/donat/i.test(email.subject)));
  });

  // ========================================================================
  journey("What Astra's reviews of this step found, each as a case of its own", async () => {
    const { monthlyDue } = await import("../src/lib/contributions/rules");
    const { saveProjectsSwitch } = await import("../src/lib/contributions/switch");
    const { lockPair } = await import("../src/lib/contributions/locks");
    const V = await import("../src/lib/contributions/views");
    const paymentsOf = (contributionId: string) => db.select().from(pays).where(eq(pays.contributionId, contributionId)).orderBy(pays.number);
    const mail = async (to: Person, subject: string) => db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to.email), like(schema.emailOutbox.subject, `%${subject}%`)));
    const rounds = async (now: Date) => {
      await runContributionJobs(now);
      await runContributionJobs(now);
    };
    const admin = await person("admin");
    await db.insert(schema.admins).values({ userId: admin.id });
    const host = await newHost();
    /**
     * Waits until another step is really waiting for this very pair's lock, which the case holds: only then are the
     * two in the order the case is about. (The lock is named as locks.ts names it; nothing else waits for that one.)
     */
    const untilWaiting = async (contributorId: string, hostId: string): Promise<boolean> => {
      const key = `pair:${contributorId}:${hostId}`;
      for (let i = 0; i < 100; i++) {
        const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and objid::bigint = (hashtext(${key})::bigint & 4294967295)`);
        if (row.n > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };

    // A month that was written down, and the helper stopped before it tried the card.
    const m = await held(host, { kind: "monthly", amountCents: 1000 });
    const first = (await CO(m.contributionId)).firstHoldAt!;
    await C.takePayment(m.paymentId, (await PM(m.paymentId)).takeAt!);
    await runContributionJobs(monthlyDue(first, 2));
    let all = await paymentsOf(m.contributionId);
    check("(the helper wrote the second month down and stopped before it tried the card)", all.length === 2 && all[1].status === "to_pay" && (await operations(all[1].id, "hold")).length === 0);
    await rounds(new Date(monthlyDue(first, 2).getTime() + 7 * DAY + MIN));
    check("just after its 7 days the month is neither tried nor given up yet: the helper waits a moment, in case a hold placed by hand in time is still to be heard of", (await PM(all[1].id)).status === "to_pay" && (await PM(all[1].id)).endedHow === null && (await operations(all[1].id, "hold")).length === 0);
    await rounds(new Date(monthlyDue(first, 2).getTime() + 7 * DAY + 10 * MIN));
    let c = await CO(m.contributionId);
    check("when the helper comes back more than 7 days after that month's day, the month is not charged: it is missed and skipped, and the contribution goes on", (await PM(all[1].id)).status === "given_up" && (await PM(all[1].id)).endedHow === "missed" && (await operations(all[1].id, "hold")).length === 0 && c.status === "running" && c.skippedMonths === "[2]");
    await rounds(monthlyDue(first, 3));
    all = await paymentsOf(m.contributionId);
    check("the next month is held on its day, and only that one", all.length === 3 && all[2].number === 3 && all[2].status === "held");
    await C.takePayment(all[2].id, all[2].takeAt!);
    await runContributionJobs(monthlyDue(first, 4));
    // (One round only: a second round at this pretended moment would be long past the new hold's own last moment.)
    await runContributionJobs(new Date(monthlyDue(first, 4).getTime() + 6 * DAY));
    all = await paymentsOf(m.contributionId);
    check("a month that was written down and is tried 6 days late is still held", all.length === 4 && all[3].status === "held", all.map((p) => `${p.number}:${p.status}:${p.endedHow}`));

    // The switch is saved at the very moment a monthly contribution's first hold is accepted.
    const racing = await atCardStep(host, { kind: "monthly", amountCents: 1000 });
    let save: Promise<void> = Promise.resolve();
    let released = 0;
    let saveWaited = false;
    await db.transaction(async (tx) => {
      await lockPair(tx, racing.giver.id, host.id);
      // The save reads what it has to do now (the contribution is still at its card step), then waits for this pair.
      save = saveProjectsSwitch({ adminId: admin.id, values: { projects: "off" }, detail: "off (check)" });
      saveWaited = await untilWaiting(racing.giver.id, host.id);
      // Meanwhile the first hold is accepted (put in by hand, as that step writes it).
      const soon = new Date(Date.now() + 3 * DAY);
      await tx.update(pays).set({ status: "held", authorisedAt: new Date(), holdExpiresAt: new Date(soon.getTime() + DAY), takeAt: soon, takeBy: new Date(soon.getTime() + 23 * HOUR) }).where(eq(pays.id, racing.paymentId));
      await tx.update(schema.contributions).set({ status: "running", firstHoldAt: new Date() }).where(eq(schema.contributions.id, racing.contributionId));
      released = Date.now();
    });
    await save;
    c = await CO(racing.contributionId);
    check("(the save had read what it has to do, and was waiting for the pair, when the first hold was accepted)", saveWaited);
    check("a contribution whose first hold is accepted while the switch is being saved is still marked, and its payment given up", c.status === "running" && c.switchOffAt !== null && (await PM(racing.paymentId)).endedHow === "switch", { status: c.status, mark: c.switchOffAt, payment: (await PM(racing.paymentId)).endedHow });
    check("the moment of the switch is read after its locks were got, not when the press arrived", c.switchOffAt !== null && c.switchOffAt.getTime() >= released);
    await saveProjectsSwitch({ adminId: admin.id, values: { projects: "everyone" }, detail: "on (check)" });

    // Contributions that are not due yet never take the places of one that is. (Fixed days, so the case is the same whenever it runs.)
    const crowded = await newHost();
    const project = (await runningProjectOf(crowded.id))!;
    const insert = async (firstHoldAt: Date, updatedAt: Date) => {
      const giver = await person("giver");
      const [row] = await db.insert(schema.contributions).values({ projectId: project.id, hostId: crowded.id, contributorId: giver.id, kind: "monthly", amountCents: 1000, status: "running", requestKey: randomUUID(), firstHoldAt, lastWrittenMonth: 1, updatedAt }).returning();
      return row;
    };
    const at = new Date("2027-03-15T12:00:00Z");
    // Fifty-five whose second month is 18 hours away at that moment, all touched long ago; then one whose second month fell due three days before it.
    const tomorrow = Array.from({ length: 55 }, (_, i) => new Date(Date.parse("2027-02-16T06:00:00Z") + i * 1000));
    for (const anchor of tomorrow) await insert(anchor, new Date("2026-01-01T00:00:00Z"));
    const dueOne = await insert(new Date("2027-02-12T12:00:00Z"), new Date());
    check("(the days of the case: fifty-five second months fall due 18 hours after that moment, and one fell due three days before it)", tomorrow.every((anchor) => monthlyDue(anchor, 2).getTime() - at.getTime() >= 18 * HOUR && monthlyDue(anchor, 2).getTime() - at.getTime() < 19 * HOUR) && at.getTime() - monthlyDue(dueOne.firstHoldAt!, 2).getTime() === 3 * DAY);
    // (Twice: other contributions of this run whose day lies further back come first, and leave the list once they were dealt with.)
    await M.writeDuePayments(at);
    await M.writeDuePayments(at);
    const untouched = await db.select({ id: schema.contributions.id }).from(schema.contributions).where(and(eq(schema.contributions.hostId, crowded.id), eq(schema.contributions.lastWrittenMonth, 1)));
    check("with more than a batch of contributions that are due only tomorrow, the one that is due today is written, and none of the others is", (await paymentsOf(dueOne.id)).length === 1 && untouched.length === 55, { written: (await paymentsOf(dueOne.id)).length, untouched: untouched.length });

    // What a person is told.
    for (const how of ["card_step", "host_let_go", "hold_lost", "not_taken_in_time", "no_hold_end", "project_ended", "stopped", "blocked", "paused"]) {
      if (/charged/i.test(V.endedWords(how))) check(`why a contribution ended ("${how}") says nothing about what was charged`, false, V.endedWords(how));
    }
    check("why a contribution ended never says what was charged: each payment's own line does, from what is known about it", true);
    const lateHold = await atCardStep(host, { cardStepMs: 2000 });
    await C.intentFor(lateHold.paymentId);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await confirmOnly(lateHold.paymentId);
    await C.syncPayment(lateHold.paymentId, new Date());
    const rejected = await PM(lateHold.paymentId);
    check("a hold that arrives after the card step's time is not accepted, but it is kept that a hold was there: once it is let go, its contributor is told so", rejected.status === "given_up" && rejected.endedHow === "card_step" && rejected.authorisedAt !== null && (await intentOf(lateHold.paymentId)).status === "canceled" && (await mail(lateHold.giver, "Nothing was charged")).length === 1, { status: rejected.status, endedHow: rejected.endedHow, authorisedAt: rejected.authorisedAt });

    // "Projects you support" keeps a contribution that ended after a month that was never paid.
    const history = await held(host, { kind: "monthly", amountCents: 1000 });
    const hFirst = (await CO(history.contributionId)).firstHoldAt!;
    await C.takePayment(history.paymentId, (await PM(history.paymentId)).takeAt!);
    await runContributionJobs(monthlyDue(hFirst, 2));
    await M.stopContribution({ contributionId: history.contributionId, contributorId: history.giver.id });
    const left = await atCardStep(host, { giver: history.giver });
    await C.giveUp(left.paymentId, "card_step", new Date());
    const supported = await V.supportedBy(history.giver.id);
    check("a contribution that ended after a month that was never paid still began, and stays in the person's list; one left at the card step did not begin", supported.find((s) => s.contribution.id === history.contributionId)?.began === true && supported.find((s) => s.contribution.id === history.contributionId)?.latest?.authorisedAt === null && supported.find((s) => s.contribution.id === left.contributionId)?.began === false);

    // The founder's notice: once for each crossing of the line.
    const big = await newHost();
    const giver = await person("giver");
    const b1 = await taken(big, { giver, amountCents: 60_000 });
    check("under the line the founder is not told, and nothing is marked", (await mail(admin, "over $1,000")).length === 0 && !(await PM(b1.paymentId)).thirtyDayMark);
    const b2 = await held(big, { giver, amountCents: 60_000 });
    await C.syncPayment(b2.paymentId, new Date());
    check("the founder is told once when a new hold crosses the line, however often the pair is counted afterwards", (await mail(admin, "over $1,000")).length === 1 && (await mail(admin, "over $1,000"))[0].body.includes("$1200.00"));
    check("a payment that was taken before the line was crossed carries the mark too, so the founder's list shows it", (await PM(b1.paymentId)).thirtyDayMark && (await PM(b2.paymentId)).thirtyDayMark && (await shareOf(b1.paymentId)).transferDueAt?.getTime() === b1.at.getTime() + 30 * DAY);
    const giver2 = await person("giver");
    const c1 = await held(big, { giver: giver2, amountCents: 60_000 });
    await held(big, { giver: giver2, amountCents: 60_000 });
    const before = (await mail(admin, "over $1,000")).length;
    // One of the two holds is let go: under the line again, while the other keeps its mark. Then a new hold.
    await C.giveUp(c1.paymentId, "cancelled", new Date());
    await held(big, { giver: giver2, amountCents: 60_000 });
    check("after one of the holds that crossed it was let go, crossing the line again is a new crossing, and the founder is told again", before === 2 && (await mail(admin, "over $1,000")).length === 3, { before, after: (await mail(admin, "over $1,000")).length });

    // A try that was started and has no answer yet is a try: its month is not given up as missed.
    const u = await held(host, { kind: "monthly", amountCents: 1000 });
    const uFirst = (await CO(u.contributionId)).firstHoldAt!;
    await C.takePayment(u.paymentId, (await PM(u.paymentId)).takeAt!);
    await runContributionJobs(monthlyDue(uFirst, 2));
    const uSecond = (await paymentsOf(u.contributionId))[1];
    const [onItsWay] = await db.insert(schema.moneyOperations).values({ contributionPaymentId: uSecond.id, kind: "hold", label: `contributionhold:${uSecond.id}:1:1`, params: JSON.stringify({ intentId: "pi_made_up", paymentMethodId: "pm_made_up" }) }).returning();
    await rounds(new Date(monthlyDue(uFirst, 2).getTime() + 7 * DAY + 10 * MIN));
    check("a month whose first try is on its way to Stripe when the 7 days end is not given up as missed: the try keeps its own ending", (await PM(uSecond.id)).status === "to_pay" && (await PM(uSecond.id)).endedHow === null && (await CO(u.contributionId)).skippedMonths === "[]");
    await db.update(schema.moneyOperations).set({ status: "failed", finishedAt: new Date() }).where(eq(schema.moneyOperations.id, onItsWay.id));

    // Paying a month by hand: possible while the helper has not tried it, and not after its 7 days.
    const late = await held(host, { kind: "monthly", amountCents: 1000 });
    await C.takePayment(late.paymentId, (await PM(late.paymentId)).takeAt!);
    const lateSecond = await nextMonth(late, 2, new Date());
    check("a month the helper has not tried yet can be paid by hand", Boolean(await S.payNow({ paymentId: lateSecond, contributorId: late.giver.id })));
    // (Its day is moved more than 7 days back, by moving the contribution's first hold by hand.)
    await db.update(schema.contributions).set({ firstHoldAt: new Date(Date.now() - 40 * DAY) }).where(eq(schema.contributions.id, late.contributionId));
    check("more than 7 days after its day it is neither made ready nor shown for paying", (await S.payNow({ paymentId: lateSecond, contributorId: late.giver.id })) === null && (await S.secretToPay({ paymentId: lateSecond, contributorId: late.giver.id })) === null);
    await stripe().paymentIntents.confirm((await PM(lateSecond)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
    const refusedLate = await C.syncPayment(lateSecond, new Date());
    check("a hold that still arrives for it (from a page left open) is not accepted: it is let go, the month is skipped, the contribution goes on, and the contributor is told nothing was charged", refusedLate.status === "given_up" && refusedLate.endedHow === "missed" && (await intentOf(lateSecond)).status === "canceled" && (await CO(late.contributionId)).status === "running" && (await CO(late.contributionId)).skippedMonths === "[2]" && (await mail(late.giver, "Nothing was charged")).length === 1, { status: refusedLate.status, endedHow: refusedLate.endedHow, skipped: (await CO(late.contributionId)).skippedMonths });

    // The helper looked at Stripe before the contributor paid by hand, in time; the answer to that look comes after the 7 days.
    const justInTime = await held(host, { kind: "monthly", amountCents: 1000 });
    await C.takePayment(justInTime.paymentId, (await PM(justInTime.paymentId)).takeAt!);
    const jSecond = await nextMonth(justInTime, 2, new Date());
    await S.payNow({ paymentId: jSecond, contributorId: justInTime.giver.id });
    const intents = stripe().paymentIntents;
    const early = await intents.retrieve((await PM(jSecond)).stripePaymentIntentId!, { expand: ["latest_charge", "payment_method"] });
    // (Its day is moved by hand so that its 7 days end some days from now, whatever the calendar says today;
    // the helper's round is then pretended to come three minutes after they end.)
    const anchor = new Date(Date.now() - 20 * DAY);
    await db.update(schema.contributions).set({ firstHoldAt: anchor }).where(eq(schema.contributions.id, justInTime.contributionId));
    const deadline = monthlyDue(anchor, 2).getTime() + 7 * DAY;
    await intents.confirm(early.id, { payment_method: "pm_card_visa", return_url: RETURN });
    const heldInTime = Date.now() < deadline;
    const realRetrieve = intents.retrieve;
    let firstLook = true;
    intents.retrieve = ((...args: unknown[]) => {
      if (firstLook) {
        firstLook = false;
        return Promise.resolve(early);
      }
      return Reflect.apply(realRetrieve, intents, args);
    }) as unknown as typeof intents.retrieve;
    try {
      await C.tryHold(jSecond, new Date(deadline + 3 * MIN));
    } finally {
      intents.retrieve = realRetrieve;
    }
    check("a hold the contributor placed by hand within the 7 days is accepted, also when the helper's look at Stripe was made before it and answered after them: the month is not given up as missed", heldInTime && early.status !== "requires_capture" && !firstLook && (await PM(jSecond)).status === "held" && (await PM(jSecond)).endedHow === null && (await CO(justInTime.contributionId)).skippedMonths === "[]", { heldInTime, early: early.status, status: (await PM(jSecond)).status, endedHow: (await PM(jSecond)).endedHow });

    // A contributor pays, and cancels before we have heard of the hold.
    const unheard = await atCardStep(host);
    await confirmOnly(unheard.paymentId);
    await M.letPaymentGo({ paymentId: unheard.paymentId, by: "contributor", actorId: unheard.giver.id });
    check("a hold we had not heard of when its payment was cancelled is still kept as a hold that was there: once it is gone, its contributor is told", (await PM(unheard.paymentId)).status === "given_up" && (await PM(unheard.paymentId)).authorisedAt !== null && (await intentOf(unheard.paymentId)).status === "canceled" && (await mail(unheard.giver, "Nothing was charged")).length === 1);
    const neverPaid = await atCardStep(host);
    await C.intentFor(neverPaid.paymentId);
    await M.letPaymentGo({ paymentId: neverPaid.paymentId, by: "contributor", actorId: neverPaid.giver.id });
    check("and a payment that never had a hold still gets no such email", (await PM(neverPaid.paymentId)).status === "given_up" && (await PM(neverPaid.paymentId)).authorisedAt === null && (await mail(neverPaid.giver, "Nothing was charged")).length === 0);

    // The contributor stops at the very moment the host ends her project.
    const closing = await newHost();
    const q = await held(closing, { kind: "monthly", amountCents: 1000 });
    await C.takePayment(q.paymentId, (await PM(q.paymentId)).takeAt!);
    const closingProject = (await runningProjectOf(closing.id))!.id;
    let ending: Promise<unknown> = Promise.resolve();
    let endingWaited = false;
    await db.transaction(async (tx) => {
      await lockPair(tx, q.giver.id, closing.id);
      // The ending reads who contributes now (this contribution is still running), then waits for this pair.
      ending = endProject({ hostId: closing.id, projectId: closingProject, now: new Date() });
      endingWaited = await untilWaiting(q.giver.id, closing.id);
      // Meanwhile their own stop is saved (put in by hand, as that step writes it).
      await tx.update(schema.contributions).set({ status: "ended", endedAt: new Date(), endedHow: "stopped" }).where(eq(schema.contributions.id, q.contributionId));
    });
    await ending;
    check("someone who stopped at the very moment the project ended is still told that it ended", endingWaited && (await mail(q.giver, "\" has ended")).length === 1, { endingWaited, mails: (await mail(q.giver, "has ended")).map((email) => email.subject) });

    // The founder reaches every payment of a project, also an ordinary one.
    const plain = await taken(big, { amountCents: 2500 });
    const attention = await V.forFounder();
    const listed = await V.projectPaymentsForFounder((await runningProjectOf(big.id))!.id, 1);
    check("an ordinary payment is not in the founder's attention list, and is in its project's own list, where the founder can hold it back or refund it", !attention.rows.some((row) => row.payment.id === plain.paymentId) && listed.rows.some((row) => row.payment.id === plain.paymentId && row.refundableCents === 2500) && listed.older === false);
    check("the total a project received is a plain number, also when it is large", typeof attention.received.get((await runningProjectOf(big.id))!.id) === "number");

    // The project ends: everyone whose money it took is told, each once.
    const paidOnce = await taken(big, { amountCents: 2500 });
    const monthlyOne = await held(big, { kind: "monthly", amountCents: 1000 });
    await endProject({ hostId: big.id, projectId: (await runningProjectOf(big.id))!.id, now: new Date() });
    check("when a project ends, someone whose contribution made once was taken is told by email, and a monthly contributor gets the one email about their contribution ending", (await mail(paidOnce.giver, "has ended")).length === 1 && (await mail(monthlyOne.giver, "has ended")).length === 1 && /ended the project/.test((await mail(monthlyOne.giver, "has ended"))[0].body));
  });

  // ========================================================================
  journey("The pages: only a pressed button starts anything, and every action takes the person from the login", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const uses: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(path, "utf8");
          if (/contributions\/(start|monthly|charge|refund|founder|switch|ending)["']/.test(text)) uses.push({ path, text });
        }
      }
    };
    walk("src/app");
    const contributors = ["src/app/contributions/actions.ts", "src/app/contributions/new/page.tsx", "src/app/contributions/[id]/page.tsx", "src/app/api/contributions/[id]/sync/route.ts", "src/app/h/[handle]/project/diary.tsx"];
    const hosts = ["src/app/host/project/contribution-actions.ts"];
    const founders = ["src/app/admin/projects/contribution-actions.ts", "src/app/admin/projects/actions.ts"];
    const known = [...contributors, ...hosts, ...founders];
    check("only the contributor's, the host's and the founder's own pages reach the code that starts, pays, stops or refunds a contribution", uses.every((file) => known.includes(file.path)) && uses.length === known.length, { found: uses.map((file) => file.path) });

    // "Starting is an action; loading is only reading": nothing that is drawn on opening a page may write a
    // contribution or a payment, or ask Stripe for one. (Recording what Stripe shows belongs to the one address the card form posts to.)
    const isRoute = (file: { path: string }) => file.path.endsWith("/route.ts");
    const writes = /\b(startContribution|payNow|intentFor|syncPayment|recordIntent|tryHold|takePayment|giveUp|letGo|letGoAll|stopContribution|letPaymentGo|refundContribution|runRefunds|holdBack|release|saveProjectsSwitch|endContribution|writeDuePayments|writeDownPayment)\b/;
    const starting = uses.filter((file) => !file.text.startsWith("\"use server\"") && !isRoute(file) && [...file.text.matchAll(/import \{([^}]*)\} from "@\/lib\/contributions\/[a-z]+";/g)].some((match) => writes.test(match[1]))).map((file) => file.path);
    const routes = uses.filter(isRoute);
    check("no page that is only being opened can start a contribution, a payment, a stop or a refund, and the one address that asks Stripe only answers a post", starting.length === 0 && routes.length === 1 && routes.every((file) => /export async function POST\(/.test(file.text) && !/export async function (GET|PUT|PATCH|DELETE)\(/.test(file.text)), { starting, routes: routes.map((file) => file.path) });
    check("that address records a payment only for its own contributor", /contributionFor\(user\.id, id\)/.test(routes[0]?.text ?? "") && /found\?\.payments\.find/.test(routes[0]?.text ?? ""));

    const actionsOf = (path: string) => (uses.find((file) => file.path === path)?.text ?? "").split(/^export async function /m).slice(1);
    const mine = actionsOf("src/app/contributions/actions.ts");
    check("each of the contributor's actions asks who is signed in and acts as that person; none takes the person from the form", mine.length === 4 && mine.every((action) => /const user = await require(Active)?User\("\/account"\);/.test(action) && /(contributorId|actorId): user\.id/.test(action)) && !/formData\.get\("(contributorId|userId|actorId)"\)/.test(mine.join("")));
    check("cancelling and stopping work for a paused account too; starting and paying do not", mine.filter((action) => /^(cancelPaymentAction|stopContributionAction)/.test(action)).every((action) => action.includes("await requireUser(")) && mine.filter((action) => /^(startContributionAction|payNowAction)/.test(action)).every((action) => action.includes("await requireActiveUser(")));
    const hers = actionsOf("src/app/host/project/contribution-actions.ts");
    check("each of the host's actions asks who is signed in and acts as that host", hers.length === 3 && hers.every((action) => /const user = await require(Active)?User\(PAGE\);/.test(action) && /(hostId|actorId|deciderId): user\.id/.test(action)) && !/formData\.get\("(hostId|userId|actorId|deciderId)"\)/.test(hers.join("")));
    const founders2 = actionsOf("src/app/admin/projects/contribution-actions.ts");
    check("each of the founder's actions asks for the founder's login first, and gives the founder as who did it", founders2.length === 4 && founders2.every((action) => /^\w+\(formData: FormData\) \{\n  const admin = await requireAdmin\(\);/.test(action) && /(adminId|actorId|deciderId): admin\.id/.test(action)));
    check("a refund by the founder needs a reason, and so does letting a payment go", /if \(!reason\) throw new ContributionError\("Please give a reason\. It is kept\."\);/.test(founders2.join("")) && /by === "founder" && !note\) throw/.test(readFileSync("src/lib/contributions/monthly.ts", "utf8")));

    // What a person is shown.
    const summary = readFileSync("src/app/contributions/new/page.tsx", "utf8");
    check("the summary page makes only a request's id; it writes nothing", /name="request" value=\{randomUUID\(\)\}/.test(summary) && !/\.insert\(|\.update\(/.test(summary));
    const { summarySentences, agreementBox } = await import("../src/lib/contributions/wording");
    const once = summarySentences({ kind: "once", amountCents: 2500, hostName: "Hana", projectName: "Bread" }).join(" ");
    const monthlyWords = summarySentences({ kind: "monthly", amountCents: 1000, hostName: "Hana", projectName: "Bread" }).join(" ");
    check("before paying once, the page says what the rulebook asks: the amount, held first and normally three days, cancel and pay nothing, supports the project and buys no call or reward, no charity and no tax deduction, refunds are the host's decision", /\$25\.00, once/.test(once) && /first only held/.test(once) && /three days/.test(once) && /cancel and pay nothing/.test(once) && /does not buy a call or any promised reward/.test(once) && /not a donation to a charity/.test(once) && /no charitable tax deduction/.test(once) && /Hana's decision/.test(once));
    check("before a monthly contribution it also says: every month, starting with a hold today, taken three days later each time, how to stop", /\$10\.00 every month, starting with a hold today/.test(monthlyWords) && /taken three days later/.test(monthlyWords) && /stop at any time/.test(monthlyWords) && agreementBox(1000) === "I agree that Connect holds $10.00 on my card today and every month, and takes it three days later each time, until I cancel.");
    const ownPage = readFileSync("src/app/contributions/[id]/page.tsx", "utf8");
    check("\"nothing was charged\" is said on the page only for a payment whose hold is certainly gone; until then it says the payment is being cancelled", /state === "cancelling" && \(\s*<>\s*<p className="mt-1">We are cancelling this payment\./.test(ownPage) && /state === "cancelled" && <p className="mt-1">\{payment\.authorisedAt \? "Cancelled\. The hold was let go, and nothing was charged\."/.test(ownPage));
    const { stateOf } = await import("../src/lib/contributions/views");
    check("a payment that was given up and whose hold is not yet let go is \"being cancelled\", never \"cancelled\"", stateOf({ status: "held", endedHow: "cancelled", problem: null, needsAction: false, firstFailedAt: null }) === "cancelling" && stateOf({ status: "given_up", endedHow: "cancelled", problem: null, needsAction: false, firstFailedAt: null }) === "cancelled" && stateOf({ status: "to_pay", endedHow: null, problem: null, needsAction: true, firstFailedAt: new Date() }) === "confirm");
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
      let holder = host;
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
        // A payment Stripe already holds and that we have not heard of yet (the contributor just paid with a new card).
        // (With a host of her own, so the 24 hours between two collections do not come into it.)
        const other = await newHost();
        await give(host.id, other.id);
        holder = other;
        const fresh = await person("giver");
        const f1 = await taken(other, { giver: fresh, amountCents: 60_000 });
        const f2 = await atCardStep(other, { giver: fresh, amountCents: 60_000 });
        await confirmOnly(f2.paymentId);
        const unheard = await collectEarnings({ collectionId: randomUUID(), hostId: other.id, startedBy: other.id, now: new Date(f1.at.getTime() + 8 * DAY) }).then(() => null, (error: unknown) => error as Error);
        check("a collection asks Stripe first about a payment that may just have been paid: its hold is recorded and counted, so the earlier share waits 30 days and is not sent", unheard instanceof MoneyError && (await PM(f2.paymentId)).status === "held" && (await shareOf(f1.paymentId)).transferDueAt?.getTime() === f1.at.getTime() + 30 * DAY && (await shareOf(f1.paymentId)).transferStatus === "not_due", unheard?.message);
        // And when Stripe cannot be asked about such a payment, that person's shares wait for this collection.
        // (The script makes Stripe's look-up fail once, as a network fault would.)
        const quiet = await person("giver");
        const q1 = await taken(other, { giver: quiet });
        const q2 = await atCardStep(other, { giver: quiet });
        await C.intentFor(q2.paymentId);
        const pressOther = (now: Date) => collectEarnings({ collectionId: randomUUID(), hostId: other.id, startedBy: other.id, now }).then(() => null, (error: unknown) => error as Error);
        const intents = stripe().paymentIntents;
        const realRetrieve = intents.retrieve;
        intents.retrieve = (() => Promise.reject(new Error("The network is down (made up by the check script)."))) as unknown as typeof intents.retrieve;
        let notAsked: Error | null;
        try {
          notAsked = await pressOther(new Date(q1.at.getTime() + 8 * DAY));
        } finally {
          intents.retrieve = realRetrieve;
        }
        const waited = (await shareOf(q1.paymentId)).transferStatus;
        const asked = await pressOther(new Date(q1.at.getTime() + 8 * DAY));
        check("when Stripe cannot be asked about a payment that may just have been paid, that person's shares wait; once it can, they are collected", notAsked instanceof MoneyError && waited === "not_due" && asked === null && (await shareOf(q1.paymentId)).transferStatus === "sent", { first: notAsked?.message, waited, second: asked?.message });
        // When Stripe is certain that it has no such payment, asking again never helps: the founder is shown it.
        await db.update(pays).set({ stripePaymentIntentId: `pi_not_there_${RUN}` }).where(eq(pays.id, q2.paymentId));
        const gone = await C.syncPayment(q2.paymentId, new Date());
        check("a payment Stripe does not know at all is set aside for the founder, so it does not stay \"to be paid\" for ever", gone.status === "to_pay" && /Stripe does not know/.test(gone.problem ?? "") && (await healthProblems(new Date())).some((problem) => /needs the founder/.test(problem)));
      } finally {
        await give(holder.id, seeded.id);
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
