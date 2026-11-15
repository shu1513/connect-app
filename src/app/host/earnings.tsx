import { randomUUID } from "node:crypto";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { formatMoney } from "@/lib/payments/access";
import { lastCollectionOf, unsentEarnings, wouldCollect, type Earning } from "@/lib/payments/collect";
import { collectEarningsAction } from "./actions";

const sum = (earnings: Earning[]) => earnings.reduce((total, e) => total + e.shareCents, 0);

/** What the host has earned and not collected yet, the button to collect it, and what their last collection really did. */
export async function Earnings({ hostId, payoutsReady, now }: { hostId: string; payoutsReady: boolean; now: Date }) {
  const earnings = await unsentEarnings(now, hostId);
  const ready = earnings.filter((e) => e.heldBack === null);
  const waiting = earnings.filter((e) => e.heldBack !== null);
  const collection = await lastCollectionOf(hostId);
  const would = wouldCollect(ready);
  const tooSoon = collection !== null && now < collection.againAt;
  const calls = new Set(ready.map((e) => e.call.id)).size;

  return (
    <div className="mt-5 rounded border border-neutral-400 p-4 text-sm" data-earnings>
      <h3 className="text-base font-semibold">Your earnings</h3>

      <p className="mt-2">
        <span className="font-medium">Ready to collect: {formatMoney(sum(ready))}</span>
        {calls > 0 && ` (from ${calls} ${calls === 1 ? "call" : "calls"})`}
      </p>
      {ready.length > 0 && !would && (
        <p className="mt-1 opacity-80">That is not more than the 25-cent collection charge, so there is nothing to collect yet.</p>
      )}
      {would && !payoutsReady && <p className="mt-1 opacity-80">Finish your payout setup at Stripe first. Then you can collect it.</p>}
      {would && payoutsReady && tooSoon && (
        <p className="mt-1 opacity-80">
          You can collect again from <LocalTime iso={collection.againAt.toISOString()} />.
        </p>
      )}
      {would && payoutsReady && !tooSoon && (
        <form action={collectEarningsAction} className="mt-2">
          <input type="hidden" name="collectionId" value={randomUUID()} />
          <p>
            {formatMoney(sum(ready))}, less the {formatMoney(would.feeCents)} collection charge: {formatMoney(would.sendCents)} will be sent to
            your Stripe payout account. Stripe then pays your bank.
          </p>
          <button type="submit" className="mt-2 rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Collect earnings
          </button>
        </form>
      )}

      {waiting.length > 0 && (
        <>
          <p className="mt-4">
            <span className="font-medium">Not ready yet: {formatMoney(sum(waiting))}</span>
          </p>
          <ul className="mt-1 space-y-1">
            {waiting.map(({ payment, call, shareCents, heldBack }) => (
              <li key={payment.id}>
                <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                  Call on <LocalTime iso={call.startsAt.toISOString()} />
                </Link>
                {payment.extensionId ? " (added time)" : ""}, {formatMoney(shareCents)}:{" "}
                {heldBack === "dispute" ? (
                  "the customer's bank is disputing this charge"
                ) : heldBack === "refund" ? (
                  "a refund is on its way"
                ) : heldBack === "being_sent" ? (
                  "being checked with Stripe"
                ) : payment.transferDueAt ? (
                  <>
                    ready on <LocalTime iso={payment.transferDueAt.toISOString()} />
                  </>
                ) : (
                  "not ready yet"
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {collection && (
        <p className="mt-4" data-last-collection>
          <span className="font-medium">
            Your last collection, on <LocalTime iso={collection.last.acceptedAt.toISOString()} />:
          </span>{" "}
          {collection.last.sentCents > 0 || collection.last.feeCents > 0
            ? `${formatMoney(collection.last.sentCents)} sent to your Stripe payout account${collection.last.feeCents > 0 ? `, after the ${formatMoney(collection.last.feeCents)} collection charge` : ""}.`
            : collection.last.checkingCents > 0
              ? "Nothing is confirmed as sent yet."
              : "Nothing was sent, and no collection charge was taken."}
          {collection.last.checkingCents > 0 && ` ${formatMoney(collection.last.checkingCents)} is being checked. You do not need to press again.`}
          {collection.last.refusedCents > 0 && ` ${formatMoney(collection.last.refusedCents)} could not be sent; it stays ready.`}
          {!tooSoon ? "" : (
            <>
              {" "}
              You can collect again from <LocalTime iso={collection.againAt.toISOString()} />.
            </>
          )}
        </p>
      )}

      <p className="mt-4 opacity-70">
        After we send it, Stripe pays your bank on its own schedule. Your first payout from Stripe typically takes 7 to 14 days; Stripe shows
        you its own estimate.
      </p>
    </div>
  );
}
