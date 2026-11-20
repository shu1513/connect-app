import { readYear, statementCsv, statementFor, statementYears } from "@/lib/payments/statement";
import { getUser } from "@/lib/session";

/**
 * A host's yearly statement as a file for a spreadsheet (plans/46, part 5): the same numbers as the page
 * /host/statement shows. Only for the host herself, and only for a year she can have a statement for.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Please log in.", { status: 401 });
  const years = await statementYears(user.id, new Date());
  if (!years) return new Response("Not found.", { status: 404 });
  const asked = new URL(request.url).searchParams.getAll("year");
  const year = asked.length === 1 ? readYear(asked[0], years.first, years.last) : null;
  if (year === null) return new Response("Not found.", { status: 404 });
  return new Response(statementCsv(await statementFor(user.id, year)), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="connect-statement-${year}.csv"`, "cache-control": "no-store" },
  });
}
