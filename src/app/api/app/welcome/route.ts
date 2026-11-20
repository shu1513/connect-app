import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import type { AppWelcome, AppWelcomeDone } from "@/lib/app-door/types";
import { type Shown } from "@/legal/accept";
import { isDocumentName } from "@/legal/versions";
import { timeZones } from "@/lib/time-zones";
import { acceptedBefore, finishSigningUp, WELCOME_PROBLEMS, welcomeAgreements } from "@/lib/welcome";

/**
 * The last step of signing up, for the phone app (plans/45-phone-apps/03-signing-in.md): "18 or
 * older", the general documents, and the time zone. For someone who is logged in with a confirmed
 * email address, whether or not the step is done: it is the one address such a person may use
 * before it.
 *
 * GET: what the app needs to show the step, with the documents the step accepts and the version
 * of each (plans/46-agreements-live.md, decision 7). Reading only.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "confirmed");
  if (asked instanceof Response) return asked;
  const person = asked.person!;
  const agreements = welcomeAgreements(new Date()).map(({ name, title, version, href }) => ({ name, title, version, href }));
  const body: AppWelcome = { done: person.welcomed, returning: await acceptedBefore(person.id), agreements, timeZone: person.timeZone, timeZones: timeZones() };
  return answer(body);
}

/** What the app says it showed: `agreements: [{ name, version }, ...]`, as GET gave them. Anything else is read as nothing shown. */
function shownFrom(sent: unknown): Shown {
  const shown: Shown = {};
  if (!Array.isArray(sent)) return shown;
  for (const one of sent) {
    if (one === null || typeof one !== "object") continue;
    const { name, version } = one as { name?: unknown; version?: unknown };
    if (typeof name === "string" && typeof version === "string" && isDocumentName(name)) shown[name] = version;
  }
  return shown;
}

/**
 * POST: does the step, exactly as the website's form does (one shared function). "18 or older"
 * must be sent as `true`, the documents shown must be the ones in effect, and the time zone must
 * be one from the list. A `terms: true` alone, as an older copy of the app sent it, is not
 * enough: it does not say which documents the person was shown, so nothing is written and the
 * app is told to show the step again. Doing the step a second time changes nothing and is
 * answered the same.
 */
export async function POST(request: Request) {
  const asked = await appRequest(request, "confirmed");
  if (asked instanceof Response) return asked;
  const sent: unknown = await request.json().catch(() => null);
  const given = (sent !== null && typeof sent === "object" ? sent : {}) as { adult?: unknown; agreements?: unknown; timeZone?: unknown };
  const result = await finishSigningUp(asked.person!, {
    adult: given.adult === true,
    shown: shownFrom(given.agreements),
    timeZone: typeof given.timeZone === "string" ? given.timeZone : "",
  });
  if (result === "boxes" || result === "zone" || result === "changed") return refuse("not_valid", WELCOME_PROBLEMS[result]);
  // Closed, or no longer confirmed, since the gate let her in: answered as nobody. The app asks the opening address again, which says where she stands.
  if (result === "gone") return refuse("not_signed_in");
  const body: AppWelcomeDone = { done: true };
  return answer(body);
}
