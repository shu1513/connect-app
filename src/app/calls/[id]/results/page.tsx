import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import type { Interval } from "@/lib/attendance/calc";
import { loadAttendance } from "@/lib/attendance/load";
import { formatDuration } from "@/lib/format";
import { callForViewer, formatMoney } from "@/lib/payments/access";
import { currentSplit } from "@/lib/payments/actions";
import { paymentsOfCall } from "@/lib/payments/own";
import { attendanceChargeCents, countedSeconds, MIN_CHARGE_CENTS } from "@/lib/payments/pricing";
import { isDecided, moneyPlan } from "@/lib/payments/take";
import { requestViewOf } from "@/lib/refunds/requests";
import { BlockButton } from "@/components/block-button";
import { readNotice } from "@/lib/notice";
import { getSignedIn, isAdminSession } from "@/lib/session";
import { requireUser } from "@/lib/session";
import { myRating, ratingStateOf } from "@/lib/ratings/ratings";
import { RATING } from "@/lib/ratings/rules";
import { publicProfile } from "@/lib/profiles/profiles";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { rateCallAction, refundAction } from "../actions";
import { SitePage } from "@/components/site-page";
import { RefundRequest } from "./refund-request";

export const metadata: Metadata = { title: "Call results" };

const EVENT_LABEL: Record<string, string> = {
  participant_joined: "Connected",
  participant_left: "Disconnected",
  participant_connection_aborted: "Connection attempt failed",
  room_started: "Room started",
  room_finished: "Room finished",
};

const fromSeconds = (s: number) => new Date(s * 1000).toISOString();

export default async function ResultsPage(props: PageProps<"/calls/[id]/results">) {
  const { id } = await props.params;
  const user = await requireUser(`/calls/${id}/results`);
  const query = await props.searchParams;
  const notice = readNotice(`/calls/${id}/results`, query);
  // The founder's login. Kept apart from the role below: a founder who was in the call is "host" or
  // "customer" there (for the rating and the receipt), and still sees the raw record.
  const founder = await isAdminSession(await getSignedIn());
  const access = await callForViewer(id, user.id, founder);
  if (!access) notFound();
  const { call, payment, role } = access;

  // Every payment of the call: its own, then one for each request for more time. Each is its own line.
  const payments = payment ? await paymentsOfCall(call.id) : [];
  const [{ result, events, bookedSeconds }, people, refunds, extensions] = await Promise.all([
    loadAttendance(call),
    db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(inArray(schema.user.id, [call.hostId, call.customerId])),
    payments.length > 0
      ? db.select().from(schema.refunds).where(inArray(schema.refunds.paymentId, payments.map((p) => p.id))).orderBy(asc(schema.refunds.createdAt))
      : [],
    db.select().from(schema.callExtensions).where(eq(schema.callExtensions.callId, call.id)).orderBy(asc(schema.callExtensions.createdAt)),
  ]);
  // Where the money stands: the charges still on hold, what the record gives for each right now, and when they are taken.
  const now = new Date();
  const plan = payments.length > 0 ? await moneyPlan(call) : null;
  const request = payments.length > 0 ? await requestViewOf(call) : null;
  const toBeCharged = new Map<string, number | null>();
  for (const held of plan?.held ?? []) {
    const own = await loadAttendance(call, now, { from: held.coversFrom, until: held.coversUntil });
    const final = own.final && call.closedAt && own.result.status === "complete" && own.result.totals;
    const record = final ? attendanceChargeCents({ pricePer15Cents: held.pricePer15Cents, bookedSeconds: own.bookedSeconds, countedSeconds: countedSeconds(call, own.result.totals!) }) : null;
    // With an answer already saved for this charge, what will be taken is what the answer allows, not what the record gives.
    const answer = request?.request.status === "answered" ? request.answers.find((a) => a.paymentId === held.id) : undefined;
    const cents = record === null || !answer || answer.choice === "full" ? record : answer.choice === "less" ? Math.min(answer.maxCents ?? 0, record) : 0;
    toBeCharged.set(held.id, cents !== null && cents < MIN_CHARGE_CENTS ? 0 : cents);
  }
  const extensionOf = new Map(extensions.map((e) => [e.id, e]));
  const addedMinutes = extensions.filter((e) => e.status === "accepted").reduce((sum, e) => sum + e.minutes, 0);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  // A customer knows their host by the display name on the host's page, never by the host's account name:
  // everywhere on this page. (A host sees a customer, and an admin sees both, by their own names.)
  const [hostProfile] =
    role === "customer"
      ? await db
          .select({ displayName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle })
          .from(schema.hostProfiles)
          .where(eq(schema.hostProfiles.userId, call.hostId))
      : [];
  if (hostProfile) nameOf.set(call.hostId, hostProfile.displayName);
  // For a customer, the way back to the host's page: only while that page can really be opened
  // (approved, not hidden, account open), and never across a block in either direction.
  const bookAgain = hostProfile && (await publicProfile(hostProfile.handle)) && !(await isBlockedEitherWay(user.id, call.hostId)) ? `/h/${hostProfile.handle}` : null;
  // Rating: for the two people on the call only. Each sees their own rating, never the other's.
  const otherName = role === "admin" ? "" : (nameOf.get(role === "host" ? call.customerId : call.hostId) ?? "the other person");
  const rating = role === "admin" ? null : { state: await ratingStateOf(call, new Date()), mine: await myRating(call.id, user.id) };
  const who = (identity: string | null) =>
    identity === call.hostId
      ? `${nameOf.get(identity) ?? "Host"} (host)`
      : identity === call.customerId
        ? `${nameOf.get(identity) ?? "Customer"} (customer)`
        : identity
          ? `Unknown (${identity})`
          : "—";

  const status = {
    complete: { label: "Complete", note: "The call is over and the record is consistent.", tone: "text-green-700" },
    in_progress: {
      label: "Not final yet",
      note: result.stillConnected
        ? "Someone is still connected. Totals appear once they disconnect. Refresh this page to update."
        : "The call is still running or has only just ended. Refresh this page to update.",
      tone: "text-amber-700",
    },
    needs_review: {
      label: "Needs review",
      note: "The record is incomplete or contradicts itself, so no totals are shown.",
      tone: "text-red-700",
    },
  }[result.status];

  return (
    <SitePage className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Call results</h1>
      <p className="mt-1 text-sm opacity-70">
        {who(call.hostId)} and {who(call.customerId)}. Booked <LocalTime iso={call.startsAt.toISOString()} seconds /> to{" "}
        <LocalTime iso={call.endsAt.toISOString()} seconds /> ({formatDuration(bookedSeconds)}).
        {addedMinutes > 0 ? ` That includes ${addedMinutes} minutes added during the call.` : ""}
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {rating && (rating.mine !== null || rating.state === "open" || rating.state === "not_yet") && (
        <section className="mt-4 rounded border border-blue-600 p-4 text-sm">
          {rating.mine !== null ? (
            <p>
              You gave {otherName} {rating.mine} {rating.mine === 1 ? "star" : "stars"}. They never see what you gave. Ratings start to count a week after the call, and each person counts once in an average.
            </p>
          ) : rating.state === "open" ? (
            <form action={rateCallAction}>
              <input type="hidden" name="callId" value={call.id} />
              <fieldset>
                <legend className="text-base font-semibold">How was your call with {otherName}?</legend>
                <p className="mt-1 opacity-70">
                  {otherName} never sees what you gave, and you never see what they gave. A rating cannot be changed afterwards. You have {RATING.windowDays}{" "}
                  days from the call.
                </p>
                <div className="mt-3 flex flex-wrap gap-4">
                  {[1, 2, 3, 4, 5].map((stars) => (
                    <label key={stars} className="flex items-center gap-1">
                      <input type="radio" name="stars" value={stars} required /> {stars} {stars === 1 ? "star" : "stars"}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="mt-3 rounded bg-blue-600 px-4 py-2 font-medium text-white">
                Send rating
              </button>
            </form>
          ) : (
            <p className="opacity-80">You can rate this call a few minutes after its booked end, once its record is final. Refresh this page then.</p>
          )}
        </section>
      )}

      {call.safetyEndedAt && (
        <p className="mt-4 rounded border border-red-600 p-3 text-sm">
          This call was ended with &quot;End call and report&quot; on <LocalTime iso={call.safetyEndedAt.toISOString()} />. Time after that is not
          counted, and the charge is decided by a person.
        </p>
      )}

      {bookAgain && !call.safetyEndedAt && (
        <p className="mt-4 text-sm">
          <Link href={bookAgain} className="underline underline-offset-2">
            Book another call with {nameOf.get(call.hostId)}
          </Link>
        </p>
      )}

      {role !== "admin" && (
        <div className="mt-3 text-sm opacity-70">
          <Link href={`/report?call=${call.id}`} className="underline underline-offset-2">
            Report {nameOf.get(role === "host" ? call.customerId : call.hostId) ?? "the other person"}
          </Link>
          <span className="mx-2">·</span>
          <BlockButton userId={role === "host" ? call.customerId : call.hostId} name={nameOf.get(role === "host" ? call.customerId : call.hostId) ?? "this person"} back={`/calls/${call.id}/results`} />
        </div>
      )}

      {call.cancelledAt && (
        <p className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          This call was cancelled by {call.cancelledBy === "admin" ? "Connect" : `the ${call.cancelledBy}`} on <LocalTime iso={call.cancelledAt.toISOString()} />
          {call.cancelledLate ? ", after the free cancelling period." : "."}
        </p>
      )}

      {payments.length > 0 && (
        <RefundRequest
          call={call}
          role={role}
          founder={founder}
          view={request}
          names={{ host: nameOf.get(call.hostId) ?? "the host", customer: nameOf.get(call.customerId) ?? "the customer" }}
          asking={typeof query.ask === "string" ? query.ask : null}
          charges={(request?.open ?? []).map((p) => ({
            paymentId: p.id,
            label: p.extensionId ? `The ${extensionOf.get(p.extensionId)?.minutes ?? ""} minutes added during the call` : "The call itself",
            recordCents: toBeCharged.get(p.id) ?? null,
            bookedCents: p.bookedCents,
          }))}
        />
      )}

      {payments.length > 0 ? (
        payments.map((p) => (
          <Receipt
            key={p.id}
            payment={p}
            role={role}
            callId={call.id}
            refunds={refunds.filter((r) => r.paymentId === p.id)}
            billing={call.billing}
            addedMinutes={p.extensionId ? (extensionOf.get(p.extensionId)?.minutes ?? 0) : null}
            waiting={
              toBeCharged.has(p.id)
                ? { cents: toBeCharged.get(p.id) ?? null, takeAt: plan?.timing?.takeAt ?? null, decided: isDecided(plan?.request), askedFor: Boolean(plan?.request) }
                : null
            }
          />
        ))
      ) : (
        <p className="mt-4 text-sm opacity-70">This was a free call. Nothing is charged.</p>
      )}

      <section className="mt-6 rounded border border-neutral-400 p-4">
        <p className={`text-lg font-semibold ${status.tone}`}>{status.label}</p>
        <p className="text-sm opacity-80">{status.note}</p>
        {result.reasons.length > 0 && !founder && <p className="mt-2 text-sm">A person at Connect looks at records like this one by hand.</p>}
        {result.reasons.length > 0 && founder && (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
          <Total label="Host time" seconds={result.totals?.hostSeconds} />
          <Total label="Customer time" seconds={result.totals?.customerSeconds} />
          <Total label="Time together" seconds={result.totals?.togetherSeconds} />
        </dl>
        <p className="mt-3 text-xs opacity-70">
          Connected time as reported by the video service, counted only inside the booked window.
          {call.billing === "together" ? " This call charges the time together." : " This call charges the host's time."}
          {founder ? (call.closedAt ? " Room confirmed closed." : " Room not confirmed closed yet.") : ""}
        </p>
      </section>

      <h2 className="mt-8 text-lg font-semibold">When each of you was connected, inside the booked time</h2>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        <Periods title="Host" intervals={result.hostIntervals} />
        <Periods title="Customer" intervals={result.customerIntervals} />
        <Periods title="Together" intervals={result.togetherIntervals} />
      </div>

      {/* The raw record, with connection codes: for the founder only. The two people see the totals and the periods above. */}
      {founder && <h2 className="mt-8 text-lg font-semibold">Messages received from the video service</h2>}
      {!founder ? null : events.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">None yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">What</th>
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 font-medium">Connection</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-neutral-300/40">
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    <LocalTime iso={e.providerTime.toISOString()} seconds />
                  </td>
                  <td className="py-1.5 pr-4">{EVENT_LABEL[e.type] ?? e.type}</td>
                  <td className="py-1.5 pr-4">{who(e.participantIdentity)}</td>
                  <td className="py-1.5 font-mono text-xs">{e.participantSessionId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SitePage>
  );
}

/**
 * What was paid and why, for one payment: the call's own, or the one for more time added during
 * the call. The customer sees the charge; the host also sees the split and their payout.
 */
function Receipt(props: {
  payment: Payment;
  role: "host" | "customer" | "admin";
  callId: string;
  refunds: Array<{ id: string; amountCents: number; status: string; decidedAs: string; reason: string | null; createdAt: Date }>;
  billing: string;
  /** Null for the call's own payment. Otherwise the minutes this payment was asked for. */
  addedMinutes: number | null;
  /**
   * For an ordinary charge that is still on hold after the call: what the record gives now (null until the
   * record is final), when the money is taken, and whether a refund request was made and decided.
   */
  waiting: { cents: number | null; takeAt: Date | null; decided: boolean; askedFor: boolean } | null;
}) {
  const { payment, role, refunds } = props;
  const split = currentSplit(payment);
  const paid = (payment.chargedCents ?? 0) - payment.refundedCents;
  const frozenHost = payment.frozenHostSeconds;
  const frozenTogether = payment.frozenTogetherSeconds;
  const canRefund = role === "host" && payment.status === "charged" && payment.transferStatus !== "sent" && paid > 0 && !payment.disputeOpen;

  const extra = props.addedMinutes !== null;
  const headline =
    payment.status === "awaiting_payment"
      ? extra
        ? "The customer's card is being checked."
        : "Waiting for the customer to confirm and pay."
      : payment.status === "held"
        ? payment.needsReview
          ? `${formatMoney(payment.bookedCents)} is held. This call's record needs review, so nothing is charged until the review is decided.`
          : `${formatMoney(payment.bookedCents)} is held on the customer's card. The charge is worked out after the call.`
        : payment.status === "closed_uncharged"
          ? `Nothing was charged for ${extra ? "this extra time" : "this call"}.`
          : payment.loweredBy && payment.recordCents !== null
            ? // Never mistaken for what the call's record gave: it says who lowered it.
              `Charged ${formatMoney(payment.chargedCents ?? 0)} of ${formatMoney(payment.recordCents)}, lowered by ${payment.loweredBy === "admin" ? "Connect" : "the host"}.`
            : `Charged ${formatMoney(payment.chargedCents ?? 0)} of the ${formatMoney(payment.bookedCents)} ${extra ? "held" : "booked"}.`;
  const waiting = payment.status === "held" && !payment.needsReview ? props.waiting : null;

  return (
    <section className="mt-6 rounded border border-neutral-400 p-4">
      <h2 className="text-lg font-semibold">{extra ? `Payment for ${props.addedMinutes} more minutes` : "Payment"}</h2>
      <p className="mt-1">{headline}</p>
      {waiting && waiting.cents !== null && (
        <p className="mt-1" data-to-be-charged>
          To be charged: <span className="font-medium">{waiting.cents === 0 ? "nothing" : formatMoney(waiting.cents)}</span>
          {waiting.decided ? (
            ". The answer to the refund request is being applied."
          ) : waiting.takeAt ? (
            <>
              {waiting.askedFor ? ", at the latest on " : ", on "}
              <LocalTime iso={waiting.takeAt.toISOString()} />
              {waiting.askedFor ? ", or sooner when the host answers the refund request (the amount can then be lower)." : ". Nothing is taken from the card before then."}
            </>
          ) : (
            "."
          )}
        </p>
      )}
      {waiting && waiting.cents === null && <p className="mt-1 text-sm opacity-70">The amount is shown here a few minutes after the call, once its record is final.</p>}
      {payment.status === "closed_uncharged" && payment.reviewReason && <p className="mt-1 text-sm opacity-70">{payment.reviewReason}</p>}

      {payment.status === "charged" && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="Price" value={`${formatMoney(payment.pricePer15Cents)} per 15 minutes`} />
          <Row
            label="Why this amount"
            value={
              payment.chargeReason === "late_cancel"
                ? "Cancelled after the free period: the booked price"
                : payment.chargeReason === "admin"
                  ? "Decided after a review"
                  : `${props.billing === "together" ? "The time both people were in the call" : "The time the host was in the call"}${extra ? ", during these extra minutes" : ""}`
            }
          />
          {frozenHost !== null && frozenTogether !== null && (
            <>
              <Row label="Time together" value={formatDuration(frozenTogether)} />
              <Row label="Time the host waited" value={formatDuration(Math.max(0, frozenHost - frozenTogether))} />
            </>
          )}
          {payment.refundedCents > 0 && <Row label="Refunded" value={formatMoney(payment.refundedCents)} />}
          <Row label="Paid by the customer" value={formatMoney(paid)} />
          {role !== "customer" && (
            <>
              <Row
                label={`Our fee${payment.cardCountry && payment.cardCountry !== "US" ? ` (includes ${payment.feeForeignCardBps / 100}% for a card from outside the US)` : ""}`}
                value={formatMoney(split.feeCents)}
              />
              <Row label={role === "host" ? "Your share" : "Host's share"} value={formatMoney(split.hostShareCents)} />
              <Row
                label="Payout"
                value={
                  payment.transferStatus === "sent"
                    ? `Sent ${formatMoney(payment.transferCents ?? 0)}${payment.payoutFeeCents ? ` after a ${formatMoney(payment.payoutFeeCents)} collection charge` : ""}`
                    : payment.transferStatus === "not_owed"
                      ? "Nothing to pay out"
                      : payment.transferDueAt
                        ? (
                            <>
                              Not collected yet. Ready to collect from <LocalTime iso={payment.transferDueAt.toISOString()} />
                            </>
                          )
                        : "Not scheduled yet"
                }
              />
            </>
          )}
        </dl>
      )}

      {payment.flaggedAfterCharge && (
        <p className="mt-3 text-sm text-amber-700">The call&apos;s record changed after it was charged. The charge was not changed; it has been flagged for a check.</p>
      )}
      {payment.disputeOpen && <p className="mt-3 text-sm text-amber-700">The customer&apos;s bank is disputing this charge.</p>}

      {refunds.length > 0 && (
        <ul className="mt-3 text-sm">
          {refunds.map((r) => (
            <li key={r.id}>
              Refund of {formatMoney(r.amountCents)} by {r.decidedAs === "admin" ? "Connect" : "the host"}:{" "}
              {r.status === "done" ? "sent" : r.status === "failed" ? "did not go through" : "in progress"}
              {r.reason ? `. Message: "${r.reason}"` : ""}
            </li>
          ))}
        </ul>
      )}

      {canRefund && (
        <form action={refundAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-neutral-400/40 pt-4 text-sm">
          <input type="hidden" name="callId" value={props.callId} />
          <input type="hidden" name="paymentId" value={payment.id} />
          <input type="hidden" name="requestId" value={randomUUID()} />
          <label>
            Refund to the customer (US dollars, up to {formatMoney(paid)})
            <input
              name="amount"
              type="number"
              min={0.01}
              max={paid / 100}
              step="0.01"
              required
              className="mt-1 block w-40 rounded border border-neutral-400 bg-transparent px-3 py-1.5"
            />
          </label>
          <label>
            Message to the customer (optional)
            <input name="reason" type="text" maxLength={300} className="mt-1 block w-64 rounded border border-neutral-400 bg-transparent px-3 py-1.5" />
          </label>
          <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5">
            Refund
          </button>
          <p className="basis-full opacity-70">
            You can refund until your share is sent to you. Our fee is returned in the same proportion, so a full refund
            gives the customer everything back.
          </p>
        </form>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-neutral-300/30 py-1">
      <dt className="opacity-70">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function Total({ label, seconds }: { label: string; seconds: number | undefined }) {
  return (
    <div>
      <dt className="text-sm opacity-70">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{seconds === undefined ? "Not known yet" : formatDuration(seconds)}</dd>
    </div>
  );
}

function Periods({ title, intervals }: { title: string; intervals: Interval[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {intervals.length === 0 ? (
        <p className="text-sm opacity-70">None</p>
      ) : (
        <ul className="text-sm tabular-nums">
          {intervals.map((i) => (
            <li key={i.start}>
              <LocalTime iso={fromSeconds(i.start)} seconds /> → <LocalTime iso={fromSeconds(i.end)} seconds /> (
              {formatDuration(i.end - i.start)})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
