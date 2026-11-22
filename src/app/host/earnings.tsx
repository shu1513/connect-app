import { randomUUID } from "node:crypto";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { formatMoney } from "@/lib/payments/access";
import { disputePagesOf } from "@/lib/disputes/pages";
import { debtsOfHost } from "@/lib/disputes/takeback";
import { DISPUTE_MESSAGE_WAITING, disputeMessageWaiting, lastCollectionOf, unsentEarnings, wouldCollect, type Earning } from "@/lib/payments/collect";
import { STARTED_BY_CONNECT } from "@/lib/payments/uncollected-words";
import { collectEarningsAction } from "./actions";

const sum = (earnings: Earning[]) => earnings.reduce((total, e) => total + e.shareCents, 0);

/** What the host has earned and not collected yet, the button to collect it, and what their last collection really did. */
export async function Earnings({ hostId, payoutsReady, abroad, now }: { hostId: string; payoutsReady: boolean; abroad: boolean; now: Date }) {
  const earnings = await unsentEarnings(now, hostId);
  const ready = earnings.filter((e) => e.heldBack === null);
  const waiting = earnings.filter((e) => e.heldBack !== null);
  const collection = await lastCollectionOf(hostId);
  const would = wouldCollect(ready);
  const tooSoon = collection !== null && now < collection.againAt;
  // Only what a call earned counts as "a call". What has no call is said in words: tips, contributions to her project, expired member time.
  const calls = new Set(ready.flatMap((e) => (e.call ? [e.call.id] : []))).size;
  const tips = ready.filter((e) => e.tip).length;
  const contributions = ready.filter((e) => !e.call && !e.tip && e.payment.kind === "contribution").length;
  const expired = ready.filter((e) => !e.call && e.payment.kind !== "contribution").length;
  const from = [
    ...(calls > 0 ? [`${calls} ${calls === 1 ? "call" : "calls"}`] : []),
    ...(tips > 0 ? [`${tips} ${tips === 1 ? "tip" : "tips"}`] : []),
    ...(contributions > 0 ? [`${contributions} ${contributions === 1 ? "contribution" : "contributions"}`] : []),
    ...(expired > 0 ? ["expired member time"] : []),
  ];
  // A press would be refused for this reason, so the button is not offered while it lasts (minutes).
  const waitForStripe = would !== null && payoutsReady && !tooSoon && (await disputeMessageWaiting());
  // Where the host can read about each disputed payment (plans/47). A dispute the app has no record of yet has no page.
  const disputePage = await disputePagesOf(waiting.filter((e) => e.heldBack === "dispute").map((e) => e.payment));
  // A share collected before a bank dispute was lost is taken back (plans/47, part 3): what is owed, from when, and what was taken.
  const takeBacks = await debtsOfHost(hostId);

  return (
    <div className="mt-5 rounded border border-neutral-400 p-4 text-sm" data-earnings>
      <h3 className="text-base font-semibold">Your earnings</h3>

      <p className="mt-2">
        <span className="font-medium">Ready to collect: {formatMoney(sum(ready))}</span>
        {from.length > 0 && ` (from ${from.length > 1 ? `${from.slice(0, -1).join(", ")} and ${from.at(-1)}` : from[0]})`}
      </p>
      {ready.length > 0 && !would && (
        <p className="mt-1 opacity-80">That is not more than the 25-cent collection charge, so there is nothing to collect yet.</p>
      )}
      {would && !payoutsReady && <p className="mt-1 opacity-80">Your payout account at Stripe is not ready yet (see above). Once it is, you can collect this.</p>}
      {would && payoutsReady && tooSoon && (
        <p className="mt-1 opacity-80">
          You can collect again from <LocalTime iso={collection.againAt.toISOString()} />.
        </p>
      )}
      {waitForStripe && <p className="mt-1 opacity-80">{DISPUTE_MESSAGE_WAITING}</p>}
      {would && payoutsReady && !tooSoon && !waitForStripe && (
        <form action={collectEarningsAction} className="mt-2">
          <input type="hidden" name="collectionId" value={randomUUID()} />
          <p>
            {formatMoney(sum(ready))}, less the {formatMoney(would.feeCents)} collection charge: {formatMoney(would.sendCents)} will be sent to
            your Stripe payout account. Stripe then pays your bank{abroad ? ", in your own money at its exchange rate of that moment" : ""}.
          </p>
          <button type="submit" className="mt-2 rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Collect earnings
          </button>
        </form>
      )}

      {waiting.length > 0 && (
        // A busy host can have dozens of these. The total is always in sight; the list opens on request once it is long.
        <details className="mt-4" open={waiting.length <= 6}>
          <summary className="cursor-pointer">
            <span className="font-medium">Not ready yet: {formatMoney(sum(waiting))}</span> (from {waiting.length}{" "}
            {waiting.length === 1 ? "payment" : "payments"}; the reason is beside each)
          </summary>
          <ul className="mt-1 space-y-1">
            {waiting.map(({ payment, call, month, project, tip, shareCents, heldBack }) => (
              <li key={payment.id}>
                {call ? (
                  <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                    Call on <LocalTime iso={call.startsAt.toISOString()} />
                  </Link>
                ) : tip ? (
                  // A tip (plans/44): kept like a contribution, and named by the call it was given for.
                  <Link href={`/calls/${tip.callId}/results`} className="underline underline-offset-2" data-tip>
                    Tip for the call{tip.callStartsAt ? <> on <LocalTime iso={tip.callStartsAt.toISOString()} /></> : null}
                  </Link>
                ) : payment.kind === "contribution" ? (
                  // A contribution to her project: it has no call to link to either.
                  <span data-contribution>
                    Contribution{project ? <> to &ldquo;{project}&rdquo;</> : null}
                    {payment.chargedAt ? <>, taken <LocalTime iso={payment.chargedAt.toISOString()} /></> : null}
                  </span>
                ) : (
                  // A membership month's unused time that expired: it has no call to link to.
                  <span data-expired-time>Expired member time{month?.endsAt ? <>, month to <LocalTime iso={month.endsAt.toISOString()} /></> : null}</span>
                )}
                {payment.extensionId ? " (added time)" : ""}, {formatMoney(shareCents)}:{" "}
                {heldBack === "dispute" ? (
                  disputePage.has(payment.id) ? (
                    <Link href={disputePage.get(payment.id)!.path} className="underline underline-offset-2" data-dispute-link>
                      {disputePage.get(payment.id)!.lost ? "the customer's bank decided for the customer on this charge" : "the customer's bank is disputing this charge"}
                    </Link>
                  ) : (
                    "the customer's bank is disputing this charge"
                  )
                ) : heldBack === "refund" ? (
                  "a refund is on its way"
                ) : heldBack === "founder" ? (
                  "held back by Connect for now"
                ) : heldBack === "request" ? (
                  "waiting for your answer to a refund request"
                ) : heldBack === "answer_applying" ? (
                  "your answer to a refund request is being applied"
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
        </details>
      )}

      {collection && (
        <p className="mt-4" data-last-collection>
          <span className="font-medium">
            Your last collection, on <LocalTime iso={collection.last.acceptedAt.toISOString()} />:
          </span>{" "}
          {collection.last.sentCents > 0 || collection.last.feeCents > 0
            ? `${formatMoney(collection.last.sentCents)} sent to your Stripe payout account${collection.last.feeCents > 0 ? `, after the ${formatMoney(collection.last.feeCents)} collection charge` : ""}.`
            : collection.last.unanswered > 0
              ? "Nothing is confirmed as sent yet."
              : "Nothing was sent, and no collection charge was taken."}
          {collection.last.checkingCents > 0 && ` ${formatMoney(collection.last.checkingCents)} is being checked.${collection.last.startedAs === "helper" ? "" : " You do not need to press again."}`}
          {/* A share that only carries the charge: nothing of it is "being checked" in cents, and the charge is not known yet. */}
          {collection.last.checkingCents === 0 && collection.last.checkingFeeCents > 0 && ` The collection charge of ${formatMoney(collection.last.checkingFeeCents)} is still being checked.`}
          {/* What is hers to collect now is in the lists above: a refund or a dispute can have changed a share since. */}
          {collection.last.refusedCents > 0 && ` ${formatMoney(collection.last.refusedCents)} was not sent in this collection.`}
          {/* A collection the helper started, after 12 months without one (plans/46, part 3b). */}
          {collection.last.startedAs === "helper" && <span data-started-by-connect> {STARTED_BY_CONNECT}</span>}
          {/* Said once: beside the money that is ready when there is some, otherwise here. */}
          {tooSoon && !would && (
            <>
              {" "}
              You can collect again from <LocalTime iso={collection.againAt.toISOString()} />.
            </>
          )}
        </p>
      )}

      {takeBacks.length > 0 && (
        <div className="mt-4" data-take-backs>
          <p className="font-medium">Money you owe back, or that was taken back</p>
          <ul className="mt-1 space-y-1">
            {takeBacks.map((debt) => (
              <li key={debt.id} data-take-back={debt.status}>
                {/* For one that is over: all that was owed (what the app took and what a person at Connect took by hand), never the row's own remainder, which can be nothing. */}
                {formatMoney(debt.status === "taken" ? debt.amountCents + debt.byHandCents : debt.amountCents)}
                {debt.status === "taken" ? (
                  <>
                    {" "}
                    was taken back from your Stripe balance
                    {/* A day only for what the app itself took: a part a person at Connect took by hand has its own day at Stripe. */}
                    {debt.amountCents > 0 && debt.takenAt ? (
                      <>
                        {debt.byHandCents > 0 ? `, the last ${formatMoney(debt.amountCents)}` : ""} on <LocalTime iso={debt.takenAt.toISOString()} />
                      </>
                    ) : null}
                    .
                    {debt.leftoverToldAt ? " It has since turned out not to be owed: a person at Connect gives it back to you." : ""}
                    {debt.overpaidCents > 0 ? ` Another ${formatMoney(debt.overpaidCents)} was taken on top of it: a person at Connect gives that back to you.` : ""}
                  </>
                ) : debt.status === "taking" ? (
                  " is being taken back now."
                ) : debt.status === "settled" ? (
                  " was settled with Connect outside the app. Nothing more is owed for it."
                ) : debt.status === "waiting" ? (
                  " is owed back: Connect refunded a payment you had already collected. Connect does not take it by itself; a person at Connect will write to you about it."
                ) : debt.status === "objected" ? (
                  " is owed back, and you told us this is wrong. Nothing is taken until we have answered you."
                ) : (
                  <>
                    {" "}
                    is owed back: you had collected your share of a payment {debt.refundId ? "that Connect then refunded" : "the customer's bank then took back"}. Connect asks Stripe to take it from your Stripe balance{" "}
                    {debt.dueAt ? (
                      <>
                        from <LocalTime iso={debt.dueAt.toISOString()} />.
                      </>
                    ) : debt.status === "answered" ? (
                      "not before 3 days after our answer to your objection reached you by email."
                    ) : (
                      "not before 14 days after our email about it reached you."
                    )}
                    {!debt.dueAt && debt.noticeProblemToldAt && " We could not reach you by email about this, so nothing is taken for now; please check the email address of your account."}
                    {debt.status === "told" && " If you think this is wrong, you can say so on its page; nothing is taken then until we have answered you."}
                  </>
                )}{" "}
                <Link href={debt.path} className="underline underline-offset-2">
                  {debt.refundId ? "Read about this" : "Read about this dispute"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {abroad ? (
        // No number of days is promised to a host abroad: it was only ever measured for hosts in the United States.
        <p className="mt-4 opacity-70" data-earnings-abroad>
          The amounts here are in US dollars, as we send them. Stripe turns them into your own money and pays your bank on its own schedule; your
          Stripe dashboard shows what arrived and when it is paid.
        </p>
      ) : (
        <p className="mt-4 opacity-70">
          After we send it, Stripe pays your bank on its own schedule. Your first payout from Stripe typically takes 7 to 14 days; Stripe shows
          you its own estimate.
        </p>
      )}
    </div>
  );
}
