import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { APP_REPORT_PLACES, reportFormFor, type AppReportPlace } from "@/lib/app-door/report";
import type { AppReportSent } from "@/lib/app-door/types";
import { sendReportFor } from "@/lib/safety/report-form";
import { ReportError } from "@/lib/safety/reports";

const isPlace = (value: unknown): value is AppReportPlace => typeof value === "string" && (APP_REPORT_PLACES as readonly string[]).includes(value);
/** A call's or a request's id, or a host's handle: short, and nothing but letters, digits, "-" and "_". */
const isPlaceId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);

/**
 * The report form, from the phone app (plans/45-phone-apps/09-the-call.md, decision 9), on the
 * very functions the website's form uses:
 *
 *   GET  /api/app/report?call=<id> | ?booking=<id> | ?profile=<handle>   the form
 *   POST /api/app/report   { place, id, reason, text }                   send the report
 *
 * For anyone signed in, a paused person too (as on the website). Who the report is about is
 * worked out on the server from the place; the app never names a person. Reporting a person
 * also blocks them, as the form says.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const query = new URL(request.url).searchParams;
  const places = APP_REPORT_PLACES.filter((place) => query.has(place));
  // Exactly one place, and a thing that can be one.
  if (places.length !== 1 || !isPlaceId(query.get(places[0]))) return refuse("not_found");
  return answer(await reportFormFor(asked.person!, places[0], query.get(places[0])!));
}

export async function POST(request: Request) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const sent: unknown = await request.json().catch(() => null);
  const given = (sent !== null && typeof sent === "object" ? sent : {}) as { place?: unknown; id?: unknown; reason?: unknown; text?: unknown };
  if (!isPlace(given.place) || !isPlaceId(given.id) || typeof given.reason !== "string" || (given.text !== undefined && typeof given.text !== "string")) return refuse("not_valid");
  try {
    const { notice } = await sendReportFor(asked.person!.id, { context: given.place, contextId: given.id, reason: given.reason, text: typeof given.text === "string" ? given.text : "" }, new Date());
    const body: AppReportSent = { notice };
    return answer(body);
  } catch (error) {
    // Not taken, in the form's own sentence ("Choose a reason.", "Call not found.", the day's limit).
    if (error instanceof ReportError) return refuse("not_valid", error.message);
    // Anything else: the report may or may not have been written down (the block that follows it can fail by
    // itself), so it is not said that it was not.
    console.error("[safety] a report from the app failed", error);
    return new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
