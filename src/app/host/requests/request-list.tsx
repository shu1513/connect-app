import { AboutCustomer } from "@/components/about-customer";
import { HostPhoto } from "@/components/host-photo";
import { LocalTime } from "@/components/local-time";
import { Rating } from "@/components/rating";
import { aboutWaiting, byTime, type Waiting } from "@/lib/booking/waiting-list";
import { formatMoney } from "@/lib/payments/access";
import { acceptAction, declineAction } from "../../bookings/[id]/actions";

/** How many different times a list of requests asks for: what `times` below counts. */
export { timesAskedFor } from "@/lib/booking/waiting-list";

/**
 * The requests a host has to answer, with Accept and Decline: on the requests page, and on the
 * home page (plans/38), drawn by this one piece so the two can never differ. Requests for the same
 * time sit together, so the host can compare the people who asked for it.
 *
 * `waiting` is this host's own list (`waitingForHost`), asked for by the page with the logged-in
 * person's id. What is shown about each customer is asked for here, and only for the requests that
 * are drawn, from the one place that decides it for this list and for the phone app
 * (src/lib/booking/waiting-list.ts). The host's own note is folded: a list is on show longer than
 * the page of one request.
 *
 * Nothing about a customer whose account is closed, or while either has blocked the other
 * (plans/38, decision 7): closing an account or blocking ends the waiting requests, but that step
 * can fail, and a request that is still here is then shown with the name, its time, length and
 * price, and nothing else about the customer. The name stays, as it does for a call across a
 * block: the host has to know whose request she is declining.
 *
 * `from` names the page the buttons are on, so the answer comes back to it. `times` shows only the
 * first few times asked for; a time several people asked for counts as one.
 */
export async function RequestList({ hostId, waiting, from, times }: { hostId: string; waiting: Waiting; from: "requests" | "home"; times?: number }) {
  const groups = byTime(waiting).slice(0, times);
  const drawn = groups.flatMap(([, rows]) => rows);
  if (drawn.length === 0) return null;
  // What may be shown about each customer: nothing but the name for a closed account or across a block.
  const about = await aboutWaiting(hostId, drawn, new Date());

  return (
    <ul className="space-y-6" data-request-list={from}>
      {groups.map(([start, rows]) => (
        <li key={start} className="rounded border border-neutral-400 p-4">
          <p className="font-medium">
            <LocalTime iso={start} />
            {rows.length > 1 && <span className="ml-2 text-sm font-normal opacity-70">{rows.length} people asked for this time. Choose one.</span>}
          </p>
          <ul className="mt-3 space-y-4">
            {rows.map(({ booking, customerName }) => {
              const them = about.get(booking.id)!;
              return (
              <li key={booking.id} className="text-sm" data-request={booking.id}>
                <div className="flex items-center gap-3">
                  <HostPhoto photoId={them.photoId} name={customerName} small />
                  <p>
                    <strong>{customerName}</strong>, {booking.lengthMinutes} minutes, {booking.totalCents > 0 ? formatMoney(booking.totalCents) : "free"}
                    {them.known && (
                      <>
                        {" "}
                        · <Rating shown={them.rating} newText="New: not enough ratings yet" />
                      </>
                    )}
                    {them.idConfirmed && <span className="text-green-700"> · ID confirmed</span>}
                  </p>
                </div>
                {them.words && <p className="mt-1 opacity-80">&ldquo;{them.words}&rdquo;</p>}
                {them.note !== null && <AboutCustomer key={booking.id} name={customerName} text={them.note} folded />}
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
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
