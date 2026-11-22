import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import type { Refund } from "@/db/schema";
import { debtForPage, pageOfDebt } from "@/lib/disputes/takeback";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { getSignedIn, isAdminSession, requireUser } from "@/lib/session";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { answerDebtAction, cancelDebtAction, holdDebtAction, objectDebtAction, sendAgainDebtAction, settleDebtAction } from "./actions";

// The same title whoever asks: nothing is given away before it is known who may see the page.
export const metadata: Metadata = { title: "Money owed back" };

export const dynamic = "force-dynamic";

const DEBT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One take-back that comes from a refund Connect gave after the host had collected (plans/46-part-3-money-owed.md):
 * for the host who owes it, and for the founder. What was refunded and why, how the amount is worked out, where it
 * stands, and what each of the two can do. Someone else's and one that does not exist are both "not found". A
 * take-back that comes from a bank dispute is shown on that dispute's page.
 */
export default async function DebtPage(props: PageProps<"/debts/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/debts/${id}`);
  if (!DEBT_ID.test(id)) notFound();
  const founder = await isAdminSession(await getSignedIn());
  const found = await debtForPage(id, "host", user);
  if (!found || (found.debt.hostId !== user.id && !founder)) notFound();
  const asHost = found.debt.hostId === user.id;
  const { debt, cause } = found;
  if (debt.disputeId) redirect(pageOfDebt(debt));
  // (Read again in the founder's words when the founder is not this take-back's host.)
  const what = asHost ? found.what : ((await debtForPage(id, "founder", user))?.what ?? found.what);
  const refund = cause as Refund;
  const notice = readNotice(`/debts/${debt.id}`, await props.searchParams);
  const now = new Date();
  const button = "rounded border border-neutral-500 px-4 py-2 text-sm font-medium";
  const box = "mt-1 block w-full rounded border border-neutral-400 p-2";
  const waitingForDay = (debt.status === "told" || debt.status === "answered") && !debt.dueAt;
  const cutShort = debt.amountCents < refund.hostOwesCents;

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-sm">
        <Link href={asHost ? "/host" : "/admin/debts"} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {asHost ? "Hosting" : "Money hosts owe back"}
        </Link>
      </p>
      <h1 className={warm.title}>Money owed back after a refund</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <div className="mt-6 rounded border border-neutral-400 p-4 text-sm" data-debt={debt.id} data-debt-status={debt.status}>
        <p>
          {asHost ? `Connect has given ${found.customerName} ` : `You gave ${found.customerName} `}
          <span className="font-medium">{formatMoney(refund.amountCents)}</span> back for {what}.{" "}
          {asHost ? "You had already collected your share of that payment, so the money came from Connect." : `${found.hostName} had already collected their share, so the money came from Connect.`}
        </p>
        <p className="mt-2 whitespace-pre-wrap" data-debt-reason>
          {asHost ? "Why Connect decided this refund: " : "The reason you gave: "}
          {refund.reason}
        </p>
        <p className="mt-2" data-debt-how>
          {asHost ? "Your" : "The host's"} share of that payment was {formatMoney(refund.shareBeforeCents ?? 0)} before this refund and is {formatMoney(refund.shareAfterCents ?? 0)} after it.{" "}
          {asHost ? "What you owe back: " : "What the host owes back: "}
          <span className="font-medium">{formatMoney(debt.amountCents)}</span>.
          {cutShort && " (It is less than the difference: no more than that is left of what was sent for this payment.)"}
        </p>

        <p className="mt-3 font-medium" data-debt-state>
          {debt.status === "waiting" &&
            (asHost
              ? "Connect does not take this amount by itself. A person at Connect will write to you about how it is settled. Until then nothing is taken."
              : "The app does not take this one by itself: the host had not accepted a published Host Agreement before the customer's payment was held. Settle it with the host, then record that here, or call it off.")}
          {(debt.status === "told" || debt.status === "answered") &&
            (debt.dueAt ? (
              <>
                From <LocalTime iso={debt.dueAt.toISOString()} />, {asHost ? "Connect asks Stripe to take it back from your Stripe balance. Until then nothing is taken." : "the app asks Stripe to take it back."}
              </>
            ) : debt.noticeProblemToldAt ? (
              asHost ? (
                "We could not confirm that our email about this reached you, so nothing is taken for now. Please check the email address of your account, or write to us."
              ) : (
                "The email about this is not confirmed as delivered to the host, so nothing is taken. Send it again (once the host's address works), or call it off."
              )
            ) : debt.status === "answered" ? (
              asHost ? (
                "We have answered your objection. Connect asks Stripe to take it back, not before 3 days after our answer reached you by email."
              ) : (
                "The objection was answered. It gets its day once the answer's email has arrived."
              )
            ) : asHost ? (
              "Connect asks Stripe to take it back from your Stripe balance, not before 14 days after our email about it was sent to you. Until then nothing is taken."
            ) : (
              "The host was told. It gets its day once the notice's email has arrived (14 days after that)."
            ))}
          {debt.status === "objected" && (asHost ? "You told us this is wrong. Nothing is taken until we have answered you." : "The host objected. Nothing is taken until you have decided.")}
          {debt.status === "taking" && "Stripe is being asked to take it back now."}
          {debt.status === "taken" && debt.takenAt && (
            <>
              Taken back from {asHost ? "your" : "the host's"} Stripe balance on <LocalTime iso={debt.takenAt.toISOString()} />. Nothing more is owed for it.
            </>
          )}
          {debt.status === "cancelled" && "Called off. Nothing is taken, and nothing is owed for it."}
          {debt.status === "settled" && `Settled outside the app: ${formatMoney(debt.repaidCents ?? 0)} was paid back${debt.amountCents - (debt.repaidCents ?? 0) > 0 ? `, and Connect carries the remaining ${formatMoney(debt.amountCents - (debt.repaidCents ?? 0))}` : ""}. Nothing more is owed for it.`}
        </p>
        {debt.objection && (debt.status === "objected" || debt.status === "answered") && (
          <p className="mt-2 whitespace-pre-wrap opacity-80" data-objection>
            {asHost ? "What you wrote: " : "What the host wrote: "}
            {debt.objection}
          </p>
        )}
        {debt.answer && debt.status === "answered" && (
          <p className="mt-2 whitespace-pre-wrap opacity-80" data-answer-to-objection>
            {asHost ? "Our answer: " : "Your answer: "}
            {debt.answer}
          </p>
        )}
        {(debt.status === "told" || debt.status === "answered") && debt.dueAt && debt.dueAt <= now && debt.refusedAt && (
          <p className="mt-2 opacity-80" data-refused>
            {asHost ? "Stripe could not take it back yet. It is tried again once a day." : `Stripe refused the last try${debt.refusal ? `: ${debt.refusal}` : "."} The app tries again once a day.`}
          </p>
        )}
        {!asHost && debt.settledNote && debt.status === "settled" && (
          <p className="mt-2 whitespace-pre-wrap opacity-80" data-settled-note>
            Your note: {debt.settledNote}
          </p>
        )}

        {asHost && debt.status === "told" && (
          <form action={objectDebtAction} className="mt-4 max-w-md space-y-2" data-object>
            <input type="hidden" name="debt" value={debt.id} />
            <label className="block">
              If you think this is wrong, tell us why. Nothing is taken until a person at Connect has answered you.
              <textarea name="objection" required minLength={10} maxLength={2000} rows={3} className={box} />
            </label>
            <button type="submit" className={button}>
              I think this is wrong
            </button>
          </form>
        )}
        {asHost && (debt.status === "waiting" || debt.status === "answered") && (
          <p className="mt-3 opacity-70">
            If you think this is wrong, write to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        )}

        {founder && !asHost && debt.status === "objected" && (
          <form action={answerDebtAction} className="mt-4 max-w-md space-y-2" data-answer-objection>
            <input type="hidden" name="debt" value={debt.id} />
            <label className="block">
              Your answer to the host, if it is taken after all. The host reads it as written. It is then taken no earlier than the first day, and no earlier than 3 days after this answer has arrived.
              <textarea name="answer" required minLength={10} maxLength={2000} rows={3} className={box} />
            </label>
            <button type="submit" className={button}>
              Answer, and take it after all
            </button>
          </form>
        )}
        {founder && !asHost && debt.status === "told" && (
          <form action={holdDebtAction} className="mt-4 max-w-md space-y-2" data-hold-take-back>
            <input type="hidden" name="debt" value={debt.id} />
            <label className="block">
              The host objected by email? Note what they said. Nothing is taken until you have decided.
              <input type="text" name="note" maxLength={2000} className={box} />
            </label>
            <button type="submit" className={button}>
              Hold it: the host objected
            </button>
          </form>
        )}
        {founder && !asHost && waitingForDay && debt.noticeProblemToldAt && (
          <form action={sendAgainDebtAction} className="mt-4" data-send-again>
            <input type="hidden" name="debt" value={debt.id} />
            <button type="submit" className={button}>
              Send it again
            </button>
          </form>
        )}
        {founder && !asHost && ["told", "waiting", "objected", "answered"].includes(debt.status) && (
          <>
            <form action={settleDebtAction} className="mt-4 max-w-md space-y-2" data-settle>
              <input type="hidden" name="debt" value={debt.id} />
              <p className="font-medium">Settled outside the app</p>
              <label className="block">
                What the host paid back to Connect, in dollars (0 if nothing). The rest is carried by Connect. Do not enter a reversal you made by hand in Stripe: Stripe already shows it.
                <input type="text" name="repaid" inputMode="decimal" required pattern="\d{1,7}(\.\d{1,2})?" className={box} />
              </label>
              <label className="block">
                How it was settled (when, and how the host paid)
                <input type="text" name="note" required minLength={5} maxLength={2000} className={box} />
              </label>
              <button type="submit" className={button}>
                Record as settled
              </button>
            </form>
            <form action={cancelDebtAction} className="mt-4" data-cancel-take-back>
              <input type="hidden" name="debt" value={debt.id} />
              <button type="submit" className={button}>
                Call it off (Connect carries {formatMoney(debt.amountCents)})
              </button>
            </form>
          </>
        )}
      </div>
    </SitePage>
  );
}
