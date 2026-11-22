import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { db, schema } from "@/db";
import type { Dispute } from "@/db/schema";
import { disputeForViewer } from "@/lib/disputes/pages";
import { aboutOwner, ownerOf } from "@/lib/disputes/record";
import { canChoose, planFor, stopsPaying } from "@/lib/disputes/rules";
import { debtsOfDispute } from "@/lib/disputes/takeback";
import { paidBackCents } from "@/lib/disputes/takeback-rules";
import { isAppeal, reasonWords, standingOf } from "@/lib/disputes/status";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { getSignedIn, isAdminSession, requireUser } from "@/lib/session";
import { SUPPORT_EMAIL } from "@/lib/terms";
import { allowPayingAction, answerObjectionAction, cancelDebtAction, chooseAction, holdDebtAction, objectAction, sendAgainAction } from "./actions";

// The same title whoever asks: nothing is given away before it is known who may see the page.
export const metadata: Metadata = { title: "A bank dispute" };

export const dynamic = "force-dynamic";

/** What became of the answer to the bank, in a sentence. Null while nothing has been sent or decided. */
function AnswerLine({ dispute, asHost }: { dispute: Dispute; asHost: boolean }) {
  const who = asHost ? "Connect" : "The app";
  const when = dispute.answeredAt ? (
    <>
      {" "}
      on <LocalTime iso={dispute.answeredAt.toISOString()} />
    </>
  ) : null;
  if (dispute.answer === "proof") return <p data-answer="proof">{who} sent the bank its record of this payment{when}.</p>;
  if (dispute.answer === "given_in") return <p data-answer="given_in">{who} told the bank that it does not contest this dispute{when}.</p>;
  if (dispute.answer === "sending") return <p data-answer="sending">{who} is sending its answer to the bank now.</p>;
  if (dispute.answer === "not_ours") return <p data-answer="not_ours">{asHost ? "Connect's own answer was not sent: the bank stopped waiting before it was due." : "The app sent nothing: the dispute stopped waiting for an answer before one was due (it was answered in Stripe, or the bank's time ran out)."}</p>;
  if (dispute.answer === "unknown") return <p data-answer="unknown">{asHost ? "The bank has an answer or stopped waiting; whether it was Connect's own could not be confirmed." : "A request of the app was written down and never confirmed, and the dispute stopped waiting: it is not known who answered."}</p>;
  return null;
}

/**
 * One bank dispute, for the host whose money it is about and for the founder (plans/47): what is
 * disputed, why, where it stands, the host's choice, and what the app sent to the bank. Someone
 * else's dispute and one that does not exist are both "not found". The customer has no page here:
 * they are told in their messages, and read about the payment on the page of what they paid for.
 */
export default async function DisputePage(props: PageProps<"/disputes/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/disputes/${id}`);
  const founder = await isAdminSession(await getSignedIn());
  const dispute = await disputeForViewer(id, user, founder);
  if (!dispute) notFound();
  const asHost = dispute.hostId === user.id;
  const notice = readNotice(`/disputes/${dispute.id}`, await props.searchParams);
  const now = new Date();

  const about = await aboutOwner(db, ownerOf(dispute));
  const [customer] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, dispute.customerId));
  const [host] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, dispute.hostId));
  const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, dispute.hostId));
  const names = { host: profile?.displayName ?? host?.name ?? "the host", customer: customer?.name ?? "the customer" };
  const what = about ? about.what(asHost ? "host" : "founder", user, names) : "a payment";
  const question = dispute.stage === "question";
  const standing = standingOf(dispute.status);
  const plan = planFor(dispute);
  const mayChoose = asHost && canChoose(dispute, now);
  // What is taken back from the host after a loss, if they had collected their share (plans/47, part 3).
  const takeBacks = await debtsOfDispute(dispute.id);
  const button = "rounded border border-neutral-500 px-4 py-2 text-sm font-medium";
  // What only the founder sees and can do. Shown beside the host's own view when the founder is this dispute's host.
  const founderTools = (
    <>
      {stopsPaying(dispute) === "lost" && (
        <form action={allowPayingAction} className="mt-4 rounded border border-neutral-400 p-4" data-allow-paying>
          <input type="hidden" name="dispute" value={dispute.id} />
          <p>
            {names.customer} cannot start new bookings or payments: the bank decided for them after the app had sent its record of this payment. That stays so until you allow
            it again.
          </p>
          <button type="submit" className={`${button} mt-3`}>
            Allow paying again
          </button>
        </form>
      )}
      {stopsPaying(dispute) === "open" && <p className="mt-2">While this dispute is open, {names.customer} cannot start new bookings or payments. That ends by itself when the dispute does, unless it is lost after the app&apos;s own proof.</p>}
      {dispute.answer === "proof" && dispute.proof && (
        <details className="mt-4" data-proof>
          <summary className="cursor-pointer font-medium">What was sent to the bank</summary>
          <dl className="mt-2 space-y-2">
            {Object.entries(JSON.parse(dispute.proof) as Record<string, unknown>)
              .filter(([, value]) => typeof value === "string" && value.length > 0)
              .map(([field, value]) => (
                <div key={field}>
                  <dt className="opacity-70">{field.replace(/_/g, " ")}</dt>
                  <dd className="whitespace-pre-line">{String(value)}</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      <p className="mt-3 opacity-70" data-stripe-id>
        At Stripe: {dispute.id}
        {dispute.compliance ? ". This is a compliance dispute: fighting it costs 500 dollars." : ""}
      </p>
    </>
  );

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-sm">
        <Link href={asHost ? "/host" : "/admin"} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {asHost ? "Hosting" : "Admin"}
        </Link>
      </p>
      <h1 className={warm.title}>{question ? "A bank's question about a payment" : "A bank dispute"}</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <div className="mt-6 rounded border border-neutral-400 p-4 text-sm" data-dispute={dispute.id} data-stage={dispute.stage} data-standing={standing}>
        <p>
          {question ? `${names.customer}'s bank has asked about ` : `${names.customer}'s bank has opened a dispute over `}
          {what}.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="opacity-70">Amount</dt>
          <dd data-amount>{formatMoney(dispute.amountCents)}</dd>
          <dt className="opacity-70">The bank&apos;s reason</dt>
          <dd>{reasonWords(dispute.reason)}</dd>
          <dt className="opacity-70">Opened</dt>
          <dd>
            <LocalTime iso={dispute.openedAt.toISOString()} />
          </dd>
          <dt className="opacity-70">Where it stands</dt>
          <dd data-where>
            {standing === "waiting" && !dispute.noAnswer && (question ? "The bank is waiting for an answer to its question." : "The bank is waiting for an answer.")}
            {standing === "waiting" && dispute.noAnswer && "The bank is deciding by itself. It takes no answer to this one."}
            {standing === "with_bank" && !isAppeal(dispute.status) && "The bank is deciding. That can take up to three months."}
            {standing === "with_bank" && isAppeal(dispute.status) && "The bank is looking at it once more (an appeal)."}
            {standing === "won" && "It has ended: the payment stands."}
            {standing === "lost" && "It has ended: the bank decided for the customer."}
            {standing === "closed" && (question ? "The bank closed its question. It did not become a dispute." : "It was closed without a decision by the bank.")}
          </dd>
          {founder && standing === "waiting" && (
            <>
              <dt className="opacity-70">The bank&apos;s deadline</dt>
              <dd data-due>{dispute.noAnswer ? "The bank takes no answer to this one." : dispute.dueBy ? <LocalTime iso={dispute.dueBy.toISOString()} /> : "Stripe gives no date."}</dd>
            </>
          )}
        </dl>
      </div>

      {mayChoose && (
        <div className="mt-6 rounded border border-neutral-400 p-4 text-sm" data-choose>
          <h2 className="text-base font-semibold">What should Connect do?</h2>
          <p className="mt-2">
            Choose by <LocalTime iso={dispute.askUntil!.toISOString()} />. If you do not choose by then, Connect fights it. Your first choice stands: it cannot be changed afterwards.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <form action={chooseAction}>
              <input type="hidden" name="dispute" value={dispute.id} />
              <input type="hidden" name="choice" value="fight" />
              <p className="font-medium">Fight it</p>
              <p className="mt-1 opacity-80">
                Connect sends the bank its record of this payment: what was paid for, and what the record shows of it. The bank then decides. If it decides for you, this
                dispute no longer holds the money for this payment back. If it decides for the customer, your share of it is no longer yours.
              </p>
              <button type="submit" className={`${button} mt-3`}>
                Fight it
              </button>
            </form>
            <form action={chooseAction}>
              <input type="hidden" name="dispute" value={dispute.id} />
              <input type="hidden" name="choice" value="give_back" />
              <p className="font-medium">Give the money back</p>
              <p className="mt-1 opacity-80">
                Connect tells the bank that it does not contest the dispute. This is not a refund from you: the bank has already taken the {formatMoney(dispute.amountCents)}, and
                it stays with the customer. Your share of it is no longer yours. If you had already collected it, Connect asks Stripe to take it back from
                your Stripe balance, after a message with the amount and 14 days.
              </p>
              <button type="submit" className={`${button} mt-3`}>
                Give the money back
              </button>
            </form>
          </div>
        </div>
      )}

      {dispute.stage === "chargeback" && (dispute.choice || dispute.answer !== "none") && (
        <div className="mt-6 space-y-2 text-sm" data-answered>
          {dispute.choice && (
            <p data-choice={dispute.choice} data-chosen-as={dispute.chosenAs ?? ""}>
              {dispute.chosenAs === "host"
                ? asHost
                  ? dispute.choice === "fight"
                    ? "You chose: fight it."
                    : "You chose: give the money back."
                  : dispute.choice === "fight"
                    ? "The host chose: fight it."
                    : "The host chose: give the money back."
                : asHost
                  ? "No choice was made in time (or there was no time to ask), so Connect fights it."
                  : "No choice was made by the host in time (or nobody was asked), which counts as \"fight\"."}
            </p>
          )}
          <AnswerLine dispute={dispute} asHost={asHost} />
        </div>
      )}
      {dispute.stage === "question" && dispute.answer !== "none" && (
        <div className="mt-6 space-y-2 text-sm" data-answered>
          <AnswerLine dispute={dispute} asHost={asHost} />
        </div>
      )}

      <div className="mt-6 text-sm" data-what-it-means>
        {asHost ? (
          <>
            {standing === "waiting" && plan === "leave" && !dispute.noAnswer && (
              <p>
                This is a dispute about the card network&apos;s own rules. Fighting one costs Connect 500 dollars each time, so Connect does not fight one of this size by itself.
              </p>
            )}
            {(standing === "waiting" || standing === "with_bank") && (
              <p className="mt-2">
                While this is open, the money for this payment cannot be collected. The bank decides how it ends, and we will tell you when it has. Please do not contact the
                customer about it.
              </p>
            )}
            {(standing === "won" || standing === "closed") && (
              <p>
                This dispute no longer holds the money for this payment back. Your{" "}
                <Link href="/host" className="underline underline-offset-2">
                  earnings
                </Link>{" "}
                show when it can be collected.
              </p>
            )}
            {standing === "lost" && (
              <p>
                Your share of the {formatMoney(dispute.amountCents)} the bank took back is no longer yours, and the money for this payment stays held back. If you had already
                collected it, Connect asks Stripe to take it back from your Stripe balance: you get a message with the amount first, and nothing is taken for 14 days after that.
              </p>
            )}
            <p className="mt-3 opacity-70">
              If you think something here is wrong, write to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
            {founder && (
              <div className="mt-6 border-t border-neutral-300 pt-4" data-founder-tools>
                <p className="font-medium">For you as the founder</p>
                {founderTools}
              </div>
            )}
          </>
        ) : (
          <>
            {standing === "waiting" && dispute.noAnswer && <p>The bank takes no answer to this one, so there is nothing to send. It decides by itself.</p>}
            {standing === "waiting" && !dispute.noAnswer && plan === "leave" && (
              <p data-plan="leave">
                This is a compliance dispute: fighting it costs 500 dollars, returned only on a win. It is under the amount from which the app fights these, so the app sends nothing.
                If you want to fight this one, do it in Stripe before the bank&apos;s deadline; otherwise it is lost when that date passes.
              </p>
            )}
            {standing === "waiting" && !dispute.noAnswer && plan === "answer" && dispute.answer === "none" && <p data-plan="answer">The app answers the bank&apos;s question by itself, with its record of this payment. Nothing is needed from you.</p>}
            {standing === "waiting" && !dispute.noAnswer && plan === "ask" && dispute.answer === "none" && (
              <p data-plan="ask">
                {dispute.choice ? (
                  "The app sends the answer to the bank now."
                ) : dispute.askUntil ? (
                  <>
                    The host can choose until <LocalTime iso={dispute.askUntil.toISOString()} />. Then the app answers the bank; with no choice it fights.
                  </>
                ) : (
                  "Nobody is asked: the app sends its record of this payment to the bank."
                )}{" "}
                Nothing is needed from you.
              </p>
            )}
            {dispute.answerError && standing === "waiting" && <p className="mt-2 text-amber-700" data-answer-error>The last try to answer did not go through: {dispute.answerError}</p>}
            {standing === "with_bank" && !isAppeal(dispute.status) && <p>Nothing can be sent to the bank now. The money for this payment stays where it is until the bank has decided.</p>}
            {standing === "with_bank" && isAppeal(dispute.status) && (
              <p>
                The app sends nothing to the bank in an appeal. If something has to be sent, that is done by hand in Stripe. The money for this payment stays where it is until the
                bank has decided.
              </p>
            )}
            {(standing === "won" || standing === "closed") && <p>This dispute no longer holds the money for this payment back.</p>}
            {standing === "lost" && (
              <p>
                The host&apos;s share of this payment stays held back. If the host had already collected it, the app tells them the amount and, 14 days later, asks Stripe to take it
                back out of the transfer. A take-back is listed below once there is one.
              </p>
            )}
            {founderTools}
          </>
        )}
      </div>

      {takeBacks.length > 0 && (
        <div className="mt-6 rounded border border-neutral-400 p-4 text-sm" data-take-backs>
          <h2 className="text-base font-semibold">{asHost ? "Money Connect takes back" : "Taken back from the host"}</h2>
          <p className="mt-2 opacity-80">
            {asHost
              ? "You had collected your share of this payment before the bank decided for the customer."
              : "The host had collected their share of this payment before the dispute was lost."}
          </p>
          <ul className="mt-3 space-y-3">
            {takeBacks.map((debt) => (
              <li key={debt.id} data-take-back={debt.status}>
                <p>
                  {/* What was first owed. Where a reversal made by hand has paid part of it, what is left is said after it. */}
                  <span className="font-medium">{formatMoney(debt.amountCents + debt.byHandCents)}</span>
                  {debt.byHandCents > 0 &&
                    (["told", "objected", "answered"].includes(debt.status)
                      ? ` (of which ${formatMoney(debt.byHandCents)} was already taken by a person at Connect, and ${formatMoney(debt.amountCents)} is still owed)`
                      : ` (of which ${formatMoney(debt.byHandCents)} was taken by a reversal a person at Connect made at Stripe)`)}
                  {(debt.status === "told" || debt.status === "answered") &&
                    (debt.dueAt ? (
                      <>
                        {asHost ? ": from " : debt.status === "answered" ? ": the objection was answered. From " : ": the host was told. From "}
                        <LocalTime iso={debt.dueAt.toISOString()} />
                        {asHost ? ", Connect asks Stripe to take it back from your Stripe balance. Until then nothing is taken." : " the app asks Stripe to take it back."}
                      </>
                    ) : debt.status === "answered" ? (
                      asHost ? (
                        ": we have answered your objection. Connect asks Stripe to take it back, not before 3 days after our answer was sent to you by email."
                      ) : (
                        ": the objection was answered. It gets its day once the answer's email has gone out (3 days after that, and not before the first day)."
                      )
                    ) : asHost ? (
                      ": Connect asks Stripe to take it back from your Stripe balance, not before 14 days after our email about it was sent to you. Until then nothing is taken."
                    ) : (
                      ": the host was told. It gets its day once the notice's email has gone out (14 days after that)."
                    ))}
                  {debt.status === "objected" && (asHost ? ": you told us this is wrong. Nothing is taken until we have answered you." : ": the host objected. Nothing is taken until you have decided.")}
                  {debt.status === "taking" && ": Stripe is being asked to take it back now."}
                  {debt.status === "taken" && debt.takenAt && (
                    <>
                      : taken back on <LocalTime iso={debt.takenAt.toISOString()} />.
                    </>
                  )}
                  {debt.status === "taken" && !debt.takenAt && ": taken back."}
                  {debt.status === "cancelled" && ": called off. Nothing is taken."}
                  {debt.status === "settled" &&
                    `: settled outside the app. ${formatMoney(debt.repaidCents ?? 0)} was paid back${debt.amountCents - (debt.repaidCents ?? 0) > 0 ? `, and Connect carries the remaining ${formatMoney(debt.amountCents - (debt.repaidCents ?? 0))}` : ""}. Nothing more is owed for it.`}
                </p>
                {debt.overpaidCents > 0 && (
                  <p className="mt-1 opacity-80" data-overpaid>
                    {asHost
                      ? `${formatMoney(debt.overpaidCents)} was taken from your Stripe balance on top of this. That money is yours: a person at Connect gives it back to you.`
                      : `${formatMoney(debt.overpaidCents)} was taken on top of this by a reversal made by hand at Stripe: send it back to the host.`}
                  </p>
                )}
                {debt.objection && (debt.status === "objected" || debt.status === "answered") && (
                  <p className="mt-1 whitespace-pre-wrap opacity-80" data-objection>
                    {asHost ? "What you wrote: " : "What the host wrote: "}
                    {debt.objection}
                  </p>
                )}
                {debt.answer && debt.status === "answered" && (
                  <p className="mt-1 whitespace-pre-wrap opacity-80" data-answer-to-objection>
                    {asHost ? "Our answer: " : "Your answer: "}
                    {debt.answer}
                  </p>
                )}
                {(debt.status === "told" || debt.status === "answered") && !debt.dueAt && debt.noticeProblemToldAt && (
                  <p className="mt-1 opacity-80" data-not-delivered>
                    {asHost
                      ? "We could not reach you by email about this, so nothing is taken for now. Please check the email address of your account, or write to us."
                      : "The email about this did not reach the host, or its delivery was never confirmed, so nothing is taken. Send it again (once the host's address works), or cancel the take-back."}
                  </p>
                )}
                {founder && (debt.status === "told" || debt.status === "answered") && !debt.dueAt && debt.noticeProblemToldAt && (
                  <form action={sendAgainAction} className="mt-2" data-send-again>
                    <input type="hidden" name="dispute" value={dispute.id} />
                    <input type="hidden" name="debt" value={debt.id} />
                    <button type="submit" className={button}>
                      Send it again
                    </button>
                  </form>
                )}
                {(debt.status === "told" || debt.status === "answered") && debt.dueAt && debt.dueAt <= now && debt.refusedAt && (
                  <p className="mt-1 opacity-80" data-refused>
                    {asHost ? "Stripe could not take it back yet. It is tried again once a day." : `Stripe refused the last try${debt.refusal ? `: ${debt.refusal}` : "."} The app tries again once a day.`}
                  </p>
                )}
                {debt.leftoverToldAt && paidBackCents(debt) > 0 && (
                  <p className="mt-1 opacity-80" data-leftover>
                    {/* The amount she really paid back, whichever way: never the row's own number, which can be nothing. */}
                    {asHost
                      ? `The bank has since let the payment stand. A person at Connect gives the ${formatMoney(paidBackCents(debt))} you paid back to you again.`
                      : `The bank has since decided the other way. The app does not give anything back by itself: send ${formatMoney(paidBackCents(debt))} to the host by hand.`}
                  </p>
                )}
                {asHost && debt.status === "told" && (
                  <form action={objectAction} className="mt-2 max-w-md space-y-2" data-object>
                    <input type="hidden" name="dispute" value={dispute.id} />
                    <input type="hidden" name="debt" value={debt.id} />
                    <label className="block">
                      If you think this is wrong, tell us why. Nothing is taken until a person at Connect has answered you.
                      <textarea name="objection" required minLength={10} maxLength={2000} rows={3} className="mt-1 block w-full rounded border border-neutral-400 p-2" />
                    </label>
                    <button type="submit" className={button}>
                      I think this is wrong
                    </button>
                  </form>
                )}
                {founder && debt.status === "objected" && (
                  <form action={answerObjectionAction} className="mt-2 max-w-md space-y-2" data-answer-objection>
                    <input type="hidden" name="dispute" value={dispute.id} />
                    <input type="hidden" name="debt" value={debt.id} />
                    <label className="block">
                      Your answer to the host, if it is taken after all. The host reads it as written. It is then taken no earlier than the first day, and no earlier than 3 days after this answer has gone out.
                      <textarea name="answer" required minLength={10} maxLength={2000} rows={3} className="mt-1 block w-full rounded border border-neutral-400 p-2" />
                    </label>
                    <button type="submit" className={button}>
                      Answer, and take it after all
                    </button>
                  </form>
                )}
                {founder && debt.status === "told" && (
                  <form action={holdDebtAction} className="mt-2 max-w-md space-y-2" data-hold-take-back>
                    <input type="hidden" name="dispute" value={dispute.id} />
                    <input type="hidden" name="debt" value={debt.id} />
                    <label className="block">
                      The host objected by email? Note what they said. Nothing is taken until you have decided.
                      <input type="text" name="note" maxLength={2000} className="mt-1 block w-full rounded border border-neutral-400 p-2" />
                    </label>
                    <button type="submit" className={button}>
                      Hold it: the host objected
                    </button>
                  </form>
                )}
                {founder && (debt.status === "told" || debt.status === "objected" || debt.status === "answered") && (
                  <form action={cancelDebtAction} className="mt-2" data-cancel-take-back>
                    <input type="hidden" name="dispute" value={dispute.id} />
                    <input type="hidden" name="debt" value={debt.id} />
                    <button type="submit" className={button}>
                      Cancel this take-back (Connect carries {formatMoney(debt.amountCents)})
                    </button>
                  </form>
                )}
                {founder && debt.status !== "taking" && (
                  <p className="mt-2 text-sm">
                    <Link href={`/debts/${debt.id}?as=founder`} className="underline underline-offset-2">
                      {debt.status === "told" || debt.status === "objected" || debt.status === "answered"
                        ? "The host paid it back outside the app, or you reversed it by hand at Stripe: record that"
                        : "A reversal made by hand at Stripe was for this one: account for it"}
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {asHost && takeBacks.some((debt) => debt.status === "answered") && (
            <p className="mt-3 opacity-70">
              If you still think this is wrong, write to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          )}
        </div>
      )}
    </SitePage>
  );
}
