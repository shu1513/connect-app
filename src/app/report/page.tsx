import Link from "next/link";
import { notFound } from "next/navigation";
import { readNotice } from "@/lib/notice";
import { REPORT_REASONS } from "@/lib/safety/reports";
import { callForParticipant } from "@/lib/payments/access";
import { requireUser } from "@/lib/session";
import { sendReport } from "./actions";

/** The report form. Reached from a host's page, a request, a call's page, or "End call and report". */
export default async function ReportPage(props: PageProps<"/report">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const context = (["call", "booking", "profile"] as const).find((c) => typeof query[c] === "string");
  if (!context) notFound();
  const contextId = String(query[context]);
  const notice = readNotice("/report", query);
  // Said only when true: the call really was ended with the button.
  const stopped = context === "call" ? (await callForParticipant(contextId, user.id))?.call.safetyEndedAt !== null && (await callForParticipant(contextId, user.id)) !== null : false;
  const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Report</h1>
      {stopped && (
        <p className="mt-2 text-sm">
          The call has been ended for both of you. Nobody can rejoin, and the charge for it will be looked at by a person.
        </p>
      )}
      <p className="mt-2 text-sm opacity-70">
        Tell us what happened. Only our team reads this. Reporting someone also blocks them: they cannot contact you through Connect
        again. Read the{" "}
        <Link href="/rules" target="_blank" className="underline underline-offset-2">
          rules
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
          What happened?
          <select name="reason" required className={field} defaultValue="">
            <option value="" disabled>
              Choose a reason
            </option>
            {REPORT_REASONS.map((reason) => (
              <option key={reason.key} value={reason.key}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Tell us more (optional)
          <textarea name="text" rows={5} maxLength={2000} className={field} />
        </label>
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          Send report
        </button>
      </form>
      <p className="mt-6 text-sm opacity-70">If someone is in danger right now, contact your local emergency services first.</p>
    </main>
  );
}
