import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readNotice } from "@/lib/notice";
import { endedScreenFor } from "@/lib/call-page/ended";
import { callStopState } from "@/lib/safety/report-form";
import { REPORT_TEXT_MAX, REPORT_WORDS } from "@/lib/safety/report-words";
import { REPORT_REASONS } from "@/lib/safety/reports";
import { requireUser } from "@/lib/session";
import { sendReport } from "./actions";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Report" };

/** The report form. Reached from a host's page, a request, a call's page, the screen after "End call now", a post of a host's diary, or a message of a conversation. */
export default async function ReportPage(props: PageProps<"/report">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const context = (["call", "booking", "profile", "post", "message"] as const).find((c) => typeof query[c] === "string");
  if (!context) notFound();
  const contextId = String(query[context]);
  const notice = readNotice("/report", query);
  // Said only when true: the call really was ended with the button. And "has been ended for both" only once the
  // room is written down as closed; until then, "is being ended" (as in the phone app).
  const stop = context === "call" ? await callStopState(user.id, contextId) : "no";
  // For a customer who ended the call himself: what a report does to that call's charge right now (plans/50, decision 19).
  const ended = stop !== "no" ? await endedScreenFor(user.id, contextId, new Date()) : null;
  const money = ended && ended !== "not_ended" ? ended.report.money : null;
  const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{REPORT_WORDS.title}</h1>
      {stop !== "no" && (
        <p className="mt-2 text-sm">{stop === "stopped" ? REPORT_WORDS.stopped : REPORT_WORDS.stopping}</p>
      )}
      {money && <p className="mt-2 text-sm">{money}</p>}
      <p className="mt-2 text-sm opacity-70">
        {context === "post" ? REPORT_WORDS.aboutPost : REPORT_WORDS.aboutPerson} {REPORT_WORDS.readThe}{" "}
        <Link href="/rules" target="_blank" className="underline underline-offset-2">
          {REPORT_WORDS.rules}
        </Link>
        .
      </p>
      {notice && (
        <p role="alert" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}
      <form action={sendReport} className="mt-6 space-y-4 text-sm">
        <input type="hidden" name="context" value={context} />
        <input type="hidden" name="contextId" value={contextId} />
        <label className="block">
          {REPORT_WORDS.what}
          <select name="reason" required className={field} defaultValue="">
            <option value="" disabled>
              {REPORT_WORDS.choose}
            </option>
            {REPORT_REASONS.map((reason) => (
              <option key={reason.key} value={reason.key}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {REPORT_WORDS.more}
          <textarea name="text" rows={5} maxLength={REPORT_TEXT_MAX} className={field} />
        </label>
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {REPORT_WORDS.send}
        </button>
      </form>
      <p className="mt-6 text-sm opacity-70">{REPORT_WORDS.danger}</p>
    </SitePage>
  );
}
