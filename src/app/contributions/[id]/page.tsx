import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { contributionFor, secretToPay, tooLateForItsMonth } from "@/lib/contributions/start";
import { endedWords, paymentRows, stateOf, type PaymentRow } from "@/lib/contributions/views";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { stripePublishableKey } from "@/lib/payments/stripe";
import { requireUser } from "@/lib/session";
import { cancelPaymentAction, payNowAction, stopContributionAction } from "../actions";
import { ContributionCardForm, PaymentCheck } from "./card-form";

export const metadata: Metadata = { title: "Your contribution" };

export const dynamic = "force-dynamic";

const smallButton = "rounded border border-neutral-500 px-3 py-1.5 text-sm";

/**
 * One contribution, for its contributor only (plans/25, "The pages"): the card step, and after
 * that each payment with where it stands and its real last moment, "Cancel, nothing is charged"
 * while it is held, "Pay now" when the bank wants a confirmation or a payment failed, and "Stop
 * contributing". Opening or reloading it starts nothing new: no contribution, no payment and no
 * PaymentIntent. The card form is shown for the payment that already exists at Stripe, once a
 * pressed button has made it ready. What the page does do when it is opened, through its small
 * "check" part, is ask what became of a payment that already exists, and record the answer.
 *
 * Nothing is claimed before it is known: "nothing was charged" is said only once the hold is
 * certainly gone. Until then: "We are cancelling this payment."
 *
 * A tip after a call (plans/44) lives on this page too, in a tip's words: it is a contribution of
 * kind "tip", with a call and no project, and its one payment moves as one made once does.
 */
export default async function ContributionPage(props: PageProps<"/contributions/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/contributions/${id}`);
  const found = await contributionFor(user.id, id);
  if (!found) notFound();
  const { contribution, project } = found;
  const here = `/contributions/${contribution.id}`;
  const notice = readNotice(here, await props.searchParams);
  const now = new Date();
  const rows = await paymentRows(contribution.id);
  const [profile] = await db.select({ displayName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, contribution.hostId));
  const hostName = profile?.displayName ?? "the host";
  const monthly = contribution.kind === "monthly";
  const tip = contribution.kind === "tip";
  const tipCents = contribution.tipCents ?? contribution.amountCents;
  const projectName = project?.name ?? "the project";

  // The one payment that waits for this person's card, if any: at the card step, after a failure, or for the bank's confirmation.
  const waiting = rows.map((row) => row.payment).find((payment) => payment.status === "to_pay" && !payment.endedHow && !payment.problem) ?? null;
  // (A month nobody has tried to pay is missed 7 days after its day: it can no longer be paid then. The same question the payment functions ask.)
  const missed = waiting ? await tooLateForItsMonth({ payment: waiting, kind: contribution.kind, firstHoldAt: contribution.firstHoldAt }, now) : false;
  const inTime = waiting && !(waiting.cardStepExpiresAt && waiting.cardStepExpiresAt <= now) && !(waiting.giveUpAt && waiting.giveUpAt <= now) && !missed ? waiting : null;
  // Read only: the secret of the payment this payment already has at Stripe. If Stripe cannot be reached the page still opens and says so.
  const read = inTime ? await secretToPay({ paymentId: inTime.id, contributorId: user.id, now }).then((secret) => ({ secret, reached: true }), () => ({ secret: null, reached: false })) : { secret: null, reached: true };

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/account" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Your account
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">{tip ? `Your tip for ${hostName}` : `Your contribution to ${projectName}`}</h1>
      {tip ? (
        <p className="mt-1 text-sm" data-tip-lead>
          {formatMoney(contribution.amountCents)}, once: a tip of {formatMoney(tipCents)} for{" "}
          {contribution.callId ? (
            <Link href={`/calls/${contribution.callId}/results`} className="underline underline-offset-2">
              your call with {hostName}
            </Link>
          ) : (
            `your call with ${hostName}`
          )}
          , and a payment fee of {formatMoney(contribution.amountCents - tipCents)}. All of a tip is meant for the host; Connect keeps nothing of it. It is a thank-you; it does not buy a call or any promised reward.
        </p>
      ) : (
        <p className="mt-1 text-sm">
          {formatMoney(contribution.amountCents)}
          {monthly ? " every month" : ", once"}, to{" "}
          {profile ? (
            <Link href={`/h/${profile.handle}/project`} className="underline underline-offset-2">
              {hostName}&apos;s project
            </Link>
          ) : (
            `${hostName}'s project`
          )}
          . It supports the project; it does not buy a call or any promised reward.
        </p>
      )}

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {contribution.status === "ended" && (
        <p className="mt-4 rounded border border-neutral-400 p-3 text-sm" data-ended>
          {monthly ? "This monthly contribution has ended." : contribution.endedHow === "paid" ? `This ${tip ? "tip" : "contribution"} is complete.` : `This ${tip ? "tip" : "contribution"} has ended.`} {endedWords(contribution.endedHow)}
          {monthly && " No further month is held or taken."}
        </p>
      )}

      {waiting && (
        <section className="mt-6 text-sm" data-pay>
          <h2 className="text-lg font-semibold">{waiting.number === 1 ? "The card step" : waiting.needsAction ? "Your bank wants you to confirm this month's payment" : waiting.firstFailedAt ? "This month's payment did not go through" : "This month's payment"}</h2>
          {!inTime ? (
            <>
              {/* A hold placed in time, whose way back arrived late, still counts: nothing is claimed before the bank was asked. */}
              <p className="mt-2">The time to pay is over. We are checking with the bank what became of your payment. If your card was held in time, this page shows it in a moment. If not, nothing is charged.</p>
              <PaymentCheck contributionId={contribution.id} paymentId={waiting.id} />
            </>
          ) : (
            <>
              <p className="mt-2">
                <strong>{formatMoney(waiting.amountCents)}</strong> is first only held on your card, and taken three days later (sooner if your bank makes the hold shorter; this page then shows the exact moment). Until it is taken you can cancel it and pay nothing.
                {monthly && " The card you use here is kept for the monthly payment."}
              </p>
              {waiting.cardStepExpiresAt && (
                <p className="mt-2 opacity-80">
                  You can pay until <LocalTime iso={waiting.cardStepExpiresAt.toISOString()} />. After that nothing is charged and this {tip ? "tip" : "contribution"} is undone.
                </p>
              )}
              {waiting.giveUpAt && (
                <p className="mt-2 opacity-80">
                  You can pay until <LocalTime iso={waiting.giveUpAt.toISOString()} />. After that your monthly contribution is stopped, and nothing is owed.
                </p>
              )}
              {read.secret ? (
                <ContributionCardForm contributionId={contribution.id} paymentId={waiting.id} clientSecret={read.secret.clientSecret} publishableKey={stripePublishableKey()} button={`Hold ${formatMoney(waiting.amountCents)}`} />
              ) : !read.reached ? (
                <p role="alert" className="mt-4 rounded border border-red-600 p-3">
                  We could not reach the payment service just now, so the card form cannot be shown. Please reload this page in a moment.
                </p>
              ) : (
                <>
                  <form action={payNowAction} className="mt-4">
                    <input type="hidden" name="contribution" value={contribution.id} />
                    {/* The payment this page shows: only that one is made ready. */}
                    <input type="hidden" name="payment" value={waiting.id} />
                    <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                      {waiting.number === 1 ? "Continue to the card step" : "Pay now"}
                    </button>
                    <span className="ml-2 opacity-70">The next step asks for your card.</span>
                  </form>
                  <PaymentCheck contributionId={contribution.id} paymentId={waiting.id} />
                </>
              )}
              <form action={cancelPaymentAction} className="mt-4">
                <input type="hidden" name="contribution" value={contribution.id} />
                <input type="hidden" name="payment" value={waiting.id} />
                <button type="submit" className={smallButton}>
                  {waiting.number === 1 ? "Cancel, nothing is charged" : "Skip this month"}
                </button>
              </form>
            </>
          )}
        </section>
      )}

      <section className="mt-8 text-sm" data-payments>
        <h2 className="text-lg font-semibold">{monthly ? "Its payments" : "Its payment"}</h2>
        <ul className="mt-3 space-y-3">
          {[...rows].reverse().map((row) => (
            <PaymentLine key={row.payment.id} row={row} contributionId={contribution.id} monthly={monthly} hostName={hostName} />
          ))}
        </ul>
      </section>

      {monthly && contribution.status !== "ended" && (
        <section className="mt-8 text-sm" data-stop>
          <h2 className="text-lg font-semibold">Stop contributing</h2>
          <p className="mt-2">Stopping takes effect at once: no further month is held or taken, and a payment that is only held is let go. Money that was already taken is not returned by stopping.</p>
          <form action={stopContributionAction} className="mt-3">
            <input type="hidden" name="contribution" value={contribution.id} />
            <label className="flex items-start gap-2">
              <input type="checkbox" name="sure" className="mt-1" />
              <span>Yes, stop my monthly contribution.</span>
            </label>
            <button type="submit" className={`${smallButton} mt-3`}>
              Stop contributing
            </button>
          </form>
        </section>
      )}
    </SitePage>
  );
}

function PaymentLine({ row, contributionId, monthly, hostName }: { row: PaymentRow; contributionId: string; monthly: boolean; hostName: string }) {
  const { payment } = row;
  const state = stateOf(payment);
  return (
    <li className="rounded border border-neutral-300 p-3" data-payment={state}>
      <p className="font-medium">
        {formatMoney(payment.amountCents)}
        {monthly ? `, month ${payment.number}` : ""}
      </p>
      {state === "held" && payment.takeAt && (
        <>
          <p className="mt-1">
            Held on your card. The money is taken on <LocalTime iso={payment.takeAt.toISOString()} />. Until then you can cancel this payment, and nothing is charged.
          </p>
          <form action={cancelPaymentAction} className="mt-2">
            <input type="hidden" name="contribution" value={contributionId} />
            <input type="hidden" name="payment" value={payment.id} />
            <button type="submit" className={smallButton}>
              Cancel, nothing is charged
            </button>
            {monthly && <span className="ml-2 opacity-70">This skips this month only. Your contribution goes on.</span>}
          </form>
        </>
      )}
      {state === "to_pay" && <p className="mt-1">Waiting for your card.</p>}
      {state === "failed" && <p className="mt-1">This payment did not go through. Nothing has been charged. You can pay above.</p>}
      {state === "confirm" && <p className="mt-1">Your bank wants you to confirm this payment. Nothing has been charged. You can do that above.</p>}
      {state === "cancelling" && (
        <>
          <p className="mt-1">We are cancelling this payment. This page says so once that is done.</p>
          <PaymentCheck contributionId={contributionId} paymentId={payment.id} />
        </>
      )}
      {state === "cancelled" && <p className="mt-1">{payment.authorisedAt ? "Cancelled. The hold was let go, and nothing was charged." : "Cancelled. Nothing was charged."}</p>}
      {state === "problem" && <p className="mt-1">Something about this payment needs a look by Connect. Nothing more happens to it until then.</p>}
      {state === "taken" && payment.takenAt && (
        <>
          <p className="mt-1">
            {formatMoney(payment.takenCents ?? payment.amountCents)} was taken on <LocalTime iso={payment.takenAt.toISOString()} />.
          </p>
          {payment.refundedCents > 0 && <p className="mt-1">{formatMoney(payment.refundedCents)} of it was paid back to your card.</p>}
          {row.refundUnderWayCents > 0 && <p className="mt-1">{formatMoney(row.refundUnderWayCents)} is on its way back to your card.</p>}
          {/* (Not while its charge is disputed at the bank: nothing can be given back from it then.) */}
          {payment.refundedCents === 0 && row.refundUnderWayCents === 0 && payment.dispute !== "open" && payment.dispute !== "lost" && <p className="mt-1 opacity-70">Giving it back is {hostName}&apos;s decision.</p>}
        </>
      )}
    </li>
  );
}
