import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SitePage } from "@/components/site-page";
import { readNotice } from "@/lib/notice";
import { reportedOf } from "@/lib/safety/report-form";
import { REPORT_WORDS } from "@/lib/safety/report-words";
import { requireUser } from "@/lib/session";
import { blockReportedAction } from "../../actions";

export const metadata: Metadata = { title: "Your report" };

export const dynamic = "force-dynamic";

/**
 * The receipt of a report whose block did not go through cleanly (plans/49-messaging.md, part 2):
 * the report is saved, and this page says what became of the block, with a "Block" button for the
 * person the report was about. Not every place a report is made from has such a button (a host's
 * page has none), so the receipt brings its own.
 *
 * Only the person who made the report gets it. The form sends nothing but the report's number:
 * who is blocked is looked up again on the server, from that report, when the button is pressed
 * (`blockReportedAction`). The sentence shown was signed for this very receipt, because the
 * report's number is part of the page's address.
 */
export default async function ReportSavedPage(props: PageProps<"/report/saved/[reference]">) {
  const user = await requireUser();
  const { reference: given } = await props.params;
  const reference = /^[0-9]{1,12}$/.test(given) ? Number(given) : 0;
  // Someone else's report, and a number that is no report, give the same answer.
  if (!(await reportedOf(user.id, reference))) notFound();
  const notice = readNotice(`/report/saved/${reference}`, await props.searchParams);

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{REPORT_WORDS.receiptTitle}</h1>
      <p className="mt-4 rounded border border-neutral-400 p-3 text-sm" role="status" data-report-receipt={reference}>
        {notice ?? `Your report is R-${reference}.`}
      </p>
      <form action={blockReportedAction} className="mt-6 text-sm">
        <input type="hidden" name="reference" value={reference} />
        <p className="opacity-70">{REPORT_WORDS.receiptBlock}</p>
        <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5" data-block-reported>
          {REPORT_WORDS.receiptBlockButton}
        </button>
      </form>
      <p className="mt-6 text-sm">
        <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Home
        </Link>
      </p>
      <p className="mt-2 text-sm opacity-70">{REPORT_WORDS.danger}</p>
    </SitePage>
  );
}
