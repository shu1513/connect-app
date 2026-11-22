import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { paymentsForRefund, REFUND_GROUNDS, REFUND_SEARCH_PAGE, refundEstimate } from "@/lib/payments/founder-refund";
import { requireAdmin } from "@/lib/session";
import { findForRefundAction, refundAsFounderAction } from "./actions";

export const metadata: Metadata = { title: "Refund a call" };
export const dynamic = "force-dynamic";

/**
 * The founder's refund of a call's payment, also after the host has collected (plans/46-part-3-money-owed.md,
 * decisions 9 to 11). A payment is found by its call or by the customer's email address; the amount can be a part;
 * the founder names a ground and adds a sentence. After collection the customer is paid from Connect's money and the
 * host owes what her share shrinks by: the page says so, with an estimate, before the button is pressed.
 */
export default async function FounderRefundPage(props: PageProps<"/admin/refund">) {
  await requireAdmin();
  const query = await props.searchParams;
  // The result is addressed by the call's id or by the customer's account number, never by an email address.
  const call = typeof query.call === "string" ? query.call : "";
  const customer = typeof query.customer === "string" ? query.customer : "";
  const where = call ? `call=${encodeURIComponent(call)}` : customer ? `customer=${encodeURIComponent(customer)}` : "";
  const notice = readNotice("/admin/refund", query);
  // "Older": what comes after the last payment shown, by the list's own order (the call's start, then the payment's number).
  const [beforeTime, beforeId] = typeof query.before === "string" ? query.before.split("~") : [];
  const cursor = beforeTime && beforeId && !Number.isNaN(Date.parse(beforeTime)) && /^[0-9a-f-]{36}$/i.test(beforeId) ? { startsAt: new Date(beforeTime), paymentId: beforeId } : undefined;
  const found = call ? await paymentsForRefund({ callId: call }, cursor) : customer ? await paymentsForRefund({ customerId: customer }, cursor) : [];
  const box = "mt-1 block w-full rounded border border-neutral-400 p-2";

  return (
    <SitePage className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Refund a call</h1>
      <p className="mt-2 text-sm opacity-80">
        Also for a call whose host has already collected. Then the customer is paid back from Connect&apos;s money, and the host owes what their share shrinks by; they are told, with the reason you give here.{" "}
        <Link href="/admin/debts" className="underline underline-offset-2">
          Money hosts owe back
        </Link>
      </p>
      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <form action={findForRefundAction} className="mt-6 max-w-md text-sm">
        <label className="block">
          Find the payment: the call&apos;s id (from its page&apos;s address), or the customer&apos;s email address
          <input type="text" name="q" defaultValue={call} required className={box} />
        </label>
        <button type="submit" className="mt-2 rounded border border-neutral-500 px-4 py-2 font-medium">
          Find
        </button>
      </form>

      {where && found.length === 0 && <p className="mt-6 text-sm">No charged call payment was found for that.</p>}

      <ul className="mt-6 space-y-6">
        {found.map((one) => {
          const estimate = refundEstimate(one.payment, undefined, one.reductionsCents);
          return (
            <li key={one.payment.id} className="rounded border border-neutral-400 p-4 text-sm" data-refund-payment={one.payment.id} data-collected={one.collected ? "yes" : "no"}>
              <p className="font-medium">
                {one.customerName} with {one.hostName}, <LocalTime iso={one.startsAt.toISOString()} />
                {one.payment.extensionId ? " (time added during the call)" : ""}
              </p>
              <p className="mt-1">
                Charged {formatMoney(one.payment.chargedCents ?? 0)}, refunded so far {formatMoney(one.payment.refundedCents)}, left to refund {formatMoney(estimate.leftCents)}.{" "}
                <Link href={`/calls/${one.callId}/results`} className="underline underline-offset-2">
                  The call
                </Link>
              </p>
              {one.payment.disputeOpen ? (
                <p className="mt-2">The customer&apos;s bank has a question or a dispute on this payment, so it cannot be refunded as well.</p>
              ) : one.refundUnderWay === "accepted" ? (
                <p className="mt-2">A refund of this payment is on its way: Stripe has accepted it and has not confirmed it yet. Wait for it to finish before another.</p>
              ) : one.refundUnderWay === "unanswered" ? (
                <p className="mt-2">A refund of this payment was recorded, and what came of it at Stripe is not confirmed yet: it may have gone through, or it may not have reached Stripe. The app finds out by itself; mostly that takes a few minutes, at the longest a day. Do not refund it again before this page shows what happened.</p>
              ) : estimate.leftCents === 0 ? (
                <p className="mt-2">All of it has been refunded.</p>
              ) : (
                <form action={refundAsFounderAction} className="mt-3 max-w-md space-y-3">
                  <input type="hidden" name="where" value={where} />
                  <input type="hidden" name="payment" value={one.payment.id} />
                  {/* One number for this form as it is shown: pressing twice cannot refund twice. */}
                  <input type="hidden" name="request" value={randomUUID()} />
                  {one.collected ? (
                    <p className="rounded border border-neutral-400 p-2" data-refund-estimate>
                      <strong>The host has collected this share.</strong> The customer is paid back from Connect&apos;s money.{" "}
                      {estimate.hostOwesCents > 0
                        ? `If you refund all that is left, the host will owe about ${formatMoney(estimate.hostOwesCents)} (less for a part, and never more than is left of the ${formatMoney(estimate.sentCents)} that was sent to them). If the host then owes something, they are told, with your reason, and can object before anything is taken.`
                        : estimate.sentCents <= 0
                          ? "Nothing was sent to the host for this share (the charge for collecting used it up), so the host will owe nothing: Connect carries this refund."
                          : one.reductionsCents >= estimate.sentCents
                            ? `Earlier refunds have already used up the ${formatMoney(estimate.sentCents)} that was sent to the host for this share, so the host will owe nothing more: Connect carries this refund.`
                            : "This refund takes nothing off the host's share, so the host will owe nothing for it."}
                    </p>
                  ) : (
                    <p className="opacity-80">The host has not collected this share: the refund comes out of it and of our fee, and nobody owes anything.</p>
                  )}
                  <label className="block">
                    Amount to give back, in dollars
                    <input type="text" name="amount" inputMode="decimal" required pattern="\d{1,7}(\.\d{1,2})?" defaultValue={(estimate.leftCents / 100).toFixed(2)} className={box} />
                  </label>
                  <label className="block">
                    Why Connect decides this refund (the customer and the host both read it)
                    <select name="ground" required defaultValue="" className={box}>
                      <option value="" disabled>
                        Choose one
                      </option>
                      {Object.entries(REFUND_GROUNDS).map(([key, words]) => (
                        <option key={key} value={key}>
                          {words}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    A sentence of your own about what happened. The customer reads it in the email about the refund, and the host too if they had collected: write nothing that only one of them should know.
                    <textarea name="sentence" required minLength={10} maxLength={1000} rows={2} className={box} />
                  </label>
                  <button type="submit" className="rounded border border-neutral-500 px-4 py-2 font-medium">
                    Refund
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {where && found.length === REFUND_SEARCH_PAGE && (
        <p className="mt-6 text-sm">
          <Link href={`/admin/refund?${where}&before=${encodeURIComponent(`${found[found.length - 1].startsAt.toISOString()}~${found[found.length - 1].payment.id}`)}`} className="underline underline-offset-2">
            Older payments
          </Link>
        </p>
      )}
    </SitePage>
  );
}
