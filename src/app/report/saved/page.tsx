import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlockButton } from "@/components/block-button";
import { SitePage } from "@/components/site-page";
import { readNotice } from "@/lib/notice";
import { reportedOf } from "@/lib/safety/report-form";
import { REPORT_WORDS } from "@/lib/safety/report-words";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Your report" };

export const dynamic = "force-dynamic";

/**
 * The receipt of a report whose block did not go through cleanly (plans/49-messaging.md, part 2):
 * the report is saved, and this page says what became of the block, with a "Block" button for the
 * person the report was about. Not every place a report is made from has such a button (a host's
 * page has none), so the receipt brings its own.
 *
 * Only the person who made the report gets it. The button names the person on the server's word,
 * from the report itself: the address carries only the report's number.
 */
export default async function ReportSavedPage(props: PageProps<"/report/saved">) {
  const user = await requireUser();
  const query = await props.searchParams;
  const reference = typeof query.r === "string" && /^[0-9]{1,12}$/.test(query.r) ? Number(query.r) : 0;
  const reportedId = await reportedOf(user.id, reference);
  if (!reportedId) notFound();
  const notice = readNotice("/report/saved", query);

  return (
    <SitePage className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{REPORT_WORDS.receiptTitle}</h1>
      <p className="mt-4 rounded border border-neutral-400 p-3 text-sm" role="status" data-report-receipt={reference}>
        {notice ?? `Your report is R-${reference}.`}
      </p>
      <div className="mt-6 text-sm">
        <BlockButton userId={reportedId} name="this person" back={`/report/saved?r=${reference}`} />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Home
        </Link>
      </p>
      <p className="mt-2 text-sm opacity-70">{REPORT_WORDS.danger}</p>
    </SitePage>
  );
}
