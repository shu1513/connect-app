import { answer, appRequest } from "@/lib/app-door/gate";
import { homeFor } from "@/lib/app-door/home";
import { switchesForApps } from "@/lib/app-door/start";

/**
 * The home page of someone who is signed in, for the phone app
 * (plans/45-phone-apps/04-the-home-page.md): the next call, the calendar around the day asked
 * for (`?day=2026-11-20`; anything else is today), requests, calls to rate, followed hosts and
 * suggested hosts. A paused person may look. Reading only: it never opens a room and never makes
 * suggestions.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const day = new URL(request.url).searchParams.get("day");
  return answer(await homeFor(asked.person!, day, switchesForApps(asked.switches)));
}
