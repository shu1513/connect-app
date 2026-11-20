import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { ContributionError } from "@/lib/contributions/rules";
import { callDay, chargeFor, readTip, refusal, TIP_WORDING_VERSION, tipSentences, whyNoTip } from "@/lib/contributions/tip-rules";
import { tipFacts } from "@/lib/contributions/tips";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { isId } from "@/lib/projects/projects";
import { requireUser } from "@/lib/session";
import { startTipAction } from "../actions";

export const metadata: Metadata = { title: "Give a tip" };

export const dynamic = "force-dynamic";

/**
 * The summary before paying a tip (plans/44, decision 8): what the person pays, that the host
 * gets the whole tip, and every sentence they must have read. Opening or reloading this page
 * writes nothing: it only makes the id of a request. The tip is written when the form is sent.
 *
 * The address names the call and the tip as the person picked or typed it on the call's results.
 */
export default async function NewTipPage(props: PageProps<"/tips/new">) {
  const query = await props.searchParams;
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value.slice(0, 20) : "");
  const callId = typeof query.call === "string" && isId(query.call) ? query.call.toLowerCase() : "";
  // An amount typed into the box counts before one that was picked.
  const typed = text(query.other).trim() || text(query.amount).trim();
  const user = await requireUser(`/tips/new?call=${callId}&amount=${encodeURIComponent(typed)}`);
  const notice = readNotice("/tips/new", query);

  const [call] = callId ? await db.select().from(schema.calls).where(eq(schema.calls.id, callId)) : [];
  // Someone else's call and one that does not exist look the same.
  if (!call || call.customerId !== user.id) notFound();
  const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId));
  const hostName = profile?.displayName ?? "your host";
  const back = `/calls/${call.id}/results`;

  // Asked here so that a page that cannot lead anywhere says so at once; asked again, under its locks, when the form is sent.
  const why = whyNoTip(await tipFacts(db, user.id, call, new Date()));
  let tipCents: number | null = null;
  let amountProblem: string | null = null;
  try {
    tipCents = readTip(typed);
  } catch (error) {
    if (!(error instanceof ContributionError)) throw error;
    amountProblem = typed ? error.message : "Please pick or type an amount.";
  }

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href={back} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Your call with {hostName}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">A tip for {hostName}</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {why ? (
        <p className="mt-6 text-sm" data-cannot>
          {refusal(why)}
        </p>
      ) : tipCents === null ? (
        <p className="mt-6 text-sm" data-amount-problem>
          {amountProblem}{" "}
          <Link href={back} className="underline underline-offset-2">
            Choose an amount on the call&apos;s page.
          </Link>
        </p>
      ) : (
        <section className="mt-6 text-sm" data-summary>
          <p className="text-base">
            <strong>{formatMoney(chargeFor(tipCents))}, once</strong>
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            {tipSentences({ tipCents, hostName, callOn: callDay(user, call.startsAt) }).map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
          <form action={startTipAction} className="mt-5">
            <input type="hidden" name="call" value={call.id} />
            <input type="hidden" name="amount" value={typed} />
            {/* Made when this page was drawn: the same press, sent twice, is one tip. */}
            <input type="hidden" name="request" value={randomUUID()} />
            <input type="hidden" name="wording" value={TIP_WORDING_VERSION} />
            <button type="submit" className="mt-4 rounded bg-blue-600 px-4 py-2 font-medium text-white">
              Continue to the card step
            </button>
            <p className="mt-2 opacity-70">The next step asks for your card. Nothing is held until you have paid there.</p>
          </form>
        </section>
      )}
    </SitePage>
  );
}
