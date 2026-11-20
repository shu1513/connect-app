import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import type { AppWelcome, AppWelcomeDone } from "@/lib/app-door/types";
import { timeZones } from "@/lib/time-zones";
import { acceptedBefore, finishSigningUp, WELCOME_PROBLEMS } from "@/lib/welcome";

/**
 * The last step of signing up, for the phone app (plans/45-phone-apps/03-signing-in.md): "18 or
 * older", the terms, and the time zone. For someone who is logged in with a confirmed email
 * address, whether or not the step is done: it is the one address such a person may use before it.
 *
 * GET: what the app needs to show the step. Reading only.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "confirmed");
  if (asked instanceof Response) return asked;
  const person = asked.person!;
  const body: AppWelcome = { done: person.welcomed, returning: await acceptedBefore(person.id), timeZone: person.timeZone, timeZones: timeZones() };
  return answer(body);
}

/**
 * POST: does the step, exactly as the website's form does (one shared function). Both boxes must
 * be sent as `true`, and the time zone must be one from the list. Doing it a second time changes
 * nothing and is answered the same.
 */
export async function POST(request: Request) {
  const asked = await appRequest(request, "confirmed");
  if (asked instanceof Response) return asked;
  const sent: unknown = await request.json().catch(() => null);
  const given = (sent !== null && typeof sent === "object" ? sent : {}) as { adult?: unknown; terms?: unknown; timeZone?: unknown };
  const result = await finishSigningUp(asked.person!, {
    adult: given.adult === true,
    terms: given.terms === true,
    timeZone: typeof given.timeZone === "string" ? given.timeZone : "",
  });
  if (result === "boxes" || result === "zone") return refuse("not_valid", WELCOME_PROBLEMS[result]);
  const body: AppWelcomeDone = { done: true };
  return answer(body);
}
