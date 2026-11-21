/**
 * What the app has on record about a disputed payment, read at the moment of sending
 * (plans/47-bank-disputes.md, decision 8). The words made from these facts, and the rule for every
 * sentence, are in proof.ts.
 */
import { and, asc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { DOCUMENTS, isDocumentName } from "@/legal/versions";
import { isAnswered } from "@/lib/refunds/requests";
import type { Owner } from "./record";
import type { ProofFacts, Visit } from "./proof";
import type { Stage } from "./status";

type Reader = Pick<typeof db, "select">;

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** Who joined and left a call when, from the video service's own messages, in order. */
async function visitsOf(reader: Reader, call: { id: string; hostId: string; customerId: string }): Promise<Visit[]> {
  const events = await reader
    .select({ type: schema.attendanceEvents.type, identity: schema.attendanceEvents.participantIdentity, session: schema.attendanceEvents.participantSessionId, time: schema.attendanceEvents.providerTime })
    .from(schema.attendanceEvents)
    .where(and(eq(schema.attendanceEvents.callId, call.id), inArray(schema.attendanceEvents.type, ["participant_joined", "participant_left"])))
    .orderBy(asc(schema.attendanceEvents.providerTime), asc(schema.attendanceEvents.id));
  const visits: Array<Visit & { session: string | null }> = [];
  for (const event of events) {
    const role = event.identity === call.hostId ? "host" : event.identity === call.customerId ? "customer" : null;
    if (!role) continue;
    if (event.type === "participant_joined") visits.push({ who: role, joined: event.time, left: null, session: event.session });
    else {
      const open = visits.find((visit) => visit.who === role && visit.joined !== null && visit.left === null && visit.session === event.session);
      if (open) open.left = event.time;
      // A leaving with no joining before it is on record too, and is said as that: it shows the person was there.
      else visits.push({ who: role, joined: null, left: event.time, session: event.session });
    }
  }
  return visits.map(({ who: role, joined, left }) => ({ who: role, joined, left }));
}

/** Published agreements this person accepted before a moment. A draft proves only that a draft was accepted, so it is left out. */
async function acceptedBefore(reader: Reader, userId: string, before: Date | null): Promise<ProofFacts["accepted"]> {
  if (!before) return [];
  const rows = await reader
    .select()
    .from(schema.agreementAcceptances)
    .where(and(eq(schema.agreementAcceptances.userId, userId), lt(schema.agreementAcceptances.acceptedAt, before)))
    .orderBy(asc(schema.agreementAcceptances.acceptedAt));
  return rows.flatMap((row) => {
    if (!isDocumentName(row.document)) return [];
    const version = DOCUMENTS[row.document].versions.find((one) => one.version === row.version);
    return version && !version.draft ? [{ title: DOCUMENTS[row.document].title, version: row.version, at: row.acceptedAt }] : [];
  });
}

/** Other payments of this customer, taken before this one, for which the app has no dispute on record: calls paid by card only (the plainest count). */
async function earlierPaymentsOf(reader: Reader, customerId: string, before: Date | null, notPaymentId: string | null): Promise<number> {
  if (!before) return 0;
  const taken = await reader
    .select({ id: schema.payments.id, disputeOpen: schema.payments.disputeOpen })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .where(and(eq(schema.calls.customerId, customerId), eq(schema.payments.kind, "card"), eq(schema.payments.status, "charged"), isNotNull(schema.payments.chargedAt), lt(schema.payments.chargedAt, before), notPaymentId ? ne(schema.payments.id, notPaymentId) : undefined));
  if (taken.length === 0) return 0;
  const disputed = await reader.select({ paymentId: schema.disputes.paymentId }).from(schema.disputes).where(inArray(schema.disputes.paymentId, taken.map((row) => row.id)));
  const ever = new Set(disputed.map((row) => row.paymentId));
  return taken.filter((row) => !row.disputeOpen && !ever.has(row.id)).length;
}

/** Everything the app has on record about a disputed payment, read now. Null when the record is not there. */
export async function gatherFacts(reader: Reader, dispute: { stage: string; reason: string; amountCents: number; hostId: string; customerId: string }, owner: Owner): Promise<ProofFacts | null> {
  const [customer] = await reader.select({ name: schema.user.name, email: schema.user.email, since: schema.user.createdAt }).from(schema.user).where(eq(schema.user.id, dispute.customerId));
  const [host] = await reader.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, dispute.hostId));
  const [profile] = await reader.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, dispute.hostId));
  if (!customer || !host) return null;
  const common = { stage: dispute.stage as Stage, bankReason: dispute.reason, customer, hostName: profile?.displayName ?? host.name, disputedCents: dispute.amountCents };

  if (owner.kind === "payment") {
    const [row] = await reader.select({ payment: schema.payments, call: schema.calls }).from(schema.payments).innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId)).where(eq(schema.payments.id, owner.id));
    if (!row) return null;
    const { payment, call } = row;
    // Stripe has taken the money and the amount is not on record here yet: nothing is written until it is.
    if (payment.chargedCents === null) return null;
    const [request] = await reader.select().from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id));
    const hasTotals = payment.frozenHostSeconds !== null && payment.frozenCustomerSeconds !== null && payment.frozenTogetherSeconds !== null;
    return {
      ...common,
      chargedCents: payment.chargedCents,
      refundedCents: payment.refundedCents,
      chargedAt: payment.chargedAt,
      earlierPayments: await earlierPaymentsOf(reader, dispute.customerId, payment.chargedAt, payment.id),
      accepted: await acceptedBefore(reader, dispute.customerId, payment.chargedAt),
      about: {
        kind: "call",
        // The stretch THIS payment is for. A call made longer has a payment of its own for the added time, and the
        // call's end moves; the first payment still covers the time first booked.
        startsAt: payment.coversFrom,
        endsAt: payment.coversUntil,
        pricePer15Cents: payment.pricePer15Cents,
        bookedCents: payment.bookedCents,
        addedTime: payment.extensionId !== null,
        billing: call.billing,
        chargeReason: payment.chargeReason,
        charged: hasTotals ? { hostSeconds: payment.frozenHostSeconds!, customerSeconds: payment.frozenCustomerSeconds!, togetherSeconds: payment.frozenTogetherSeconds! } : null,
        // The same mark is also set on a charge the app cannot explain; that one has no totals, and nothing is said of a changed record.
        recordChanged: payment.flaggedAfterCharge && hasTotals,
        visits: await visitsOf(reader, call),
        freeCancelMinutes: call.freeCancelMinutes,
        cancelledAt: call.cancelledAt,
        cancelledBy: call.cancelledBy,
        loweredBy: payment.loweredBy,
        refundRequest: request ? { askedAt: request.askedAt, reason: request.reason, status: request.status, decidedAt: request.decidedAt, decidedAs: request.decidedAs, answeredByRefund: request.status === "asked" && (await isAnswered(request, reader)) } : null,
      },
    };
  }

  if (owner.kind === "month") {
    const [row] = await reader
      .select({ month: schema.membershipMonths, membership: schema.memberships, agreedAt: schema.membershipAgreements.at })
      .from(schema.membershipMonths)
      .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
      .leftJoin(schema.membershipAgreements, eq(schema.membershipAgreements.id, schema.membershipMonths.agreementId))
      .where(eq(schema.membershipMonths.id, owner.id));
    if (!row) return null;
    const { month } = row;
    // What Stripe really took is not on record here yet: the scheduled amount is never given as money taken.
    if (month.takenCents === null) return null;
    return {
      ...common,
      chargedCents: month.takenCents,
      refundedCents: month.paidBackCents,
      chargedAt: month.takenAt,
      earlierPayments: await earlierPaymentsOf(reader, dispute.customerId, month.takenAt, null),
      accepted: await acceptedBefore(reader, dispute.customerId, month.takenAt),
      about: {
        kind: "month",
        number: month.number,
        includedMinutes: month.includedMinutes,
        pricePer15Cents: month.pricePer15Cents,
        startsAt: month.startsAt,
        endsAt: month.endsAt,
        usedCents: month.usedCents,
        agreedAt: row.agreedAt,
      },
    };
  }

  const [row] = await reader
    .select({ payment: schema.contributionPayments, contribution: schema.contributions, project: schema.projects.name, callStartsAt: schema.calls.startsAt })
    .from(schema.contributionPayments)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.contributions.projectId))
    .leftJoin(schema.calls, eq(schema.calls.id, schema.contributions.callId))
    .where(eq(schema.contributionPayments.id, owner.id));
  if (!row || row.payment.takenCents === null) return null;
  const [agreement] = await reader.select({ agreedAt: schema.contributionAgreements.agreedAt }).from(schema.contributionAgreements).where(eq(schema.contributionAgreements.contributionId, row.contribution.id)).orderBy(asc(schema.contributionAgreements.agreedAt)).limit(1);
  return {
    ...common,
    chargedCents: row.payment.takenCents,
    refundedCents: row.payment.refundedCents,
    chargedAt: row.payment.takenAt,
    earlierPayments: await earlierPaymentsOf(reader, dispute.customerId, row.payment.takenAt, null),
    accepted: await acceptedBefore(reader, dispute.customerId, row.payment.takenAt),
    about: {
      kind: "contribution",
      tip: row.contribution.kind === "tip",
      monthly: row.contribution.kind === "monthly",
      number: row.payment.number,
      projectName: row.project,
      callStartsAt: row.callStartsAt,
      agreedAt: agreement?.agreedAt ?? null,
    },
  };
}
