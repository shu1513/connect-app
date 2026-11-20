import { inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { db, schema } from "@/db";
import { paymentLine, paymentsByCall } from "@/lib/home/payment-line";
import { pastCallRows } from "@/lib/home/list-calls";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Past calls" };

// What a call's money line says changes as charges and refunds happen: always built fresh.
export const dynamic = "force-dynamic";

/**
 * "Past calls" (plans/36, decision 7): this person's calls that are over, the newest first. It
 * holds exactly the calls the home page does not: cancelled, ended with a report, or with their
 * booked end passed. Never a call the person is not part of.
 */
export default async function PastCallsPage(props: PageProps<"/calls">) {
  const user = await requireUser("/calls");
  const query = await props.searchParams;
  const page = typeof query.page === "string" && /^[1-9]\d{0,3}$/.test(query.page) ? Number(query.page) : 1;
  const now = new Date();

  // Which calls, and whether there are older ones: asked in one place, for this page and the phone app (list-calls.ts).
  const { calls, older } = await pastCallRows(user.id, page, now);

  // Only the names of the people this person has had calls with.
  const otherIds = [...new Set(calls.map((c) => (c.hostId === user.id ? c.customerId : c.hostId)))];
  // A customer knows their host by the display name on the host's page, never by the host's account name.
  const myHostIds = [...new Set(calls.filter((c) => c.customerId === user.id).map((c) => c.hostId))];
  const callIds = calls.map((c) => c.id);
  const [people, hostProfiles, payments] = await Promise.all([
    otherIds.length > 0 ? db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, otherIds)) : [],
    myHostIds.length > 0 ? db.select({ userId: schema.hostProfiles.userId, displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, myHostIds)) : [],
    callIds.length > 0 ? db.select().from(schema.payments).where(inArray(schema.payments.callId, callIds)) : [],
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const hostNameOf = new Map(hostProfiles.map((p) => [p.userId, p.displayName]));
  const paymentsOf = paymentsByCall(payments);
  const otherOf = (call: (typeof calls)[number]) => (call.hostId === user.id ? nameOf.get(call.customerId) : (hostNameOf.get(call.hostId) ?? nameOf.get(call.hostId))) ?? "Unknown";
  const pageLink = (n: number) => (n === 1 ? "/calls" : `/calls?page=${n}`);
  const plainLink = "inline-flex min-h-11 items-center underline underline-offset-2";

  return (
    <SitePage className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-sm">
        <Link href="/" className={plainLink}>
          ← Home
        </Link>
      </p>
      <h1 className={`${warm.title} mt-2`}>Past calls</h1>

      {calls.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">{page === 1 ? "No past calls yet." : "No more calls."}</p>
      ) : (
        <div className="mt-6 overflow-x-auto" data-calls="earlier">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Started</th>
                <th className="py-2 pr-4 font-medium">With</th>
                <th className="py-2 pr-4 font-medium">You were</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Payment</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.id} className="border-b border-neutral-300/40" data-call={call.id}>
                  <td className="py-2 pr-4">
                    <LocalTime iso={call.startsAt.toISOString()} year />
                  </td>
                  <td className="py-2 pr-4">{otherOf(call)}</td>
                  <td className="py-2 pr-4">{call.hostId === user.id ? "Host" : "Customer"}</td>
                  <td className="py-2 pr-4">{call.cancelledAt ? "Cancelled" : "Ended"}</td>
                  <td className="py-2 pr-4">{paymentLine(paymentsOf.get(call.id) ?? [])}</td>
                  <td className="py-2 whitespace-nowrap">
                    <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                      Results
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || older) && (
        <p className="mt-4 flex flex-wrap gap-x-6 text-sm">
          {page > 1 && (
            <Link href={pageLink(page - 1)} className={plainLink}>
              Newer
            </Link>
          )}
          {older && (
            <Link href={pageLink(page + 1)} className={plainLink}>
              Older
            </Link>
          )}
        </p>
      )}
    </SitePage>
  );
}
