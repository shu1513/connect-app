import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { hideSuggestion, makeSuggestions, markOpened, markSeen } from "@/lib/suggestions/suggestions";

/**
 * The four small steps of "Suggested hosts" for the phone app
 * (plans/45-phone-apps/04-the-home-page.md), on the very functions the website's page uses:
 *
 *   POST /api/app/suggestions/make    today's suggestions are made (reading the home page never makes them)
 *   POST /api/app/suggestions/seen    { day, places }   these cards were really on the screen
 *   POST /api/app/suggestions/opened  { day, place }    the person opened this host's page from the row
 *   POST /api/app/suggestions/hide    { handle }        never suggest this host again
 *
 * Each can only touch the person's own lines, whatever the app sends.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/app/suggestions/[step]">) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const person = asked.person!;
  const { step } = await ctx.params;
  const sent: unknown = await request.json().catch(() => null);
  const given = (sent !== null && typeof sent === "object" ? sent : {}) as { day?: unknown; places?: unknown; place?: unknown; handle?: unknown };
  const now = new Date();

  if (step === "make") {
    // A paused person gets no suggestions; nothing is written for them, so they get theirs on the day the pause ends.
    if (!person.paused) await makeSuggestions(person.id, now);
    return answer({ done: true });
  }
  if (step === "seen") {
    if (typeof given.day !== "string" || !Array.isArray(given.places)) return refuse("not_valid");
    await markSeen(person.id, given.day.slice(0, 10), given.places.slice(0, 12).filter((place): place is number => typeof place === "number"), now);
    return answer({ done: true });
  }
  if (step === "opened") {
    if (typeof given.day !== "string" || typeof given.place !== "number") return refuse("not_valid");
    await markOpened(person.id, given.day.slice(0, 10), given.place, now);
    return answer({ done: true });
  }
  if (step === "hide") {
    if (typeof given.handle !== "string" || !given.handle) return refuse("not_valid");
    try {
      await hideSuggestion(person.id, given.handle.slice(0, 100), now);
    } catch (error) {
      // As on the website: said plainly, and nothing was changed.
      console.error("[suggestions] could not hide a suggestion", error);
      return refuse("not_valid", "Something went wrong. Nothing was changed. Please try again.");
    }
    return answer({ done: true });
  }
  return refuse("not_found");
}
