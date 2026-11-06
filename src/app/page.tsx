import { desc, eq, inArray, or } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SignOutButton } from "@/components/sign-out-button";
import { db, schema } from "@/db";
import { roomState } from "@/lib/calls";
import { formatMoney, isAdmin } from "@/lib/payments/access";
import { requireUser } from "@/lib/session";

const STATE_LABEL = { not_open_yet: "Not open yet", open: "Open now", closed: "Ended" } as const;

export default async function HomePage() {
  const user = await requireUser();

  const calls = await db
    .select()
    .from(schema.calls)
    .where(or(eq(schema.calls.hostId, user.id), eq(schema.calls.customerId, user.id)))
    .orderBy(desc(schema.calls.startsAt));

  // Only the names of the people this person has calls with.
  const otherIds = [...new Set(calls.map((c) => (c.hostId === user.id ? c.customerId : c.hostId)))];
  const people =
    otherIds.length > 0
      ? await db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, otherIds))
      : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const callIds = calls.map((c) => c.id);
  const payments = callIds.length > 0 ? await db.select().from(schema.payments).where(inArray(schema.payments.callId, callIds)) : [];
  const paymentOf = new Map(payments.map((p) => [p.callId, p]));
  const admin = await isAdmin(user.id);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Your calls</h1>
        <p className="text-sm">
          {user.name} · <SignOutButton />
        </p>
      </header>

      <p className="mt-6">
        <Link href="/host" className="underline underline-offset-2">
          Hosting
        </Link>
        <Link href="/account" className="ml-4 underline underline-offset-2">
          Your account
        </Link>
        {admin && (
          <>
            <Link href="/admin" className="ml-4 underline underline-offset-2">
              Admin
            </Link>
            <Link href="/calls/new" className="ml-4 underline underline-offset-2">
              Create a test call
            </Link>
          </>
        )}
      </p>

      {calls.length === 0 ? (
        <p className="mt-8 opacity-70">No calls yet.</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Starts</th>
                <th className="py-2 pr-4 font-medium">With</th>
                <th className="py-2 pr-4 font-medium">You are</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Payment</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const isHost = call.hostId === user.id;
                const state = roomState(call, now);
                const payment = paymentOf.get(call.id);
                const paymentText = !payment
                  ? "Free"
                  : payment.status === "awaiting_payment"
                    ? `${formatMoney(payment.bookedCents)}, not paid yet`
                    : payment.status === "held"
                      ? `${formatMoney(payment.bookedCents)} held${payment.needsReview ? ", needs review" : ""}`
                      : payment.status === "charged"
                        ? `Charged ${formatMoney((payment.chargedCents ?? 0) - payment.refundedCents)}`
                        : "Not charged";
                return (
                  <tr key={call.id} className="border-b border-neutral-300/40">
                    <td className="py-2 pr-4">
                      <LocalTime iso={call.startsAt.toISOString()} />
                    </td>
                    <td className="py-2 pr-4">{nameOf.get(isHost ? call.customerId : call.hostId) ?? "Unknown"}</td>
                    <td className="py-2 pr-4">{isHost ? "Host" : "Customer"}</td>
                    <td className="py-2 pr-4">{call.cancelledAt ? "Cancelled" : STATE_LABEL[state]}</td>
                    <td className="py-2 pr-4">{paymentText}</td>
                    <td className="py-2 whitespace-nowrap">
                      {state !== "closed" && !call.cancelledAt && (
                        <Link href={`/calls/${call.id}`} className="mr-4 underline underline-offset-2">
                          Open
                        </Link>
                      )}
                      <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                        Results
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
