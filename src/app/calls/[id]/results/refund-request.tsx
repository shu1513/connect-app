import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import type { Call } from "@/db/schema";
import { formatDuration } from "@/lib/format";
import { formatMoney } from "@/lib/payments/access";
import { ENDED_WORDS, type GradeTimes, type PersonQuality, type QualitySummary } from "@/lib/quality/summary";
import { askBy, loadSummary, MESSAGE_MAX, NOTE_MAX, type RequestView } from "@/lib/refunds/requests";
import { recordVisibleTo } from "@/lib/refunds/rules";
import { answerRequestAction, askRefundAction, closeRequestAction, declineRequestAction } from "../actions";

type Names = { host: string; customer: string };

const field = "mt-1 block w-full rounded border border-neutral-400 bg-transparent px-3 py-1.5";
const button = "rounded bg-blue-600 px-4 py-2 font-medium text-white";
const REASON_WORDS: Record<string, string> = { connection: "The connection was bad.", other: "Something else." };

function Grades({ label, times }: { label: string; times: GradeTimes }) {
  const cell = (seconds: number) => (seconds > 0 ? formatDuration(seconds) : "—");
  return (
    <tr className="border-b border-neutral-300/30">
      <th scope="row" className="py-1 pr-3 text-left font-normal">
        {label}
      </th>
      <td className="py-1 pr-3 tabular-nums">{cell(times.excellent)}</td>
      <td className="py-1 pr-3 tabular-nums">{cell(times.good)}</td>
      <td className="py-1 pr-3 tabular-nums">{cell(times.poor)}</td>
      <td className="py-1 pr-3 tabular-nums">{cell(times.lost)}</td>
      <td className="py-1 tabular-nums">{cell(times.unknown)}</td>
    </tr>
  );
}

function Person({ name, other, quality }: { name: string; other: string; quality: PersonQuality }) {
  return (
    <div className="mt-3">
      <p className="font-medium">{name}</p>
      {quality.connections.length === 0 ? (
        <p className="opacity-80">The video service recorded no connection inside the call&apos;s time.</p>
      ) : (
        <ul className="mt-1 list-disc pl-5">
          {quality.connections.map((c) => (
            <li key={c.from}>
              Connected from <LocalTime iso={c.from} seconds />
              {c.until ? (
                <>
                  {" "}
                  until <LocalTime iso={c.until} seconds />.
                </>
              ) : (
                ". The video service sent no message that this connection ended."
              )}
              {c.ended ? ` ${ENDED_WORDS[c.ended]}` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="text-left">
          <thead>
            <tr className="border-b border-neutral-400">
              <th className="py-1 pr-3 font-medium">About how long at each grade</th>
              <th className="py-1 pr-3 font-medium">Excellent</th>
              <th className="py-1 pr-3 font-medium">Good</th>
              <th className="py-1 pr-3 font-medium">Poor</th>
              <th className="py-1 pr-3 font-medium">Lost</th>
              <th className="py-1 font-medium">Unknown</th>
            </tr>
          </thead>
          <tbody>
            <Grades label={`As ${name}'s own browser reported it`} times={quality.ownBrowser} />
            <Grades label={`As ${other}'s browser reported it`} times={quality.otherBrowser} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The short summary of a call's quality record, always with the plain warning about what it is and is not. */
export function QualityRecord({ summary, names }: { summary: QualitySummary; names: Names }) {
  return (
    <div className="mt-3 rounded border border-neutral-400/60 p-3" data-quality-record>
      <p className="font-medium">The call&apos;s connection record</p>
      <p className="mt-1 opacity-80">
        These are approximate periods put together from what each browser reported, and from the video service&apos;s own messages. Missing reports
        do not show that a connection worked, and nothing here shows whose fault a problem was or what was said or seen on the call.
      </p>
      {!summary.anyNotes && <p className="mt-2 font-medium">No connection reports; quality unknown.</p>}
      <Person name={`${names.host} (host)`} other={names.customer} quality={summary.host} />
      <Person name={`${names.customer} (customer)`} other={names.host} quality={summary.customer} />
    </div>
  );
}

const parseSummary = (text: string | null): QualitySummary | null => {
  try {
    return text ? (JSON.parse(text) as QualitySummary) : null;
  } catch {
    return null;
  }
};

/**
 * Everything about a refund request on the call's results page: the customer's
 * way to ask, where a request stands, and the host's (or the founder's) answer.
 *
 * Who may see the quality record is decided here, on the server: the customer
 * before asking, when they choose "the connection was bad"; after a request,
 * the customer and the host only if that is the saved reason; the founder for
 * any request. Nobody else, and nobody for a call without a request.
 */
export async function RefundRequest(props: {
  call: Call;
  role: "host" | "customer" | "admin";
  /** A full admin login, whatever the person's role on the call. */
  founder: boolean;
  view: RequestView | null;
  names: Names;
  /** "connection" or "other" while the customer is filling in the form. */
  asking: string | null;
  /** For each charge an answer can still change: its label and what the record gives now. */
  charges: Array<{ paymentId: string; label: string; recordCents: number | null; bookedCents: number }>;
}) {
  const { call, role, view, names } = props;
  const now = new Date();
  const page = `/calls/${call.id}/results`;

  // ---- No request yet: only the customer sees anything, and only while they can ask.
  if (!view) {
    if (role !== "customer") return null;
    const until = await askBy(call, now);
    if (!until || now >= until) return null;
    const mayLook = recordVisibleTo({ role, founder: props.founder, requestReason: null, canStillAsk: true });
    const record = props.asking === "connection" && mayLook ? await loadSummary(call) : null;
    return (
      <section id="refund" className="mt-6 scroll-mt-4 rounded border border-neutral-400 p-4 text-sm">
        <h2 className="text-lg font-semibold">Ask for a refund</h2>
        <p className="mt-1 opacity-80">
          If something went wrong on this call, you can ask {names.host} for a refund until <LocalTime iso={until.toISOString()} />. {names.host}{" "}
          decides. One request per call.
        </p>
        {props.asking !== "connection" && props.asking !== "other" && (
          <p className="mt-3 flex flex-wrap gap-4">
            <Link href={`${page}?ask=connection#refund`} className="underline underline-offset-2">
              The connection was bad
            </Link>
            <Link href={`${page}?ask=other#refund`} className="underline underline-offset-2">
              Something else
            </Link>
          </p>
        )}
        {record && (
          <>
            <p className="mt-3">
              This is the record of the connection on this call. {names.host} will see the same record with your request. Look at it first; then
              send your request if you still want to.
            </p>
            <QualityRecord summary={record.summary} names={names} />
          </>
        )}
        {(props.asking === "connection" || props.asking === "other") && (
          <form action={askRefundAction} className="mt-3 max-w-xl">
            <input type="hidden" name="callId" value={call.id} />
            <input type="hidden" name="reason" value={props.asking} />
            {record && <input type="hidden" name="seen" value={record.seen} />}
            <label className="block">
              {props.asking === "other" ? "What went wrong? (one or two sentences)" : "What went wrong? (optional, one or two sentences)"}
              <textarea name="note" rows={2} maxLength={NOTE_MAX} required={props.asking === "other"} className={field} />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <button type="submit" className={button}>
                Send request
              </button>
              <Link href={page} className="underline underline-offset-2">
                Do not ask
              </Link>
            </div>
          </form>
        )}
      </section>
    );
  }

  // ---- A request exists.
  const { request } = view;
  const deciding = role === "host" || props.founder;
  const mayOpenRecord = recordVisibleTo({ role, founder: props.founder, requestReason: request.reason, canStillAsk: false });
  const saved = mayOpenRecord ? parseSummary(request.summary) : null;
  const decidedBy = request.decidedAs === "admin" ? "Connect" : names.host;
  const answerOf = (paymentId: string) => view.answers.find((a) => a.paymentId === paymentId);

  return (
    <section id="refund" className="mt-6 scroll-mt-4 rounded border border-neutral-400 p-4 text-sm" data-refund-request={request.status}>
      <h2 className="text-lg font-semibold">Refund request</h2>
      <p className="mt-1">
        {role === "customer" ? "You" : names.customer} asked for a refund on <LocalTime iso={request.askedAt.toISOString()} />. Reason:{" "}
        {REASON_WORDS[request.reason] ?? request.reason}
      </p>
      {request.note && <p className="mt-1">&quot;{request.note}&quot;</p>}

      {request.status === "answered" && (
        <div className="mt-3">
          <p className="font-medium">
            {decidedBy} answered on <LocalTime iso={request.decidedAt!.toISOString()} />:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {view.answers.map((a, index) => (
              <li key={a.paymentId}>
                {view.answers.length > 1 ? `Charge ${index + 1}: ` : ""}
                {a.choice === "nothing" ? "charge nothing" : a.choice === "less" ? `charge at most ${formatMoney(a.maxCents ?? 0)}` : "the charge stays as the call's record gives it"}
              </li>
            ))}
          </ul>
          <p className="mt-1 opacity-80">The exact amounts are in the payment below. While it still says &quot;held&quot;, the answer is being applied.</p>
        </div>
      )}
      {request.status === "declined" && (
        <p className="mt-3 font-medium">
          {decidedBy} answered on <LocalTime iso={request.decidedAt!.toISOString()} />: no refund.
        </p>
      )}
      {request.status === "closed" && (
        <p className="mt-3 font-medium">
          Connect closed this request on <LocalTime iso={request.decidedAt!.toISOString()} />.
        </p>
      )}
      {request.message && (
        <p className="mt-1">
          Message from {decidedBy}: &quot;{request.message}&quot;
        </p>
      )}
      {request.status === "asked" && view.answered && <p className="mt-3 font-medium">Answered with a refund. It is listed in the payment below.</p>}
      {request.status === "asked" && !view.answered && view.nothingAtStake && (
        <p className="mt-3 font-medium">Nothing was charged for this call, so there is nothing to refund. The payment below says why.</p>
      )}

      {request.status === "asked" && !view.answered && !view.nothingAtStake && role === "customer" && (
        <p className="mt-3 opacity-80">
          Waiting for {names.host}&apos;s answer.
          {view.answerBy ? (
            <>
              {" "}
              Nothing is taken from your card before <LocalTime iso={view.answerBy.toISOString()} /> unless {names.host} answers sooner. If there is no
              answer by then, the charge is taken in full; {names.host} can still refund you afterwards.
            </>
          ) : (
            " The money for this call has been taken; a refund is still possible."
          )}
        </p>
      )}

      {saved && <QualityRecord summary={saved} names={names} />}
      {mayOpenRecord && !saved && <p className="mt-3 opacity-70">The connection record saved with this request is no longer kept.</p>}

      {request.status === "asked" && !view.answered && !view.nothingAtStake && deciding && (
        <div className="mt-4 border-t border-neutral-400/40 pt-4">
          {role !== "host" && <p className="mb-2 font-medium">You are answering as Connect, in the host&apos;s place.</p>}
          {view.open.length > 0 ? (
            <form action={answerRequestAction} className="max-w-xl">
              <input type="hidden" name="callId" value={call.id} />
              <p>
                The money has not been taken yet.
                {view.answerBy && (
                  <>
                    {" "}
                    An answer before <LocalTime iso={view.answerBy.toISOString()} /> costs nothing: charging less or nothing loses no card fee. After
                    that the full amount is taken, and a refund is still possible.
                  </>
                )}{" "}
                {role === "host" ? "You cannot collect the money for this call until you have answered." : ""}
              </p>
              {props.charges.map((charge) => (
                <fieldset key={charge.paymentId} className="mt-3">
                  <legend className="font-medium">
                    {charge.label}
                    {charge.recordCents !== null ? `: ${formatMoney(charge.recordCents)} by the call's record` : " (the record is not final yet)"}
                  </legend>
                  <label className="mt-1 flex items-center gap-2">
                    <input type="radio" name={`choice:${charge.paymentId}`} value="full" required defaultChecked={answerOf(charge.paymentId)?.choice === "full"} /> Charge in full
                  </label>
                  <label className="mt-1 flex flex-wrap items-center gap-2">
                    <input type="radio" name={`choice:${charge.paymentId}`} value="less" /> Charge less: at most
                    <input name={`max:${charge.paymentId}`} type="number" min={0.5} max={(charge.bookedCents - 1) / 100} step="0.01" aria-label="The most to charge, in US dollars" className="w-28 rounded border border-neutral-400 bg-transparent px-2 py-1" />
                    US dollars (50 cents or more)
                  </label>
                  <label className="mt-1 flex items-center gap-2">
                    <input type="radio" name={`choice:${charge.paymentId}`} value="nothing" /> Charge nothing
                  </label>
                </fieldset>
              ))}
              <label className="mt-3 block">
                Message to the customer (optional)
                <textarea name="message" rows={2} maxLength={MESSAGE_MAX} className={field} />
              </label>
              <button type="submit" className={`mt-3 ${button}`}>
                Send answer
              </button>
              <p className="mt-2 opacity-70">An answer cannot be changed afterwards. &quot;In full&quot; is what the call&apos;s record gives when the money is taken.</p>
            </form>
          ) : (
            <form action={declineRequestAction} className="max-w-xl">
              <input type="hidden" name="callId" value={call.id} />
              <p>
                The money for this call has been taken. To answer, give a refund with the form in the payment below (all or part), or say no here.
                {role === "host" ? " You cannot collect the money for this call until you have answered." : ""}
              </p>
              <label className="mt-3 block">
                Message to the customer (optional)
                <textarea name="message" rows={2} maxLength={MESSAGE_MAX} className={field} />
              </label>
              <button type="submit" className="mt-3 rounded border border-neutral-500 px-3 py-1.5">
                No refund
              </button>
            </form>
          )}
          {props.founder && (
            <form action={closeRequestAction} className="mt-4">
              <input type="hidden" name="callId" value={call.id} />
              <button type="submit" className="underline underline-offset-2">
                Close this request without an answer (the host&apos;s payment can then go ahead)
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
