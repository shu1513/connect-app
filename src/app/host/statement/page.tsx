import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SitePage } from "@/components/site-page";
import { formatMoney } from "@/lib/payments/access";
import { COLUMNS, MONTH_NAMES, PAID_FOR, readYear, SOURCES, statementFor, statementYears } from "@/lib/payments/statement";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Yearly statement" };
export const dynamic = "force-dynamic";

/**
 * A host's statement of one calendar year (plans/46, part 5): a page made for printing, and a link to the same
 * numbers as a file for a spreadsheet. A summary for her own records, not a tax form.
 */
export default async function StatementPage(props: PageProps<"/host/statement">) {
  const user = await requireUser("/host/statement");
  const years = await statementYears(user.id, new Date());
  if (!years) redirect("/host");
  const query = await props.searchParams;
  // Last year's is the one a host comes for in January; before a first full year, this year's.
  const year = readYear(query.year, years.first, years.last) ?? Math.max(years.first, years.last - 1);
  const statement = await statementFor(user.id, year);
  const all = Array.from({ length: years.last - years.first + 1 }, (_, index) => years.last - index);
  const cell = "border border-neutral-400 px-2 py-1 text-right tabular-nums";
  const head = "border border-neutral-400 px-2 py-1 text-left align-bottom";

  return (
    <SitePage className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm print:hidden">
        <Link href="/host" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Hosting
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold" data-statement-year={year}>
        Your statement for {year}
      </h1>
      <p className="mt-1 text-sm">{user.name}</p>
      <p className="mt-3 rounded border border-neutral-400 p-3 text-sm">
        <strong>This is a summary for your own records. It is not a tax form.</strong> You are responsible for reporting your own earnings. All amounts are in US dollars. Each amount is counted in the month it
        was written into Connect&apos;s books, by the clock in UTC; that can be a little after your customer&apos;s bank moved the money, and it is not the day your own bank paid you.
      </p>
      <p className="mt-3 text-sm print:hidden">
        Year:{" "}
        {all.map((one) => (
          <Link key={one} href={`/host/statement?year=${one}`} className={`mr-3 underline underline-offset-2 ${one === year ? "font-bold" : ""}`} aria-current={one === year ? "page" : undefined}>
            {one}
          </Link>
        ))}
        <a href={`/host/statement/csv?year=${year}`} className="ml-2 underline underline-offset-2" data-statement-file>
          Download {year} as a file for a spreadsheet
        </a>
        <span className="ml-3 opacity-70">To keep a copy of this page, print it or save it as a PDF from your browser.</span>
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-statement>
          <thead>
            <tr>
              <th scope="col" className={head}>
                Month
              </th>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" className={head}>
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statement.months.map((sums, index) => (
              <tr key={MONTH_NAMES[index]}>
                <th scope="row" className={`${head} font-normal`}>
                  {MONTH_NAMES[index]}
                </th>
                {COLUMNS.map((column) => (
                  <td key={column.key} className={cell}>
                    {formatMoney(sums[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-statement-total>
              <th scope="row" className={head}>
                Year {year}
              </th>
              {COLUMNS.map((column) => (
                <td key={column.key} className={`${cell} font-bold`} data-total={column.key}>
                  {formatMoney(statement.total[column.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className="mt-6 text-lg font-semibold">What customers paid for</h2>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {SOURCES.map((source) => (
          <li key={source} data-paid-by={source}>
            {PAID_FOR[source]}: {formatMoney(statement.paidBy[source])}
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-lg font-semibold">What the columns mean</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>
          <strong>Paid by customers:</strong> what was charged to your customers. A member&apos;s month is counted when the member paid it. A tip is counted with the payment fee the customer paid on top.
        </li>
        <li>
          <strong>Given back:</strong> refunds, in the month the refund was written into our books. A payment of December given back in January is in two different years.
        </li>
        <li>
          <strong>Carried by Connect:</strong> what Connect paid itself after you had collected your share. Two things are in it: a refund of a contribution or a tip that Connect gave from its own money (your share
          was not touched), and what Connect decided not to take back from you of a share you owed back (after a refund of a call, or after a bank dispute that was lost), in the month it decided so. If Connect later takes such a
          decision off its books again (the bank decided for you after all, say), that shows as a minus.
        </li>
        <li>
          <strong>Connect&apos;s fees:</strong> our fee on calls, memberships and contributions. A fee we returned with a refund is taken off again, so a month can show a minus.
        </li>
        <li>
          <strong>Payment fees on tips:</strong> the card fee your customer paid on top of a tip. You got the tip whole.
        </li>
        <li>
          <strong>Your share:</strong> what you earned, after refunds. For a member&apos;s month it is counted as the calls happen, or when unused time runs out, so it can fall in a later month than the payment. A refund of a call
          lowers it, also when Connect then does not take the money back from you. A contribution or a tip that Connect refunds after you collected does not lower it (that is in &quot;Carried by Connect&quot;). These columns are a record of the year, not a balance: what is still owed to you, or by you, is on your Hosting page under &quot;Your earnings&quot;.
        </li>
        <li>
          <strong>Sent to you:</strong> what Connect sent to your payout account when you collected, after the collection charge. Nothing is taken off here for money that went back later.
        </li>
        <li>
          <strong>Taken back or paid back:</strong> what went back from you after it had been sent: a share taken back out of a transfer (after a lost bank dispute, or after a refund Connect gave once you had collected), or what you
          paid back to Connect yourself. It is counted in the month Connect wrote it into its books, which can be later than the day the money moved (a payment you made on 31 December and we recorded on 2 January is in January).
        </li>
        <li>
          <strong>Collection charges:</strong> the charge taken each time you collected. It is already off &quot;Sent to you&quot;.
        </li>
        <li>
          <strong>Not included:</strong> the payment itself that a customer&apos;s bank took back in a dispute (it is not in &quot;Given back&quot;). If you had one, ask us for the
          amounts.
        </li>
      </ul>
    </SitePage>
  );
}
