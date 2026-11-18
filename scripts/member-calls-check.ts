/**
 * Testing tool: plays members and hosts through calls that are booked from a membership, against
 * the Stripe sandbox and the local database, and checks every result. No real money moves.
 *
 * Members are made the real way (the host invites, the person joins and pays), for which the
 * script turns the founder's switch on in the local database, and off again at the end. Calls are
 * "attended" by writing the attendance record. A pretend "now" is used so nothing has to wait.
 *
 * Usage: npx tsx scripts/member-calls-check.ts            (everything)
 *        npx tsx scripts/member-calls-check.ts --only=3   (one journey)
 *        npx tsx scripts/member-calls-check.ts --payouts  (also collecting; needs the test host's payout account)
 *
 * Never run two check scripts at the same time: their jobs act on every row in the local database.
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
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { MoneyError } = await import("../src/lib/payments/operations");
  const { reconcileOperations, settleFinishedCalls, settleCancelledCalls, runPaymentJobs } = await import("../src/lib/payments/jobs");
  const { cancelCall } = await import("../src/lib/payments/cancel");
  const { ownPaymentOf } = await import("../src/lib/payments/own");
  const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
  const { moneyPlan } = await import("../src/lib/payments/take");
  const { unsentEarnings, collectEarnings, acceptCollection } = await import("../src/lib/payments/collect");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { callOverdue } = await import("../src/lib/health");
  const C = await import("../src/lib/membership/charge");
  const { closeMonth } = await import("../src/lib/membership/close");
  const { runMembershipJobs } = await import("../src/lib/membership/jobs");
  const E = await import("../src/lib/membership/ending");
  const J = await import("../src/lib/membership/join");
  const B = await import("../src/lib/membership/book");
  const { decideMemberReview } = await import("../src/lib/membership/calls");
  const { giveTimeBack } = await import("../src/lib/membership/give-back");
  const { MembershipError } = await import("../src/lib/membership/rules");
  const { MEMBERSHIP_WORDING_VERSION: WORDING } = await import("../src/lib/membership/wording");
  const { askForCall, offerOf, openTimes, instantOffer, BookingError, requestsOfCustomer } = await import("../src/lib/booking/bookings");
  const { mayKeepMemberHours, addWeeklyHours } = await import("../src/lib/booking/calendar");
  const { block } = await import("../src/lib/safety/blocks");
  const { closeAccount } = await import("../src/lib/profiles/closing");
  const { endCallForSafety } = await import("../src/lib/safety/calls");
  const { askForRefund, answerRequest, askBy, requestViewOf, RequestError } = await import("../src/lib/refunds/requests");
  const { rateCall } = await import("../src/lib/ratings/ratings");
  const { addTimeChoices } = await import("../src/lib/extend/extend");
  type Booking = import("../src/db/schema").Booking;
  type Call = import("../src/db/schema").Call;

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
  // Making people, hosts and members
  // ------------------------------------------------------------------------
  async function person(kind: string): Promise<Person> {
    const id = `mk-${RUN}-${++made}-${kind}`;
    const stamp = new Date();
    const row = { id, name: `Calls check ${kind} ${made}`, email: `membercalls-${RUN}-${made}@example.test` };
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: "check", timeZone: "America/New_York" });
    return row;
  }
  /**
   * A host with a regular price of $10.00 and a membership of 2 hours at $7.50 ($60.00 a month).
   * Every day: general hours from 9 to 12, and member-only hours from 13 to 15 (New York time).
   */
  async function newHost(opts: { lengths?: string; price?: number; minutes?: number; freeCancelMinutes?: number; onlyMemberHours?: boolean } = {}): Promise<Person> {
    const p = await person("host");
    const stamp = new Date();
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `mk${RUN}${made}`, handleKey: `mk${RUN}${made}`, displayName: `Host ${made}`, pricePer15Cents: 1000, status: "approved", usConfirmedAt: stamp });
    // (Marked as able to be paid: a payout account cannot be made ready from a script.)
    await db.insert(schema.hostSettings).values({ userId: p.id, payoutsReady: true, freeCancelMinutes: opts.freeCancelMinutes ?? 0 }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: opts.lengths ?? "30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    for (let weekday = 1; weekday <= 7; weekday++) {
      if (!opts.onlyMemberHours) await db.insert(schema.weeklyHours).values({ hostId: p.id, weekday, startMinute: 540, endMinute: 720 });
      await db.insert(schema.weeklyHours).values({ hostId: p.id, weekday, startMinute: 780, endMinute: 900, membersOnly: true });
    }
    await db.insert(schema.membershipOffers).values({ hostId: p.id, on: true, pricePer15Cents: opts.price ?? 750, includedMinutes: opts.minutes ?? 120 });
    named.push(p.id);
    await setSwitches({ memberships: "named", membershipsHosts: named });
    return p;
  }
  type Made = { host: Person; member: Person; membershipId: string; monthId: string };
  /** The two have had a call, with this host as the host, so she can invite the person. */
  async function talked(host: Person, member: Person) {
    const startsAt = new Date(Date.now() - 2 * DAY);
    const [call] = await db.insert(schema.calls).values({ hostId: host.id, customerId: member.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), roomName: `membercalls-${randomUUID()}`, pricePer15Cents: 1000, closedAt: new Date(startsAt.getTime() + 31 * MIN) }).returning();
    await db.insert(schema.bookings).values({ hostId: host.id, customerId: member.id, startsAt, endsAt: call.endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 1000, totalCents: 2000, freeCancelMinutes: 0, stage: "accepted", requestKey: randomUUID(), callId: call.id });
    for (const who of [host.id, member.id]) {
      await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type: "participant_joined", roomSessionId: "RM_membercalls", participantIdentity: who, participantSessionId: `PA_${randomUUID().slice(0, 8)}`, providerTime: startsAt, payload: "{}" });
    }
  }
  /** A member the real way: invited, joined with the box ticked, paid (the month is held), and, unless told otherwise, the money taken (the month runs). */
  async function member(host: Person, opts: { take?: boolean; card?: string } = {}): Promise<Made> {
    const who = await person("member");
    await talked(host, who);
    const invitation = await J.invite({ hostId: host.id, customerId: who.id, now: new Date() });
    const started = await J.join({ customerId: who.id, inviteId: invitation.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date() });
    await C.payNow({ monthId: started.monthId, memberId: who.id });
    await stripe().paymentIntents.confirm((await M(started.monthId)).stripePaymentIntentId!, { payment_method: opts.card ?? "pm_card_visa", return_url: "https://example.com/return" });
    await C.syncMonth(started.monthId, new Date());
    if (opts.take !== false) await C.takeNow(started.monthId, new Date());
    return { host, member: who, ...started };
  }

  // ------------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------------
  const M = async (id: string) => (await db.select().from(months).where(eq(months.id, id)))[0];
  const MS = async (id: string) => (await db.select().from(schema.memberships).where(eq(schema.memberships.id, id)))[0];
  const placesOf = (m: Awaited<ReturnType<typeof M>>) => [m.freeCents, m.setAsideCents, m.usedCents, m.expiredCents, m.toPayBackCents, m.paidBackCents];
  const places = async (monthId: string) => placesOf(await M(monthId)).join("/");
  const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
  const callOf = async (booking: Booking): Promise<Call> => (await db.select().from(schema.calls).where(eq(schema.calls.id, booking.callId!)))[0];
  const bookingById = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];
  const pay = async (call: Call) => (await ownPaymentOf(call.id))!;
  const refundsOf = (monthId: string) => db.select().from(schema.membershipRefunds).where(eq(schema.membershipRefunds.monthId, monthId));
  const emailText = async (to: string, subject: string) => (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)))).map((row) => row.body).join("\n");
  const ledger = async (owner: { monthId: string } | { paymentId: string }, kind: string) =>
    (
      await db
        .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amountCents}), 0)::int`, lines: sql<number>`count(*)::int` })
        .from(schema.ledgerEntries)
        .where(and("monthId" in owner ? eq(schema.ledgerEntries.monthId, owner.monthId) : eq(schema.ledgerEntries.paymentId, owner.paymentId), eq(schema.ledgerEntries.kind, kind)))
    )[0];
  const refused = (work: Promise<unknown>) =>
    work.then(
      () => null,
      (error: unknown) => (error instanceof BookingError || error instanceof MoneyError || error instanceof MembershipError || error instanceof RequestError ? error.message || "refused" : Promise.reject(error)),
    );
  /** For races: a result that was refused must have been refused by a rule (in words for a person), never by a database error or a deadlock. */
  const byARule = (result: PromiseSettledResult<unknown>) => result.status === "fulfilled" || result.reason instanceof BookingError || result.reason instanceof MoneyError || result.reason instanceof MembershipError;
  const whyNot = (result: PromiseSettledResult<unknown>) => (result.status === "rejected" ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : "");
  /** The hour of the day in New York, to tell general hours (9 to 12) from member-only hours (13 to 15). */
  const hourInNewYork = (at: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(at));

  // ------------------------------------------------------------------------
  // Booking, attending, settling
  // ------------------------------------------------------------------------
  /** The member's open times for one length, as their page would show them now. */
  async function times(m: Made, length = 30, now = new Date()): Promise<Date[]> {
    const view = await B.memberBookingView(m.member.id, m.host.id, now);
    return view ? (await B.memberOpenTimes(view, length, now)).map((time) => time.startsAt) : [];
  }
  /** Books as the member's page would: the price and cancelling rule it shows are the ones sent. */
  async function book(m: Made, startsAt: Date, opts: { length?: number; key?: string; now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const view = await B.memberBookingView(m.member.id, m.host.id, now);
    const month = await M(m.monthId);
    return B.bookAsMember({ customer: m.member, hostId: m.host.id, startsAt, lengthMinutes: opts.length ?? 30, requestKey: opts.key ?? randomUUID(), seen: { pricePer15Cents: month.pricePer15Cents, freeCancelMinutes: view?.offer.freeCancelMinutes ?? 0 }, now });
  }
  /** A booked member call at the member's n-th open time (general hours unless `memberOnly`). */
  async function booked(m: Made, opts: { nth?: number; length?: number; memberOnly?: boolean } = {}): Promise<{ booking: Booking; call: Call }> {
    const open = (await times(m, opts.length ?? 30)).filter((at) => (opts.memberOnly ? hourInNewYork(at) >= 13 : hourInNewYork(at) < 13));
    const result = await book(m, open[opts.nth ?? 0], { length: opts.length });
    if (result.outcome !== "booked") throw new Error(`could not book: ${result.outcome} ${result.message}`);
    // The daily limit on requests (3 to one host in 24 hours) applies to a member too; journey 1 checks it.
    // So that a journey can book more than that, each booking is made to look two days old.
    await db.update(schema.bookings).set({ requestedAt: new Date(Date.now() - 2 * DAY) }).where(eq(schema.bookings.id, result.booking.id));
    return { booking: result.booking, call: await callOf(result.booking) };
  }
  /** Moves a booked call to another time (into the past, to play a call that took place or is under way), with its payment's stretch. */
  async function moveCall(call: Call, startsAt: Date): Promise<Call> {
    const endsAt = new Date(startsAt.getTime() + (call.endsAt.getTime() - call.startsAt.getTime()));
    await db.update(schema.calls).set({ startsAt, endsAt }).where(eq(schema.calls.id, call.id));
    await db.update(schema.payments).set({ coversFrom: startsAt, coversUntil: endsAt }).where(eq(schema.payments.callId, call.id));
    return (await db.select().from(schema.calls).where(eq(schema.calls.id, call.id)))[0];
  }
  /** Writes the call's record: who was in the room from which second to which, and that the room is closed. */
  async function attend(call: Call, who: Array<[string, number, number]>) {
    for (const [id, from, until] of who) {
      const event = (type: string, offset: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: `RM_${call.id.slice(0, 8)}`, participantIdentity: id, participantSessionId: `PA_${id.slice(-6)}_${randomUUID().slice(0, 6)}`, providerTime: new Date(call.startsAt.getTime() + offset * 1000), payload: "{}" });
      const joined = event("participant_joined", from);
      await db.insert(schema.attendanceEvents).values([joined, { ...event("participant_left", until), participantSessionId: joined.participantSessionId }]);
    }
    await db.update(schema.calls).set({ closedAt: new Date(call.endsAt.getTime() + MIN) }).where(eq(schema.calls.id, call.id));
  }
  const bothThere = (m: Made, call: Call, seconds = Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / 1000)) => attend(call, [[m.host.id, 0, seconds], [m.member.id, 0, seconds]]);
  /** The moment the call's money is used by itself: 24 hours and 3 minutes after its start (a little later, to be past it). */
  const callsMoment = (call: Call) => new Date(call.startsAt.getTime() + DAY + 4 * MIN);
  const settle = (call: Call, at = callsMoment(call)) => settleFinishedCalls(at);
  /** The membership helper and the payment helper, until nothing is left to do. */
  async function helper(now: Date, rounds = 2) {
    for (let i = 0; i < rounds; i++) {
      await reconcileOperations(now);
      await runMembershipJobs(now);
    }
  }

  /**
   * Compared after every journey: the month's six places against what was paid; what is set aside
   * and used against the member's call payments, one by one; Stripe asked afresh; the money record;
   * and no work left owed.
   */
  async function audit(label: string, m: Made, opts: { owed?: boolean; frozen?: boolean } = {}) {
    const problems: string[] = [];
    const all = await db.select().from(months).where(eq(months.membershipId, m.membershipId));
    for (const month of all) {
      if (!["running", "closed", "finished"].includes(month.status)) continue;
      const total = sum(placesOf(month));
      if (total !== month.totalCents) problems.push(`month ${month.number}: the six places add up to ${total}, not ${month.totalCents}`);
      const callPayments = await db.select().from(schema.payments).where(and(eq(schema.payments.monthId, month.id), eq(schema.payments.kind, "member_call")));
      const aside = sum(callPayments.filter((p) => p.status === "held").map((p) => p.bookedCents));
      const used = sum(callPayments.filter((p) => p.status === "charged").map((p) => (p.chargedCents ?? 0) - p.refundedCents));
      if (aside !== month.setAsideCents) problems.push(`month ${month.number}: ${month.setAsideCents} set aside, but its calls still hold ${aside}`);
      if (used !== month.usedCents) problems.push(`month ${month.number}: ${month.usedCents} used, but its calls used ${used}`);
      if (month.hostCausedCents > month.freeCents) problems.push(`month ${month.number}: more marked "because of the host" (${month.hostCausedCents}) than is free (${month.freeCents})`);
      for (const p of callPayments) {
        if (p.stripePaymentIntentId) problems.push(`member payment ${p.id} has a PaymentIntent of its own`);
        if ((await ledger({ paymentId: p.id }, "customer_charge")).lines !== 0) problems.push(`member payment ${p.id} has a "charged to the customer" line`);
        if (p.status === "charged") {
          const fee = await ledger({ paymentId: p.id }, "platform_fee");
          const share = await ledger({ paymentId: p.id }, "host_share");
          if (fee.total + share.total !== (p.chargedCents ?? 0) - p.refundedCents) problems.push(`member payment ${p.id}: fee ${fee.total} and share ${share.total} do not add up to what was used`);
          if (p.stripeChargeId !== month.stripeChargeId) problems.push(`member payment ${p.id} does not name the month's charge`);
        }
        const operations = await db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.paymentId, p.id), inArray(schema.moneyOperations.kind, ["capture", "release", "refund", "hold"])));
        if (operations.length > 0) problems.push(`member payment ${p.id} was sent to the card code (${operations.map((o) => o.kind).join(", ")})`);
      }
      const intent = month.stripePaymentIntentId ? await stripe().paymentIntents.retrieve(month.stripePaymentIntentId) : null;
      if (!intent || intent.status !== "succeeded" || intent.amount_received !== month.totalCents) problems.push(`month ${month.number}: Stripe took ${intent?.amount_received}, state ${intent?.status}`);
      const charged = await ledger({ monthId: month.id }, "customer_charge");
      if (charged.lines !== 1 || charged.total !== month.totalCents) problems.push(`month ${month.number}: ${charged.lines} "charged" lines for ${charged.total}`);
      const atStripe = intent ? await stripe().refunds.list({ payment_intent: intent.id, limit: 100 }).autoPagingToArray({ limit: 1000 }) : [];
      const back = sum(atStripe.filter((refund) => refund.status === "succeeded").map((refund) => refund.amount));
      if (back !== month.paidBackCents) problems.push(`month ${month.number}: Stripe paid back ${back}, the month says ${month.paidBackCents}`);
      const owed = (await refundsOf(month.id)).filter((line) => line.status !== "done");
      if (owed.length > 0 && !opts.owed && !opts.frozen) problems.push(`month ${month.number} has a pay-back that is not done`);
      const started = await db.select().from(schema.moneyOperations).where(and(eq(schema.moneyOperations.monthId, month.id), eq(schema.moneyOperations.status, "started")));
      if (started.length > 0) problems.push(`month ${month.number} has an action without an answer`);
    }
    check(`${label}: the month's places, its calls, Stripe and the money record agree`, problems.length === 0, problems.join("; "));
  }

  // ------------------------------------------------------------------------
  // Cleaning up: only this script's own people (ids starting "mk-")
  // ------------------------------------------------------------------------
  /** If an earlier run stopped while one of its hosts held the test payout account, the seeded host gets it back before anything is deleted. */
  async function payoutAccountBack() {
    const [holder] = await db.select().from(schema.hostSettings).where(and(like(schema.hostSettings.userId, "mk-%"), sql`${schema.hostSettings.stripeAccountId} is not null`));
    const [seeded] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, "host@test.local"));
    if (!holder || !seeded) return;
    await db.transaction(async (tx) => {
      await tx.update(schema.hostSettings).set({ stripeAccountId: null, payoutsReady: false }).where(eq(schema.hostSettings.userId, holder.userId));
      await tx.update(schema.hostSettings).set({ stripeAccountId: holder.stripeAccountId }).where(eq(schema.hostSettings.userId, seeded.id));
    });
    console.log("   (the test payout account was given back to host@test.local)");
  }

  /** `pair`: instead of this script's own people, the membership between two seeded test accounts that `--demo` made, and its calls. */
  async function wipe(everything = false, pair?: { hostId: string; customerId: string }) {
    const quiet = async (step: () => Promise<unknown>) => step().catch((error) => console.log(`   (clean-up: ${error instanceof Error ? error.message.split("\n")[0] : error})`));
    await payoutAccountBack();
    const all = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(pair ? and(eq(schema.memberships.hostId, pair.hostId), eq(schema.memberships.customerId, pair.customerId)) : or(like(schema.memberships.hostId, "mk-%"), like(schema.memberships.customerId, "mk-%")));
    const ids = all.map((row) => row.id);
    const theirMonths = ids.length > 0 ? await db.select().from(months).where(inArray(months.membershipId, ids)) : [];
    const monthIds = theirMonths.map((month) => month.id);
    const theirCalls = pair
      ? [
          // The calls booked from those months, and the one call the demo wrote so that the host could invite.
          ...(monthIds.length > 0 ? (await db.select({ id: schema.payments.callId }).from(schema.payments).where(inArray(schema.payments.monthId, monthIds))).flatMap((row) => (row.id ? [row.id] : [])) : []),
          ...(await db.select({ id: schema.calls.id }).from(schema.calls).where(like(schema.calls.roomName, "membercalls-demo-%"))).map((row) => row.id),
        ]
      : (await db.select({ id: schema.calls.id }).from(schema.calls).where(or(like(schema.calls.hostId, "mk-%"), like(schema.calls.customerId, "mk-%")))).map((row) => row.id);
    // Nothing stays held on a test card.
    for (const month of theirMonths) {
      if (month.stripePaymentIntentId && (month.status === "to_pay" || month.status === "held")) await stripe().paymentIntents.cancel(month.stripePaymentIntentId).catch(() => undefined);
    }
    const paymentIds = (
      await db
        .select({ id: schema.payments.id, intent: schema.payments.stripePaymentIntentId, status: schema.payments.status })
        .from(schema.payments)
        .where(or(theirCalls.length > 0 ? inArray(schema.payments.callId, theirCalls) : undefined, monthIds.length > 0 ? inArray(schema.payments.monthId, monthIds) : undefined, sql`false`))
    ).map((row) => {
      if (row.intent && row.status === "held") void stripe().paymentIntents.cancel(row.intent).catch(() => undefined);
      return row.id;
    });
    if (theirCalls.length > 0) {
      const requests = (await db.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(inArray(schema.refundRequests.callId, theirCalls))).map((row) => row.id);
      if (requests.length > 0) await quiet(() => db.delete(schema.refundRequestAnswers).where(inArray(schema.refundRequestAnswers.requestId, requests)));
      await quiet(() => db.delete(schema.refundRequests).where(inArray(schema.refundRequests.callId, theirCalls)));
      await quiet(() => db.delete(schema.ratings).where(inArray(schema.ratings.callId, theirCalls)));
      await quiet(() => db.delete(schema.qualityNotes).where(inArray(schema.qualityNotes.callId, theirCalls)));
    }
    if (monthIds.length > 0) await quiet(() => db.delete(schema.membershipRefunds).where(inArray(schema.membershipRefunds.monthId, monthIds)));
    if (paymentIds.length > 0) {
      await quiet(() => db.delete(schema.refunds).where(inArray(schema.refunds.paymentId, paymentIds)));
      await quiet(() => db.delete(schema.collectionItems).where(inArray(schema.collectionItems.paymentId, paymentIds)));
      await quiet(() => db.delete(schema.payoutFees).where(inArray(schema.payoutFees.paymentId, paymentIds)));
      await quiet(() => db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, paymentIds)));
      await quiet(() => db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, paymentIds)));
      await quiet(() => db.delete(schema.payments).where(inArray(schema.payments.id, paymentIds)));
    }
    const theirBookings = (
      await db
        .select({ id: schema.bookings.id })
        .from(schema.bookings)
        .where(
          pair
            ? or(theirCalls.length > 0 ? inArray(schema.bookings.callId, theirCalls) : undefined, monthIds.length > 0 ? inArray(schema.bookings.monthId, monthIds) : undefined, sql`false`)
            : or(like(schema.bookings.hostId, "mk-%"), like(schema.bookings.customerId, "mk-%")),
        )
    ).map((row) => row.id);
    if (theirBookings.length > 0) {
      await quiet(() => db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, theirBookings)));
      await quiet(() => db.delete(schema.bookingCards).where(inArray(schema.bookingCards.bookingId, theirBookings)));
      await quiet(() => db.delete(schema.bookings).where(inArray(schema.bookings.id, theirBookings)));
    }
    if (theirCalls.length > 0) {
      await quiet(() => db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, theirCalls)));
      await quiet(() => db.delete(schema.callExtensions).where(inArray(schema.callExtensions.callId, theirCalls)));
      await quiet(() => db.delete(schema.calls).where(inArray(schema.calls.id, theirCalls)));
    }
    if (ids.length > 0) {
      if (monthIds.length > 0) {
        await quiet(() => db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.monthId, monthIds)));
        await quiet(() => db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.monthId, monthIds)));
      }
      await quiet(() => db.update(schema.memberships).set({ currentMonthId: null, agreementId: null, offerMonthId: null }).where(inArray(schema.memberships.id, ids)));
      if (monthIds.length > 0) await quiet(() => db.delete(months).where(inArray(months.id, monthIds)));
      await quiet(() => db.delete(schema.membershipCards).where(inArray(schema.membershipCards.membershipId, ids)));
      await quiet(() => db.delete(schema.membershipAgreements).where(inArray(schema.membershipAgreements.membershipId, ids)));
      await quiet(() => db.delete(schema.membershipInvitations).where(inArray(schema.membershipInvitations.membershipId, ids)));
      await quiet(() => db.delete(schema.memberships).where(inArray(schema.memberships.id, ids)));
    }
    if (!everything || pair) return;
    const steps: Array<() => Promise<unknown>> = [
      () => db.delete(schema.collections).where(like(schema.collections.hostId, "mk-%")),
      () => db.delete(schema.blocks).where(or(like(schema.blocks.blockerId, "mk-%"), like(schema.blocks.blockedId, "mk-%"))),
      () => db.delete(schema.adminActions).where(like(schema.adminActions.targetUserId, "mk-%")),
      () => db.delete(schema.weeklyHours).where(like(schema.weeklyHours.hostId, "mk-%")),
      () => db.delete(schema.hostCalendars).where(like(schema.hostCalendars.userId, "mk-%")),
      () => db.delete(schema.membershipOffers).where(like(schema.membershipOffers.hostId, "mk-%")),
      () => db.delete(schema.hostSettings).where(like(schema.hostSettings.userId, "mk-%")),
      () => db.delete(schema.hostProfiles).where(like(schema.hostProfiles.userId, "mk-%")),
      () => db.delete(schema.stripeCustomers).where(like(schema.stripeCustomers.userId, "mk-%")),
      () => db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "membercalls-%")),
      () => db.delete(schema.session).where(like(schema.session.userId, "mk-%")),
      () => db.delete(schema.user).where(like(schema.user.id, "mk-%")),
    ];
    for (const step of steps) await quiet(step);
  }

  const journeys: Array<[string, () => Promise<void>]> = [];
  const journey = (title: string, run: () => Promise<void>) => journeys.push([title, run]);

  // ========================================================================
  journey("Booking as a member: general and member-only times, and everything that refuses a booking", async () => {
    const host = await newHost();
    const m = await member(host);
    const view = await B.memberBookingView(m.member.id, host.id, new Date());
    check("the member sees their time: 2 hours left, and the host's length", view?.minutesLeft === 120 && view.lengths.join() === "30", `${view?.minutesLeft} ${view?.lengths}`);
    const open = await times(m);
    const general = open.filter((at) => hourInNewYork(at) < 13);
    const membersOnly = open.filter((at) => hourInNewYork(at) >= 13);
    check("the member's times include general hours and member-only hours", general.length > 0 && membersOnly.length > 0, `${general.length} ${membersOnly.length}`);
    const marked = await B.memberOpenTimes(view!, 30, new Date());
    check("each time says whether it is for members only", marked.every((time) => time.membersOnly === hourInNewYork(time.startsAt) >= 13));
    check("every time shown starts after the host's 24 hours' notice", open.every((at) => at.getTime() >= Date.now() + DAY - MIN));
    const offer = (await offerOf(host.id))!;
    const forPublic = await openTimes(offer, 30, new Date());
    check("someone who is not a member is shown no member-only time", forPublic.length > 0 && forPublic.every((at) => hourInNewYork(at) < 13));
    const stranger = await person("stranger");
    const asStranger = await refused(askForCall({ customer: stranger, hostId: host.id, startsAt: membersOnly[0], lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 1000, freeCancelMinutes: 0 }, now: new Date() }));
    check("and asking for one the ordinary way is refused", Boolean(asStranger), asStranger);
    check("someone who is not a member has no member's view of this host", (await B.memberBookingView(stranger.id, host.id, new Date())) === null);

    // Someone else is waiting for a general time; the member books it.
    const waiting = await askForCall({ customer: stranger, hostId: host.id, startsAt: forPublic[0], lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 1000, freeCancelMinutes: 0 }, now: new Date() });
    // (The stranger's request counts as sent once their card step is finished; here it is marked as waiting directly.)
    await db.update(schema.bookings).set({ stage: "waiting", requestedAt: new Date(), respondBy: new Date(Date.now() + DAY) }).where(eq(schema.bookings.id, waiting.booking.id));
    const key = randomUUID();
    const first = await book(m, forPublic[0], { key });
    const call = await callOf(first.booking);
    const payment = await pay(call);
    check("a general time is booked at once: accepted, with the member price, no request and no card step", first.outcome === "booked" && first.booking.stage === "accepted" && first.booking.source === "member" && first.booking.pricePer15Cents === 750 && first.booking.totalCents === 1500 && Boolean(first.booking.decidedAt), `${first.outcome} ${first.booking.stage}`);
    check("its payment is money set aside in the month: held, $15.00, no hold end, no PaymentIntent", payment.kind === "member_call" && payment.status === "held" && payment.bookedCents === 1500 && payment.holdExpiresAt === null && payment.stripePaymentIntentId === null && payment.monthId === m.monthId && payment.feeFixedCents === 0);
    check("the call counts the host's time, at the member price", call.billing === "host" && call.pricePer15Cents === 750);
    check("$15.00 went from free to set aside", (await places(m.monthId)) === "4500/1500/0/0/0/0", await places(m.monthId));
    check("the other person's waiting request for that time has ended, with its email", (await bookingById(waiting.booking.id)).stage === "passed_over" && /accepted another request/.test(await emailText(stranger.email, "accepted another request")), (await bookingById(waiting.booking.id)).stage);
    check("both people are told it is booked", /uses 30 minutes of your membership/.test(await emailText(m.member.email, "is booked")) && /confirmed at once/.test(await emailText(host.email, "booked a call with you")));
    const again = await book(m, forPublic[0], { key });
    check("the same press twice books once and sets nothing aside again", again.booking.id === first.booking.id && (await places(m.monthId)) === "4500/1500/0/0/0/0");
    const hostBusy = (await db.select().from(schema.busyEntries).where(and(eq(schema.busyEntries.bookingId, first.booking.id), eq(schema.busyEntries.userId, host.id))))[0];
    check("the host is taken for the call and the 5-minute break after it; the member for the call", hostBusy.endsAt.getTime() === call.endsAt.getTime() + 5 * MIN && (await db.select().from(schema.busyEntries).where(and(eq(schema.busyEntries.bookingId, first.booking.id), eq(schema.busyEntries.userId, m.member.id))))[0].endsAt.getTime() === call.endsAt.getTime());
    check("that time is no longer open to the member, and a call that would start inside the break is refused", !(await times(m)).some((at) => at.getTime() === forPublic[0].getTime()) && /no longer open/.test((await refused(book(m, new Date(call.endsAt.getTime())))) ?? ""));
    check("a booked member call is a call, not an open request, on the member's list", !(await requestsOfCustomer(m.member.id, new Date())).some((row) => row.booking.id === first.booking.id));

    const second = await book(m, membersOnly[0]);
    check("a member-only time is booked the same way", second.outcome === "booked" && (await places(m.monthId)) === "3000/3000/0/0/0/0", await places(m.monthId));

    // A time that is open today, asked for when it is only 2 hours away: only the host's 24 hours' notice stands in the way.
    check("the same time is still open one hour before the notice begins", (await times(m, 30, new Date(general[3].getTime() - 25 * HOUR))).some((at) => at.getTime() === general[3].getTime()));
    check("inside the host's notice it is refused", /no longer open/.test((await refused(book(m, general[3], { now: new Date(general[3].getTime() - 2 * HOUR) }))) ?? "") && !(await times(m, 30, new Date(general[3].getTime() - 2 * HOUR))).some((at) => at.getTime() === general[3].getTime()));
    check("a length the host does not offer is refused", Boolean(await refused(book(m, general[3], { length: 45 }))));
    // The month is made to end before a time that is otherwise open: a member's call must end before the month ends.
    const realEnd = (await M(m.monthId)).endsAt!;
    await db.update(months).set({ endsAt: new Date(general[4].getTime() + 20 * MIN) }).where(eq(months.id, m.monthId));
    check("a call that would run past the month's end is not shown", !(await times(m)).some((at) => at.getTime() === general[4].getTime()));
    check("and is refused", /before your paid month ends/.test((await refused(book(m, general[4]))) ?? ""));
    await db.update(months).set({ endsAt: realEnd }).where(eq(months.id, m.monthId));

    // Not enough time left: only $5.00 of the month is free.
    await db.update(months).set({ freeCents: 500, expiredCents: 2500 }).where(eq(months.id, m.monthId));
    check("with $5.00 left, the 30-minute length is no longer offered", (await B.memberBookingView(m.member.id, host.id, new Date()))?.lengths.length === 0);
    check("and booking it is refused, pointing to the ordinary way", /ordinary way/.test((await refused(book(m, general[5]))) ?? ""));
    await db.update(months).set({ freeCents: 3000, expiredCents: 0 }).where(eq(months.id, m.monthId));

    // The price the page showed is no longer the month's.
    const stale = await refused(B.bookAsMember({ customer: m.member, hostId: host.id, startsAt: general[5], lengthMinutes: 30, requestKey: randomUUID(), seen: { pricePer15Cents: 700, freeCancelMinutes: 0 }, now: new Date() }));
    check("a form that shows another price is refused", /changed while you were looking/.test(stale ?? ""), stale);

    await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, host.id));
    check("a host who is waiting to be approved again cannot be booked", Boolean(await refused(book(m, general[5]))) && (await times(m)).length === 0);
    await db.update(schema.hostProfiles).set({ status: "approved", hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
    const hidden = await times(m);
    const whileHidden = hidden.length > 0 ? await book(m, hidden.filter((at) => hourInNewYork(at) < 13)[6]) : null;
    check("a member can still book with a host whose page is hidden, from the times shown to the booking", whileHidden?.outcome === "booked", whileHidden?.outcome);
    check("someone who is not a member cannot (as today)", (await offerOf(host.id)) === null);
    await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));

    await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, m.member.id));
    check("a paused account cannot book", /cannot make bookings/.test((await refused(book(m, general[7]))) ?? ""));
    await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, m.member.id));
    await db.update(schema.hostSettings).set({ verifiedOnly: true }).where(eq(schema.hostSettings.userId, host.id));
    check("the host's \"confirmed ID only\" rule applies to a member too", /confirmed their ID/.test((await refused(book(m, general[7]))) ?? ""));
    await db.update(schema.hostSettings).set({ verifiedOnly: false }).where(eq(schema.hostSettings.userId, host.id));
    await setSwitches({ requestsOff: true });
    check("with the founder's \"no new requests\" switch on, nothing is booked", /not taking new requests/.test((await refused(book(m, general[7]))) ?? ""));
    await setSwitches({ requestsOff: false });
    check("the daily limit on requests applies to a member too: a fourth booking with one host in a day is refused", /a lot of requests today/.test((await refused(book(m, general[7]))) ?? ""));
    check("the card form is refused for a member's call", (await refused(startHold({ payment, call, customer: m.member, now: new Date() }))) !== null);
    check("no extra time is offered for a member's call yet", (await addTimeChoices(call)).fits === 0);
    await audit("after booking", m);
  });

  // ========================================================================
  journey("The first booking of a month whose money is only held: the money first, then the call", async () => {
    const host = await newHost();
    const m = await member(host, { take: false });
    check("(the month is held, and the member sees all of its time)", (await M(m.monthId)).status === "held" && (await B.memberBookingView(m.member.id, host.id, new Date()))?.minutesLeft === 120);
    const open = (await times(m)).filter((at) => hourInNewYork(at) < 13);
    const first = await book(m, open[0]);
    const month = await M(m.monthId);
    check("the first booking takes the month's money, and only then books", first.outcome === "booked" && month.status === "running" && (await places(m.monthId)) === "4500/1500/0/0/0/0" && (await stripe().paymentIntents.retrieve(month.stripePaymentIntentId!)).status === "succeeded", `${first.outcome} ${month.status} ${await places(m.monthId)}`);
    await audit("after the first booking", m);

    // The taking is refused: the bank let the hold go.
    const n = await member(host, { take: false });
    await stripe().paymentIntents.cancel((await M(n.monthId)).stripePaymentIntentId!);
    const open2 = (await times(n)).filter((at) => hourInNewYork(at) < 13);
    const key = randomUUID();
    const notTaken = await book(n, open2[1], { key });
    check("when the taking is refused, nothing is booked and nothing is reserved", notTaken.outcome === "paying" && notTaken.booking.stage === "paying" && notTaken.booking.callId === null && (await db.select().from(schema.busyEntries).where(eq(schema.busyEntries.bookingId, notTaken.booking.id))).length === 0, `${notTaken.outcome} ${notTaken.booking.stage}`);
    check("the member's list shows the unfinished booking", (await requestsOfCustomer(n.member.id, new Date())).length > 0);
    const pressedAgain = await book(n, open2[1], { key });
    const ended = await bookingById(notTaken.booking.id);
    check("the same press again finds the month can no longer be booked from, and the request ends with words of its own", pressedAgain.outcome === "not_booked" && ended.stage === "ran_out" && /could no longer be booked from/.test(ended.endedReason ?? "") && /No membership time was used/.test(await emailText(n.member.email, "was not booked")), `${pressedAgain.outcome} ${ended.stage} ${ended.endedReason}`);
    const laterPress = await book(n, open2[1], { key });
    check("an ended request is never brought back, and is never called booked", laterPress.outcome === "not_booked" && Boolean(laterPress.message) && laterPress.booking.stage === "ran_out", laterPress.outcome);

    // The request was saved and the app stopped before the money was taken: the 30 minutes run out.
    const o = await member(host, { take: false });
    const open3 = (await times(o)).filter((at) => hourInNewYork(at) < 13);
    const [month3, membership3] = [await M(o.monthId), await MS(o.membershipId)];
    void membership3;
    const [stuck] = await db
      .insert(schema.bookings)
      .values({ hostId: host.id, customerId: o.member.id, startsAt: open3[2], endsAt: new Date(open3[2].getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 750, totalCents: 1500, freeCancelMinutes: 0, stage: "paying", source: "member", requestKey: randomUUID(), monthId: month3.id, requestedAt: new Date() })
      .returning();
    await helper(new Date(Date.now() + 29 * MIN), 1);
    check("a booking waiting for its month's payment is left for 30 minutes", (await bookingById(stuck.id)).stage === "paying");
    const continued = await B.bookAsMember({ customer: o.member, hostId: host.id, startsAt: open3[2], lengthMinutes: 30, requestKey: stuck.requestKey, seen: { pricePer15Cents: 750, freeCancelMinutes: 0 }, now: new Date() });
    check("the same press continues it: the money is taken and the call booked, on the same booking", continued.outcome === "booked" && continued.booking.id === stuck.id && (await M(o.monthId)).status === "running" && (await places(o.monthId)) === "4500/1500/0/0/0/0", `${continued.outcome} ${await places(o.monthId)}`);
    await audit("after continuing", o);
    // A request that was written down for another month is never continued with this month's money.
    const [otherMonth] = await db
      .insert(schema.bookings)
      .values({ hostId: host.id, customerId: o.member.id, startsAt: open3[4], endsAt: new Date(open3[4].getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 750, totalCents: 1500, freeCancelMinutes: 0, stage: "paying", source: "member", requestKey: randomUUID(), monthId: m.monthId, requestedAt: new Date() })
      .returning();
    const wrongMonth = await B.bookAsMember({ customer: o.member, hostId: host.id, startsAt: open3[4], lengthMinutes: 30, requestKey: otherMonth.requestKey, seen: { pricePer15Cents: 750, freeCancelMinutes: 0 }, now: new Date() });
    check("a request written down for another month ends instead of being booked from this one", wrongMonth.outcome === "not_booked" && (await bookingById(otherMonth.id)).stage === "ran_out" && (await places(o.monthId)) === "4500/1500/0/0/0/0", `${wrongMonth.outcome} ${await places(o.monthId)}`);
    const [sameKey] = await db
      .insert(schema.bookings)
      .values({ hostId: host.id, customerId: o.member.id, startsAt: open3[5], endsAt: new Date(open3[5].getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 750, totalCents: 1500, freeCancelMinutes: 0, stage: "paying", source: "member", requestKey: randomUUID(), monthId: o.monthId, requestedAt: new Date() })
      .returning();
    const otherTime = await refused(B.bookAsMember({ customer: o.member, hostId: host.id, startsAt: open3[6], lengthMinutes: 30, requestKey: sameKey.requestKey, seen: { pricePer15Cents: 750, freeCancelMinutes: 0 }, now: new Date() }));
    check("a request is only continued for the time it was written down for", /out of date/.test(otherTime ?? "") && (await bookingById(sameKey.id)).stage === "paying", otherTime);
    const otherHost = await person("host");
    const wrongHost = await refused(B.bookAsMember({ customer: o.member, hostId: otherHost.id, startsAt: open3[5], lengthMinutes: 30, requestKey: sameKey.requestKey, seen: { pricePer15Cents: 750, freeCancelMinutes: 0 }, now: new Date() }));
    check("and for the host it was written down for: a press that names another host is refused and leaves the request as it is", /out of date/.test(wrongHost ?? "") && (await bookingById(sameKey.id)).stage === "paying", wrongHost);
    await db.update(schema.bookings).set({ createdAt: new Date(Date.now() - 31 * MIN) }).where(eq(schema.bookings.id, sameKey.id));
    await runMembershipJobs(new Date());
    check("when it runs out and the month's money was taken meanwhile, it says the payment went through", /payment went through/.test((await bookingById(sameKey.id)).endedReason ?? ""), (await bookingById(sameKey.id)).endedReason);

    // The member is already taken at that time (a call with someone else): said before the month's money is taken.
    const busy = await member(host, { take: false });
    const open7 = (await times(busy)).filter((at) => hourInNewYork(at) < 13);
    const elsewhere = await person("host");
    const [theirs] = await db
      .insert(schema.bookings)
      .values({ hostId: elsewhere.id, customerId: busy.member.id, startsAt: open7[7], endsAt: new Date(open7[7].getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 1000, totalCents: 2000, freeCancelMinutes: 0, stage: "accepted", requestKey: randomUUID(), requestedAt: new Date(Date.now() - 2 * DAY) })
      .returning();
    await db.insert(schema.busyEntries).values({ bookingId: theirs.id, userId: busy.member.id, startsAt: theirs.startsAt, endsAt: theirs.endsAt });
    const taken = await refused(book(busy, open7[7]));
    check("a first booking at a time the member is already taken is refused before the month's money is taken", /already have a request or a call/.test(taken ?? "") && (await M(busy.monthId)).status === "held" && (await db.select().from(schema.bookings).where(and(eq(schema.bookings.customerId, busy.member.id), eq(schema.bookings.stage, "paying")))).length === 0, `${taken} ${(await M(busy.monthId)).status}`);

    const p = await member(host, { take: false });
    const open4 = (await times(p)).filter((at) => hourInNewYork(at) < 13);
    const [old] = await db
      .insert(schema.bookings)
      .values({ hostId: host.id, customerId: p.member.id, startsAt: open4[3], endsAt: new Date(open4[3].getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 750, totalCents: 1500, freeCancelMinutes: 0, stage: "paying", source: "member", requestKey: randomUUID(), monthId: p.monthId, requestedAt: new Date() })
      .returning();
    await db.update(schema.bookings).set({ createdAt: new Date(Date.now() - 31 * MIN) }).where(eq(schema.bookings.id, old.id));
    await runMembershipJobs(new Date());
    const ranOut = await bookingById(old.id);
    check("after 30 minutes it ends by itself, and the month is still only held", ranOut.stage === "ran_out" && /not finished in time/.test(ranOut.endedReason ?? "") && (await M(p.monthId)).status === "held", `${ranOut.stage} ${ranOut.endedReason}`);

    // The time is gone before the money is taken (the app had stopped after writing the request down): the money is NOT taken.
    const taker = await member(host);
    const open5 = (await times(p)).filter((at) => hourInNewYork(at) < 13);
    const payingRow = async (who: Made, startsAt: Date) =>
      (
        await db
          .insert(schema.bookings)
          .values({ hostId: host.id, customerId: who.member.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 750, totalCents: 1500, freeCancelMinutes: 0, stage: "paying", source: "member", requestKey: randomUUID(), monthId: who.monthId, requestedAt: new Date() })
          .returning()
      )[0];
    const press = (who: Made, row: Booking) => B.bookAsMember({ customer: who.member, hostId: host.id, startsAt: row.startsAt, lengthMinutes: 30, requestKey: row.requestKey, seen: { pricePer15Cents: 750, freeCancelMinutes: 0 }, now: new Date() });
    const before = await payingRow(p, open5[4]);
    await book(taker, open5[4]);
    const lostBefore = await press(p, before);
    check(
      "a request that was written down is checked again before the money is taken: the time is gone, so it ends and the month stays only held",
      lostBefore.outcome === "not_booked" && /no longer open/.test(lostBefore.message ?? "") && (await bookingById(before.id)).stage === "ran_out" && (await M(p.monthId)).status === "held",
      `${lostBefore.outcome} ${lostBefore.message} ${(await M(p.monthId)).status}`,
    );
    // The time is lost after the money was taken (Stripe took it, the app stopped, someone else booked the time meanwhile).
    const late = await member(host, { take: false });
    const after = await payingRow(late, open5[6]);
    await C.takeNow(late.monthId, new Date());
    await book(taker, open5[6]);
    const lostAfter = await press(late, after);
    const afterRow = await bookingById(after.id);
    check(
      "if the time was lost after the month's money was taken, the month stays paid, nothing is booked or reserved, and the member is told plainly",
      lostAfter.outcome === "not_booked" && lostAfter.message === B.PAID_BUT_TIME_GONE && afterRow.stage === "ran_out" && afterRow.callId === null && afterRow.endedReason === B.PAID_BUT_TIME_GONE &&
        (await db.select().from(schema.busyEntries).where(eq(schema.busyEntries.bookingId, after.id))).length === 0 && (await M(late.monthId)).status === "running" && (await places(late.monthId)) === "6000/0/0/0/0/0",
      `${lostAfter.outcome} ${lostAfter.message} ${afterRow.stage} ${await places(late.monthId)}`,
    );
    // The member became busy elsewhere after the request was written down: also found before the money is taken.
    const elsewhere2 = await person("host");
    const wait = await payingRow(busy, open7[9]);
    const [other2] = await db
      .insert(schema.bookings)
      .values({ hostId: elsewhere2.id, customerId: busy.member.id, startsAt: open7[9], endsAt: new Date(open7[9].getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 1000, totalCents: 2000, freeCancelMinutes: 0, stage: "accepted", requestKey: randomUUID(), requestedAt: new Date(Date.now() - 2 * DAY) })
      .returning();
    await db.insert(schema.busyEntries).values({ bookingId: other2.id, userId: busy.member.id, startsAt: other2.startsAt, endsAt: other2.endsAt });
    const nowBusy = await press(busy, wait);
    check("continuing a request for a time the member is now taken at ends it, and the month's money is not taken", nowBusy.outcome === "not_booked" && /already have a request or a call/.test(nowBusy.message ?? "") && (await M(busy.monthId)).status === "held", `${nowBusy.outcome} ${nowBusy.message} ${(await M(busy.monthId)).status}`);

    // The membership ends while a booking waits for its payment.
    const q = await member(host, { take: false });
    const open6 = (await times(q)).filter((at) => hourInNewYork(at) < 13);
    const [waits] = await db
      .insert(schema.bookings)
      .values({ hostId: host.id, customerId: q.member.id, startsAt: open6[5], endsAt: new Date(open6[5].getTime() + 30 * MIN), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 750, totalCents: 1500, freeCancelMinutes: 0, stage: "paying", source: "member", requestKey: randomUUID(), monthId: q.monthId, requestedAt: new Date() })
      .returning();
    await E.endByHost({ membershipId: q.membershipId, hostId: host.id, now: new Date() });
    await helper(new Date());
    check("when the membership ends meanwhile, the waiting booking ends at once", (await bookingById(waits.id)).stage === "ran_out" && /could no longer be booked from/.test((await bookingById(waits.id)).endedReason ?? ""), (await bookingById(waits.id)).stage);
  });

  // ========================================================================
  journey("Calls: the host there for all of it, for part of it, not at all; the member not there", async () => {
    const host = await newHost();
    const m = await member(host);
    const a = await booked(m, { nth: 0 });
    const b = await booked(m, { nth: 1 });
    const c = await booked(m, { nth: 2 });
    const d = await booked(m, { nth: 3 });
    check("(four calls booked: all of the month's 2 hours are set aside)", (await places(m.monthId)) === "0/6000/0/0/0/0", await places(m.monthId));
    check("with nothing left, no length is offered any more", (await B.memberBookingView(m.member.id, host.id, new Date()))?.lengths.length === 0);

    await bothThere(m, a.call);
    await settleFinishedCalls(new Date(a.call.endsAt.getTime() + 10 * MIN));
    check("nothing is used right after the call: the member has 24 hours to ask for a refund", (await pay(a.call)).status === "held");
    const plan = await moneyPlan(a.call);
    check("the call's moments come from its start alone: ask for 24 hours, used 3 minutes later", plan.timing?.askBy.getTime() === a.call.startsAt.getTime() + DAY && plan.timing?.takeAt.getTime() === a.call.startsAt.getTime() + DAY + 3 * MIN);
    check("the member can ask for a refund until then", (await askBy(a.call, new Date(a.call.endsAt.getTime() + HOUR)))?.getTime() === a.call.startsAt.getTime() + DAY);
    await settle(a.call);
    const used = await pay(a.call);
    // $15.00: 4.9% is 74 cents, plus the month's 30 cents on the first amount of the month.
    check("the host was there for all of it: the $15.00 is used, with the month's 30 cents on this first amount", used.status === "charged" && used.chargedCents === 1500 && used.chargeReason === "attendance" && used.originalFeeCents === 104 && used.originalHostShareCents === 1396 && used.feeFixedCents === 30, `${used.status} ${used.chargedCents} ${used.originalFeeCents}`);
    check("its share can be collected 24 hours after the call", used.transferStatus === "not_due" && used.transferDueAt?.getTime() === Math.max(a.call.endsAt.getTime() + DAY, used.chargedAt!.getTime()) && used.stripeChargeId === (await M(m.monthId)).stripeChargeId);
    check("set aside became used", (await places(m.monthId)) === "0/4500/1500/0/0/0" && (await M(m.monthId)).fixedFeePlaced, await places(m.monthId));

    // The host was there for 20 of the 30 minutes.
    await attend(b.call, [[host.id, 0, 1200], [m.member.id, 0, 1800]]);
    await settle(b.call);
    const part = await pay(b.call);
    check("the host was there for 20 of 30 minutes: $10.00 is used, with no second 30 cents, and $5.00 comes back", part.chargedCents === 1000 && part.originalFeeCents === 49 && part.originalHostShareCents === 951 && part.feeFixedCents === 0, `${part.chargedCents} ${part.originalFeeCents}`);
    const afterPart = await M(m.monthId);
    check("the $5.00 is free again, marked as back because of the host", (await places(m.monthId)) === "500/3000/2500/0/0/0" && afterPart.hostCausedCents === 500, `${await places(m.monthId)} ${afterPart.hostCausedCents}`);

    // The host was not there at all.
    await attend(c.call, [[m.member.id, 0, 1800]]);
    await settleFinishedCalls(new Date(c.call.endsAt.getTime() + 10 * MIN));
    const none = await pay(c.call);
    check("the host was not there: nothing is used, all of it comes back at once, because of the host", none.status === "closed_uncharged" && (await places(m.monthId)) === "2000/1500/2500/0/0/0" && (await M(m.monthId)).hostCausedCents === 2000, `${none.status} ${await places(m.monthId)}`);

    // The member was not there; the host was.
    await attend(d.call, [[host.id, 0, 1800]]);
    await settle(d.call);
    check("the member was not there and the host was: all of it is used, as for any booked call", (await pay(d.call)).chargedCents === 1500 && (await places(m.monthId)) === "2000/0/4000/0/0/0", await places(m.monthId));

    // Money that came back because of the host is used last, and remembered on the booking.
    const e = await booked(m, { nth: 0 });
    check("a new booking from money that all came back because of the host remembers that", (await pay(e.call)).hostCausedCents === 1500 && (await M(m.monthId)).hostCausedCents === 500);
    await rateCall({ callId: a.call.id, raterId: m.member.id, stars: 5, now: new Date(a.call.endsAt.getTime() + HOUR) });
    await rateCall({ callId: a.call.id, raterId: host.id, stars: 4, now: new Date(a.call.endsAt.getTime() + HOUR) });
    check("each side can rate a member's call", (await db.select().from(schema.ratings).where(eq(schema.ratings.callId, a.call.id))).length === 2);
    await audit("after four calls", m);
  });

  // ========================================================================
  journey("Cancelling: by the member in time, by the host, and late", async () => {
    const host = await newHost({ freeCancelMinutes: 60 });
    const m = await member(host);
    // Make part of the month's free money "because of the host": a call the host cancels.
    const x = await booked(m, { nth: 0 });
    const outcome = await cancelCall({ call: x.call, payment: await pay(x.call), by: "host", now: new Date() });
    check("the host cancels: all of it comes back at once, marked because of the host", outcome === "free" && (await places(m.monthId)) === "6000/0/0/0/0/0" && (await M(m.monthId)).hostCausedCents === 1500 && (await pay(x.call)).status === "closed_uncharged", `${await places(m.monthId)} ${(await M(m.monthId)).hostCausedCents}`);
    check("the member's email says the time is back in the membership", /back in your membership/.test(await emailText(m.member.email, "cancelled your call")));
    check("the booking has ended and both people's time is free again", (await bookingById(x.booking.id)).stage === "cancelled" && (await db.select().from(schema.busyEntries).where(eq(schema.busyEntries.bookingId, x.booking.id))).length === 0);

    // Three more bookings use the plain money first ($45.00), so the fourth is made from host-caused money.
    await booked(m, { nth: 0 });
    await booked(m, { nth: 1 });
    await booked(m, { nth: 2 });
    const y = await booked(m, { nth: 3 });
    check("money that would expire is booked first: the last booking is the one made from host-caused money", (await pay(y.call)).hostCausedCents === 1500 && (await M(m.monthId)).hostCausedCents === 0, (await pay(y.call)).hostCausedCents);
    await cancelCall({ call: y.call, payment: await pay(y.call), by: "customer", now: new Date() });
    check("the member cancels in time: each part goes back where it came from", (await places(m.monthId)) === "1500/4500/0/0/0/0" && (await M(m.monthId)).hostCausedCents === 1500, `${await places(m.monthId)} ${(await M(m.monthId)).hostCausedCents}`);

    // A late cancellation: inside the host's last free hour before the call.
    const z = (await db.select().from(schema.bookings).where(and(eq(schema.bookings.customerId, m.member.id), eq(schema.bookings.stage, "accepted"), eq(schema.bookings.source, "member"))))[0];
    const zCall = await callOf(z);
    const late = await cancelCall({ call: zCall, payment: await pay(zCall), by: "customer", now: new Date(zCall.startsAt.getTime() - 30 * MIN) });
    const latePayment = await pay(zCall);
    check("a late cancellation uses everything that was set aside", late === "late_charge" && latePayment.status === "charged" && latePayment.chargedCents === 1500 && latePayment.chargeReason === "late_cancel" && (await M(m.monthId)).usedCents === 1500, `${late} ${latePayment.status}`);
    await settleCancelledCalls(new Date());
    check("the helper finds nothing left to settle for the cancelled calls", (await M(m.monthId)).setAsideCents === 3000);
    await audit("after cancelling", m);
  });

  // ========================================================================
  journey("Awkward prices: $5.00 per 15 minutes and 5-minute calls", async () => {
    const host = await newHost({ lengths: "5", price: 500, minutes: 30 });
    const m = await member(host);
    check("(a month of 30 minutes at $5.00: $10.00)", (await M(m.monthId)).totalCents === 1000);
    const calls: Call[] = [];
    for (let i = 0; i < 6; i++) calls.push((await booked(m, { nth: i * 3, length: 5 })).call);
    check("a 5-minute call sets aside $1.66 (rounded down); six of them leave 4 cents", (await pay(calls[0])).bookedCents === 166 && (await places(m.monthId)) === "4/996/0/0/0/0", await places(m.monthId));
    check("with 4 cents left, nothing more is offered", (await B.memberBookingView(m.member.id, host.id, new Date()))?.lengths.length === 0);
    await bothThere(m, calls[0]);
    await settle(calls[0]);
    check("a full call uses exactly the $1.66 that was set aside, never the $1.67 the usual rounding gives", (await pay(calls[0])).chargedCents === 166 && (await M(m.monthId)).usedCents === 166, (await pay(calls[0])).chargedCents);
    // The host was there for 1 minute of 5: 33 cents, under the 50-cent minimum.
    await attend(calls[1], [[host.id, 0, 60], [m.member.id, 0, 300]]);
    await settleFinishedCalls(new Date(calls[1].endsAt.getTime() + 10 * MIN));
    check("under 50 cents nothing is used: all of it comes back", (await pay(calls[1])).status === "closed_uncharged" && (await M(m.monthId)).freeCents === 170, await places(m.monthId));
    for (const call of calls.slice(2)) await cancelCall({ call, payment: await pay(call), by: "customer", now: new Date() });
    await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, m.membershipId));
    const end = (await M(m.monthId)).endsAt!;
    await closeMonth(m.monthId, end);
    await helper(new Date(end.getTime() + HOUR));
    const closed = await M(m.monthId);
    // Free at the end: 4 + 166 (host-caused) + 4 × 166 = 834; the host-caused 166 is paid back, 668 expires.
    check("at the month's end the small leftovers expire with the rest, and the host-caused part is paid back", closed.expiredCents === 668 && closed.paidBackCents === 166 && closed.usedCents === 166 && closed.status === "finished", `${placesOf(closed).join("/")} ${closed.status}`);
    await audit("after the month", m);
  });

  // ========================================================================
  journey("Across the month's end: a call just before it, settled afterwards", async () => {
    const host = await newHost();
    const m = await member(host);
    const a = await booked(m, { nth: 0 });
    const b = await booked(m, { nth: 1 });
    const c = await booked(m, { nth: 2 });
    await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, m.membershipId));
    // The month is made to end an hour after the last of the three calls.
    const end = new Date(c.call.endsAt.getTime() + HOUR);
    await db.update(months).set({ endsAt: end }).where(eq(months.id, m.monthId));
    await attend(a.call, [[host.id, 0, 1200], [m.member.id, 0, 1800]]);
    await bothThere(m, b.call);
    await bothThere(m, c.call);
    await closeMonth(m.monthId, end);
    const closed = await M(m.monthId);
    check("the month closes with the three calls' money still set aside: the free $15.00 expires, the rest waits", closed.status === "closed" && placesOf(closed).join("/") === "0/4500/0/1500/0/0", placesOf(closed).join("/"));
    await helper(new Date(end.getTime() + HOUR));
    check("the month is not finished while money is set aside", (await M(m.monthId)).status === "closed");

    // The first call settles the next day: $10.00 used, $5.00 back, which now goes to the card.
    await settle(a.call, new Date(Math.max(callsMoment(a.call).getTime(), end.getTime() + MIN)));
    const lines = await refundsOf(m.monthId);
    check("what comes back after the month's end is owed to the member's card, once", (await places(m.monthId)) === "0/3000/1000/1500/500/0" && lines.length === 1 && lines[0].sourceKey === `callreturn:${(await pay(a.call)).id}:settled` && lines[0].amountCents === 500, `${await places(m.monthId)} ${lines.map((l) => l.sourceKey)}`);
    // The expired money carried the month's 30 cents, so this first used amount does not.
    check("the month's 30 cents were placed on the expired money, so not on this call", (await pay(a.call)).feeFixedCents === 0 && (await pay(a.call)).originalFeeCents === 49);

    // The second: a refund request, answered "less" two days later.
    const afterEnd = new Date(Math.max(b.call.endsAt.getTime() + HOUR, end.getTime() + MIN));
    await askForRefund({ callId: b.call.id, customerId: m.member.id, reason: "other", note: "It was shorter than I hoped.", seen: null, now: afterEnd });
    await settle(b.call);
    check("with a request open, nothing is used at the usual moment", (await pay(b.call)).status === "held");
    const view = await requestViewOf(b.call);
    check("the host's time to answer is 24 hours from the request, with no hold to cut it short", view?.answerBy?.getTime() === afterEnd.getTime() + DAY, view?.answerBy);
    await answerRequest({ callId: b.call.id, by: host.id, as: "host", answers: [{ paymentId: (await pay(b.call)).id, choice: "less", maxCents: 600 }], message: null, now: new Date(afterEnd.getTime() + 2 * HOUR) });
    const less = await pay(b.call);
    check("answered \"less\": $6.00 is used and $9.00 goes to the card", less.chargedCents === 600 && less.recordCents === 1500 && less.loweredBy === "host" && (await places(m.monthId)) === "0/1500/1600/1500/1400/0", `${less.chargedCents} ${await places(m.monthId)}`);
    check("its share waits the 2 days of a call with a request", less.transferDueAt?.getTime() === Math.max(b.call.endsAt.getTime() + 2 * DAY, less.chargedAt!.getTime()));

    // The third comes under review, and nobody decides.
    await db.update(schema.payments).set({ needsReview: true, reviewReason: "check" }).where(eq(schema.payments.id, (await pay(c.call)).id));
    await settle(c.call);
    check("under review, the money stays set aside", (await pay(c.call)).status === "held");
    await settleFinishedCalls(new Date(c.call.endsAt.getTime() + 3 * DAY + MIN));
    check("not decided within 3 days of the call: all of it comes back, to the card", (await pay(c.call)).status === "closed_uncharged" && (await places(m.monthId)) === "0/0/1600/1500/2900/0", await places(m.monthId));
    await helper(new Date(end.getTime() + 5 * DAY));
    const done = await M(m.monthId);
    check("the pay-backs go through and the month is finished", done.status === "finished" && placesOf(done).join("/") === "0/0/1600/1500/0/2900", `${done.status} ${placesOf(done).join("/")}`);
    // The host has not collected yet, and gives $4.00 of the first call back after the month is finished.
    const lateGift = await giveTimeBack({ paymentId: (await pay(a.call)).id, amountCents: 400, decidedBy: host.id, decidedAs: "host", reason: null, requestId: randomUUID(), now: new Date(end.getTime() + 6 * DAY) });
    const reopened = await M(m.monthId);
    check("time given back after the month was finished is owed to the card, and the month is open for that again", lateGift === "card" && reopened.status === "closed" && placesOf(reopened).join("/") === "0/0/1200/1500/400/2900", `${lateGift} ${reopened.status} ${placesOf(reopened).join("/")}`);
    await helper(new Date(end.getTime() + 6 * DAY + HOUR));
    const again = await M(m.monthId);
    check("that pay-back is sent too, and the month is finished again", again.status === "finished" && placesOf(again).join("/") === "0/0/1200/1500/0/3300", `${again.status} ${placesOf(again).join("/")}`);
    await audit("after the month's end", m);
  });

  // ========================================================================
  journey("Refund requests on a member's call, and giving time back", async () => {
    const host = await newHost();
    const m = await member(host);
    const a = await booked(m, { nth: 0 });
    const b = await booked(m, { nth: 1 });
    const c = await booked(m, { nth: 2 });
    const d = await booked(m, { nth: 3 });
    for (const { call } of [a, b, c, d]) await bothThere(m, call);
    const ask = (call: Call) => askForRefund({ callId: call.id, customerId: m.member.id, reason: "other", note: "Please look at this.", seen: null, now: new Date(call.endsAt.getTime() + HOUR) });
    const answer = async (call: Call, choice: string, maxCents?: number) => answerRequest({ callId: call.id, by: host.id, as: "host", answers: [{ paymentId: (await pay(call)).id, choice, maxCents }], message: null, now: new Date(call.endsAt.getTime() + 2 * HOUR) });

    await ask(a.call);
    await answer(a.call, "full");
    check("answered \"in full\" before the money is used: all of it is used at once", (await pay(a.call)).chargedCents === 1500 && (await pay(a.call)).loweredBy === null);
    await ask(b.call);
    const tooLittle = await refused(answer(b.call, "less", 40));
    check("\"less\" under 50 cents is refused, in words for a membership", /cannot be used from a membership/.test(tooLittle ?? ""), tooLittle);
    await answer(b.call, "nothing");
    check("answered \"nothing\": nothing is used and all of it is free again, because of the host", (await pay(b.call)).status === "closed_uncharged" && (await pay(b.call)).loweredBy === "host" && (await M(m.monthId)).freeCents === 1500 && (await M(m.monthId)).hostCausedCents === 1500, await places(m.monthId));
    await ask(c.call);
    await settle(c.call);
    check("not answered: nothing is used at the usual moment", (await pay(c.call)).status === "held");
    await settleFinishedCalls(new Date(c.call.endsAt.getTime() + HOUR + DAY + 4 * MIN));
    check("when the host's 24 hours are over, it is used in full", (await pay(c.call)).chargedCents === 1500);

    // The form after the money was used, while the month runs: time back.
    await settle(d.call);
    const dPay = await pay(d.call);
    check("(the fourth call was used with nobody asking)", dPay.chargedCents === 1500);
    const formId = randomUUID();
    const give = (amountCents: number, requestId: string, now = new Date(d.call.startsAt.getTime() + DAY + HOUR)) => giveTimeBack({ paymentId: dPay.id, amountCents, decidedBy: host.id, decidedAs: "host", reason: "Sorry about the sound.", requestId, now });
    const before = await M(m.monthId);
    const to = await give(500, formId);
    const afterGive = await pay(d.call);
    check("the host gives $5.00 back while the month runs: it is time in the membership again", to === "free" && (await M(m.monthId)).freeCents === before.freeCents + 500 && (await M(m.monthId)).usedCents === before.usedCents - 500 && afterGive.refundedCents === 500, `${to} ${await places(m.monthId)}`);
    check("the member's email says time, not money to the card", /back in your membership/.test(await emailText(m.member.email, "membership time is back")));
    await give(500, formId);
    check("the same press twice gives back once", (await pay(d.call)).refundedCents === 500 && (await M(m.monthId)).freeCents === before.freeCents + 500);
    await give(300, randomUUID());
    check("a second, different amount is a second giving back", (await pay(d.call)).refundedCents === 800);
    check("more than is left is refused", /more than what is left/.test((await refused(give(800, randomUUID()))) ?? ""));
    const [line] = await db.select().from(schema.refunds).where(eq(schema.refunds.id, formId));
    const givenLines = await db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, dPay.id));
    check("each of the two is a line among the refunds that is done at once, with no Stripe refund", Boolean(line) && givenLines.length === 2 && givenLines.every((row) => row.status === "done" && row.stripeRefundId === null && row.decidedAs === "host" && Boolean(row.finishedAt)) && sum(givenLines.map((row) => row.amountCents)) === 800, givenLines.length);

    // An open request answered by time given back.
    const e = await booked(m, { nth: 0 });
    await bothThere(m, e.call);
    // Its money is used by the founder's decision a few minutes after the call, so the member can still ask afterwards.
    await db.update(schema.payments).set({ needsReview: true, reviewReason: "check" }).where(eq(schema.payments.id, (await pay(e.call)).id));
    await decideMemberReview({ paymentId: (await pay(e.call)).id, amountCents: 1500, frozen: null, now: new Date(e.call.endsAt.getTime() + 10 * MIN) });
    await ask(e.call);
    const openRequest = await requestViewOf(e.call);
    check("(the member asked after the money was used: the request is open, with nothing left that an answer could lower)", openRequest?.answered === false && openRequest.open.length === 0, openRequest?.answered);
    await giveTimeBack({ paymentId: (await pay(e.call)).id, amountCents: 200, decidedBy: host.id, decidedAs: "host", reason: null, requestId: randomUUID(), now: new Date(e.call.endsAt.getTime() + 2 * HOUR) });
    check("an open request counts as answered once time was given back", (await requestViewOf(e.call))?.answered === true);

    // While the share is written down for collecting, and once it is sent: refused.
    const cPay = await pay(c.call);
    const [operation] = await db.insert(schema.moneyOperations).values({ paymentId: cPay.id, kind: "transfer", label: `check:${randomUUID()}`, params: "{}", status: "started" }).returning();
    const whileSending = await refused(giveTimeBack({ paymentId: cPay.id, amountCents: 100, decidedBy: host.id, decidedAs: "host", reason: null, requestId: randomUUID() }));
    check("while the share is written down for collecting, nothing can be given back", /being sent right now/.test(whileSending ?? ""), whileSending);
    await db.delete(schema.moneyOperations).where(eq(schema.moneyOperations.id, operation.id));
    await db.update(schema.payments).set({ transferStatus: "sent" }).where(eq(schema.payments.id, cPay.id));
    const afterSent = await refused(giveTimeBack({ paymentId: cPay.id, amountCents: 100, decidedBy: host.id, decidedAs: "host", reason: null, requestId: randomUUID() }));
    check("and not once the host has collected it", /already been paid/.test(afterSent ?? ""), afterSent);
    await db.update(schema.payments).set({ transferStatus: "not_due" }).where(eq(schema.payments.id, cPay.id));

    // After the month's end the same form pays back to the card. The first amount of the month carried the fixed fee.
    await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, m.membershipId));
    for (const row of await db.select().from(schema.bookings).where(and(eq(schema.bookings.customerId, m.member.id), eq(schema.bookings.stage, "accepted"), eq(schema.bookings.source, "member")))) {
      const call = await callOf(row);
      if ((await pay(call)).status === "held") await cancelCall({ call, payment: await pay(call), by: "customer", now: new Date() }).catch(() => undefined);
    }
    const end = (await M(m.monthId)).endsAt!;
    await closeMonth(m.monthId, end);
    const first = await pay(a.call);
    check("(the first amount of the month carried the 30 cents: fee $1.04)", first.originalFeeCents === 104 && first.feeFixedCents === 30);
    const toCard = await giveTimeBack({ paymentId: first.id, amountCents: 1500, decidedBy: host.id, decidedAs: "admin", reason: null, requestId: randomUUID(), now: new Date(end.getTime() + HOUR) });
    const given = await pay(a.call);
    check("after the month's end the time given back is owed to the card, and the whole fee goes back with it", toCard === "card" && given.refundedCents === 1500 && given.transferStatus === "not_owed" && (await ledger({ paymentId: given.id }, "platform_fee")).total === 0 && (await ledger({ paymentId: given.id }, "host_share")).total === 0, `${toCard} ${given.transferStatus}`);
    check("the member's email says money to the card", /paid back to your card/.test(await emailText(m.member.email, "will be paid back to your card")));
    await helper(new Date(end.getTime() + 2 * HOUR));
    check("the pay-back goes through at Stripe", (await M(m.monthId)).toPayBackCents === 0 && (await M(m.monthId)).paidBackCents >= 1500, await places(m.monthId));
    await audit("after refund requests and giving back", m);
  });

  // ========================================================================
  journey("The founder's review of a member's call", async () => {
    const host = await newHost();
    const m = await member(host);
    const a = await booked(m, { nth: 0 });
    const b = await booked(m, { nth: 1 });
    const c = await booked(m, { nth: 2 });
    // "End call and report", 10 minutes into the first call.
    const during = new Date(a.call.startsAt.getTime() + 10 * MIN);
    await endCallForSafety({ call: a.call, by: m.member.id, now: during }).catch((error) => console.log(`   (the room could not be closed from a script: ${error instanceof Error ? error.message.split("\n")[0] : error})`));
    const stopped = (await db.select().from(schema.calls).where(eq(schema.calls.id, a.call.id)))[0];
    const aPay = await pay(a.call);
    check("\"End call and report\" sends the member's payment to the founder's review", Boolean(stopped.safetyEndedAt) && aPay.needsReview && aPay.status === "held");
    await attend(stopped, [[host.id, 0, 600], [m.member.id, 0, 600]]);
    await settle(stopped);
    check("it is not used by itself", (await pay(a.call)).status === "held");
    const decide = (paymentId: string, amountCents: number | null, call: Call, maxCents?: number) => decideMemberReview({ paymentId, amountCents, maxCents, frozen: null, now: new Date(call.endsAt.getTime() + DAY) });
    // 10 of 30 minutes at $7.50 per 15: at most $5.00.
    check("more than the time before the stop allows is refused", /before the call was stopped/.test((await refused(decide(aPay.id, 600, a.call, 500))) ?? ""));
    check("more than was set aside is refused", /more than was set aside/.test((await refused(decide(aPay.id, 1600, a.call))) ?? ""));
    check("under 50 cents is refused", Boolean(await refused(decide(aPay.id, 40, a.call, 500))));
    await decide(aPay.id, 500, a.call, 500);
    const decided = await pay(a.call);
    check("within the ceilings: $5.00 is used as the founder's decision, and $10.00 comes back because of the host", decided.status === "charged" && decided.chargedCents === 500 && decided.chargeReason === "admin" && !decided.needsReview && (await places(m.monthId)) === "2500/3000/500/0/0/0" && (await M(m.monthId)).hostCausedCents === 1000, `${decided.status} ${await places(m.monthId)}`);
    check("a second decision is refused", Boolean(await refused(decide(aPay.id, 500, a.call, 500))));

    // A record that does not add up: the helper sends it to review; the founder releases it.
    await attend(b.call, [[host.id, 0, 1800]]);
    await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: b.call.id, type: "participant_left", roomSessionId: "RM_odd", participantIdentity: m.member.id, participantSessionId: "PA_never_joined", providerTime: new Date(b.call.startsAt.getTime() + 60_000), payload: "{}" });
    await settle(b.call);
    const bPay = await pay(b.call);
    check("a record that does not add up goes to the founder's review, not to a guess", bPay.needsReview && bPay.status === "held", `${bPay.status} ${bPay.needsReview}`);
    const beforeRelease = await M(m.monthId);
    const released = await refused(decide(bPay.id, null, b.call));
    check("the founder releases it: nothing is used, all of it comes back, because of the host", released === null && (await pay(b.call)).status === "closed_uncharged" && (await M(m.monthId)).freeCents === beforeRelease.freeCents + 1500 && (await M(m.monthId)).hostCausedCents === beforeRelease.hostCausedCents + 1500, released);

    // An answer accepted before the review stays the most the member pays.
    await bothThere(m, c.call);
    await askForRefund({ callId: c.call.id, customerId: m.member.id, reason: "other", note: "Too short.", seen: null, now: new Date(c.call.endsAt.getTime() + HOUR) });
    const cPay = await pay(c.call);
    await db.transaction(async (tx) => {
      const [request] = await tx.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, c.call.id));
      await tx.insert(schema.refundRequestAnswers).values({ requestId: request.id, paymentId: cPay.id, choice: "less", maxCents: 700 });
      await tx.update(schema.refundRequests).set({ status: "answered", decidedBy: host.id, decidedAs: "host", decidedAt: new Date() }).where(eq(schema.refundRequests.id, request.id));
      await tx.update(schema.payments).set({ needsReview: true, reviewReason: "check" }).where(eq(schema.payments.id, cPay.id));
    });
    check("an answer accepted before the review is the ceiling for the founder", /at most \$7\.00/.test((await refused(decide(cPay.id, 800, c.call))) ?? ""));
    check("past 3 days after the call the founder can no longer decide", /deadline/.test((await refused(decideMemberReview({ paymentId: cPay.id, amountCents: 700, frozen: null, now: new Date(c.call.endsAt.getTime() + 3 * DAY + MIN) }))) ?? ""));
    await decide(cPay.id, 700, c.call);
    check("at the ceiling it is used", (await pay(c.call)).chargedCents === 700);
    // "End call and report" in the 5 minutes before the start, and then a cancellation from a page that was still open.
    const d = await booked(m, { nth: 3 });
    const soon = await moveCall(d.call, new Date(Date.now() + 3 * MIN));
    await endCallForSafety({ call: soon, by: host.id, now: new Date() }).catch((error) => console.log(`   (the room could not be closed from a script: ${error instanceof Error ? error.message.split("\n")[0] : error})`));
    const beforeCancel = await places(m.monthId);
    check("(the call was ended before its start, and its money waits for review)", (await pay(soon)).needsReview && Boolean((await db.select().from(schema.calls).where(eq(schema.calls.id, soon.id)))[0].safetyEndedAt));
    const sneaky = await refused(cancelCall({ call: soon, payment: await pay(soon), by: "customer", now: new Date() }));
    const still = await pay(soon);
    check("a call that was ended with \"End call and report\" cannot be cancelled: its money stays for the founder's review", /no longer be cancelled/.test(sneaky ?? "") && still.status === "held" && still.needsReview && (await places(m.monthId)) === beforeCancel && !(await db.select().from(schema.calls).where(eq(schema.calls.id, soon.id)))[0].cancelledAt, `${sneaky} ${still.status} ${still.needsReview}`);
    await decideMemberReview({ paymentId: still.id, amountCents: null, frozen: null, now: new Date() });
    await audit("after the reviews", m);
  });

  // ========================================================================
  journey("A frozen month: nothing of it moves while the bank's dispute is open", async () => {
    const host = await newHost();
    const m = await member(host);
    const first = await booked(m, { nth: 0 });
    const b = await booked(m, { nth: 1 });
    // The first call took place two hours ago and is not settled yet; the second is still to come.
    const a = { booking: first.booking, call: await moveCall(first.call, new Date(Date.now() - 2 * HOUR)) };
    await bothThere(m, a.call);
    await E.recordMonthDispute(m.monthId, "open", new Date());
    await helper(new Date());
    const membership = await MS(m.membershipId);
    check("a dispute ends the membership and cancels the upcoming member call", membership.status === "ended" && Boolean((await callOf(b.booking)).cancelledAt));
    check("the cancelled call's money stays set aside: only the disputed month is frozen, and all of it", (await pay(b.call)).status === "held" && (await places(m.monthId)) === "3000/3000/0/0/0/0", await places(m.monthId));
    check("the member's email says the time stays where it is until the bank has decided", /stays where it is until the bank has decided/.test(await emailText(m.member.email, "Your call was cancelled")));
    await settle(a.call);
    await settleCancelledCalls(new Date());
    check("the call that took place is not settled either", (await pay(a.call)).status === "held" && (await places(m.monthId)) === "3000/3000/0/0/0/0");
    const finished = (await db.select().from(schema.calls).where(eq(schema.calls.id, a.call.id)))[0];
    check("and nothing of it counts as late for the health check", (await callOverdue(finished, new Date(callsMoment(a.call).getTime() + HOUR))) === false);
    check("a frozen month gives the member no view to book from", (await B.memberBookingView(m.member.id, host.id, new Date())) === null);
    await db.update(schema.payments).set({ needsReview: true, reviewReason: "check" }).where(eq(schema.payments.id, (await pay(a.call)).id));
    check("the founder cannot decide a payment of it", /disputed/.test((await refused(decideMemberReview({ paymentId: (await pay(a.call)).id, amountCents: 1500, frozen: null, now: new Date() }))) ?? "") && (await pay(a.call)).status === "held");
    await db.update(schema.payments).set({ needsReview: false, reviewReason: null }).where(eq(schema.payments.id, (await pay(a.call)).id));

    await E.recordMonthDispute(m.monthId, "lost", new Date());
    await settle(a.call);
    await settleCancelledCalls(new Date());
    check("lost: still nothing moves", (await places(m.monthId)) === "3000/3000/0/0/0/0");

    // A second member whose dispute is won.
    const n = await member(host);
    const third = await booked(n, { nth: 2 });
    const d = await booked(n, { nth: 3 });
    const c = { booking: third.booking, call: await moveCall(third.call, new Date(Date.now() - 2 * HOUR)) };
    await bothThere(n, c.call);
    await E.recordMonthDispute(n.monthId, "open", new Date());
    await helper(new Date());
    await E.recordMonthDispute(n.monthId, "won", new Date());
    await settleCancelledCalls(new Date());
    await settle(c.call);
    const won = await M(n.monthId);
    // $30.00 was free: paid back because the membership ended. $15.00 of the cancelled call: to the card. $15.00 used.
    check("won: the month goes on from where it stood: the call is used, the cancelled call's money and the free money go to the card", (await pay(c.call)).chargedCents === 1500 && (await pay(d.call)).status === "closed_uncharged" && won.usedCents === 1500 && won.toPayBackCents + won.paidBackCents === 4500 && won.setAsideCents === 0 && won.freeCents === 0, placesOf(won).join("/"));
    await audit("the frozen month", m, { frozen: true });
  });

  // ========================================================================
  journey("Endings: the host ends the membership, a block, a closed account", async () => {
    const host = await newHost();
    const m = await member(host);
    const upcoming = await booked(m, { nth: 0 });
    const underWay = await booked(m, { nth: 1 });
    // The second call is under way when the membership ends.
    const live = await moveCall(underWay.call, new Date(Date.now() - 10 * MIN));
    await E.endByHost({ membershipId: m.membershipId, hostId: host.id, now: new Date() });
    await helper(new Date());
    check("the host ends the membership: the upcoming call is cancelled and its money goes to the card", Boolean((await callOf(upcoming.booking)).cancelledAt) && (await pay(upcoming.call)).status === "closed_uncharged" && /paid back to your card/.test(await emailText(m.member.email, "Your call was cancelled")));
    check("the call under way is left alone, with its money still set aside", !(await callOf(underWay.booking)).cancelledAt && (await pay(live)).status === "held" && (await M(m.monthId)).setAsideCents === 1500, await places(m.monthId));
    check("the clean-up is done, and the free money is owed back", Boolean((await MS(m.membershipId)).cleanupDoneAt) && (await M(m.monthId)).freeCents === 0);
    await attend(live, [[host.id, 0, 900], [m.member.id, 0, 1800]]);
    await settleFinishedCalls(new Date(live.startsAt.getTime() + DAY + 4 * MIN));
    await helper(new Date(live.startsAt.getTime() + DAY + HOUR));
    const after = await M(m.monthId);
    // 15 of 30 minutes: $7.50 used, $7.50 to the card; with $30.00 free and $15.00 cancelled: $52.50 paid back.
    check("when it is settled, what it used goes to the host and the rest to the card", after.usedCents === 750 && after.paidBackCents === 5250 && after.setAsideCents === 0, placesOf(after).join("/"));
    await audit("after the host's ending", m);

    const n = await member(host);
    const blockedCall = await booked(n, { nth: 2 });
    await block({ blockerId: host.id, blockedId: n.member.id, now: new Date() });
    await helper(new Date());
    check("a block ends the membership and cancels the member's call, with the money to the card", (await MS(n.membershipId)).status === "ended" && Boolean((await callOf(blockedCall.booking)).cancelledAt) && (await M(n.monthId)).paidBackCents === 6000, await places(n.monthId));
    check("after the block the member has no view to book from", (await B.memberBookingView(n.member.id, host.id, new Date())) === null);
    await audit("after the block", n);

    const o = await member(host);
    const closing = await booked(o, { nth: 3 });
    await closeAccount({ userId: o.member.id, by: o.member.id });
    await helper(new Date());
    const [closedUser] = await db.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, o.member.id));
    check("a closed account: the account is closed, the membership has ended, the call is cancelled and everything goes back to the card", Boolean(closedUser.closedAt) && (await MS(o.membershipId)).status === "ended" && Boolean((await callOf(closing.booking)).cancelledAt) && (await M(o.monthId)).paidBackCents === 6000, `${closedUser.closedAt} ${(await MS(o.membershipId)).status} ${await places(o.monthId)}`);
    await audit("after the closed account", o);
  });

  // ========================================================================
  journey("At the same moment: two bookings, a booking and \"Cancel now\", a booking and the timed taking", async () => {
    const host = await newHost();
    const m = await member(host);
    await db.update(months).set({ freeCents: 1500, expiredCents: 4500 }).where(eq(months.id, m.monthId));
    const open = (await times(m)).filter((at) => hourInNewYork(at) < 13);
    const both = await Promise.allSettled([book(m, open[0]), book(m, open[2])]);
    const bookedNow = both.filter((r) => r.status === "fulfilled" && r.value.outcome === "booked").length;
    const refusedOne = both.find((r) => r.status === "rejected");
    check("two bookings for the last free money at the same moment: one is booked, and the other is refused for lack of time left", bookedNow === 1 && Boolean(refusedOne) && byARule(refusedOne!) && /enough membership time/.test(whyNot(refusedOne!)) && (await M(m.monthId)).freeCents === 0 && (await M(m.monthId)).setAsideCents === 1500, `${bookedNow} ${both.map(whyNot)} ${await places(m.monthId)}`);
    await db.update(months).set({ expiredCents: 0, freeCents: 4500 }).where(eq(months.id, m.monthId));
    const same = await Promise.allSettled([book(m, open[4]), book(m, open[4])]);
    const refusedSame = same.find((r) => r.status === "rejected");
    check("two different presses for the same time: one is booked, and the other is told the time is gone", same.filter((r) => r.status === "fulfilled" && r.value.outcome === "booked").length === 1 && Boolean(refusedSame) && byARule(refusedSame!) && /no longer open|already have a request or a call/.test(whyNot(refusedSame!)) && (await M(m.monthId)).setAsideCents === 3000, `${same.map(whyNot)} ${await places(m.monthId)}`);
    await audit("after the races", m);

    // A booking and "Cancel now" on a month that is only held.
    const n = await member(host, { take: false });
    const open2 = (await times(n)).filter((at) => hourInNewYork(at) < 13);
    const race = await Promise.allSettled([book(n, open2[6]), E.cancelNow({ membershipId: n.membershipId, memberId: n.member.id, now: new Date() })]);
    await helper(new Date());
    const month = await M(n.monthId);
    const membership = await MS(n.membershipId);
    const wasBooked = race[0].status === "fulfilled" && race[0].value.outcome === "booked";
    const consistent = wasBooked ? month.status === "running" && month.setAsideCents === 1500 && membership.status === "active" : month.setAsideCents === 0 && (month.status !== "running" || membership.status === "active");
    check("a booking and \"Cancel now\" at the same moment: each is carried out or refused by a rule, never by a database error", race.every(byARule), race.map(whyNot));
    check("and either the call is booked from a paid month, or nothing is booked; never a call without its money", consistent, `${race.map((r) => r.status)} booked=${wasBooked} ${month.status} ${membership.status} ${await places(n.monthId)}`);
    const intent = await stripe().paymentIntents.retrieve(month.stripePaymentIntentId!);
    check("and Stripe agrees with the month", month.status === "running" ? intent.status === "succeeded" : intent.status === "canceled" || intent.status === "requires_capture", intent.status);

    // A booking and the timed taking.
    const o = await member(host, { take: false });
    const open3 = (await times(o)).filter((at) => hourInNewYork(at) < 13);
    const race2 = await Promise.allSettled([book(o, open3[8]), C.takeMonth(o.monthId, new Date())]);
    const again = race2[0].status === "fulfilled" && race2[0].value.outcome !== "booked" ? await book(o, open3[8], { key: race2[0].value.booking.requestKey }) : null;
    const month2 = await M(o.monthId);
    check("a booking and the timed taking at the same moment: the money is taken once, and the call is booked (at once or on the next press)", race2.every(byARule) && month2.status === "running" && month2.setAsideCents === 1500 && (await ledger({ monthId: o.monthId }, "customer_charge")).lines === 1, `${race2.map((r) => r.status)} ${again?.outcome} ${await places(o.monthId)}`);
    await audit("after the taking race", o);

    // A booking and the month's end.
    const p = await member(host);
    await db.update(schema.memberships).set({ memberStoppedAt: new Date() }).where(eq(schema.memberships.id, p.membershipId));
    const open4 = (await times(p)).filter((at) => hourInNewYork(at) < 13);
    const end = (await M(p.monthId)).endsAt!;
    const race3 = await Promise.allSettled([book(p, open4[10]), closeMonth(p.monthId, end)]);
    const month3 = await M(p.monthId);
    const booked3 = race3[0].status === "fulfilled" && race3[0].value.outcome === "booked";
    check(
      "a booking and the closing of the month at the same moment: the booking is made or refused by a rule; the month is closed with the call's money set aside, or finished with none",
      race3[1].status === "fulfilled" && month3.status === (booked3 ? "closed" : "finished") && byARule(race3[0]) && sum(placesOf(month3)) === 6000 && month3.setAsideCents === (booked3 ? 1500 : 0) && month3.freeCents === 0,
      `${race3.map(whyNot)} ${booked3} ${month3.status} ${placesOf(month3).join("/")}`,
    );
  });

  // ========================================================================
  journey("The switch off with a month running; \"call now\"; the ordinary way; a card call beside a member call", async () => {
    const host = await newHost({ onlyMemberHours: true });
    const m = await member(host);
    const a = await booked(m, { nth: 0, memberOnly: true });
    await setSwitches({ memberships: "off", membershipsHosts: [] });
    try {
      const b = await booked(m, { nth: 1, memberOnly: true });
      check("with the founder's switch off, a month already paid for can still be booked from", Boolean(b.call.id) && (await places(m.monthId)) === "3000/3000/0/0/0/0");
      await bothThere(m, a.call);
      await settle(a.call);
      check("and its call is settled", (await pay(a.call)).chargedCents === 1500);
      const someone = await person("member");
      await talked(host, someone);
      check("nobody can be invited", (await refused(J.invite({ hostId: host.id, customerId: someone.id, now: new Date() }))) !== null);
      check("with the switch off, a host who already has hours for members may still keep such hours; someone with none may not", (await mayKeepMemberHours(host.id)) === true && (await mayKeepMemberHours(someone.id)) === false);
      await addWeeklyHours(host.id, { weekday: 3, from: "16:00", to: "17:00", membersOnly: true });
      const [added] = await db.select().from(schema.weeklyHours).where(and(eq(schema.weeklyHours.hostId, host.id), eq(schema.weeklyHours.weekday, 3), eq(schema.weeklyHours.startMinute, 16 * 60)));
      check("hours added with the tick are saved as hours for members only", added?.membersOnly === true && added.endMinute === 17 * 60);
    } finally {
      await setSwitches({ memberships: "named", membershipsHosts: named });
    }
    const offer = (await offerOf(host.id))!;
    check("a host whose weekly hours are all for members has no times for a call later for the public", (await openTimes(offer, 30, new Date())).length === 0);
    // The host switches "available now" on (her page is open and was seen a moment ago).
    await db.update(schema.hostCalendars).set({ availableUntil: new Date(Date.now() + 2 * HOUR), availableSeenAt: new Date() }).where(eq(schema.hostCalendars.userId, host.id));
    const now = await instantOffer(host.id, new Date());
    check("such a host can still be called now: \"call now\" is not narrowed by member-only hours", now !== null && now.offer.hostId === host.id && now.lengths.includes(30), now?.lengths);

    // A member with too little time left asks the ordinary way.
    const general = await newHost();
    const n = await member(general);
    await db.update(months).set({ freeCents: 500, expiredCents: 5500 }).where(eq(months.id, n.monthId));
    const publicTimes = await openTimes((await offerOf(general.id))!, 30, new Date());
    const ordinary = await askForCall({ customer: n.member, hostId: general.id, startsAt: publicTimes[0], lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 1000, freeCancelMinutes: 0 }, now: new Date() });
    check("a member whose time does not cover a call can still ask the ordinary way, at the regular price", ordinary.booking.source === "customer" && ordinary.booking.pricePer15Cents === 1000 && ordinary.booking.stage === "card");
    await db.update(months).set({ freeCents: 6000, expiredCents: 0 }).where(eq(months.id, n.monthId));

    // A card call through every job, with a member's payment beside it on the same host.
    const memberCall = await booked(n, { nth: 2 });
    const caller = await person("caller");
    const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
    const paid = await db.transaction(async (tx) => {
      const [call] = await tx.insert(schema.calls).values({ hostId: general.id, customerId: caller.id, startsAt, endsAt: new Date(startsAt.getTime() + 15 * MIN), roomName: `membercalls-${randomUUID()}`, pricePer15Cents: 1000 }).returning();
      await createPaymentForCall(tx, call);
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
      return { call, payment };
    });
    await startHold({ payment: paid.payment, call: paid.call, customer: caller, now: new Date() });
    const [withIntent] = await db.select().from(schema.payments).where(eq(schema.payments.id, paid.payment.id));
    await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    await syncHold(paid.payment.id, new Date());
    await attend(paid.call, [[general.id, 0, 900], [caller.id, 0, 900]]);
    await bothThere(n, memberCall.call);
    const later = new Date(Math.max(callsMoment(memberCall.call).getTime(), startsAt.getTime() + DAY + 4 * MIN));
    await runPaymentJobs(later);
    const cardPaid = (await db.select().from(schema.payments).where(eq(schema.payments.id, paid.payment.id)))[0];
    const cardIntent = await stripe().paymentIntents.retrieve(cardPaid.stripePaymentIntentId!);
    check("a card call goes through the same jobs exactly as before: $10.00 charged at Stripe, with its own fee", cardIntent.status === "succeeded" && cardIntent.amount_received === 1000 && cardPaid.status === "charged" && cardPaid.chargedCents === 1000 && cardPaid.originalFeeCents === 79 && (await ledger({ paymentId: cardPaid.id }, "customer_charge")).total === 1000, `${cardPaid.status} ${cardPaid.chargedCents} ${cardPaid.originalFeeCents}`);
    check("and the member's call beside it is used from the month", (await pay(memberCall.call)).chargedCents === 1500);
    const earnings = await unsentEarnings(new Date(later.getTime() + 2 * DAY), general.id);
    const sharesOf = (paymentId: string) => earnings.filter((row) => row.payment?.id === paymentId && !row.heldBack).length;
    check("both shares are the host's to collect, neither held back: the card call's and the member call's", earnings.length === 2 && sharesOf(cardPaid.id) === 1 && sharesOf((await pay(memberCall.call)).id) === 1, earnings.map((row) => row.heldBack));
    void acceptCollection;
    await audit("at the end", n);
  });

  // ========================================================================
  journey("The health check, and collecting held back by a request", async () => {
    const host = await newHost();
    const m = await member(host);
    const a = await booked(m, { nth: 0 });
    const b = await booked(m, { nth: 1 });
    await bothThere(m, a.call);
    await bothThere(m, b.call);
    const finished = async (call: Call) => (await db.select().from(schema.calls).where(eq(schema.calls.id, call.id)))[0];
    check("a member's money is not late before the call's moment", (await callOverdue(await finished(a.call), new Date(a.call.startsAt.getTime() + DAY))) === false);
    check("5 minutes past the call's moment and still set aside: reported as late", (await callOverdue(await finished(a.call), new Date(a.call.startsAt.getTime() + DAY + 3 * MIN + 6 * MIN))) === true);
    await settle(a.call);
    check("once it is used, nothing is late", (await callOverdue(await finished(a.call), new Date(a.call.startsAt.getTime() + DAY + HOUR))) === false);
    await settle(b.call);
    const second = await pay(b.call);
    check("the second amount of the month carries no fixed fee: $14.26 for the host", second.originalHostShareCents === 1426 && (await pay(a.call)).originalHostShareCents === 1396);
    const at = new Date(b.call.endsAt.getTime() + DAY + HOUR);
    const ready = await unsentEarnings(at, host.id);
    check("both shares are ready a day after their calls", ready.filter((row) => !row.heldBack).length === 2, ready.map((row) => row.heldBack));
    // The member asks about a third call after it was used by the founder's decision: its share is held back.
    const c = await booked(m, { nth: 2 });
    await bothThere(m, c.call);
    await db.update(schema.payments).set({ needsReview: true, reviewReason: "check" }).where(eq(schema.payments.id, (await pay(c.call)).id));
    await decideMemberReview({ paymentId: (await pay(c.call)).id, amountCents: 1500, frozen: null, now: new Date(c.call.endsAt.getTime() + 10 * MIN) });
    const beforeAsk = (await pay(c.call)).transferDueAt!;
    await askForRefund({ callId: c.call.id, customerId: m.member.id, reason: "other", note: "Please look.", seen: null, now: new Date(c.call.endsAt.getTime() + HOUR) });
    const afterAsk = await pay(c.call);
    check("asking for a refund moves the day of a member payment that was already used, as for a card payment", afterAsk.transferDueAt!.getTime() === c.call.endsAt.getTime() + 2 * DAY && afterAsk.transferDueAt! > beforeAsk);
    const held = (await unsentEarnings(new Date(c.call.endsAt.getTime() + 3 * DAY), host.id)).find((row) => row.payment?.id === afterAsk.id);
    check("and its share is held back until the host has answered", held?.heldBack === "request", held?.heldBack);
    await audit("at the end", m);
  });

  // ========================================================================
  if (process.argv.includes("--payouts")) {
    journey("Collecting: a member call's share reaches the host through \"Collect earnings\", from the month's own charge", async () => {
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
        const m = await member(host);
        const a = await booked(m, { nth: 0 });
        const b = await booked(m, { nth: 1 });
        await bothThere(m, a.call);
        await bothThere(m, b.call);
        check("nothing of a member's call can be collected while its money is only set aside", (await press(new Date(b.call.endsAt.getTime() + 3 * DAY))) instanceof MoneyError);
        await settle(a.call);
        await settle(b.call);
        const early = await press(new Date(a.call.endsAt.getTime() + DAY - MIN));
        check("a member call's share cannot be collected before 24 hours after the call", early instanceof MoneyError && (await pay(a.call)).transferStatus === "not_due", early?.message);
        // A card call with the same host, charged the ordinary way.
        const caller = await person("caller");
        const startsAt = new Date(Math.ceil((Date.now() + 600_000) / 1000) * 1000);
        const paid = await db.transaction(async (tx) => {
          const [call] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: caller.id, startsAt, endsAt: new Date(startsAt.getTime() + 15 * MIN), roomName: `membercalls-${randomUUID()}`, pricePer15Cents: 1000 }).returning();
          await createPaymentForCall(tx, call);
          const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
          return { call, payment };
        });
        await startHold({ payment: paid.payment, call: paid.call, customer: caller, now: new Date() });
        const [withIntent] = await db.select().from(schema.payments).where(eq(schema.payments.id, paid.payment.id));
        await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
        await syncHold(paid.payment.id, new Date());
        await attend(paid.call, [[host.id, 0, 900], [caller.id, 0, 900]]);
        await settleFinishedCalls(new Date(startsAt.getTime() + DAY + 4 * MIN));
        const cardShare = async () => (await db.select().from(schema.payments).where(eq(schema.payments.id, paid.payment.id)))[0];
        check("(the card call was charged $10.00: the host's share is $9.21)", (await cardShare()).originalHostShareCents === 921, (await cardShare()).status);

        const pressed = await press(new Date(b.call.endsAt.getTime() + 3 * DAY));
        const [pa, pb, pc] = [await pay(a.call), await pay(b.call), await cardShare()];
        // $13.96 (with the month's 30 cents) + $14.26 + $9.21 = $37.43; one 25-cent collection charge: $37.18 sent.
        const sent = (pa.transferCents ?? 0) + (pb.transferCents ?? 0) + (pc.transferCents ?? 0);
        const fees = (pa.payoutFeeCents ?? 0) + (pb.payoutFeeCents ?? 0) + (pc.payoutFeeCents ?? 0);
        check("one press sends two member calls' shares and a card call's share together, with one collection charge", pressed === null && [pa, pb, pc].every((p) => p.transferStatus === "sent") && sent === 3718 && fees === 25, `${pressed?.message} ${pa.transferStatus} ${pb.transferStatus} ${pc.transferStatus} ${sent} ${fees}`);
        const month = await M(m.monthId);
        const inMonthsGroup = (await stripe().transfers.list({ transfer_group: m.monthId, limit: 10 })).data;
        const inCallsGroup = (await stripe().transfers.list({ transfer_group: paid.call.id, limit: 10 })).data;
        check(
          "at Stripe: the member calls' transfers name the month's charge and group, the card call's its own",
          inMonthsGroup.length === 2 && inMonthsGroup.every((t) => t.source_transaction === month.stripeChargeId && t.destination === account) && inCallsGroup.length === 1 && inCallsGroup[0].source_transaction === pc.stripeChargeId && sum([...inMonthsGroup, ...inCallsGroup].map((t) => t.amount)) === 3718,
          `${inMonthsGroup.length} ${inCallsGroup.length}`,
        );
        check("what went to the host from the month is never more than what was used", sum(inMonthsGroup.map((t) => t.amount)) <= month.usedCents);
        const tooLate = await refused(giveTimeBack({ paymentId: pa.id, amountCents: 100, decidedBy: host.id, decidedAs: "host", reason: null, requestId: randomUUID() }));
        check("once the share is collected, time can no longer be given back through the app", /already been paid/.test(tooLate ?? ""), tooLate);
        await audit("after collecting", m);
      } finally {
        await give(host.id, seeded.id);
        await refreshPayoutsReady(seeded.id).catch(() => undefined);
      }
    });
  }

  // ------------------------------------------------------------------------
  // For looking at the pages by hand: a real member between the two seeded test accounts.
  //   --demo      makes it (a membership whose first month is held, on a host with member-only hours) and leaves it there
  //   --demo-off  takes it away again and turns the founder's switch off
  // ------------------------------------------------------------------------
  if (process.argv.includes("--demo") || process.argv.includes("--demo-off")) {
    const account = async (email: string) => (await db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.email, email)))[0];
    const [host, customer] = [await account("host@test.local"), await account("customer@test.local")];
    if (!host || !customer) throw new Error("The seeded test accounts are missing. Run scripts/seed.ts first.");
    await wipe(false, { hostId: host.id, customerId: customer.id });
    await db.delete(schema.weeklyHours).where(and(eq(schema.weeklyHours.hostId, host.id), eq(schema.weeklyHours.membersOnly, true)));
    if (process.argv.includes("--demo-off")) {
      await db.delete(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, host.id));
      await setSwitches({ memberships: "off", membershipsHosts: [] });
      console.log("The demo membership is gone, and the founder's memberships switch is off.");
      process.exit(0);
    }
    const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, host.id));
    if (!profile || !(await offerOf(host.id))) throw new Error("The seeded host has no approved page with a calendar and weekly hours. Set those up in the app first.");
    await setSwitches({ memberships: "named", membershipsHosts: [host.id] });
    await db.insert(schema.membershipOffers).values({ hostId: host.id, on: true, pricePer15Cents: Math.max(500, profile.pricePer15Cents - 250), includedMinutes: 120 }).onConflictDoNothing();
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) await db.insert(schema.weeklyHours).values({ hostId: host.id, weekday, startMinute: 20 * 60, endMinute: 22 * 60, membersOnly: true });
    const startsAt = new Date(Date.now() - 2 * DAY);
    const [call] = await db.insert(schema.calls).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), roomName: `membercalls-demo-${randomUUID()}`, pricePer15Cents: 1000, closedAt: new Date(startsAt.getTime() + 31 * MIN) }).returning();
    for (const who of [host.id, customer.id]) {
      await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type: "participant_joined", roomSessionId: "RM_membercalls_demo", participantIdentity: who, participantSessionId: `PA_${randomUUID().slice(0, 8)}`, providerTime: startsAt, payload: "{}" });
    }
    const invitation = await J.invite({ hostId: host.id, customerId: customer.id, now: new Date() });
    const started = await J.join({ customerId: customer.id, inviteId: invitation.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date() });
    await C.payNow({ monthId: started.monthId, memberId: customer.id });
    await stripe().paymentIntents.confirm((await M(started.monthId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    await C.syncMonth(started.monthId, new Date());
    console.log(`The demo membership is ready: customer@test.local is a member of @${profile.handle}, with this month's money held (the first booking takes it).`);
    console.log(`Open /h/${profile.handle} as the customer. Take it away again with: npx tsx scripts/member-calls-check.ts --demo-off`);
    process.exit(0);
  }

  // ------------------------------------------------------------------------
  // Running
  // ------------------------------------------------------------------------
  if (only && (only.length === 0 || only.some((n) => !Number.isInteger(n) || n < 1 || n > journeys.length))) throw new Error(`--only takes journey numbers from 1 to ${journeys.length}.`);
  const before = await switches();
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
    await setSwitches({ memberships: "off", membershipsHosts: [], requestsOff: before.requestsOff });
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
