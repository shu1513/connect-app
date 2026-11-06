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
import { requireUser } from "@/lib/session";
import { refundAction } from "../actions";

const EVENT_LABEL: Record<string, string> = {
  participant_joined: "Connected",
  participant_left: "Disconnected",
  participant_connection_aborted: "Connection attempt failed",
  room_started: "Room started",
  room_finished: "Room finished",
};

const fromSeconds = (s: number) => new Date(s * 1000).toISOString();

export default async function ResultsPage(props: PageProps<"/calls/[id]/results">) {
  const user = await requireUser();
  const { id } = await props.params;
  const { notice } = await props.searchParams;
  const access = await callForViewer(id, user.id);
  if (!access) notFound();
  const { call, payment, role } = access;

  const [{ result, events, bookedSeconds }, people, refunds] = await Promise.all([
    loadAttendance(call),
    db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(inArray(schema.user.id, [call.hostId, call.customerId])),
    payment
      ? db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, payment.id)).orderBy(asc(schema.refunds.createdAt))
      : [],
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
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
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Call results</h1>
      <p className="mt-1 text-sm opacity-70">
        {who(call.hostId)} and {who(call.customerId)}. Booked <LocalTime iso={call.startsAt.toISOString()} seconds /> to{" "}
        <LocalTime iso={call.endsAt.toISOString()} seconds /> ({formatDuration(bookedSeconds)}).
      </p>

      {typeof notice === "string" && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {call.cancelledAt && (
        <p className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          This call was cancelled by the {call.cancelledBy} on <LocalTime iso={call.cancelledAt.toISOString()} />
          {call.cancelledLate ? ", after the free cancelling period." : "."}
        </p>
      )}

      {payment ? (
        <Receipt payment={payment} role={role} callId={call.id} refunds={refunds} />
      ) : (
        <p className="mt-4 text-sm opacity-70">This was a free call. Nothing is charged.</p>
      )}

      <section className="mt-6 rounded border border-neutral-400 p-4">
        <p className={`text-lg font-semibold ${status.tone}`}>{status.label}</p>
        <p className="text-sm opacity-80">{status.note}</p>
        {result.reasons.length > 0 && (
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
          {call.closedAt ? " Room confirmed closed." : " Room not confirmed closed yet."}
        </p>
      </section>

      <h2 className="mt-8 text-lg font-semibold">Finished connected periods inside the booked window</h2>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        <Periods title="Host" intervals={result.hostIntervals} />
        <Periods title="Customer" intervals={result.customerIntervals} />
        <Periods title="Together" intervals={result.togetherIntervals} />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Messages received from the video service</h2>
      {events.length === 0 ? (
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
    </main>
  );
}

/** What was paid and why. The customer sees the charge; the host also sees the split and their payout. */
function Receipt(props: {
  payment: Payment;
  role: "host" | "customer" | "admin";
  callId: string;
  refunds: Array<{ id: string; amountCents: number; status: string; decidedAs: string; createdAt: Date }>;
}) {
  const { payment, role, refunds } = props;
  const split = currentSplit(payment);
  const paid = (payment.chargedCents ?? 0) - payment.refundedCents;
  const frozenHost = payment.frozenHostSeconds;
  const frozenTogether = payment.frozenTogetherSeconds;
  const canRefund = role === "host" && payment.status === "charged" && payment.transferStatus !== "sent" && paid > 0 && !payment.disputeOpen;

  const headline =
    payment.status === "awaiting_payment"
      ? "Waiting for the customer to confirm and pay."
      : payment.status === "held"
        ? payment.needsReview
          ? `${formatMoney(payment.bookedCents)} is held. This call's record needs review, so nothing is charged until the review is decided.`
          : `${formatMoney(payment.bookedCents)} is held on the customer's card. The charge is worked out after the call.`
        : payment.status === "closed_uncharged"
          ? "Nothing was charged for this call."
          : `Charged ${formatMoney(payment.chargedCents ?? 0)} of the ${formatMoney(payment.bookedCents)} booked.`;

  return (
    <section className="mt-6 rounded border border-neutral-400 p-4">
      <h2 className="text-lg font-semibold">Payment</h2>
      <p className="mt-1">{headline}</p>
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
                  : "The time the host was in the call"
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
                label={`Our fee${payment.cardCountry && payment.cardCountry !== "US" ? " (includes 1.5% for a card from outside the US)" : ""}`}
                value={formatMoney(split.feeCents)}
              />
              <Row label={role === "host" ? "Your share" : "Host's share"} value={formatMoney(split.hostShareCents)} />
              <Row
                label="Payout"
                value={
                  payment.transferStatus === "sent"
                    ? `Sent ${formatMoney(payment.transferCents ?? 0)}${payment.payoutFeeCents ? ` after a ${formatMoney(payment.payoutFeeCents)} payout charge` : ""}`
                    : payment.transferStatus === "not_owed"
                      ? "Nothing to pay out"
                      : payment.transferDueAt
                        ? `On the weekly payday of ${payment.transferDueAt.toISOString().slice(0, 10)}`
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
              Refund of {formatMoney(r.amountCents)} by the {r.decidedAs}:{" "}
              {r.status === "done" ? "sent" : r.status === "failed" ? "did not go through" : "in progress"}
            </li>
          ))}
        </ul>
      )}

      {canRefund && (
        <form action={refundAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-neutral-400/40 pt-4 text-sm">
          <input type="hidden" name="callId" value={props.callId} />
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
            Reason (optional)
            <input name="reason" type="text" maxLength={200} className="mt-1 block w-64 rounded border border-neutral-400 bg-transparent px-3 py-1.5" />
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

function Row({ label, value }: { label: string; value: string }) {
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
