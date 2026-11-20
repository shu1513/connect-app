/**
 * The app's own record of each bank dispute, and telling people about it
 * (plans/47-bank-disputes.md, part 1).
 *
 * This record is for the people: who is told what, and when. It is never what keeps money from
 * moving. That stays `payments.disputeOpen` and the `dispute` field of a month and of a
 * contribution's payment, which are written first, by the code that has always written them. The
 * record here is written afterwards, in a step of its own, so a fault in it can never stand in
 * the way of protecting the money.
 *
 * A row is written, and its messages with it, in one database step with the row locked. The first
 * writer makes the row; anyone arriving at the same moment waits for it and then finds nothing
 * new to say.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type Stripe from "stripe";
import { db, schema } from "@/db";
import type { Dispute } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import { refreshDispute } from "@/lib/contributions/dispute";
import { refreshMonthDispute } from "@/lib/membership/ending";
import { tell } from "@/lib/messages/messages";
import { refreshPaymentDispute } from "@/lib/payments/disputes";
import type { Tx } from "@/lib/payments/operations";
import { stripe } from "@/lib/payments/stripe";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { isCompliance, outcomeOf, reasonWords, stageOf, type Outcome } from "./status";
import { beganWords, endedWords, type Facts, type Role } from "./words";

/** What a dispute is about: a call's card payment, a membership's month, or a contribution's payment (tips are contributions). */
export type Owner = { kind: "payment" | "month" | "contribution"; id: string };

type Person = { id: string; name: string; email: string; timeZone: string | null };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The owner of a charge at Stripe, by its PaymentIntent. Null when the charge is not one of ours. */
export async function ownerOfIntent(intentId: string): Promise<Owner | null> {
  const [payment] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.stripePaymentIntentId, intentId));
  if (payment) return { kind: "payment", id: payment.id };
  const [month] = await db.select({ id: schema.membershipMonths.id }).from(schema.membershipMonths).where(eq(schema.membershipMonths.stripePaymentIntentId, intentId));
  if (month) return { kind: "month", id: month.id };
  const [contributed] = await db.select({ id: schema.contributionPayments.id }).from(schema.contributionPayments).where(eq(schema.contributionPayments.stripePaymentIntentId, intentId));
  if (contributed) return { kind: "contribution", id: contributed.id };
  return null;
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
async function peopleFor(tx: Tx, about: About): Promise<{ host: Person; customer: Person; hostName: string; founders: Person[] } | null> {
  const columns = { id: schema.user.id, name: schema.user.name, email: schema.user.email, timeZone: schema.user.timeZone };
  const rows = await tx.select(columns).from(schema.user).where(inArray(schema.user.id, [about.hostId, about.customerId]));
  const host = rows.find((row) => row.id === about.hostId);
  const customer = rows.find((row) => row.id === about.customerId);
  if (!host || !customer) return null;
  const [profile] = await tx.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, about.hostId));
  const founders = await tx.select(columns).from(schema.admins).innerJoin(schema.user, eq(schema.user.id, schema.admins.userId));
  return { host, customer, hostName: profile?.displayName ?? host.name, founders };
}

/** Where each of the three can read about a dispute: the host and the founder on its own page, the customer on the page of what they paid for. */
export const disputePath = (disputeId: string) => `/disputes/${disputeId}`;

/** What is told, to whom, about one dispute: the three "a stage began" messages or the three "it ended" ones. */
async function tellAll(tx: Tx, about: About, dispute: Dispute, event: { began: true } | { ended: Outcome }): Promise<void> {
  const people = await peopleFor(tx, about);
  if (!people) return;
  const names = { host: people.hostName, customer: people.customer.name };
  const readers: Array<{ role: Role; person: Person; path: string | null }> = [
    { role: "host", person: people.host, path: disputePath(dispute.id) },
    { role: "customer", person: people.customer, path: about.customerPath },
    ...people.founders.map((person) => ({ role: "founder" as const, person, path: disputePath(dispute.id) })),
  ];
  for (const { role, person, path } of readers) {
    const facts: Facts = {
      stage: dispute.stage as Facts["stage"],
      what: about.what(role, person, names),
      amount: money(dispute.amountCents),
      reason: reasonWords(dispute.reason),
      dueBy: dispute.dueBy ? whenFor(person, dispute.dueBy) : null,
      hostName: people.hostName,
      customerName: people.customer.name,
      supportEmail: SUPPORT_EMAIL,
    };
    const told = "began" in event ? beganWords(role, facts) : endedWords(role, facts, event.ended);
    // The key names the dispute, what happened and the person: each is told once, however often Stripe's messages repeat.
    const what = "began" in event ? `${dispute.stage}:began` : `ended:${event.ended}`;
    await tell(tx, { to: person, key: `dispute:${dispute.id}:${what}:${role}:${person.id}`, subject: told.subject, text: told.text, path });
  }
}

/** One dispute as Stripe shows it now, written into its row, with the messages a change calls for. */
async function writeOne(owner: Owner, about: About, found: Stripe.Dispute, now: Date): Promise<void> {
  const stage = stageOf(found.status);
  const outcome = outcomeOf(found.status);
  // Stripe writes 0 for "the bank takes no answer": that is not a date.
  const dueBy = found.evidence_details?.due_by ? new Date(found.evidence_details.due_by * 1000) : null;
  const seen = {
    amountCents: found.amount,
    currency: found.currency,
    reason: found.reason,
    compliance: isCompliance(found),
    stage,
    status: found.status,
    dueBy,
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
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
      })
      .onConflictDoNothing()
      .returning();
    if (made.length > 0) {
      // First sight. A dispute that had already ended when we first saw it is old news: recorded, and nobody is told.
      if (!outcome) await tellAll(tx, about, made[0], { began: true });
      return;
    }
    const [before] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, found.id)).for("update");
    if (!before) return;
    const [after] = await tx
      .update(schema.disputes)
      .set({ ...seen, outcome, endedAt: outcome ? (before.outcome === outcome ? before.endedAt : now) : null })
      .where(eq(schema.disputes.id, found.id))
      .returning();
    // A new stage on a row that was there: a bank's question that became a chargeback.
    if (!outcome && before.stage !== stage) await tellAll(tx, about, after, { began: true });
    if (outcome && before.outcome !== outcome) await tellAll(tx, about, after, { ended: outcome });
  });
}

/**
 * Writes down every dispute Stripe has on this owner's charge, as it stands now. Stripe is asked
 * once more after writing: only when it still shows the same is the work done.
 */
export async function recordDisputesOf(owner: Owner, now: Date = new Date()): Promise<void> {
  const about = await aboutOwner(db, owner);
  if (!about?.intentId) return;
  let written: string | null = null;
  for (let round = 0; round < 4; round++) {
    const found = await stripe().disputes.list({ payment_intent: about.intentId, limit: 100 }).autoPagingToArray({ limit: 300 });
    const seen = found
      .map((dispute) => `${dispute.id}:${dispute.status}`)
      .sort()
      .join(",");
    if (seen === written) return;
    for (const dispute of found) await writeOne(owner, about, dispute, now);
    written = seen;
  }
}

/**
 * Asks Stripe again about everything on this owner's charge: first what keeps the money where it
 * is (the code that has always done that, for each kind of money), then the record.
 */
export async function refreshOwner(owner: Owner, now: Date = new Date()): Promise<void> {
  if (owner.kind === "payment") await refreshPaymentDispute(owner.id, now);
  else if (owner.kind === "month") await refreshMonthDispute(owner.id, now);
  else await refreshDispute(owner.id, now);
  await recordDisputesOf(owner, now);
}

/** For test scripts only: touch nothing but these disputes, so a check never changes other rows of a shared database. */
export type Only = { disputeIds: string[] };

/**
 * The helper's hourly look: every dispute that has not ended is asked about again, whatever kind of
 * money it is about. So an ending is recorded also when Stripe's message about it never came.
 * (The looks that exist for a month and for a contribution go by "the month is open"; a month
 * already marked lost by one dispute is passed over there although a second dispute on it is still
 * open. Going by dispute closes that gap.)
 */
export async function lookAtOpenDisputes(now: Date, only?: Only): Promise<void> {
  const open = await db
    .select()
    .from(schema.disputes)
    .where(and(isNull(schema.disputes.outcome), lte(schema.disputes.updatedAt, new Date(now.getTime() - 3_600_000)), only ? inArray(schema.disputes.id, only.disputeIds) : undefined))
    .orderBy(asc(schema.disputes.updatedAt))
    .limit(25);
  for (const dispute of open) {
    await refreshOwner(ownerOf(dispute), now).catch(async (error) => {
      console.error(`[disputes] could not ask about dispute ${dispute.id}; will retry in an hour`, error);
      // It still takes its turn, so one that keeps failing cannot keep the others from being asked about.
      await db.update(schema.disputes).set({ updatedAt: now }).where(eq(schema.disputes.id, dispute.id)).catch(() => undefined);
    });
  }
}

/**
 * Catching up from Stripe's own list: every dispute opened in the last `days` days that the app
 * does not have, or has under another status than Stripe now shows, is read again. So a dispute
 * whose message was lost, or one that began before this record existed, does not stay unknown, and
 * a later change to one that had ended (an appeal) is seen. Stripe's list goes by the day a
 * dispute was opened.
 */
export async function catchUpFromStripe(now: Date, days: number, only?: Only): Promise<void> {
  const since = Math.floor((now.getTime() - days * 24 * 3_600_000) / 1000);
  const listed: Stripe.Dispute[] = [];
  for await (const dispute of stripe().disputes.list({ created: { gte: since }, limit: 100 })) {
    if (!only || only.disputeIds.includes(dispute.id)) listed.push(dispute);
  }
  if (listed.length === 0) return;
  const known = new Map<string, string>();
  for (let from = 0; from < listed.length; from += 500) {
    const ids = listed.slice(from, from + 500).map((dispute) => dispute.id);
    const rows = await db.select({ id: schema.disputes.id, status: schema.disputes.status }).from(schema.disputes).where(inArray(schema.disputes.id, ids));
    for (const row of rows) known.set(row.id, row.status);
  }
  // One read per charge, however many of its disputes are behind.
  const asked = new Set<string>();
  for (const dispute of listed) {
    if (known.get(dispute.id) === dispute.status) continue;
    const intentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!intentId || asked.has(intentId)) continue;
    asked.add(intentId);
    try {
      const owner = await ownerOfIntent(intentId);
      // Not one of ours (for example made by another copy of the app in the same Stripe test area): nothing to do.
      if (owner) await refreshOwner(owner, now);
    } catch (error) {
      console.error(`[disputes] could not catch up on dispute ${dispute.id}; the next look tries again`, error);
    }
  }
}

/** Disputes for the founder's list: those that have not ended, oldest deadline first, then the latest that ended. */
export async function disputesForFounder(endedShown = 20): Promise<{ open: Dispute[]; ended: Dispute[] }> {
  const open = await db.select().from(schema.disputes).where(isNull(schema.disputes.outcome)).orderBy(asc(schema.disputes.dueBy), asc(schema.disputes.openedAt));
  const ended = await db.select().from(schema.disputes).where(isNotNull(schema.disputes.outcome)).orderBy(desc(schema.disputes.endedAt)).limit(endedShown);
  return { open, ended };
}
