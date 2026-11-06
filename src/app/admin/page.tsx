import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { formatMoney, isAdmin } from "@/lib/payments/access";
import { currentSplit } from "@/lib/payments/actions";
import { decisionDeadline } from "@/lib/payments/rules";
import { requireUser } from "@/lib/session";
import { refundAction } from "../calls/[id]/actions";
import { chargeReviewed, releaseReviewed } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: "Waiting for payment",
  held: "Held",
  charged: "Charged",
  closed_uncharged: "Closed, not charged",
};

export default async function AdminPage(props: PageProps<"/admin">) {
  const user = await requireUser();
  // Someone who is not an admin sees the same "not found" as for any missing page.
  if (!(await isAdmin(user.id))) notFound();
  const notice = readNotice("/admin", await props.searchParams);

  const rows = await db
    .select({ payment: schema.payments, call: schema.calls })
    .from(schema.payments)
    .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId))
    .orderBy(desc(schema.calls.startsAt))
    .limit(200);
  const people = await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  // Looked up on their own, never cut off by the "latest 200" limit above.
  const paymentsWithCalls = () =>
    db
      .select({ payment: schema.payments, call: schema.calls })
      .from(schema.payments)
      .innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId));
  const [waiting, flagged] = await Promise.all([
    paymentsWithCalls()
      .where(and(eq(schema.payments.status, "held"), eq(schema.payments.needsReview, true)))
      .orderBy(asc(schema.calls.endsAt)),
    paymentsWithCalls()
      .where(or(eq(schema.payments.flaggedAfterCharge, true), eq(schema.payments.disputeOpen, true)))
      .orderBy(desc(schema.calls.startsAt)),
  ]);
  const field = "mt-1 block w-32 rounded border border-neutral-400 bg-transparent px-2 py-1";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Admin: payments</h1>
      <p className="mt-2 text-sm">
        <Link href="/admin/people" className="underline underline-offset-2">
          Hosts and accounts
        </Link>
        {process.env.NODE_ENV !== "production" && (
          <Link href="/admin/outbox" className="ml-4 underline underline-offset-2">
            Sent emails (testing)
          </Link>
        )}
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <h2 className="mt-8 text-lg font-semibold">Waiting for your decision ({waiting.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        These calls have an incomplete record, so nothing was charged. Choose an amount or release the hold. If nothing is
        decided by the deadline, the hold is released and nothing is charged.
      </p>
      {waiting.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Nothing is waiting.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {waiting.map(({ payment, call }) => (
            <li key={payment.id} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="font-medium">
                {nameOf.get(call.hostId)} (host) and {nameOf.get(call.customerId)} (customer),{" "}
                <LocalTime iso={call.startsAt.toISOString()} />
              </p>
              <p className="mt-1">
                Held: {formatMoney(payment.bookedCents)}. Decide by{" "}
                <strong>
                  <LocalTime
                    iso={decisionDeadline({ callEndsAt: call.endsAt, holdExpiresAt: payment.holdExpiresAt ?? call.endsAt }).toISOString()}
                  />
                </strong>
                .
              </p>
              <p className="mt-1 opacity-80">{payment.reviewReason}</p>
              <p className="mt-1">
                <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                  See the call&apos;s record
                </Link>
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <form action={chargeReviewed} className="flex items-end gap-2">
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <label>
                    Charge (US dollars, up to {formatMoney(payment.bookedCents)})
                    <input name="amount" type="number" min={0.5} max={payment.bookedCents / 100} step="0.01" required className={field} />
                  </label>
                  <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white">
                    Charge
                  </button>
                </form>
                <form action={releaseReviewed}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5">
                    Release the hold, charge nothing
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {flagged.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold">Flagged ({flagged.length})</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {flagged.map(({ payment, call }) => (
              <li key={payment.id}>
                <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                  {nameOf.get(call.hostId)} and {nameOf.get(call.customerId)}
                </Link>
                : {payment.disputeOpen ? "the customer's bank is disputing the charge. " : ""}
                {payment.flaggedAfterCharge ? "the record changed after the charge." : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-10 text-lg font-semibold">All payments (latest 200)</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-400">
            <tr>
              <th className="py-2 pr-3 font-medium">Call</th>
              <th className="py-2 pr-3 font-medium">Host / customer</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium text-right">Booked</th>
              <th className="py-2 pr-3 font-medium text-right">Charged</th>
              <th className="py-2 pr-3 font-medium text-right">Refunded</th>
              <th className="py-2 pr-3 font-medium text-right">Our fee</th>
              <th className="py-2 pr-3 font-medium text-right">Host share</th>
              <th className="py-2 pr-3 font-medium">Host paid</th>
              <th className="py-2 font-medium">Full refund</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ payment, call }) => {
              const split = currentSplit(payment);
              const paid = (payment.chargedCents ?? 0) - payment.refundedCents;
              return (
                <tr key={payment.id} className="border-b border-neutral-300/40 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                      <LocalTime iso={call.startsAt.toISOString()} />
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">
                    {nameOf.get(call.hostId)} / {nameOf.get(call.customerId)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {STATUS_LABEL[payment.status] ?? payment.status}
                    {payment.needsReview ? " (needs review)" : ""}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(payment.bookedCents)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{payment.chargedCents === null ? "—" : formatMoney(payment.chargedCents)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{payment.refundedCents ? formatMoney(payment.refundedCents) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{payment.status === "charged" ? formatMoney(split.feeCents) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{payment.status === "charged" ? formatMoney(split.hostShareCents) : "—"}</td>
                  <td className="py-1.5 pr-3">
                    {payment.transferStatus === "sent"
                      ? formatMoney(payment.transferCents ?? 0)
                      : payment.transferStatus === "not_owed"
                        ? "nothing owed"
                        : payment.transferDueAt
                          ? `due ${payment.transferDueAt.toISOString().slice(0, 10)}`
                          : "—"}
                  </td>
                  <td className="py-1.5">
                    {payment.status === "charged" && paid > 0 && payment.transferStatus !== "sent" && !payment.disputeOpen && (
                      <form action={refundAction}>
                        <input type="hidden" name="callId" value={call.id} />
                        <input type="hidden" name="requestId" value={randomUUID()} />
                        <input type="hidden" name="amount" value={(paid / 100).toFixed(2)} />
                        <input type="hidden" name="reason" value="Full refund by the founder" />
                        <button type="submit" className="underline underline-offset-2">
                          Refund {formatMoney(paid)}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
