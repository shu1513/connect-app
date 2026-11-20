import { randomUUID } from "node:crypto";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { chargeFor, TIP } from "@/lib/contributions/tip-rules";
import type { TipView } from "@/lib/contributions/tips";
import { stateOf } from "@/lib/contributions/views";
import { formatMoney } from "@/lib/payments/access";
import { currentSplit } from "@/lib/payments/actions";
import { letTipGoAsHostAction, refundTipAsHostAction } from "@/app/tips/actions";

const smallButton = "rounded border border-neutral-500 px-3 py-1.5 text-sm";

/**
 * The box that asks the customer of a call for a tip (plans/44, decisions 1 and 4). It only
 * leads to the summary page: nothing is written, and nothing is charged, by anything here. Each
 * amount is shown with what it costs, the payment fee included, before anything is pressed.
 */
export function TipAsk({ callId, hostName }: { callId: string; hostName: string }) {
  return (
    <section className="mt-4 rounded border border-neutral-400 p-4 text-sm" data-tip-ask>
      <h2 className="text-base font-semibold">Thank {hostName} with a tip</h2>
      <p className="mt-1 opacity-80">
        {hostName} receives the whole tip; Connect keeps nothing of it. A small payment fee is added for you, so each amount shows what you would pay.
      </p>
      <form action="/tips/new" method="get" className="mt-2">
        <input type="hidden" name="call" value={callId} />
        <ul className="space-y-1">
          {TIP.suggestedCents.map((cents, index) => (
            <li key={cents}>
              <label className="inline-flex min-h-9 items-center gap-2">
                <input type="radio" name="amount" value={(cents / 100).toFixed(2)} defaultChecked={index === 1} />
                {formatMoney(cents)}
                <span className="opacity-70">(you pay {formatMoney(chargeFor(cents))})</span>
              </label>
            </li>
          ))}
        </ul>
        <label className="mt-2 block">
          Or another amount, in dollars (from $2)
          <input type="text" name="other" inputMode="decimal" maxLength={12} placeholder="7.00" className="mt-1 block w-32 rounded border border-neutral-400 bg-transparent px-3 py-2" />
        </label>
        <button type="submit" className="mt-3 rounded bg-blue-600 px-4 py-2 font-medium text-white">
          Give a tip
        </button>
        <span className="ml-2 opacity-70">The next page shows the total before anything is paid.</span>
      </form>
    </section>
  );
}

/**
 * The tip of a call, as its customer, its host or the founder reads it. The customer's own tip
 * lives on its own page (the card step, cancelling); the host lets a held tip go and refunds a
 * taken one here; the founder only reads, and acts on the founder's page.
 */
export function TipLine({ view, role, otherName }: { view: TipView; role: "host" | "customer" | "admin"; otherName: string }) {
  const { tip, tipCents, row } = view;
  const { payment, share } = row;
  const state = stateOf(payment);
  const fee = payment.amountCents - tipCents;
  const sent = share?.transferStatus === "sent";
  const disputed = payment.dispute === "open" || payment.dispute === "lost";
  const shareCents = share ? currentSplit(share).hostShareCents : 0;
  const page = `/contributions/${tip.id}`;
  return (
    <section className="mt-4 rounded border border-neutral-400 p-4 text-sm" data-tip={state}>
      <h2 className="text-base font-semibold">{role === "customer" ? `Your tip for ${otherName}: ${formatMoney(tipCents)}` : `A tip of ${formatMoney(tipCents)}${role === "host" ? ` from ${otherName}` : ""}`}</h2>

      {role === "customer" ? (
        <>
          {state === "to_pay" && <p className="mt-1">It waits for your card. Nothing is held yet.</p>}
          {(state === "failed" || state === "confirm") && <p className="mt-1">The payment did not go through. Nothing has been charged.</p>}
          {state === "held" && payment.takeAt && (
            <p className="mt-1">
              {formatMoney(payment.amountCents)} is held on your card (the tip and a payment fee of {formatMoney(fee)}). The money is taken on <LocalTime iso={payment.takeAt.toISOString()} />. Until then you can cancel it, and nothing is charged.
            </p>
          )}
          {state === "cancelling" && <p className="mt-1">We are cancelling it. Its own page says so once that is done.</p>}
          {state === "cancelled" && <p className="mt-1">{payment.authorisedAt ? "It was cancelled. The hold was let go, and nothing was charged." : "It was cancelled. Nothing was charged."}</p>}
          {state === "problem" && <p className="mt-1">Something about this payment needs a look by Connect. Nothing more happens to it until then.</p>}
          {/* What is said about a taken tip is read from what is recorded: the host's share, a problem, what went back. Nothing is claimed beyond that. */}
          {state === "taken" && payment.takenAt && (
            <p className="mt-1">
              {formatMoney(payment.takenCents ?? payment.amountCents)} was taken on <LocalTime iso={payment.takenAt.toISOString()} />.{" "}
              {payment.problem
                ? "Something about this payment needs a look by Connect."
                : !share
                  ? "It had been cancelled, so all of it goes back to your card."
                  : payment.refundedCents === 0 && row.refundUnderWayCents === 0 && !disputed
                    ? `That is the tip and a payment fee of ${formatMoney(fee)}. ${otherName} receives the whole tip.`
                    : `That is the tip and a payment fee of ${formatMoney(fee)}.`}
              {payment.refundedCents > 0 ? ` ${formatMoney(payment.refundedCents)} of it was paid back to your card.` : ""}
              {row.refundUnderWayCents > 0 ? ` ${formatMoney(row.refundUnderWayCents)} is on its way back to your card.` : ""}
            </p>
          )}
          <p className="mt-1">
            <Link href={page} className="inline-flex min-h-11 items-center underline underline-offset-2">
              {state === "to_pay" || state === "failed" || state === "confirm" ? "Go to the card step" : state === "held" ? "See your tip, or cancel it" : "See your tip"}
            </Link>
          </p>
        </>
      ) : (
        <>
          {state === "held" && payment.takeAt && (
            <p className="mt-1">
              It is held on the customer&apos;s card and taken on <LocalTime iso={payment.takeAt.toISOString()} />. Until then they can cancel it{role === "host" ? ", and you can let it go" : ""}. All of the tip is {role === "host" ? "yours" : "the host's"}: Connect keeps nothing of it.
            </p>
          )}
          {state === "cancelling" && <p className="mt-1">It is being cancelled. This page says so once that is done.</p>}
          {state === "cancelled" && <p className="mt-1">It was cancelled before the money was taken. Nothing was charged.</p>}
          {state === "problem" && <p className="mt-1">Something about this payment needs a look by Connect. Nothing more happens to it until then.</p>}
          {state === "taken" && payment.takenAt && (
            <p className="mt-1">
              The money was taken on <LocalTime iso={payment.takenAt.toISOString()} />.{" "}
              {share ? (
                <>
                  {role === "host" ? "Your share" : "The host's share"}: {formatMoney(shareCents)}.{" "}
                  {/* What was really sent is said from the sending itself. Whether a share can be collected right now is the Hosting page's to say: here only its earliest day, and only for a share that is there and not disputed. */}
                  {sent ? (
                    <>
                      {formatMoney(share.transferCents ?? 0)} was sent to {role === "host" ? "you" : "her"}
                      {(share.payoutFeeCents ?? 0) > 0 ? `, after ${formatMoney(share.payoutFeeCents ?? 0)} of the collection charge` : ""}.
                    </>
                  ) : (
                    shareCents > 0 &&
                    !disputed &&
                    share.transferDueAt && (
                      <>
                        It is among {role === "host" ? "your" : "her"} earnings; the earliest day to collect it is <LocalTime iso={share.transferDueAt.toISOString()} />.
                      </>
                    )
                  )}
                </>
              ) : payment.problem ? (
                "Something about this payment needs a look by Connect. Nothing has been written for " + (role === "host" ? "you" : "the host") + " yet."
              ) : (
                "It had been cancelled before, so all of it goes back to the customer."
              )}
            </p>
          )}
          {payment.refundedCents > 0 && <p className="mt-1">{formatMoney(payment.refundedCents)} was paid back to the customer.</p>}
          {row.refundUnderWayCents > 0 && <p className="mt-1">{formatMoney(row.refundUnderWayCents)} is on its way back to the customer.</p>}
          {disputed && <p className="mt-1">The customer&apos;s bank has disputed this charge. Nothing can be collected or refunded from it for now.</p>}

          {role === "host" && state === "held" && (
            <form action={letTipGoAsHostAction} className="mt-2">
              <input type="hidden" name="payment" value={payment.id} />
              <button type="submit" className={smallButton}>
                Let it go
              </button>
              <span className="ml-2 opacity-70">Nothing is charged to the customer, and it costs nobody anything.</span>
            </form>
          )}
          {role === "host" && state === "taken" && share && !sent && row.refundableCents > 0 && !disputed && (
            <form action={refundTipAsHostAction} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="payment" value={payment.id} />
              {/* Made when this page was drawn: the same press, sent twice, is one refund. */}
              <input type="hidden" name="request" value={randomUUID()} />
              <label>
                Give back, in dollars
                <input name="amount" type="text" inputMode="decimal" maxLength={12} defaultValue={(row.refundableCents / 100).toFixed(2)} className="ml-2 w-28 rounded border border-neutral-400 bg-transparent px-2 py-1" />
              </label>
              <button type="submit" className={smallButton}>
                Refund
              </button>
              <span className="basis-full opacity-70">The customer paid {formatMoney(payment.takenCents ?? payment.amountCents)} (the tip and the payment fee). What you give back goes to their card, and your share gets smaller in the same proportion.</span>
            </form>
          )}
          {role === "host" && state === "taken" && sent && <p className="mt-1 opacity-70">You have collected this tip, so only Connect can refund it now.</p>}
        </>
      )}
    </section>
  );
}
