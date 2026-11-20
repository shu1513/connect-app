import { AboutCustomer } from "@/components/about-customer";
import { HostPhoto } from "@/components/host-photo";
import { LocalTime } from "@/components/local-time";
import { Rating } from "@/components/rating";
import type { waitingForHost } from "@/lib/booking/bookings";
import { formatMoney } from "@/lib/payments/access";
import { hostNotesAbout } from "@/lib/people/contacts";
import { photosForHost } from "@/lib/profiles/photo";
import { averagesFor } from "@/lib/ratings/ratings";
import { verifiedAmong } from "@/lib/safety/identity";
import { acceptAction, declineAction } from "../../bookings/[id]/actions";

type Waiting = Awaited<ReturnType<typeof waitingForHost>>;

/** The requests grouped by the time asked for, in the order given (the soonest call first). */
function byTime(waiting: Waiting): Array<[string, Waiting]> {
  const groups = new Map<string, Waiting>();
  for (const row of waiting) {
    const key = row.booking.startsAt.toISOString();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups];
}

/** How many different times these requests ask for: what `times` below counts. */
export function timesAskedFor(waiting: Waiting): number {
  return byTime(waiting).length;
}

/**
 * The requests a host has to answer, with Accept and Decline: on the requests page, and on the
 * home page (plans/38), drawn by this one piece so the two can never differ. Requests for the same
 * time sit together, so the host can compare the people who asked for it.
 *
 * `waiting` is this host's own list (`waitingForHost`), asked for by the page with the logged-in
 * person's id. What is shown about each customer is asked for here, and only for the requests that
 * are drawn. The host's own note is folded: a list is on show longer than the page of one request.
 *
 * `from` names the page the buttons are on, so the answer comes back to it. `times` shows only the
 * first few times asked for; a time several people asked for counts as one.
 */
export async function RequestList({ hostId, waiting, from, times }: { hostId: string; waiting: Waiting; from: "requests" | "home"; times?: number }) {
  const groups = byTime(waiting).slice(0, times);
  const customers = [...new Set(groups.flatMap(([, rows]) => rows.map((row) => row.booking.customerId)))];
  if (customers.length === 0) return null;
  const [ratings, idConfirmed, notes, photoIds] = await Promise.all([
    // How other hosts have rated each of these customers: one question to the database for all of them.
    averagesFor(customers, "customer", new Date()),
    verifiedAmong(customers),
    // The host's own notes about these customers (plans/32). The lookup asks every rule itself.
    hostNotesAbout(hostId, customers),
    // Their photos (plans/35): the ids only, and only of those this host is handed a photo of.
    photosForHost(hostId, customers),
  ]);

  return (
    <ul className="space-y-6" data-request-list={from}>
      {groups.map(([start, rows]) => (
        <li key={start} className="rounded border border-neutral-400 p-4">
          <p className="font-medium">
            <LocalTime iso={start} />
            {rows.length > 1 && <span className="ml-2 text-sm font-normal opacity-70">{rows.length} people asked for this time. Choose one.</span>}
          </p>
          <ul className="mt-3 space-y-4">
            {rows.map(({ booking, customerName }) => (
              <li key={booking.id} className="text-sm" data-request={booking.id}>
                <div className="flex items-center gap-3">
                  <HostPhoto photoId={photoIds.get(booking.customerId) ?? null} name={customerName} small />
                  <p>
                    <strong>{customerName}</strong>, {booking.lengthMinutes} minutes, {booking.totalCents > 0 ? formatMoney(booking.totalCents) : "free"} ·{" "}
                    <Rating shown={ratings.get(booking.customerId) ?? null} newText="New: not enough ratings yet" />
                    {idConfirmed.has(booking.customerId) && <span className="text-green-700"> · ID confirmed</span>}
                  </p>
                </div>
                {booking.note && <p className="mt-1 opacity-80">&ldquo;{booking.note}&rdquo;</p>}
                {notes.has(booking.customerId) && <AboutCustomer key={booking.id} name={customerName} text={notes.get(booking.customerId)!} folded />}
                {booking.respondBy && (
                  <p className="mt-1 opacity-70">
                    Answer by <LocalTime iso={booking.respondBy.toISOString()} />
                  </p>
                )}
                <div className="mt-2 flex gap-3">
                  <form action={acceptAction}>
                    <input type="hidden" name="id" value={booking.id} />
                    <input type="hidden" name="from" value={from} />
                    <button type="submit" className="min-h-11 rounded bg-blue-600 px-4 py-1.5 font-medium text-white">
                      Accept
                    </button>
                  </form>
                  <form action={declineAction}>
                    <input type="hidden" name="id" value={booking.id} />
                    <input type="hidden" name="from" value={from} />
                    <button type="submit" className="min-h-11 rounded border border-neutral-500 px-4 py-1.5">
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
  );
}
