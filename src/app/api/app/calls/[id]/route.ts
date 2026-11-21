import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { callPageFor } from "@/lib/app-door/calls";

/**
 * One call's page before the call, for one of its two people
 * (plans/45-phone-apps/08-the-calls-page.md). Reading it changes nothing and asks Stripe nothing:
 * the app asks this address again while the page is in front. A call that does not exist and one
 * that is somebody else's are the same "not found".
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/calls/[id]">) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const { id } = await ctx.params;
  const page = await callPageFor(asked.person!, id, new Date());
  return page ? answer(page) : refuse("not_found");
}
