import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { callsFor } from "@/lib/app-door/calls";

/**
 * A person's calls for the phone app's Calls place, a page at a time
 * (plans/45-phone-apps/08-the-calls-page.md, decision 6):
 *
 *   GET /api/app/calls?kind=coming&page=1   every call that is not over, the soonest first
 *   GET /api/app/calls?kind=past&page=1     the calls that are over, the newest first
 *
 * Whose calls they are comes from the sign-in. Never a call the person is not part of.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  const page = query.get("page") ?? "1";
  if ((kind !== "coming" && kind !== "past") || !/^[1-9]\d{0,3}$/.test(page)) return refuse("not_valid");
  return answer(await callsFor(asked.person!, kind, Number(page), new Date()));
}
