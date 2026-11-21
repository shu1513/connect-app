/**
 * The app's own record of each bank dispute, and telling people about it
 * (plans/47-bank-disputes.md, part 1).
 *
 * This record is for the people: who is told what, and when. It is never what keeps money from
 * moving. That stays `payments.disputeOpen` and the `dispute` field of a month and of a
 * contribution's payment, which are written first, by the code that has always written them. The
 * record here is written afterwards, in a step of its own, so a fault in it can never stand in
 * the way of protecting the money. And whenever the record sees something new, the money is
 * looked at once more, so the two never end up telling different stories.
 *
 * A row is written, and its messages with it, in one database step with the row locked. A row
 * that is there is read from Stripe again AFTER it is locked: whoever writes after us has read
 * after us, so an older answer from Stripe never lands on top of a newer one, and nobody is told
 * something that was already out of date.
 *
 * That locked read is the helper's work, never part of handling a message from Stripe: while such
 * a message is not handled, no host can collect, so its handling must not wait for Stripe longer
 * than the money needs. The message's handling only notes the dispute (`noteDispute`: a first
 * sight is written from what was just read; a known one is marked "look again"), and the helper
 * does the rest within the minute.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import type { Dispute } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import { refreshDispute } from "@/lib/contributions/dispute";
import { errorSummary, queueEmail } from "@/lib/email";
import { refreshMonthDispute } from "@/lib/membership/ending";
import { appUrl, tell } from "@/lib/messages/messages";
import { allDisputesOf, inTime, refreshPaymentDispute } from "@/lib/payments/disputes";
import type { Tx } from "@/lib/payments/operations";
import { stripe } from "@/lib/payments/stripe";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { askUntilFor, planFor, stopsPaying, waits } from "./rules";
import { isAppeal, isCompliance, outcomeOf, reasonWords, stageOf, standingOf, type Outcome } from "./status";
import { appealWords, beganWords, choiceWords, endedWords, lateWords, type Facts, type Role, type Told } from "./words";

/** What a dispute is about: a call's card payment, a membership's month, or a contribution's payment (tips are contributions). */
export type Owner = { kind: "payment" | "month" | "contribution"; id: string };

type Person = { id: string; name: string; email: string; timeZone: string | null };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ownerKey = (owner: Owner) => `${owner.kind}:${owner.id}`;

/** The owners of these charges at Stripe, by PaymentIntent. A charge that is not one of ours is simply not in the answer. */
export async function ownersOfIntents(intentIds: string[]): Promise<Map<string, Owner>> {
  const owners = new Map<string, Owner>();
  if (intentIds.length === 0) return owners;
  const payments = await db.select({ id: schema.payments.id, intentId: schema.payments.stripePaymentIntentId }).from(schema.payments).where(inArray(schema.payments.stripePaymentIntentId, intentIds));
  for (const row of payments) owners.set(row.intentId!, { kind: "payment", id: row.id });
  const months = await db.select({ id: schema.membershipMonths.id, intentId: schema.membershipMonths.stripePaymentIntentId }).from(schema.membershipMonths).where(inArray(schema.membershipMonths.stripePaymentIntentId, intentIds));
  for (const row of months) owners.set(row.intentId!, { kind: "month", id: row.id });
  const contributed = await db
    .select({ id: schema.contributionPayments.id, intentId: schema.contributionPayments.stripePaymentIntentId })
    .from(schema.contributionPayments)
    .where(inArray(schema.contributionPayments.stripePaymentIntentId, intentIds));
  for (const row of contributed) owners.set(row.intentId!, { kind: "contribution", id: row.id });
  return owners;
}

export const ownerOf = (dispute: Pick<Dispute, "paymentId" | "monthId" | "contributionPaymentId">): Owner =>
  dispute.paymentId ? { kind: "payment", id: dispute.paymentId } : dispute.monthId ? { kind: "month", id: dispute.monthId } : { kind: "contribution", id: dispute.contributionPaymentId! };

/**
 * Who is on each side of this money, its payment at Stripe, the page where the customer can read
 * about it, and the words for what it is, as each reader would call it.
 */
type About = {
  intentId: string | null;
  hostId: string;
  customerId: string;
  customerPath: string | null;
  what: (role: Role, reader: { timeZone: string | null }, names: { host: string; customer: string }) => string;
};

type Reader = Pick<typeof db, "select">;

export async function aboutOwner(reader: Reader, owner: Owner): Promise<About | null> {
  if (owner.kind === "payment") {
    const [row] = await reader
      .select({ intentId: schema.payments.stripePaymentIntentId, extensionId: schema.payments.extensionId, call: schema.calls })
      .from(schema.payments)
      .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
      .where(eq(schema.payments.id, owner.id));
    if (!row) return null;
    const added = row.extensionId ? " (the time added during the call)" : "";
    return {
      intentId: row.intentId,
      hostId: row.call.hostId,
      customerId: row.call.customerId,
      customerPath: `/calls/${row.call.id}/results`,
      what: (role, person, names) =>
        role === "host"
          ? `the payment for your call with ${names.customer} on ${whenFor(person, row.call.startsAt)}${added}`
          : role === "customer"
            ? `the payment for your call with ${names.host} on ${whenFor(person, row.call.startsAt)}${added}`
            : `the payment for the call of ${names.host} (host) and ${names.customer} (customer) on ${whenFor(person, row.call.startsAt)}${added}`,
    };
  }
  if (owner.kind === "month") {
    const [row] = await reader
      .select({ intentId: schema.membershipMonths.stripePaymentIntentId, number: schema.membershipMonths.number, membership: schema.memberships })
      .from(schema.membershipMonths)
      .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
      .where(eq(schema.membershipMonths.id, owner.id));
    if (!row) return null;
    return {
      intentId: row.intentId,
      hostId: row.membership.hostId,
      customerId: row.membership.customerId,
      customerPath: `/memberships/${row.membership.id}`,
      what: (role, _person, names) =>
        role === "host"
          ? `a payment for ${names.customer}'s membership with you (month ${row.number})`
          : role === "customer"
            ? `a payment for your membership with ${names.host} (month ${row.number})`
            : `a payment for ${names.customer}'s membership with ${names.host} (month ${row.number})`,
    };
  }
  const [row] = await reader
    .select({ intentId: schema.contributionPayments.stripePaymentIntentId, contribution: schema.contributions, project: schema.projects.name, tipCallStartsAt: schema.calls.startsAt })
    .from(schema.contributionPayments)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.contributions.projectId))
    .leftJoin(schema.calls, eq(schema.calls.id, schema.contributions.callId))
    .where(eq(schema.contributionPayments.id, owner.id));
  if (!row) return null;
  const { contribution, project, tipCallStartsAt } = row;
  const tip = contribution.kind === "tip";
  return {
    intentId: row.intentId,
    hostId: contribution.hostId,
    customerId: contribution.contributorId,
    customerPath: tip && contribution.callId ? `/calls/${contribution.callId}/results` : `/contributions/${contribution.id}`,
    what: (role, person, names) => {
      const thing = tip ? `a tip${tipCallStartsAt ? ` for the call on ${whenFor(person, tipCallStartsAt)}` : ""}` : `a contribution${project ? ` to "${project}"` : ""}`;
      return role === "host" ? `${thing} from ${names.customer}` : role === "customer" ? `${thing} you gave ${names.host}` : `${thing} from ${names.customer} to ${names.host}`;
    },
  };
}

/** The host, the customer and the admins, with the host's name as customers know it. */
export async function peopleFor(tx: Tx, about: About): Promise<{ host: Person; customer: Person; hostName: string; founders: Person[] } | null> {
  const columns = { id: schema.user.id, name: schema.user.name, email: schema.user.email, timeZone: schema.user.timeZone };
  const rows = await tx.select(columns).from(schema.user).where(inArray(schema.user.id, [about.hostId, about.customerId]));
  const host = rows.find((row) => row.id === about.hostId);
  const customer = rows.find((row) => row.id === about.customerId);
  if (!host || !customer) return null;
  const [profile] = await tx.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, about.hostId));
  const founders = await tx.select(columns).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
  return { host, customer, hostName: profile?.displayName ?? host.name, founders };
}

/** The page of a dispute, for its host and for the founder. */
export const disputePath = (disputeId: string) => `/disputes/${disputeId}`;

/**
 * What happened, for telling people: a stage began; the dispute ended; an appeal began (the founder
 * only); the host can now choose about a chargeback that was already waiting (the host only); or a
 * fault: no answer could be sent and the bank's deadline is near (the founder only).
 */
export type Event = { began: true } | { ended: Outcome; afterAppeal?: boolean } | { appeal: true } | { choice: true } | { late: string | null } | { plan: true };

/**
 * What is told, to whom, about one dispute.
 *   - The host and the customer: a message in the app and the same words by email (`tell`). The
 *     host reads more on the dispute's own page; the customer on the page of what they paid for.
 *   - The founder: an email only, with a link to the dispute's page. What the founder is told names
 *     both people, so it is kept behind the admin login (the admin page and the dispute's page), and
 *     not on the Messages page, which any login of that account can open.
 * Each key names the dispute, what happened and the person, so each is told once, however often
 * Stripe's messages repeat.
 */
export async function tellAll(tx: Tx, about: About, dispute: Dispute, event: Event): Promise<void> {
  const people = await peopleFor(tx, about);
  if (!people) return;
  const names = { host: people.hostName, customer: people.customer.name };
  const what = "began" in event ? `${dispute.stage}:began` : "ended" in event ? `ended:${event.ended}` : "appeal" in event ? "appeal" : "choice" in event ? `${dispute.stage}:choice` : "plan" in event ? `${dispute.stage}:plan:${planFor(dispute)}` : `${dispute.stage}:late`;
  const wordsFor = (role: Role, person: Person): Told => {
    const facts: Facts = {
      stage: dispute.stage as Facts["stage"],
      standing: standingOf(dispute.status),
      noAnswer: dispute.noAnswer,
      plan: planFor(dispute),
      compliance: dispute.compliance,
      askUntil: dispute.askUntil ? whenFor(person, dispute.askUntil) : null,
      stopStays: stopsPaying(dispute) === "lost",
      membership: dispute.monthId !== null,
      what: about.what(role, person, names),
      amount: money(dispute.amountCents),
      reason: reasonWords(dispute.reason),
      dueBy: dispute.dueBy ? whenFor(person, dispute.dueBy) : null,
      duePassed: dispute.dueBy !== null && dispute.dueBy.getTime() <= Date.now(),
      appealWaits: dispute.status === "appeal_needs_response",
      hostName: people.hostName,
      customerName: people.customer.name,
      supportEmail: SUPPORT_EMAIL,
    };
    // A dispute first seen while it is in an appeal: the founder gets the appeal's own words, which do not say
    // that nothing can be sent.
    if (role === "founder" && "began" in event && isAppeal(dispute.status)) return appealWords(facts);
    if ("choice" in event) return choiceWords(facts);
    // What the app does has changed while the dispute waits: the host gets the words that ask them, the founder the
    // opening words again, which say what the app does now.
    if ("plan" in event) return role === "host" ? choiceWords(facts) : beganWords(role, facts);
    if ("late" in event) return lateWords(facts, event.late);
    return "began" in event ? beganWords(role, facts) : "ended" in event ? endedWords(role, facts, event.ended) : appealWords(facts);
  };
  if ("began" in event || "ended" in event || "choice" in event || ("plan" in event && dispute.askUntil !== null && dispute.choice === null)) {
    const host = wordsFor("host", people.host);
    // The email that asks the host to choose is not worth sending once their time is up. The message in the app stays.
    const asks = ("began" in event || "choice" in event || "plan" in event) && dispute.askUntil !== null;
    await tell(tx, { to: people.host, key: `dispute:${dispute.id}:${what}:host:${people.host.id}`, subject: host.subject, text: host.text, path: disputePath(dispute.id), emailExpiresAt: asks ? dispute.askUntil! : undefined });
  }
  if ("began" in event || "ended" in event) {
    const customer = wordsFor("customer", people.customer);
    await tell(tx, { to: people.customer, key: `dispute:${dispute.id}:${what}:customer:${people.customer.id}`, subject: customer.subject, text: customer.text, path: about.customerPath });
  }
  // The host's own chance to choose is nothing the founder needs an email about.
  if ("choice" in event) return;
  // The founder was told that an appeal began, so they are told how it ended also when that is the same ending as
  // before the appeal (for the host and the customer, who were not told of the appeal, the same ending is no news).
  const forFounder = "ended" in event && event.afterAppeal ? `ended-after-appeal:${event.ended}` : what;
  for (const founder of people.founders) {
    const told = wordsFor("founder", founder);
    await queueEmail(tx, {
      to: founder.email,
      key: `dispute:${dispute.id}:${forFounder}:founder:${founder.id}`,
      subject: told.subject,
      text: `${told.text}\n\nThe dispute's page (admin login):\n${appUrl()}${disputePath(dispute.id)}\n`,
    });
  }
}

/** What Stripe shows of a dispute, as the row keeps it. */
export function seenIn(found: Stripe.Dispute, now: Date) {
  const due = found.evidence_details?.due_by;
  return {
    amountCents: found.amount,
    currency: found.currency,
    reason: found.reason,
    compliance: isCompliance(found),
    stage: stageOf(found.status),
    status: found.status,
    // Stripe writes 0 for "the bank takes no answer": that is not a date.
    dueBy: due ? new Date(due * 1000) : null,
    noAnswer: due === 0,
    updatedAt: now,
  };
}

/**
 * The fields of a stage that begins: when the app first sees it waiting for an answer. Whether the
 * host is asked, and until when, is fixed here; everything about an earlier stage's choice and answer
 * starts afresh. A host whose account is closed is not asked.
 */
async function stageStart(tx: Tx, dispute: { stage: string; compliance: boolean; amountCents: number; noAnswer: boolean; dueBy: Date | null; hostId: string }, now: Date) {
  const [host] = await tx.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, dispute.hostId));
  return {
    stageBeganAt: now,
    askUntil: planFor(dispute) === "ask" ? askUntilFor({ now, dueBy: dispute.dueBy, hostCanChoose: Boolean(host) && !host.closedAt }) : null,
    choice: null,
    chosenAs: null,
    chosenAt: null,
    answer: "none",
    answerKind: null,
    answerAttempt: 0,
    answerStartedAt: null,
    answeredAt: null,
    answerError: null,
    proof: null,
  };
}

/**
 * Writes the row of a dispute the app has not seen before, from what Stripe shows, and tells the
 * people. Gives back false, and writes nothing, when the row is there already. A dispute that had
 * already ended when we first saw it is old news: recorded, and nobody is told.
 */
async function firstSight(tx: Tx, owner: Owner, about: About, found: Stripe.Dispute, now: Date): Promise<boolean> {
  const outcome = outcomeOf(found.status);
  const seen = seenIn(found, now);
  const made = await tx
    .insert(schema.disputes)
    .values({
      id: found.id,
      paymentId: owner.kind === "payment" ? owner.id : null,
      monthId: owner.kind === "month" ? owner.id : null,
      contributionPaymentId: owner.kind === "contribution" ? owner.id : null,
      hostId: about.hostId,
      customerId: about.customerId,
      openedAt: new Date(found.created * 1000),
      outcome,
      endedAt: outcome ? now : null,
      ...seen,
      ...(waits(found.status) ? await stageStart(tx, { ...seen, hostId: about.hostId }, now) : {}),
    })
    .onConflictDoNothing()
    .returning();
  if (made.length === 0) return false;
  if (!outcome) await tellAll(tx, about, made[0], { began: true });
  return true;
}

/**
 * For the handling of a message from Stripe, after the money is protected: notes the dispute the
 * message was about, without asking Stripe anything more. `found` is that dispute as Stripe showed
 * it a moment ago. A first sight is written from it, with its messages. A dispute the app knows is
 * marked for the helper, which asks Stripe about it again within the minute (`lookAtOpenDisputes`).
 */
export async function noteDispute(owner: Owner, found: Stripe.Dispute, now: Date = new Date()): Promise<void> {
  const about = await aboutOwner(db, owner);
  if (!about) return;
  await db.transaction(async (tx) => {
    if (await firstSight(tx, owner, about, found, now)) return;
    await tx.update(schema.disputes).set({ lookAgain: true }).where(eq(schema.disputes.id, found.id));
  });
}


/**
 * One dispute, written into its row, with the messages a change calls for. Gives back whether
 * there was something new: a row that did not exist, or another status than the row had.
 */
async function writeOne(owner: Owner, about: About, listed: Stripe.Dispute, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (await firstSight(tx, owner, about, listed, now)) return true;
    const [before] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, listed.id)).for("update");
    if (!before) return false;
    // The row is ours now. Stripe is read again from here (see the top of this file), and "look again" is cleared in
    // the same step: a message from Stripe that comes in meanwhile waits for this row and then sets it once more.
    // One try, and never for long (`inTime`): the handling of a message from Stripe about the same dispute waits for
    // this row (`noteDispute`), and while it waits no host can collect.
    const fresh = await inTime(stripe().disputes.retrieve(listed.id, {}, { maxNetworkRetries: 0 }));
    const outcome = outcomeOf(fresh.status);
    const seen = seenIn(fresh, now);
    const stageChanged = before.stage !== seen.stage;
    // The bank has decided while a request of the app is written down and not yet confirmed: whose answer it was is
    // settled first (the answer job, this pass or the next, at the latest after 23 hours), because what people are
    // told about the ending depends on it. The money was looked at before this; only the record waits.
    if (outcome && !before.outcome && before.answer === "sending" && !stageChanged) {
      await tx.update(schema.disputes).set({ lookAgain: true, updatedAt: now }).where(eq(schema.disputes.id, listed.id));
      // Something new was seen all the same: the caller looks at the money once more.
      return true;
    }
    // A stage begins when it is first seen waiting for an answer: a bank's question that became a chargeback, or
    // a dispute that was recorded before the app answered banks (its stage was never begun).
    // What the app does about a stage that still waits has changed on Stripe's side, with nothing chosen or sent yet
    // (a dispute newly marked as a compliance one, or no longer; another amount): the stage is begun afresh, so the
    // host gets their time when it is now theirs to choose, and nobody is asked when it no longer is.
    const sameWaitingStage = !stageChanged && before.stageBeganAt !== null && waits(before.status) && waits(fresh.status) && before.answer === "none";
    // The same holds when nobody was asked and the host now could be (the founder's line for compliance disputes was
    // moved while this one waited): the stage is begun afresh, which gives the host their time.
    const [hostNow] = sameWaitingStage && before.askUntil === null && before.choice === null && planFor(seen) === "ask" ? await tx.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, before.hostId)) : [];
    const neverAsked = hostNow !== undefined && askUntilFor({ now, dueBy: seen.dueBy, hostCanChoose: !hostNow.closedAt }) !== null;
    const planDiffers = sameWaitingStage && (planFor(before) !== planFor(seen) || neverAsked);
    // A choice the host has made stands; only the founder is then told what the app now does.
    const planChanged = planDiffers && before.choice === null;
    const begins = waits(fresh.status) && (stageChanged || before.stageBeganAt === null || planChanged);
    // Whatever belongs to a stage (the choice, the answer, the proof) is the old stage's and never carried into a new
    // one, also when the new stage is first seen already past waiting: then nobody is asked, and the app has sent
    // nothing in it.
    const start = begins || stageChanged ? await stageStart(tx, { ...seen, hostId: before.hostId }, now) : {};
    // (A stage begun afresh for a new plan is still the same stage at Stripe: the count of the app's requests in it
    // goes on, so no label is ever used twice.)
    const begun = begins ? (planChanged ? { ...start, answerAttempt: before.answerAttempt } : start) : stageChanged ? { ...start, askUntil: null, answer: "not_ours" } : {};
    // What became of the stage that is over is kept, one line for each.
    const history = stageChanged && before.stageBeganAt !== null ? JSON.stringify([...(JSON.parse(before.stageHistory) as unknown[]), { stage: before.stage, choice: before.choice, chosenAs: before.chosenAs, answer: before.answer === "sending" ? "unknown" : before.answer, answeredAt: before.answeredAt }]) : before.stageHistory;
    // The stage stopped waiting and the app has sent nothing: somebody else answered (a person in Stripe, or Stripe
    // itself), or the bank's time ran out. If a request of the app had been written down for this stage and was
    // never confirmed, it is not known who answered. (A request that is still written down is the answer job's to settle.)
    const stopped = !begins && !stageChanged && waits(before.status) && !waits(fresh.status) && before.answer === "none";
    const [after] = await tx
      .update(schema.disputes)
      .set({ ...seen, ...begun, stageHistory: history, ...(stopped ? { answer: before.answerAttempt > 0 ? "unknown" : "not_ours" } : {}), lookAgain: false, outcome, endedAt: outcome ? (before.outcome === outcome ? before.endedAt : now) : null })
      .where(eq(schema.disputes.id, listed.id))
      .returning();
    // A chargeback that was already waiting and can now be chosen about: the host is told once.
    if (begins && !stageChanged && !planChanged && after.askUntil) await tellAll(tx, about, after, { choice: true });
    // The plan changed: the host is asked if it is now theirs to choose, and the founder is told what the app now does.
    if (planDiffers) await tellAll(tx, about, after, { plan: true });
    if (before.status === fresh.status) return begins;
    // A new stage on a row that was there: a bank's question that became a chargeback.
    if (!outcome && stageChanged) await tellAll(tx, about, after, { began: true });
    if (outcome && before.outcome !== outcome) await tellAll(tx, about, after, { ended: outcome, afterAppeal: isAppeal(before.status) });
    if (isAppeal(fresh.status) && !isAppeal(before.status)) await tellAll(tx, about, after, { appeal: true });
    return true;
  });
}

/**
 * Writes down every dispute Stripe has on this owner's charge, as it stands now. Stripe is asked
 * once more after writing: only when it still shows the same is the work done. Gives back whether
 * anything new was seen.
 */
export async function recordDisputesOf(owner: Owner, now: Date = new Date()): Promise<boolean> {
  const about = await aboutOwner(db, owner);
  if (!about?.intentId) return false;
  let changed = false;
  let written: string | null = null;
  for (let round = 0; round < 4; round++) {
    const found = await allDisputesOf(about.intentId);
    const seen = found
      .map((dispute) => `${dispute.id}:${dispute.status}`)
      .sort()
      .join(",");
    if (seen === written) break;
    for (const dispute of found) changed = (await writeOne(owner, about, dispute, now)) || changed;
    written = seen;
  }
  return changed;
}

/** What keeps the money where it is, asked of Stripe again: the code that has always done that, for each kind of money. */
async function refreshMoney(owner: Owner, now: Date): Promise<void> {
  if (owner.kind === "payment") await refreshPaymentDispute(owner.id, now);
  else if (owner.kind === "month") await refreshMonthDispute(owner.id, now);
  else await refreshDispute(owner.id, now);
}

/**
 * Asks Stripe again about everything on this owner's charge: first the money, then the record.
 * If the record saw something new, the money is looked at once more with a fresh read, so a change
 * that fell between the two reads cannot leave lost money collectible.
 */
export async function refreshOwner(owner: Owner, now: Date = new Date()): Promise<void> {
  await refreshMoney(owner, now);
  if (await recordDisputesOf(owner, now)) await refreshMoney(owner, now);
}

/** For test scripts only: touch nothing but these disputes, so a check never changes other rows of a shared database. */
export type Only = { disputeIds: string[] };

/**
 * The helper's look, every few seconds. Two kinds of dispute are asked about again:
 *   - one a message from Stripe has just been about (`noteDispute` marked it): within the minute;
 *   - every one that has not ended, whatever kind of money it is about: once an hour. So an ending
 *     is recorded also when Stripe's message about it never came. (The looks that exist for a
 *     month and for a contribution go by "the month is open"; a month already marked lost by one
 *     dispute is passed over there although a second dispute on it is still open. Going by dispute
 *     closes that gap.)
 * A dispute that could not be asked about, in whole or in part, is marked and tried again a minute
 * later: the record may have been written when the last look at the money failed, and the next
 * try begins with the money.
 */
export async function lookAtOpenDisputes(now: Date, only?: Only): Promise<void> {
  const due = or(
    and(isNull(schema.disputes.outcome), lte(schema.disputes.updatedAt, new Date(now.getTime() - 3_600_000))),
    and(eq(schema.disputes.lookAgain, true), lte(schema.disputes.updatedAt, new Date(now.getTime() - 60_000))),
  );
  const open = await db
    .select()
    .from(schema.disputes)
    .where(and(due, only ? inArray(schema.disputes.id, only.disputeIds) : undefined))
    .orderBy(asc(schema.disputes.updatedAt))
    .limit(25);
  // One read per charge, however many of its disputes are due.
  const asked = new Set<string>();
  for (const dispute of open) {
    const owner = ownerOf(dispute);
    if (asked.has(ownerKey(owner))) continue;
    asked.add(ownerKey(owner));
    await refreshOwner(owner, now).then(
      // It takes its turn also when Stripe's list did not show it (then nothing above wrote to its row), so no
      // dispute can keep the others from being asked about.
      () =>
        db
          .update(schema.disputes)
          .set({ updatedAt: now })
          .where(eq(schema.disputes.id, dispute.id))
          .then(
            () => undefined,
            // The look itself went through. Not being able to note its turn must not stop the others'.
            (error) => console.error(`[disputes] could not note the turn of dispute ${dispute.id} (${errorSummary(error)})`),
          ),
      async (error) => {
        console.error(`[disputes] could not ask about dispute ${dispute.id} (${errorSummary(error)}); will retry`);
        await db.update(schema.disputes).set({ lookAgain: true, updatedAt: now }).where(eq(schema.disputes.id, dispute.id)).catch(() => undefined);
      },
    );
  }
}

/**
 * Catching up from Stripe's own list: every dispute opened in the last `days` days that the app
 * does not have, or has under another status than Stripe now shows, is read again. So a dispute
 * whose message was lost, or one that began before this record existed, does not stay unknown, and
 * a later change to one that had ended (an appeal) is seen. Stripe's list goes by the day a
 * dispute was opened. The list is taken a page at a time; a Stripe account can be shared with
 * other copies of the app, whose charges are simply not found here.
 */
export async function catchUpFromStripe(now: Date, days: number, only?: Only): Promise<void> {
  const since = Math.floor((now.getTime() - days * 24 * 3_600_000) / 1000);
  const asked = new Set<string>();
  const catchUp = async (page: Stripe.Dispute[]) => {
    const rows = await db.select({ id: schema.disputes.id, status: schema.disputes.status }).from(schema.disputes).where(inArray(schema.disputes.id, page.map((dispute) => dispute.id)));
    const known = new Map(rows.map((row) => [row.id, row.status]));
    const behind = page.flatMap((dispute) => {
      const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
      return intentId && known.get(dispute.id) !== dispute.status ? [{ dispute, intentId }] : [];
    });
    const owners = await ownersOfIntents([...new Set(behind.map((one) => one.intentId))]);
    for (const { dispute, intentId } of behind) {
      const owner = owners.get(intentId);
      if (!owner || asked.has(ownerKey(owner))) continue;
      asked.add(ownerKey(owner));
      await refreshOwner(owner, now).catch(async (error) => {
        console.error(`[disputes] could not catch up on dispute ${dispute.id} (${errorSummary(error)}); the next look tries again`);
        // If its row was written before the fault, the helper's look takes it up again within the minute.
        await db.update(schema.disputes).set({ lookAgain: true, updatedAt: now }).where(eq(schema.disputes.id, dispute.id)).catch(() => undefined);
      });
    }
  };
  let page: Stripe.Dispute[] = [];
  for await (const dispute of stripe().disputes.list({ created: { gte: since }, limit: 100 })) {
    if (only && !only.disputeIds.includes(dispute.id)) continue;
    page.push(dispute);
    if (page.length === 100) {
      await catchUp(page);
      page = [];
    }
  }
  if (page.length > 0) await catchUp(page);
}

/** Disputes for the founder's list: those that have not ended, oldest deadline first, then the latest that ended. */
export async function disputesForFounder(endedShown = 20): Promise<{ open: Dispute[]; ended: Dispute[] }> {
  const open = await db.select().from(schema.disputes).where(isNull(schema.disputes.outcome)).orderBy(asc(schema.disputes.dueBy), asc(schema.disputes.openedAt));
  const ended = await db.select().from(schema.disputes).where(isNotNull(schema.disputes.outcome)).orderBy(desc(schema.disputes.endedAt)).limit(endedShown);
  return { open, ended };
}
