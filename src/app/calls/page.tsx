import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { CALL_WORDS } from "@/lib/call-page/words";
import { listCalls, pastCallRows } from "@/lib/home/list-calls";
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

  // Each call described in the one place that decides who is named how and what the money line says, for this
  // page, the home page and the phone app alike.
  const rowOf = new Map((await listCalls(user.id, calls, now)).map((row) => [row.id, row]));
  const pageLink = (n: number) => (n === 1 ? "/calls" : `/calls?page=${n}`);
  const plainLink = "inline-flex min-h-11 items-center underline underline-offset-2";

  return (
    <SitePage className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-sm">
        <Link href="/" className={plainLink}>
          ← Home
        </Link>
      </p>
      <h1 className={`${warm.title} mt-2`}>{CALL_WORDS.pastTitle}</h1>

      {calls.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">{page === 1 ? CALL_WORDS.noPast : CALL_WORDS.noMore}</p>
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
                  <td className="py-2 pr-4">{rowOf.get(call.id)?.name ?? "Unknown"}</td>
                  <td className="py-2 pr-4">{call.hostId === user.id ? "Host" : "Customer"}</td>
                  <td className="py-2 pr-4">{call.cancelledAt ? CALL_WORDS.statusCancelled : CALL_WORDS.statusEnded}</td>
                  <td className="py-2 pr-4">{rowOf.get(call.id)?.payment}</td>
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
