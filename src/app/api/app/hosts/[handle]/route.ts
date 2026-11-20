import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { hostPageFor } from "@/lib/app-door/host-page";
import { switchesForApps } from "@/lib/app-door/start";

/**
 * A host's page for the phone app (plans/45-phone-apps/05-search-and-a-hosts-page.md). Open to
 * anyone, like the website's page; who is looking decides what is on it, by the very rules of
 * the website's page (one shared function). `?length=30` and `?mlength=30` choose the length whose
 * open times are sent. A page that does not exist, and one this person may not open, are the same
 * "not found". As on the website, someone with "18 and terms" still to do counts as a guest here.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/hosts/[handle]">) {
  const asked = await appRequest(request, "anyone");
  if (asked instanceof Response) return asked;
  const { handle } = await ctx.params;
  const query = new URL(request.url).searchParams;
  const viewer = asked.person?.welcomed ? { id: asked.person.id } : null;
  const page = await hostPageFor(viewer, handle, { length: query.get("length") ?? undefined, mlength: query.get("mlength") ?? undefined }, switchesForApps(asked.switches));
  return page ? answer(page) : refuse("not_found");
}
