import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { waitingForHost } from "@/lib/booking/bookings";
import { Rating } from "@/components/rating";
import { readNotice } from "@/lib/notice";
import { averagesFor } from "@/lib/ratings/ratings";
import { formatMoney } from "@/lib/payments/access";
import { requireUser } from "@/lib/session";
import { acceptAction, declineAction } from "../../bookings/[id]/actions";

/** The requests a host has to answer. Requests for the same time sit together. */
export default async function HostRequestsPage(props: PageProps<"/host/requests">) {
  const user = await requireUser();
  const notice = readNotice("/host/requests", await props.searchParams);
  const waiting = await waitingForHost(user.id);
  // How other hosts have rated each of these customers: one question to the database for all of them.
  const ratings = await averagesFor([...new Set(waiting.map((row) => row.booking.customerId))], "customer", new Date());

  // Group by start time, so the host can compare people who asked for the same time.
  const groups = new Map<string, typeof waiting>();
  for (const row of waiting) {
    const key = row.booking.startsAt.toISOString();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/host" className="underline underline-offset-2">
          ← Hosting
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Requests for calls ({waiting.length})</h1>
      <p className="mt-2 text-sm opacity-70">
        Several people may ask for the same time. Accepting one books the call and tells everyone else whose request it gets in
        the way of. A request you do not answer in time ends by itself.
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {waiting.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">Nothing is waiting for your answer.</p>
      ) : (
        <ul className="mt-6 space-y-6">
          {[...groups].map(([start, rows]) => (
            <li key={start} className="rounded border border-neutral-400 p-4">
              <p className="font-medium">
                <LocalTime iso={start} />
                {rows.length > 1 && <span className="ml-2 text-sm font-normal opacity-70">{rows.length} people asked for this time. Choose one.</span>}
              </p>
              <ul className="mt-3 space-y-4">
                {rows.map(({ booking, customerName }) => (
                  <li key={booking.id} className="text-sm">
                    <p>
                      <strong>{customerName}</strong>, {booking.lengthMinutes} minutes, {booking.totalCents > 0 ? formatMoney(booking.totalCents) : "free"} ·{" "}
                      <Rating shown={ratings.get(booking.customerId) ?? null} newText="new customer" />
                    </p>
                    {booking.note && <p className="mt-1 opacity-80">&ldquo;{booking.note}&rdquo;</p>}
                    {booking.respondBy && (
                      <p className="mt-1 opacity-70">
                        Answer by <LocalTime iso={booking.respondBy.toISOString()} />
                      </p>
                    )}
                    <div className="mt-2 flex gap-3">
                      <form action={acceptAction}>
                        <input type="hidden" name="id" value={booking.id} />
                        <input type="hidden" name="from" value="requests" />
                        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white">
                          Accept
                        </button>
                      </form>
                      <form action={declineAction}>
                        <input type="hidden" name="id" value={booking.id} />
                        <input type="hidden" name="from" value="requests" />
                        <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5">
                          Decline
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
