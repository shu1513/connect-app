import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import type { Refund } from "@/db/schema";
import { debtForPage, handReversalsOpen, pageOfDebt } from "@/lib/disputes/takeback";
import { paidBackCents } from "@/lib/disputes/takeback-rules";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { getSignedIn, isAdminSession, requireUser } from "@/lib/session";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { answerDebtAction, cancelDebtAction, countReversalAction, holdDebtAction, objectDebtAction, sendAgainDebtAction, settleDebtAction } from "./actions";

// The same title whoever asks: nothing is given away before it is known who may see the page.
export const metadata: Metadata = { title: "Money owed back" };

export const dynamic = "force-dynamic";

const DEBT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One take-back (plans/46-part-3-money-owed.md): for the host who owes it, and for the founder. For one that comes
 * from a refund Connect gave after the host had collected: what was refunded and why, how the amount is worked out,
 * where it stands, and what each of the two can do. One that comes from a bank dispute is shown to its host on the
 * dispute's page; here the founder settles it outside the app, or says what a reversal made by hand at Stripe was
 * for. Someone else's and one that does not exist are both "not found".
 */
export default async function DebtPage(props: PageProps<"/debts/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/debts/${id}`);
  if (!DEBT_ID.test(id)) notFound();
  const founder = await isAdminSession(await getSignedIn());
  const found = await debtForPage(id, "host", user);
  if (!found || (found.debt.hostId !== user.id && !founder)) notFound();
  const isHost = found.debt.hostId === user.id;
  const query = await props.searchParams;
  // A founder who is also this take-back's host sees the host's view, and can ask for the founder's (the founder's
  // list links to it): otherwise nobody could settle or call off that one.
  const asFounder = founder && (!isHost || query.as === "founder");
  const asHost = !asFounder;
  const { debt, cause } = found;
  const refund = debt.refundId ? (cause as Refund) : null;
  // A dispute's take-back is its host's to read, and to object to, on the dispute's page.
  if (!refund && asHost) redirect(pageOfDebt(debt));
  // (Read again in the founder's words for the founder's view.)
  const what = asHost ? found.what : ((await debtForPage(id, "founder", user))?.what ?? found.what);
  const notice = readNotice(`/debts/${debt.id}`, query);
  // Keeps the founder's view through a form, for a founder who is also the host.
  const view = asFounder && isHost ? <input type="hidden" name="as" value="founder" /> : null;
  const reserved = ["told", "waiting", "objected", "answered"].includes(debt.status);
  // Reversals somebody made by hand at Stripe on this transfer that nobody has accounted for. Asked of Stripe as the
  // page is made; null when Stripe could not be asked.
  // Also for a take-back that has ended: a reversal meant for it then means the host paid twice.
  const ended = ["taken", "settled", "cancelled"].includes(debt.status);
  const byHand = asFounder && (reserved || ended) ? await handReversalsOpen(debt).catch(() => null) : [];
  // The refund this take-back came from failed at Stripe after all: the customer got nothing.
  const fellAway = refund?.failedLateAt != null;
  const paid = paidBackCents(debt);
  const now = new Date();
  const button = "rounded border border-neutral-500 px-4 py-2 text-sm font-medium";
  const box = "mt-1 block w-full rounded border border-neutral-400 p-2";
  const waitingForDay = (debt.status === "told" || debt.status === "answered") && !debt.dueAt;
  const cutShort = refund !== null && debt.amountCents + debt.byHandCents < refund.hostOwesCents;

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-sm">
        <Link href={asHost ? "/host" : "/admin/debts"} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {asHost ? "Hosting" : "Money hosts owe back"}
        </Link>
      </p>
      <h1 className={warm.title}>Money owed back after {refund ? "a refund" : "a lost bank dispute"}</h1>
      {isHost && founder && asHost && (
        <p className="mt-2 text-sm">
          You are also the founder.{" "}
          <Link href={`/debts/${debt.id}?as=founder`} className="underline underline-offset-2">
            See the founder&apos;s view of this take-back
          </Link>
        </p>
      )}

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {fellAway && (
        <p className="mt-4 rounded border border-neutral-400 p-3 text-sm" data-fell-away>
          <strong>This refund did not go through after all.</strong> Stripe first confirmed it and then reported that it failed{asFounder && refund?.failure ? ` (${refund.failure})` : ""}: the customer&apos;s bank sent the money back. So nothing is owed for it.{" "}
          {paid > 0
            ? asHost
              ? `You had already paid ${formatMoney(paid)} back for it. That money is yours: a person at Connect gives it back to you.`
              : `The host had already paid ${formatMoney(paid)} back for it. The app does not give it back by itself: send it to the host in Stripe.`
            : ""}
          {asFounder ? " The customer did not get the money: refund them again if they should still have it." : ""}
        </p>
      )}

      <div className="mt-6 rounded border border-neutral-400 p-4 text-sm" data-debt={debt.id} data-debt-status={debt.status}>
        {refund ? (
          <>
            <p>
              {fellAway ? (asHost ? `Connect had wanted to give ${found.customerName} ` : `You had wanted to give ${found.customerName} `) : asHost ? `Connect has given ${found.customerName} ` : `You gave ${found.customerName} `}
              <span className="font-medium">{formatMoney(refund.amountCents)}</span> back for {what}.{" "}
              {asHost ? "You had already collected your share of that payment, so the money came from Connect." : `${found.hostName} had already collected their share, so the money came from Connect.`}
            </p>
            <p className="mt-2 whitespace-pre-wrap" data-debt-reason>
              {asHost ? "Why Connect decided this refund: " : "The reason you gave: "}
              {refund.reason}
            </p>
            <p className="mt-2" data-debt-how>
              {asHost ? "Your" : "The host's"} share of that payment was {formatMoney(refund.shareBeforeCents ?? 0)} before this refund and is {formatMoney(refund.shareAfterCents ?? 0)} after it.{" "}
              {/* One label for each state: what is owed now, what was written before the refund fell away, what was paid. */}
              {fellAway
                ? "What had been written as owed back: "
                : debt.status === "taken" || debt.status === "settled"
                  ? asHost
                    ? "What you owed back: "
                    : "What the host owed back: "
                  : debt.status === "cancelled"
                    ? "What had been written as owed back: "
                    : debt.byHandCents > 0
                      ? asHost
                        ? "What you still owe back: "
                        : "What the host still owes back: "
                      : asHost
                        ? "What you owe back: "
                        : "What the host owes back: "}
              <span className="font-medium">{formatMoney(fellAway || debt.status === "taken" ? debt.amountCents + debt.byHandCents : debt.amountCents)}</span>.
              {cutShort && " (It is less than the difference: no more than that is left of what was really sent for this payment.)"}
            </p>
          </>
        ) : (
          <p data-debt-how>
            The bank dispute over {what} was lost, and {found.hostName} had already collected their share.{" "}
            {debt.status === "taken" || debt.status === "settled" ? "What the host owed back: " : debt.status === "cancelled" ? "What had been written as owed back: " : debt.byHandCents > 0 ? "What the host still owes back: " : "What the host owes back: "}
            <span className="font-medium">{formatMoney(debt.status === "taken" ? debt.amountCents + debt.byHandCents : debt.amountCents)}</span>.{" "}
            <Link href={pageOfDebt(debt)} className="underline underline-offset-2">
              The dispute&apos;s page
            </Link>{" "}
            shows how it was worked out, and has the host&apos;s objection and your answer.
          </p>
        )}
        {debt.byHandCents > 0 && (
          <p className="mt-2" data-by-hand>
            {fellAway || debt.status === "taken"
              ? `Of that, ${formatMoney(debt.byHandCents)} was taken by a reversal a person at Connect made at Stripe.`
              : `${formatMoney(debt.byHandCents)} more was owed and has been taken already, by a reversal a person at Connect made at Stripe.`}
          </p>
        )}
        {debt.overpaidCents > 0 && (
          <p className="mt-2" data-overpaid>
            {asHost
              ? `${formatMoney(debt.overpaidCents)} was taken from your Stripe balance on top of what you owed. That money is yours: a person at Connect gives it back to you.`
              : `${formatMoney(debt.overpaidCents)} was taken on top of it by a reversal made by hand at Stripe. The app does not give it back by itself: send it to the host in Stripe.`}
          </p>
        )}

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
          {debt.status === "taken" && debt.takenAt && !fellAway && (
            <>
              Taken back from {asHost ? "your" : "the host's"} Stripe balance on <LocalTime iso={debt.takenAt.toISOString()} />. Nothing more is owed for it.
            </>
          )}
          {debt.status === "cancelled" && !fellAway && "Called off. Nothing is taken, and nothing is owed for it."}
          {/* What Connect carries is what the books hold for it now: nothing, once the cause has fallen away. */}
          {debt.status === "settled" &&
            !fellAway &&
            `Settled outside the app: ${formatMoney(debt.repaidCents ?? 0)} was paid back${debt.costBookedCents > 0 ? `, and Connect carries the remaining ${formatMoney(debt.costBookedCents)}` : ""}. Nothing more is owed for it.`}
          {debt.status === "settled" && fellAway && `It had been settled outside the app: ${formatMoney(debt.repaidCents ?? 0)} was paid back, and the rest was let go.`}
          {debt.status === "taken" && !debt.takenAt && !fellAway && "Paid in full. Nothing more is owed for it."}
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
        {asFounder && debt.settledNote && debt.status === "settled" && (
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

        {asHost && debt.handToldAt && (debt.status === "told" || debt.status === "answered") && (
          <p className="mt-2 opacity-80" data-hand-hold>
            A person at Connect is checking something about this one. Nothing is taken until they have.
          </p>
        )}

        {asFounder && reserved && debt.handToldAt && (
          <p className="mt-3 rounded border border-neutral-400 p-2" data-hand-hold>
            <strong>On hold.</strong> A reversal was made by hand at Stripe on this transfer, and the app does not know what it was for. It takes nothing more from this transfer until each such reversal is accounted for below.
          </p>
        )}
        {asFounder && byHand === null && <p className="mt-3 opacity-80">Stripe could not be asked just now whether a reversal was made by hand on this transfer. Reload the page to ask again.</p>}
        {asFounder && byHand !== null && byHand.length > 0 && (
          <div className="mt-4" data-hand-reversals>
            <p className="font-medium">Reversals made by hand at Stripe on this transfer</p>
            <p className="mt-1 opacity-80">
              {reserved
                ? "Say for each what it was for. One that paid this take-back is counted for it, up to what is still owed, and only the rest stays owed. A part of a reversal that is left over stays here until you have said what that part was for; the app takes nothing from this transfer meanwhile."
                : "This take-back has ended. If a reversal below, or a part of it, was taken for it all the same, that money is owed back to the host: say so, and the host is told."}
            </p>
            <ul className="mt-2 space-y-3">
              {byHand.map((one) => (
                <li key={one.id} data-hand-reversal={one.id}>
                  {formatMoney(one.openCents)}
                  {one.openCents < one.amountCents ? ` (what is left of a reversal of ${formatMoney(one.amountCents)})` : ""}, made <LocalTime iso={one.at.toISOString()} />
                  <form action={countReversalAction} className="flex flex-wrap items-end gap-2 pt-1">
                    <input type="hidden" name="debt" value={debt.id} />
                    <input type="hidden" name="reversal" value={one.id} />
                    {/* What was open of it when this form was shown: a form sent twice is counted once. */}
                    <input type="hidden" name="open" value={one.openCents} />
                    {view}
                    <label className="block">
                      The part of it, in dollars
                      {/* What fits: all that is open of the reversal; for a take-back that is still open, no more than it still owes. */}
                      <input type="text" name="part" inputMode="decimal" required pattern="\d{1,7}(\.\d{1,2})?" defaultValue={((reserved ? Math.min(one.openCents, debt.amountCents) : one.openCents) / 100).toFixed(2)} className="mt-1 block w-28 rounded border border-neutral-400 p-2" />
                    </label>
                    <button type="submit" name="for" value={reserved ? "paid" : "twice"} className={button}>
                      {reserved ? "It paid this take-back" : debt.status === "cancelled" ? "It was taken for this take-back, after it was called off" : "It was meant for this take-back: the host has paid twice"}
                    </button>
                    <button type="submit" name="for" value="other" className={button}>
                      It had nothing to do with a take-back
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        {asFounder && refund && debt.status === "objected" && (
          <form action={answerDebtAction} className="mt-4 max-w-md space-y-2" data-answer-objection>
            <input type="hidden" name="debt" value={debt.id} />
            {view}
            <label className="block">
              Your answer to the host, if it is taken after all. The host reads it as written. It is then taken no earlier than the first day, and no earlier than 3 days after this answer has arrived.
              <textarea name="answer" required minLength={10} maxLength={2000} rows={3} className={box} />
            </label>
            <button type="submit" className={button}>
              Answer, and take it after all
            </button>
          </form>
        )}
        {asFounder && refund && debt.status === "told" && (
          <form action={holdDebtAction} className="mt-4 max-w-md space-y-2" data-hold-take-back>
            <input type="hidden" name="debt" value={debt.id} />
            {view}
            <label className="block">
              The host objected by email? Note what they said. Nothing is taken until you have decided. (Also hold it here BEFORE you reverse anything by hand at Stripe for this take-back: otherwise the app and you can take the same money in the same minute.)
              <input type="text" name="note" maxLength={2000} className={box} />
            </label>
            <button type="submit" className={button}>
              Hold it: the host objected
            </button>
          </form>
        )}
        {asFounder && refund && waitingForDay && debt.noticeProblemToldAt && (
          <form action={sendAgainDebtAction} className="mt-4" data-send-again>
            <input type="hidden" name="debt" value={debt.id} />
            {view}
            <button type="submit" className={button}>
              Send it again
            </button>
          </form>
        )}
        {asFounder && reserved && (
          <>
            <form action={settleDebtAction} className="mt-4 max-w-md space-y-2" data-settle>
              <input type="hidden" name="debt" value={debt.id} />
            {view}
              <p className="font-medium">Settled outside the app</p>
              <label className="block">
                What the host paid back to Connect outside Stripe, in dollars (0 if nothing). The rest is carried by Connect. Do not enter a reversal you made by hand in Stripe here: it is listed above on this page, to be counted on its own.
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
            {view}
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
